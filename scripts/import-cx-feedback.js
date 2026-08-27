#!/usr/bin/env node
/**
 * Import / update skript: cx_feedback  (v2 — fix datumu)
 * --------------------------------------------------------
 * Použití:
 *   node scripts/import-cx-feedback.js --dry-run   ← nejdřív dry run
 *   node scripts/import-cx-feedback.js             ← ostrý import
 *   node scripts/import-cx-feedback.js --fix-dates ← opraví existující záznamy s číslem místo datumu
 *   node scripts/import-cx-feedback.js --fix-dates --dry-run  ← jen ukáže co by opravil
 */

const admin = require('firebase-admin');
const XLSX = require('xlsx');
const path = require('path');

const XLSX_FILE = path.join(__dirname, 'Souhrn_zpe_tne__vazby__1_.xlsx');
const SHEET_NAME = 'List 2';
const DRY_RUN = process.argv.includes('--dry-run');
const FIX_DATES = process.argv.includes('--fix-dates');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'koupelny-navstevnost',
});
const db = admin.firestore();

// ── Datum ────────────────────────────────────────────────────────────────────
function excelSerialToDate(serial) {
  const excelEpoch = new Date(1899, 11, 30);
  return new Date(excelEpoch.getTime() + serial * 86400000).toISOString().slice(0, 10);
}

function normalizeDateStr(val) {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number' && val > 40000) return excelSerialToDate(val);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = String(val).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const n = Number(val);
  if (!isNaN(n) && n > 40000) return excelSerialToDate(n);
  return s;
}

// ── Normalizace ──────────────────────────────────────────────────────────────
function normalizeStavHovoru(raw) {
  if (!raw) return '';
  const v = String(raw).trim().toLowerCase();
  const map = {
    'dokončeno': 'Dokončeno',
    'nezvednutý hovor': 'Nezvednutý hovor',
    'zavolat jindy': 'Zavolat jindy',
    'domluven termín hovoru': 'Domluven termín',
    'hovor už jednou proběhl': 'Již kontaktováno',
    'až vše bude hotové': 'Až bude hotové',
    'nemá zajem': 'Nemá zájem',
    'nic si neobjednala': 'Nemá zájem',
    'vyřadit z hovorů': 'Nemá zájem',
  };
  return map[v] || String(raw).trim();
}

function normalizeStredisko(raw) {
  if (!raw) return '';
  const v = String(raw).trim().toLowerCase();
  const map = {
    'praha': 'praha', 'brno': 'brno', 'hradec': 'hradec',
    'hradec králové': 'hradec', 'pardubice': 'pardubice',
    'eshop': 'eshop', 'kolín': 'kolín',
  };
  return map[v] || String(raw).trim();
}

function normalizePhone(raw) {
  if (!raw) return '';
  return String(raw).replace(/^=/, '').replace(/\+420/g, '').replace(/[\s\-]/g, '').trim();
}

function parseNum(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function makeKey(cislo, telefon, datumKontaktu) {
  return [String(cislo || '').trim(), normalizePhone(telefon), normalizeDateStr(datumKontaktu)].join('|');
}

// ── Oprava existujících záznamů s číselným datumem ──────────────────────────
async function fixExistingDates() {
  console.log('\n=== FIX-DATES mód ===');
  console.log('Hledám záznamy kde datumKontaktu je číslo místo datumu...');

  const snap = await db.collection('cx_feedback').get();
  const toFix = [];

  snap.forEach(doc => {
    const d = doc.data();
    const val = d.datumKontaktu;
    if (typeof val === 'number' && val > 40000) {
      toFix.push({ id: doc.id, serial: val, fixed: excelSerialToDate(val) });
    } else if (typeof val === 'string' && /^\d{5,6}$/.test(val.trim())) {
      const n = Number(val);
      if (n > 40000) toFix.push({ id: doc.id, serial: n, fixed: excelSerialToDate(n) });
    }
  });

  console.log(`Nalezeno záznamů k opravě: ${toFix.length}`);

  if (toFix.length === 0) {
    console.log('Nic k opravě. ✅');
    return;
  }

  console.log('Ukázka prvních 5:');
  toFix.slice(0, 5).forEach(r => console.log(`  ${r.id}: ${r.serial} → ${r.fixed}`));

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Žádná data nebyla změněna. Spusť --fix-dates bez --dry-run pro zápis.');
    return;
  }

  const BATCH_SIZE = 400;
  let fixed = 0;
  for (let i = 0; i < toFix.length; i += BATCH_SIZE) {
    const batch = db.batch();
    toFix.slice(i, i + BATCH_SIZE).forEach(r => {
      batch.update(db.collection('cx_feedback').doc(r.id), { datumKontaktu: r.fixed });
    });
    await batch.commit();
    fixed += Math.min(BATCH_SIZE, toFix.length - i);
    console.log(`  Opraveno: ${fixed}/${toFix.length}`);
  }
  console.log(`\n✅ Opraveno ${fixed} záznamů.`);
}

// ── Hlavní import ────────────────────────────────────────────────────────────
async function main() {
  if (FIX_DATES) {
    await fixExistingDates();
    process.exit(0);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`CX Feedback Import  ${DRY_RUN ? '[DRY RUN]' : '[OSTRÝ IMPORT]'}`);
  console.log('='.repeat(60));

  // raw: true = xlsx vrátí sériová čísla, my je sami konvertujeme
  const wb = XLSX.readFile(XLSX_FILE);
  const ws = wb.Sheets[SHEET_NAME];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  console.log(`\nNačteno řádků z XLSX: ${rows.length}`);

  console.log('Načítám existující záznamy z Firestore...');
  const snap = await db.collection('cx_feedback').get();
  const existingKeys = new Set();
  snap.forEach(doc => {
    const d = doc.data();
    existingKeys.add(makeKey(d.cisloObjednavky, d.telefon, d.datumKontaktu));
  });
  console.log(`Existující záznamy v Firestore: ${snap.size}`);

  let skippedJunk = 0, skippedDuplicate = 0;
  const toImport = [];

  for (const row of rows) {
    const jmeno = String(row['Jméno'] || '').trim();
    const telefon = normalizePhone(row['Telefonní číslo']);
    const cislo = String(row['Číslo objednávky'] || '').trim();
    const datumKontaktu = normalizeDateStr(row['ko']);
    const strediskoRaw = String(row['Středisko'] || '');

    if (!jmeno && !telefon && !cislo) { skippedJunk++; continue; }
    if (strediskoRaw.toLowerCase().includes('nahráno') || strediskoRaw.toLowerCase() === 'středisko') {
      skippedJunk++; continue;
    }

    const key = makeKey(cislo, telefon, datumKontaktu);
    if (existingKeys.has(key)) { skippedDuplicate++; continue; }

    toImport.push({
      jmeno,
      firma: String(row['Firma'] || '').trim(),
      stredisko: normalizeStredisko(strediskoRaw),
      obchodnik: String(row['Činnost (obchodník)'] || '').trim(),
      sluzba: String(row['Služba'] || '').trim(),
      celkem: String(row['Celkem'] || '').trim(),
      datumObjednavky: normalizeDateStr(row['Datum objednávky']),
      cisloObjednavky: cislo,
      email: String(row['Email'] || '').trim(),
      stavObjednavky: String(row['Stav objednávky'] || '').trim(),
      stavHovoru: normalizeStavHovoru(String(row['stav hovoru'] || '')),
      kdoVolal: String(row['Kdo volal'] || '').trim(),
      datumKontaktu,
      telefon,
      poznamkyHovoru: String(row['Poznámky k hovoru'] || '').trim(),
      poznamkaSpokojenosti: String(row['Spokojenost / Nespokojenost'] || '').trim(),
      doporuceni: parseNum(row['Doporučení 1-10']),
      selByZnovu: String(row['Šel byste do toho s námi znovu ?'] || '').trim(),
      coZlepsit: String(row['Co bychom mohli udělat lépe ?'] || '').trim(),
      celkoveHodnoceniText: String(row['Celkové hodnocení'] || '').trim(),
      spokojenost: null,
      importovano: true,
      createdAt: new Date().toISOString(),
    });
  }

  console.log(`\nVýsledek analýzy:`);
  console.log(`  Přeskočeno (junk/metadata): ${skippedJunk}`);
  console.log(`  Přeskočeno (duplicita):     ${skippedDuplicate}`);
  console.log(`  Nových záznamů k importu:   ${toImport.length}`);

  if (toImport.length === 0) {
    console.log('\nŽádné nové záznamy. Hotovo.');
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Ukázka prvního záznamu:');
    console.log(JSON.stringify(toImport[0], null, 2));
    console.log('\n[DRY RUN] Žádná data nebyla zapsána.');
    process.exit(0);
  }

  const BATCH_SIZE = 400;
  let written = 0;
  for (let i = 0; i < toImport.length; i += BATCH_SIZE) {
    const batch = db.batch();
    toImport.slice(i, i + BATCH_SIZE).forEach(doc => {
      batch.set(db.collection('cx_feedback').doc(), doc);
    });
    await batch.commit();
    written += Math.min(BATCH_SIZE, toImport.length - i);
    console.log(`  Zapsáno: ${written}/${toImport.length}`);
  }

  console.log(`\n✅ Import dokončen. Přidáno: ${written} záznamů.`);
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Chyba:', err.message);
  process.exit(1);
});

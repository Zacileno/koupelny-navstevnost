#!/usr/bin/env node
/**
 * Jednorázový import historických leadů z Google Sheetu (Make → sheet, srpen–říjen
 * 2026) do kolekce `leads` (modul Leady, public/leady/leady.html).
 *
 * Všechny řádky se založí jako UZAVŘENÉ — výsledek "Schůzka domluvena", pokud
 * sloupec "Domluvena schůzka?" začíná na "ano", jinak "Historie ze sheetu".
 * Kdo je ještě rozpracovaný, Terka v aplikaci otevře tlačítkem "Znovu otevřít".
 * Do statistik SLA/konverze se importované leady nepočítají (source: import-sheet).
 *
 * Idempotentní: ID dokumentu = sheet-<číslo řádku>, existující se přeskočí.
 * CSV obsahuje osobní údaje zákazníků — do repa ho NEcommitovat.
 * --------------------------------------------------------
 * Použití:
 *   1. Sheet → Soubor → Stáhnout → CSV (List 1)
 *   2. node scripts/import-leady-sheet.js ~/Downloads/leady.csv --dry-run
 *   3. node scripts/import-leady-sheet.js ~/Downloads/leady.csv
 */

const fs = require('fs');
const admin = require('firebase-admin');
const { addWorkingMinutes, fromPrague, FIRST_CONTACT_SLA_MIN } = require('../functions/leady-sla');
const { _internal: { parseSource, normalizePhone } } = require('../functions/leady');

const DRY_RUN = process.argv.includes('--dry-run');
const CSV_FILE = process.argv.slice(2).find(a => !a.startsWith('--'));

if (!CSV_FILE) {
  console.error('Chybí cesta k CSV: node scripts/import-leady-sheet.js <soubor.csv> [--dry-run]');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'koupelny-navstevnost',
});
const db = admin.firestore();
const { Timestamp } = admin.firestore;

// Minimální CSV parser (uvozovky, čárky a nové řádky uvnitř buněk).
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// "15-08-2026, 1:48:57" (pražský čas)
function parseReceived(s) {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s.trim());
  if (!m) return null;
  return fromPrague(+m[3], +m[2], +m[1], +m[4] * 60 + +m[5] + (+m[6] || 0) / 60);
}

// "17.8.2026" → poledne toho dne (čas hovoru sheet nezná)
function parseContactDate(s) {
  const m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(s.trim());
  return m ? fromPrague(+m[3], +m[2], +m[1], 12 * 60) : null;
}

const clean = (s) => {
  const v = (s || '').trim();
  return /^x$/i.test(v) ? '' : v;
};

function studioFromText(s) {
  const t = s.toLowerCase();
  if (t.includes('brno')) return 'brno';
  if (t.includes('praha') || t.includes('prahy')) return 'praha';
  if (t.includes('hradec')) return 'hradec';
  if (t.includes('pardubic')) return 'pardubice';
  return null;
}

async function main() {
  const rows = parseCsv(fs.readFileSync(CSV_FILE, 'utf8').replace(/^﻿/, ''));
  const [header, ...data] = rows;
  console.log(`Hlavička: ${header.join(' | ')}`);

  let created = 0, skipped = 0, exists = 0;
  for (let i = 0; i < data.length; i++) {
    const sheetRow = i + 2;
    const [received, phoneRaw, url, contactDate, name, email, meetingCol, ...noteCols] = data[i];
    const phone = normalizePhone(phoneRaw || '');
    const mail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(email)) ? clean(email).toLowerCase() : '';
    const receivedAt = parseReceived(received || '');

    if ((!phone && !mail) || !receivedAt) {
      if ((phoneRaw || '').trim() || (received || '').trim()) console.log(`  řádek ${sheetRow}: přeskočen (bez kontaktu/data): "${phoneRaw}"`);
      skipped++;
      continue;
    }

    const ref = db.collection('leads').doc(`sheet-${sheetRow}`);
    if (!DRY_RUN && (await ref.get()).exists) { exists++; continue; }

    const meetingText = clean(meetingCol);
    const isMeeting = /^ano/i.test(meetingText);
    const notes = noteCols.map(n => n.trim()).filter(Boolean).join('\n');
    const firstAttempt = parseContactDate(contactDate || '');

    const lead = {
      receivedAt: Timestamp.fromDate(receivedAt),
      source: 'import-sheet',
      sheetRow,
      phone,
      phoneRaw: (phoneRaw || '').slice(0, 100),
      email: mail,
      name: clean(name),
      sourceUrl: (url || '').trim(),
      ...parseSource((url || '').trim()),
      status: 'closed',
      attempts: [],
      slaDueAt: Timestamp.fromDate(addWorkingMinutes(receivedAt, FIRST_CONTACT_SLA_MIN)),
      nextActionAt: null,
      firstAttemptAt: firstAttempt ? Timestamp.fromDate(firstAttempt) : null,
      notes,
      outcome: isMeeting ? 'meeting' : 'legacy',
      outcomeNote: meetingText,
      meeting: isMeeting ? { studio: studioFromText(`${meetingText} ${notes}`), at: null, designerSlug: null, raynetUrl: null } : null,
      closedAt: Timestamp.now(),
      closedBy: 'import-sheet',
      duplicateOfId: null,
      raw: JSON.stringify(data[i]).slice(0, 10000),
      updatedAt: Timestamp.now(),
      updatedBy: 'import-sheet',
    };

    console.log(`  řádek ${sheetRow}: ${phone || mail} · ${lead.channel} · ${lead.outcome}${isMeeting ? ` (${lead.meeting.studio ?? '?'})` : ''}`);
    if (!DRY_RUN) await ref.create(lead);
    created++;
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Založeno: ${created}, přeskočeno: ${skipped}, už existovalo: ${exists}`);
}

main().catch(err => { console.error(err); process.exit(1); });

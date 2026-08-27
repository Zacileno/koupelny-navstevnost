const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'koupelny-navstevnost',
});
const db = admin.firestore();

const DRY_RUN = process.argv.includes('--dry-run');

// Excel sériové číslo → "YYYY-MM-DD"
function excelSerialToDate(serial) {
  const epoch = new Date(1899, 11, 30);
  return new Date(epoch.getTime() + serial * 86400000).toISOString().slice(0, 10);
}

// Kanonické jméno obchodníka nebo null (= smazat pole / nastavit "")
const OBCHODNIK_MAP = {
  'baru': 'Bára',
  'niky': 'Nikča',
  'vali': 'Valerie',
};

// Junk hodnoty — nastavíme na ""
const OBCHODNIK_JUNK = new Set([
  '26pr00022',
  'činnost',
  'zašlu jí qr kod',
  'nahráno 17.2.2026 - všechny realizace 2028',
]);

function normalizeObchodnik(val) {
  if (!val) return null; // beze změny
  const lower = val.trim().toLowerCase();
  if (OBCHODNIK_JUNK.has(lower)) return ''; // vyčistit
  if (OBCHODNIK_MAP[lower]) return OBCHODNIK_MAP[lower]; // opravit přezdívku
  return null; // beze změny
}

async function main() {
  console.log(`\n=== CX Feedback Cleanup ${DRY_RUN ? '[DRY RUN]' : '[OSTRÝ RUN]'} ===\n`);

  const snap = await db.collection('cx_feedback').get();
  console.log(`Celkem záznamů v Firestore: ${snap.size}`);

  const toUpdate = [];

  snap.forEach(doc => {
    const d = doc.data();
    const update = {};

    // 1. Oprava datumKontaktu — číslo → string
    const dk = d.datumKontaktu;
    if (typeof dk === 'number' && dk > 40000) {
      update.datumKontaktu = excelSerialToDate(dk);
    } else if (typeof dk === 'string' && /^\d{5,6}$/.test(dk.trim())) {
      update.datumKontaktu = excelSerialToDate(Number(dk));
    }

    // 2. Oprava datumObjednavky — číslo → string
    const dob = d.datumObjednavky;
    if (typeof dob === 'number' && dob > 40000) {
      update.datumObjednavky = excelSerialToDate(dob);
    } else if (typeof dob === 'string' && /^\d{5,6}$/.test(dob.trim())) {
      update.datumObjednavky = excelSerialToDate(Number(dob));
    }

    // 3. Oprava obchodnik
    const normalizedObchodnik = normalizeObchodnik(d.obchodnik);
    if (normalizedObchodnik !== null) {
      update.obchodnik = normalizedObchodnik;
    }

    if (Object.keys(update).length > 0) {
      toUpdate.push({ id: doc.id, update });
    }
  });

  console.log(`Záznamů k úpravě: ${toUpdate.length}`);

  // Ukázka prvních 10
  console.log('\nUkázka:');
  toUpdate.slice(0, 10).forEach(r => {
    console.log(`  ${r.id}:`, JSON.stringify(r.update));
  });

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Žádná data nebyla změněna.');
    process.exit(0);
  }

  // Batch update po 400
  const BATCH_SIZE = 400;
  let done = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = db.batch();
    toUpdate.slice(i, i + BATCH_SIZE).forEach(r => {
      batch.update(db.collection('cx_feedback').doc(r.id), r.update);
    });
    await batch.commit();
    done += Math.min(BATCH_SIZE, toUpdate.length - i);
    console.log(`  Hotovo: ${done}/${toUpdate.length}`);
  }

  console.log(`\n✅ Cleanup dokončen. Upraveno ${done} záznamů.`);
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Chyba:', err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Založí výchozí data modulu Rezervace (docs/rezervace-spec.md, kap. 3 a 8):
 * dvě služby v `res_services` a výchozí `config/rezervace`. Hodnoty ⚠️ ze specu
 * (délky, předstih, horizont) jsou tady jako výchozí — měnit se pak dají na
 * stránce /rezervace/nastaveni.html.
 *
 * Idempotentní: existující dokumenty nepřepisuje (jen doplní chybějící).
 * Výchozí je --dry-run (jen vypíše, co by udělal). Ostře s --apply.
 * --------------------------------------------------------
 * Použití:
 *   node scripts/seed-rezervace.js                 ← dry-run proti produkci
 *   node scripts/seed-rezervace.js --apply         ← ostře proti produkci
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-rezervace.js --apply --demo
 *       ← emulátor: navíc ukázkový designér, bloky dostupnosti a config/raynet {mock:true}
 */

const admin = require('firebase-admin');

const APPLY = process.argv.includes('--apply');
const DEMO = process.argv.includes('--demo');
const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;

if (DEMO && !EMULATOR) {
  console.error('--demo jde jen proti emulátoru (FIRESTORE_EMULATOR_HOST).');
  process.exit(1);
}

admin.initializeApp(EMULATOR
  ? { projectId: 'koupelny-navstevnost' }
  : { credential: admin.credential.applicationDefault(), projectId: 'koupelny-navstevnost' });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const SERVICES = {
  'konzultace-studio': {
    name: 'Konzultace ve studiu',
    type: 'studio',
    description: 'Osobní konzultace s designérem v našem studiu.',
    durationMin: 60,          // ⚠️
    minLeadMinutes: 60,       // ⚠️ "kdykoliv" = za 1 hodinu
    minLeadDays: 0,
    leadDayMode: 'calendar',
    horizonDays: 60,          // ⚠️
    bufferMin: 0,
    requiresConfirmation: false,
    priceText: 'zdarma',
    active: true,
    order: 1,
  },
  'navrh-doma': {
    name: 'Návrh u vás doma',
    type: 'home',
    description: 'Designér přijede k vám, zaměří prostor a navrhne koupelnu na místě.',
    durationMin: 120,         // ⚠️
    minLeadMinutes: 0,
    minLeadDays: 2,
    leadDayMode: 'calendar',  // ⚠️ kalendářní, nebo pracovní dny
    horizonDays: 60,          // ⚠️
    bufferMin: 0,
    requiresConfirmation: true, // ⚠️ requested → CX potvrdí po úhradě zálohy
    priceText: '4 990 Kč vč. DPH',
    active: true,
    order: 2,
  },
};

const CONFIG = {
  studios: {
    praha: { name: 'Praha', address: '', openingHours: {} },
    brno: { name: 'Brno', address: '', openingHours: {} },
    hradec: { name: 'Hradec Králové', address: '', openingHours: {} },
    pardubice: { name: 'Pardubice', address: '', openingHours: {} },
  },
  bulkEmail: '',
  alertRecipients: [],
  privacyUrl: '',
  blockHolidays: true,
  stepMin: 30,
  maxActivePerPhone: 3,
  raynet: { busyEntities: ['event', 'meeting'], writeEntity: 'event', cancelMode: 'delete', createContact: true, liveCheck: true },
};

async function ensure(ref, data) {
  const snap = await ref.get();
  if (snap.exists) {
    console.log(`  = ${ref.path} už existuje, beze změny`);
    return;
  }
  console.log(`  + ${ref.path}${APPLY ? '' : ' (dry-run)'}`);
  if (!APPLY) return;
  await ref.set({ ...data, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  if (!(await ref.get()).exists) throw new Error(`Zpětné čtení ${ref.path} selhalo`);
}

// Ukázková data jen pro emulátor: designér s bloky na 14 dní dopředu.
async function seedDemo() {
  const { fromPrague, pragueParts, nextDay, isWorkingDay } = require('../functions/shared/cas');
  await db.collection('users').doc('demo-designer').set({
    name: 'Demo Designérka', active: true, department: 'sales', studios: ['praha'], email: 'demo@example.test',
    platformRole: 'admin', reservations: { enabled: true, studios: ['praha'], services: Object.keys(SERVICES), raynetUserId: 1 },
  }, { merge: true });
  let { y, m, d } = pragueParts(new Date());
  for (let i = 0; i < 14; i++) {
    if (isWorkingDay(y, m, d)) {
      const key = `${y}-${m}-${d}`;
      await db.collection('res_availability').doc(`demo-studio-${key}`).set({
        designerSlug: 'demo-designer', serviceType: 'studio', studio: 'praha',
        start: Timestamp.fromDate(fromPrague(y, m, d, 9 * 60)), end: Timestamp.fromDate(fromPrague(y, m, d, 13 * 60)), createdBy: 'seed',
      });
      await db.collection('res_availability').doc(`demo-home-${key}`).set({
        designerSlug: 'demo-designer', serviceType: 'home',
        start: Timestamp.fromDate(fromPrague(y, m, d, 14 * 60)), end: Timestamp.fromDate(fromPrague(y, m, d, 18 * 60)), createdBy: 'seed',
      });
    }
    ({ y, m, d } = nextDay(y, m, d));
  }
  await db.collection('config').doc('raynet').set({ mock: true });
  console.log('  + demo designér, bloky na 14 dní, config/raynet {mock:true}');
}

async function main() {
  console.log(`Cíl: ${EMULATOR ? `emulátor ${process.env.FIRESTORE_EMULATOR_HOST}` : 'PRODUKCE'} · ${APPLY ? 'OSTŘE' : 'dry-run'}`);
  // Ověření přístupu malým dotazem hned na začátku (past invalid_rapt, viz CLAUDE.md).
  await db.collection('res_services').limit(1).get();
  for (const [id, data] of Object.entries(SERVICES)) await ensure(db.collection('res_services').doc(id), data);
  await ensure(db.collection('config').doc('rezervace'), CONFIG);
  if (DEMO && APPLY) await seedDemo();
  if (!APPLY) console.log('\nNic se nezapsalo. Ostře: přidat --apply.');
}

main().catch((err) => { console.error(err); process.exit(1); });

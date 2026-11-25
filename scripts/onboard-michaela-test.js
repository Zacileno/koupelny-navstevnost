#!/usr/bin/env node
/**
 * Testovací účet pro Michaelu (Zacileno, externí) na vyzkoušení Rezervací.
 * Stejný vzor jako scripts/onboard-pristupy-zacileno.js: admin konzole
 * (onboardEmployee) to neumí — natvrdo píše active:true (objevila by se ve
 * výběru „Obchodník“ v Návštěvnosti) a neumí external. Tady:
 *   - Auth účet se sdíleným heslem ZmenSiHeslo + vynucená změna,
 *   - users/{slug}: external:true, active:false, platformRole:'employee',
 *   - claim slug,
 *   - rovnou zapnuté Rezervace: zvolené studio, všechny aktivní služby,
 *     oblast návrhu doma = studio, „Spravuje všechny rezervace“ (pohled CX).
 * V Nastavení rezervací se externí lidé v tabulce designérů nezobrazují,
 * proto se rezervace zapínají i vypínají tady.
 * --------------------------------------------------------
 * Použití (spouští člověk, zápis do produkce):
 *   bash scripts/with-firebase-adc.sh node scripts/onboard-michaela-test.js                 # náhled
 *   bash scripts/with-firebase-adc.sh node scripts/onboard-michaela-test.js --apply         # založit (studio Praha)
 *   bash scripts/with-firebase-adc.sh node scripts/onboard-michaela-test.js --apply --studio brno
 *   bash scripts/with-firebase-adc.sh node scripts/onboard-michaela-test.js --konec --apply # po testu: vypnout rezervace a zablokovat login
 */

const admin = require('firebase-admin');

const APPLY = process.argv.includes('--apply');
const END = process.argv.includes('--konec');
const studioArg = process.argv.indexOf('--studio');
const STUDIO = studioArg > -1 ? process.argv[studioArg + 1] : 'praha';
const STUDIOS = ['praha', 'brno', 'hradec', 'pardubice'];

const SLUG = 'michaela-zacileno';
const EMAIL = 'michaela@zacileno.cz';
const NAME = 'Michaela (Zacileno)';
const SHARED_PASSWORD = 'ZmenSiHeslo';

if (!STUDIOS.includes(STUDIO)) {
  console.error(`Neznámé studio "${STUDIO}" — povolené: ${STUDIOS.join(', ')}`);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'koupelny-navstevnost',
});
const db = admin.firestore();
const auth = admin.auth();
const tag = APPLY ? '' : '[náhled] ';

async function end() {
  const ref = db.collection('users').doc(SLUG);
  const snap = await ref.get();
  if (!snap.exists) { console.error(`users/${SLUG} neexistuje.`); process.exit(1); }
  console.log(`${tag}vypnu rezervace (enabled:false, manageAll:false) u users/${SLUG}`);
  console.log(`${tag}zablokuju login ${EMAIL} (disabled:true)`);
  if (!APPLY) return console.log('\nNic nezapsáno — pro provedení přidej --apply.');
  await ref.update({ 'reservations.enabled': false, 'reservations.manageAll': false });
  if (snap.data().uid) await auth.updateUser(snap.data().uid, { disabled: true });
  console.log('Hotovo. Domluvené rezervace zůstávají, testovací je zruš v Přehledu.');
}

async function create() {
  const ref = db.collection('users').doc(SLUG);
  if ((await ref.get()).exists) {
    console.error(`users/${SLUG} už existuje — končím, ať nic nepřepíšu omylem.`);
    process.exit(1);
  }

  const services = (await db.collection('res_services').get()).docs
    .filter((d) => d.data().active !== false)
    .map((d) => d.id);
  if (!services.length) { console.error('V res_services není žádná aktivní služba.'); process.exit(1); }

  let uid;
  try {
    const user = await auth.getUserByEmail(EMAIL);
    if (user.customClaims?.slug) {
      console.error(`Auth účet ${EMAIL} už má claim slug="${user.customClaims.slug}" — končím.`);
      process.exit(1);
    }
    uid = user.uid;
    console.log(`Auth účet už existuje: ${EMAIL} (${uid}) — propojím ho.`);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    console.log(`${tag}založím Auth účet ${EMAIL} se sdíleným heslem`);
    if (APPLY) uid = (await auth.createUser({ email: EMAIL, password: SHARED_PASSWORD, displayName: NAME })).uid;
  }

  const docData = {
    name: NAME,
    email: EMAIL,
    external: true,
    active: false,
    platformRole: 'employee',
    mustChangePassword: true,
    uid: uid || null,
    reservations: {
      enabled: true,
      studios: [STUDIO],
      homeRegions: [STUDIO],
      services,
      manageAll: true,
    },
  };
  console.log(`${tag}zapíšu users/${SLUG}:`, JSON.stringify(docData, null, 2));
  console.log(`${tag}nastavím claim slug=${SLUG}`);
  if (!APPLY) return console.log('\nNic nezapsáno — pro provedení přidej --apply.');

  await ref.set({ ...docData, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  await auth.setCustomUserClaims(uid, { slug: SLUG });
  console.log(`\nHotovo. Michaela se přihlásí na https://koupelny-navstevnost.web.app/login.html`);
  console.log(`  e-mail: ${EMAIL}, dočasné heslo: ${SHARED_PASSWORD} (hned si ho změní)`);
  console.log(`  přímý odkaz: https://koupelny-navstevnost.web.app/rezervovat/?designer=${SLUG}`);
}

(END ? end() : create()).catch((err) => { console.error(err); process.exit(1); });

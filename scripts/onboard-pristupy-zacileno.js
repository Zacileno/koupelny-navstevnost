#!/usr/bin/env node
/**
 * Jednorázové založení sdíleného přístupového účtu pristupy@zacileno.eu
 * (Zacileno — externí agentura, viz existující external:true záznamy v
 * users) s plným admin přístupem. Založeno stejným vzorem jako doplnění
 * Elišky (scripts/backfill-admin-platform-role.js + seed-users-auth.js
 * --only), ne přes admin konzoli (public/admin/lide.html) — onboardEmployee
 * natvrdo nastavuje active:true a neumí external, tenhle účet má naopak
 * být active:false (nemá se objevit v Návštěvnosti ani jinde jako aktivní
 * člověk) a external:true.
 * --------------------------------------------------------
 * Použití:
 *   node scripts/onboard-pristupy-zacileno.js --dry-run   # náhled, nic nezapisuje
 *   node scripts/onboard-pristupy-zacileno.js              # zápis
 */

const admin = require('firebase-admin');

const DRY_RUN = process.argv.includes('--dry-run');
const SLUG = 'pristupy-zacileno';
const EMAIL = 'pristupy@zacileno.eu';
const NAME = 'Přístupy (Zacileno)';
const SHARED_PASSWORD = 'ZmenSiHeslo';

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'koupelny-navstevnost',
});
const db = admin.firestore();
const auth = admin.auth();

async function main() {
  const ref = db.collection('users').doc(SLUG);
  const existing = await ref.get();
  if (existing.exists) {
    console.error(`users/${SLUG} už existuje — končím, ať nic nepřepíšu omylem.`);
    process.exit(1);
  }

  let uid;
  try {
    const user = await auth.getUserByEmail(EMAIL);
    uid = user.uid;
    console.log(`Auth účet už existuje: ${EMAIL} (${uid})`);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    if (DRY_RUN) {
      console.log(`[dry-run] založil bych Auth účet: ${EMAIL}`);
      uid = 'dry-run-uid';
    } else {
      const user = await auth.createUser({ email: EMAIL, password: SHARED_PASSWORD, displayName: NAME });
      uid = user.uid;
      console.log(`Založen Auth účet: ${EMAIL} (${uid})`);
    }
  }

  const docData = {
    name: NAME,
    email: EMAIL,
    external: true,
    active: false,
    platformRole: 'admin',
    mustChangePassword: true,
    uid,
  };

  if (DRY_RUN) {
    console.log(`[dry-run] zapsal bych users/${SLUG}:`, docData);
    console.log('[dry-run] nastavil bych claim slug=' + SLUG + ' na uid ' + uid);
    return;
  }

  await ref.set(docData);
  await auth.setCustomUserClaims(uid, { slug: SLUG });
  console.log(`Hotovo — users/${SLUG} založen, claim slug nastaven, sdílené heslo "${SHARED_PASSWORD}" (vynucená změna při prvním přihlášení na /login.html).`);
}

main().catch(err => { console.error(err); process.exit(1); });

#!/usr/bin/env node
/**
 * Jednorázový bootstrap pro admin konzoli (public/admin/lide.html): doplní pole
 * `platformRole: 'admin'` na slug dokumenty šesti stávajících adminů/manažerů
 * (viz CLAUDE.md). Bez tohohle pole by nová Cloud Function `requireAdminCaller`
 * (functions/index.js) nikoho nepustila k onboardEmployee/offboardEmployee —
 * jejich admin status dnes žije jen na legacy `users/{uid}` dokumentu z Adaptace,
 * který nová cesta identity (slug-based) ignoruje.
 *
 * Čistě přídavné pole, nic dnešního na něj nesahá — bezpečné spustit i opakovaně.
 * --------------------------------------------------------
 * Použití:
 *   node scripts/backfill-admin-platform-role.js --dry-run
 *   node scripts/backfill-admin-platform-role.js
 */

const admin = require('firebase-admin');

const DRY_RUN = process.argv.includes('--dry-run');

const ADMIN_SLUGS = [
  'martin-paclik',
  'matous-syrovy',
  'barbora-syrova',
  'jakub-krcmarik',
  'kristyna-syrova',
  'jan-lagron',
];

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'koupelny-navstevnost',
});
const db = admin.firestore();

async function main() {
  for (const slug of ADMIN_SLUGS) {
    const ref = db.collection('users').doc(slug);
    const snap = await ref.get();
    if (!snap.exists) {
      console.error(`CHYBA: users/${slug} neexistuje — přeskakuji`);
      continue;
    }
    if (snap.data().platformRole === 'admin') {
      console.log(`Přeskakuji (už má platformRole:'admin'): ${slug}`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`[dry-run] nastavil bych users/${slug}.platformRole = 'admin' (${snap.data().name})`);
      continue;
    }
    await ref.set({ platformRole: 'admin' }, { merge: true });
    console.log(`Nastaveno: users/${slug}.platformRole = 'admin' (${snap.data().name})`);
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });

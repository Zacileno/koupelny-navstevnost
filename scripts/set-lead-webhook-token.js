#!/usr/bin/env node
/**
 * Nastaví (nebo vymění) tajný token pro webhook `prijmoutLead`
 * (functions/leady.js) do Firestore `config/leadWebhook.token`.
 * Kolekce `config` nemá ve firestore.rules žádné pravidlo → klient ji nepřečte,
 * čte ji jen Cloud Function přes Admin SDK.
 *
 * Token se vypíše jednou do terminálu — vložit ho do Make (HTTP modul, hlavička
 * X-Webhook-Token). Funkce si token drží v paměti až 5 minut, po výměně tedy
 * chvíli platí i ten starý.
 * --------------------------------------------------------
 * Použití:
 *   node scripts/set-lead-webhook-token.js           ← založí, jen pokud ještě neexistuje
 *   node scripts/set-lead-webhook-token.js --rotate  ← vygeneruje nový (starý přestane platit)
 */

const crypto = require('crypto');
const admin = require('firebase-admin');

const ROTATE = process.argv.includes('--rotate');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'koupelny-navstevnost',
});
const db = admin.firestore();

async function main() {
  const ref = db.collection('config').doc('leadWebhook');
  const snap = await ref.get();
  if (snap.exists && snap.data().token && !ROTATE) {
    console.log('Token už existuje. Pro výměnu spusť s --rotate.');
    return;
  }
  const token = crypto.randomBytes(24).toString('base64url');
  await ref.set({ token, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  console.log(`Nový token (vložit do Make jako hlavičku X-Webhook-Token):\n\n${token}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });

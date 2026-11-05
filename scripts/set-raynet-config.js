#!/usr/bin/env node
/**
 * Zapíše přístup do Raynet API pro modul Rezervace (functions/rezervace/raynet.js)
 * do Firestore `config/raynet`. Kolekce `config` nemá pro tenhle dokument
 * žádné klientské pravidlo → čte ho jen Cloud Function přes Admin SDK.
 * Stejný vzor jako scripts/set-lead-webhook-token.js.
 *
 * API klíč: v Raynetu přihlášený technický uživatel → Nastavení účtu → API klíč.
 * Uživatel musí vidět kalendáře všech designérů (viz docs/rezervace-pruzkum.md).
 * Klíč se předává proměnnou prostředí, ne parametrem, ať nezůstane v historii shellu.
 * --------------------------------------------------------
 * Použití:
 *   RAYNET_API_KEY=… node scripts/set-raynet-config.js --instance <název-instance> --user <e-mail>
 *   node scripts/set-raynet-config.js --check     ← ověří spojení (GET /userAccount/), nic nezapíše
 *   node scripts/set-raynet-config.js --remove    ← smaže config/raynet (Rezervace pak běží bez Raynetu)
 */

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'koupelny-navstevnost',
});
const db = admin.firestore();
const ref = db.collection('config').doc('raynet');

async function check(cfg) {
  const res = await fetch('https://app.raynet.cz/api/v2/userAccount/?limit=200', {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${cfg.username}:${cfg.apiKey}`).toString('base64'),
      'X-Instance-Name': cfg.instanceName,
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Raynet odpověděl HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  console.log(`Spojení OK. Zbývá požadavků dnes: ${res.headers.get('x-ratelimit-remaining')}`);
  console.log('Uživatelé (Raynet ID osoby pro users/{slug}.reservations.raynetUserId):');
  for (const u of json.data || []) {
    console.log(`  ${u.person?.id ?? '?'}\t${u.person?.fullName ?? u.userName ?? ''}\t${u.userName ?? ''}`);
  }
}

async function main() {
  if (args.includes('--remove')) {
    await ref.delete();
    console.log('config/raynet smazán.');
    return;
  }
  if (args.includes('--check')) {
    const snap = await ref.get();
    if (!snap.exists) throw new Error('config/raynet neexistuje.');
    await check(snap.data());
    return;
  }

  const instanceName = arg('--instance');
  const username = arg('--user');
  const apiKey = process.env.RAYNET_API_KEY;
  if (!instanceName || !username || !apiKey) {
    console.error('Chybí --instance, --user nebo proměnná RAYNET_API_KEY. Viz hlavička skriptu.');
    process.exit(1);
  }
  const cfg = { instanceName, username, apiKey };
  await check(cfg); // nejdřív ověřit, ať se nezapíše nefunkční přístup
  await ref.set({ ...cfg, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  const back = await ref.get();
  if (back.data()?.instanceName !== instanceName) throw new Error('Zpětné čtení nesedí.');
  console.log('config/raynet zapsán a ověřen zpětným čtením. Functions si ho načtou do 5 minut.');
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });

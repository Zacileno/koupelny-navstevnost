#!/usr/bin/env node
/**
 * Bootstrap sdíleného platformového loginu: založí Firebase Auth účty pro lidi
 * z kolekce `users` (slug-keyed adresář z modulu Návštěvnost), nastaví jim
 * custom claim `slug` (identita napříč Firestore rules bez extra dotazů) a
 * zapíše `uid` zpátky do jejich users/{slug} dokumentu.
 *
 * Dva způsoby, jak lidi dostat k prvnímu heslu:
 *
 * 1) E-mail s odkazem (--send / --send-all) — bezpečnější, ale u tohoto
 *    projektu se ukázalo nespolehlivé doručování (ověřeno 2026-07-16 na dvou
 *    různých doménách, viz docs/architektura.md) — zatím nefunkční.
 * 2) Dočasné sdílené heslo (--shared-password) — všichni dostanou stejné
 *    heslo "ZmenSiHeslo" a při prvním přihlášení je appka donutí nastavit si
 *    vlastní (public/change-password.html + users/{slug}.mustChangePassword).
 *    Rychlejší, ale bezpečnostně slabší, dokud si každý heslo nezmění —
 *    vědomá volba pod časovým tlakem, viz docs/architektura.md.
 * --------------------------------------------------------
 * Použití:
 *   node scripts/seed-users-auth.js --dry-run                              # náhled, nic nezapisuje
 *   node scripts/seed-users-auth.js --shared-password --only martin-paclik # test na jednom účtu
 *   node scripts/seed-users-auth.js --shared-password --all                # sdílené heslo pro všechny
 *   node scripts/seed-users-auth.js --only martin-paclik --send            # (nefunkční cesta) e-mail jen jemu
 *   node scripts/seed-users-auth.js --send-all                             # (nefunkční cesta) e-mail všem
 *
 * Přeskakuje uživatele s `external: true` (externí dodavatelé/agentury), pokud
 * není konkrétní slug vyžádán přes --only.
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const path = require('path');

const SHARED_PASSWORD = 'ZmenSiHeslo';

const DRY_RUN = process.argv.includes('--dry-run');
const SEND_ALL = process.argv.includes('--send-all');
const SEND = process.argv.includes('--send');
const SHARED = process.argv.includes('--shared-password');
const ALL = process.argv.includes('--all');
const onlyArgIndex = process.argv.indexOf('--only');
const ONLY_SLUG = onlyArgIndex !== -1 ? process.argv[onlyArgIndex + 1] : null;

if (SEND && !ONLY_SLUG) {
  console.error('--send jde použít jen spolu s --only <slug> (test na jednom účtu). Pro hromadné rozeslání použij --send-all.');
  process.exit(1);
}
if (SEND && SEND_ALL) {
  console.error('Použij buď --send --only <slug>, nebo --send-all, ne obojí najednou.');
  process.exit(1);
}
if (SHARED && !ONLY_SLUG && !ALL) {
  console.error('--shared-password vyžaduje buď --only <slug> (test na jednom účtu), nebo výslovné --all (pro všechny).');
  process.exit(1);
}
if (SHARED && (SEND || SEND_ALL)) {
  console.error('--shared-password a --send/--send-all jsou dvě různé cesty k prvnímu heslu, nekombinuj je.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'koupelny-navstevnost',
});
const db = admin.firestore();
const auth = admin.auth();

async function ensureAuthUser(email, name, alreadyPersonalized) {
  // V režimu --shared-password chceme heslo shodit na SHARED_PASSWORD u nových
  // účtů a u těch, co ještě neprošly vynucenou změnou (mustChangePassword !==
  // false). Účet, kde si člověk už heslo sám nastavil (mustChangePassword ===
  // false), se nesmí přepsat — jinak bychom mu při každém dalším běhu skriptu
  // (např. nasazení nového kolegy přes --all) tiše sebrali vlastní heslo a
  // vrátili ho na sdílené, aniž by o tom věděl.
  try {
    const existing = await auth.getUserByEmail(email);
    if (SHARED && !DRY_RUN) {
      if (alreadyPersonalized) {
        console.log(`Přeskakuji heslo (už má vlastní): ${name} <${email}>`);
      } else {
        await auth.updateUser(existing.uid, { password: SHARED_PASSWORD });
        console.log(`Nastaveno sdílené heslo: ${name} <${email}>`);
      }
    }
    return { uid: existing.uid, created: false };
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
  }

  if (DRY_RUN) {
    console.log(`[dry-run] založil bych Auth účet: ${name} <${email}>`);
    return { uid: `dry-run-${email}`, created: true };
  }

  // Mimo --shared-password je heslo náhodné a nikam nejde — účet se nikdy
  // nepoužije bez toho, aby si ho uživatel nejdřív nastavil sám přes odkaz
  // z accounts:sendOobCode.
  const password = SHARED ? SHARED_PASSWORD : crypto.randomBytes(24).toString('base64url');
  const user = await auth.createUser({ email, password, displayName: name });
  console.log(`Založen Auth účet: ${name} <${email}>`);
  return { uid: user.uid, created: true };
}

async function ensureMustChangePassword(slug) {
  if (DRY_RUN) {
    console.log(`[dry-run] nastavil bych users/${slug}.mustChangePassword = true`);
    return;
  }
  await db.collection('users').doc(slug).set({ mustChangePassword: true }, { merge: true });
}

async function ensureSlugClaim(uid, slug) {
  if (DRY_RUN) {
    console.log(`[dry-run] nastavil bych claim slug=${slug} na uid ${uid}`);
    return;
  }
  await auth.setCustomUserClaims(uid, { slug });
}

async function ensureUidOnDoc(slug, uid, currentUid) {
  if (currentUid === uid) return;
  if (DRY_RUN) {
    console.log(`[dry-run] zapsal bych users/${slug}.uid = ${uid}`);
    return;
  }
  await db.collection('users').doc(slug).set({ uid }, { merge: true });
}

async function sendResetEmail(email, apiKey) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`sendOobCode selhal pro ${email}: ${res.status} ${body}`);
  }
}

async function markEmailSent(slug) {
  if (DRY_RUN) {
    console.log(`[dry-run] označil bych users/${slug}.authEmailSentAt = teď`);
    return;
  }
  await db.collection('users').doc(slug).set(
    { authEmailSentAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function main() {
  const commonJsPath = path.join(__dirname, '..', 'public', 'shared', 'auth-common.js');
  const { FIREBASE_CONFIG } = await import(`file://${commonJsPath}`);

  let docs;
  if (ONLY_SLUG) {
    const snap = await db.collection('users').doc(ONLY_SLUG).get();
    if (!snap.exists) {
      console.error(`users/${ONLY_SLUG} neexistuje.`);
      process.exit(1);
    }
    docs = [snap];
  } else {
    const snap = await db.collection('users').get();
    docs = snap.docs;
  }

  const toEmail = [];

  for (const doc of docs) {
    const data = doc.data();
    const slug = doc.id;

    if (data.external && !ONLY_SLUG) {
      console.log(`Přeskakuji ${slug} (external: true)`);
      continue;
    }
    if (!data.email) {
      console.log(`Přeskakuji ${slug} — chybí e-mail`);
      continue;
    }

    try {
      const alreadyPersonalized = data.mustChangePassword === false;
      const { uid } = await ensureAuthUser(data.email, data.name ?? slug, alreadyPersonalized);
      await ensureSlugClaim(uid, slug);
      await ensureUidOnDoc(slug, uid, data.uid);

      if (SHARED && !alreadyPersonalized) {
        await ensureMustChangePassword(slug);
      }

      if ((SEND && ONLY_SLUG === slug) || (SEND_ALL && !data.authEmailSentAt)) {
        toEmail.push({ slug, email: data.email, name: data.name ?? slug });
      }
    } catch (err) {
      console.error(`CHYBA u ${slug} <${data.email}>: ${err.code ?? ''} ${err.message} — přeskakuji, pokračuji dál.`);
    }
  }

  if (SHARED) {
    console.log(DRY_RUN
      ? '\n[dry-run] hotovo.'
      : `\nHotovo — sdílené heslo "${SHARED_PASSWORD}" nastaveno, mustChangePassword=true. Při prvním přihlášení appka donutí ke změně.`);
    return;
  }

  if (toEmail.length === 0) {
    console.log('Hotovo — žádné e-maily k odeslání.');
    return;
  }

  console.log(`\nOdesílám odkaz na nastavení hesla: ${toEmail.length} adres(a)`);
  for (const { slug, email, name } of toEmail) {
    if (DRY_RUN) {
      console.log(`[dry-run] poslal bych e-mail: ${name} <${email}>`);
      continue;
    }
    await sendResetEmail(email, FIREBASE_CONFIG.apiKey);
    await markEmailSent(slug);
    console.log(`Odesláno: ${name} <${email}>`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

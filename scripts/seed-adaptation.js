#!/usr/bin/env node
/**
 * Seed skript: založí Firebase Auth účty (bez Google Workspace, pouze email+heslo) a
 * Firestore adaptaci pro konkrétního nováčka podle šablony "Projektový specialista/
 * designér — 90 dní". Mezikrok, dokud neexistuje admin konzole (Fáze 3 v CLAUDE.md).
 * --------------------------------------------------------
 * Použití:
 *   node scripts/seed-adaptation.js --config scripts/seed-adaptation.example.json --dry-run
 *   node scripts/seed-adaptation.js --config scripts/seed-adaptation.example.json
 *
 * Config shape (viz scripts/seed-adaptation.example.json):
 * {
 *   "employee": { "name": "...", "email": "...", "studioKey": "praha", "startDate": "2026-05-04" },
 *   "roles": {
 *     "manager":          { "name": "...", "email": "..." },
 *     "managerDeputy":    { "name": "..." },
 *     "seniorSpecialist": { "name": "..." },
 *     "buddy":            { "name": "..." }
 *   },
 *   "admins": [ { "name": "...", "email": "..." } ]
 * }
 *
 * Potvrzuje výhradně manažer, proto jen "employee" a "roles.manager" potřebují "email"
 * (dostanou Firebase Auth účet). managerDeputy/seniorSpecialist/buddy jsou u ostatních rolí
 * jen jméno — zobrazí se u cílů, ale nemají login ani Firestore přístup.
 *
 * "admins" (nepovinné) — nezávisle na téhle konkrétní adaptaci: dostanou Firebase Auth účet
 * a users/{uid} dokument s rolí 'admin', takže uvidí úplně všechny adaptace v `tym.html`
 * (ne jen tuhle), typicky pro CEO/majitele přehled.
 *
 * Idempotentní: Auth účty a users/{uid} dokumenty se založí jen pokud ještě neexistují
 * (hledá se podle e-mailu). Adaptace se při každém spuštění vytvoří nová.
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const DRY_RUN = process.argv.includes('--dry-run');
const configArgIndex = process.argv.indexOf('--config');
const configPath = configArgIndex !== -1 ? process.argv[configArgIndex + 1] : null;

if (!configPath) {
  console.error('Použití: node scripts/seed-adaptation.js --config <cesta k JSON configu> [--dry-run]');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf-8'));

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'koupelny-navstevnost',
});
const db = admin.firestore();
const auth = admin.auth();

async function ensureAuthUser(email, name) {
  try {
    const existing = await auth.getUserByEmail(email);
    console.log(`Auth účet už existuje: ${name} <${email}>`);
    return existing.uid;
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
  }

  if (DRY_RUN) {
    console.log(`[dry-run] založil bych Auth účet: ${name} <${email}>`);
    return `dry-run-${email}`;
  }

  const tempPassword = crypto.randomBytes(9).toString('base64url');
  const user = await auth.createUser({ email, password: tempPassword, displayName: name });
  console.log(`Založen Auth účet: ${name} <${email}> — dočasné heslo: ${tempPassword} (předej bezpečně, ať si ho po přihlášení změní)`);
  return user.uid;
}

async function ensureUserDoc(uid, name, role, studioKey) {
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  if (snap.exists) return;

  if (DRY_RUN) {
    console.log(`[dry-run] založil bych users/${uid} (${name}, role=${role})`);
    return;
  }
  await ref.set({ uid, name, role, studioKey: studioKey ?? null });
}

async function ensureProjectSpecialistTemplateId(template) {
  const snap = await db.collection('adaptation_templates')
    .where('isDefault', '==', true)
    .where('role', '==', 'projektovy_specialista')
    .limit(1)
    .get();

  if (!snap.empty) return snap.docs[0].id;

  if (DRY_RUN) {
    console.log('[dry-run] založil bych adaptation_templates dokument pro projektovy_specialista');
    return 'dry-run-template';
  }

  const ref = await db.collection('adaptation_templates').add({
    ...template,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

async function main() {
  const commonJsPath = path.join(__dirname, '..', 'public', 'adaptace', 'adaptace-common.js');
  const { PROJECT_SPECIALIST_TEMPLATE, buildWeeklyProgress } = await import(`file://${commonJsPath}`);

  for (const info of config.admins ?? []) {
    const uid = await ensureAuthUser(info.email, info.name);
    await ensureUserDoc(uid, info.name, 'admin', null);
  }

  const roleEntries = {};
  for (const [key, info] of Object.entries(config.roles)) {
    if (!info.email) {
      // Jen informativní jméno u cílů (buddy/senior/zástupce) — bez loginu, potvrzuje manažer.
      roleEntries[key] = { uid: null, name: info.name };
      continue;
    }
    const uid = await ensureAuthUser(info.email, info.name);
    await ensureUserDoc(uid, info.name, 'supervisor', config.employee.studioKey);
    roleEntries[key] = { uid, name: info.name };
  }

  const employeeUid = await ensureAuthUser(config.employee.email, config.employee.name);
  await ensureUserDoc(employeeUid, config.employee.name, 'employee', config.employee.studioKey);

  const templateId = await ensureProjectSpecialistTemplateId(PROJECT_SPECIALIST_TEMPLATE);

  const startDate = new Date(config.employee.startDate);
  const { phases, ongoingCategories } = buildWeeklyProgress(PROJECT_SPECIALIST_TEMPLATE, startDate);

  const adaptationDoc = {
    employeeId: employeeUid,
    employeeName: config.employee.name,
    studioKey: config.employee.studioKey,
    templateType: 'weekly',
    templateId,
    supervisorId: roleEntries.manager.uid,
    roles: roleEntries,
    startDate: admin.firestore.Timestamp.fromDate(startDate),
    status: 'active',
    currentWeekIndex: 0,
    phases,
    ongoingCategories,
  };

  if (DRY_RUN) {
    console.log(`[dry-run] založil bych adaptations dokument pro ${config.employee.name} (start ${config.employee.startDate}), role:`, roleEntries);
    return;
  }

  const adaptationRef = await db.collection('adaptations').add(adaptationDoc);
  console.log(`Hotovo — adaptace ${adaptationRef.id} pro ${config.employee.name} je založená a aktivní.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

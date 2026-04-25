// import-cx.js - bez service account, používá FIREBASE_TOKEN
// Použití:
//   1. npx firebase login:ci   → zkopíruj token
//   2. FIREBASE_TOKEN="token" node import-cx.js

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_ID = 'koupelny-navstevnost';
const COLLECTION = 'cx_feedback';
const CSV_NAME   = 'Souhrn_zpetne_vazby.csv';

function parseCSV(filePath) {
    const raw   = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());
    const headers = parseCSVLine(lines[0]);
    return lines.slice(1).map(line => {
        const vals = parseCSVLine(line);
        const obj  = {};
        headers.forEach((h, i) => obj[h] = (vals[i] || '').trim());
        return obj;
    });
}

function parseCSVLine(line) {
    const result = []; let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === ',' && !inQuotes) { result.push(cur); cur = ''; }
        else cur += ch;
    }
    result.push(cur);
    return result;
}

function mapRow(r) {
    const stavMap = {
        'Dokončeno': 'Dokončeno', 'Nezvednutý hovor': 'Nezvednutý hovor',
        'zavolat jindy': 'Zavolat jindy', 'hovor už jednou proběhl': 'Již kontaktováno',
        'až vše bude hotové': 'Až bude hotové', 'nemá zajem': 'Nemá zájem',
        'Domluven termín hovoru': 'Domluven termín', 'nic si neobjednala': 'Nezvednutý hovor',
        'vyřadit z hovorů': 'Nemá zájem',
    };
    const doporuceni  = r['Doporučení 1-10'] !== '' && !isNaN(Number(r['Doporučení 1-10'])) ? Number(r['Doporučení 1-10']) : null;
    const spokRaw     = r['Spokojenost / Nespokojenost'];
    const spokMatch   = spokRaw.match(/\b([0-9]|10)\b/);
    const spokojenost = spokMatch ? Number(spokMatch[0]) : null;
    const celkoveHodnoceni = (spokojenost !== null && doporuceni !== null)
        ? parseFloat(((spokojenost + doporuceni) / 2).toFixed(1)) : null;
    return {
        telefon: r['Telefonní číslo'], jmeno: r['Jméno'], firma: r['Firma'],
        stredisko: r['Středisko'], obchodnik: r['Činnost (obchodník)'],
        sluzba: r['Služba'], celkem: r['Celkem'], datumObjednavky: r['Datum objednávky'],
        cisloObjednavky: r['Číslo objednávky'], email: r['Email'],
        stavObjednavky: r['Stav objednávky'],
        stavHovoru: stavMap[r['stav hovoru']] || r['stav hovoru'],
        kdoVolal: r['Kdo volal'], datumKontaktu: r['ko'],
        poznamkyHovoru: r['Poznámky k hovoru'], poznamkaSpokojenosti: spokRaw,
        spokojenost, doporuceni, selByZnovu: r['Šel byste do toho s námi znovu ?'],
        coZlepsit: r['Co bychom mohli udělat lépe ?'], celkoveHodnoceni,
        celkoveHodnoceniText: r['Celkové hodnocení'],
        importováno: true, createdAt: new Date().toISOString(),
    };
}

function toFirestoreFields(obj) {
    const f = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v === null || v === undefined) f[k] = { nullValue: null };
        else if (typeof v === 'number') f[k] = { doubleValue: v };
        else if (typeof v === 'boolean') f[k] = { booleanValue: v };
        else f[k] = { stringValue: String(v) };
    }
    return f;
}

function randomId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function httpsPost(url, data, headers) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req  = https.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
        }, res => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); } catch(e) { resolve({ status: res.statusCode, body: raw }); } });
        });
        req.on('error', reject);
        req.write(body); req.end();
    });
}

function getOAuthToken() {
    // 1. zkus gcloud
    try { const t = execSync('gcloud auth print-access-token 2>/dev/null', { encoding: 'utf8' }).trim(); if (t) return t; } catch(e) {}
    // 2. zkus ~/.config firebase-tools cache (pouze pokud nevypršel)
    try {
        const p = path.join(process.env.HOME || '', '.config', 'configstore', 'firebase-tools.json');
        if (fs.existsSync(p)) {
            const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
            const t = cfg?.tokens;
            const expiresAt = t?.expires_at ? Number(t.expires_at) : 0;
            const stillValid = expiresAt > Date.now() + 60000; // aspoň 1 minuta
            if (t?.access_token && stillValid) return t.access_token;
        }
    } catch(e) {}
    return null;
}

function getAccessTokenFromRefreshToken(refreshToken) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
            client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
        }).toString();
        const req = https.request({
            hostname: 'oauth2.googleapis.com',
            path: '/token',
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                const parsed = JSON.parse(data);
                if (parsed.access_token) resolve(parsed.access_token);
                else reject(new Error('Token exchange error: ' + data));
            });
        });
        req.on('error', reject);
        req.write(body); req.end();
    });
}

async function main() {
    const firebaseToken = process.env.FIREBASE_TOKEN;
    if (!firebaseToken) {
        console.error('❌  Chybí FIREBASE_TOKEN\n   Spusť: npx firebase login:ci\n   Pak: FIREBASE_TOKEN="token" node import-cx.js');
        process.exit(1);
    }

    const csvPath = [
        path.join(__dirname, CSV_NAME),
        path.join(__dirname, 'firebase-import', CSV_NAME),
    ].find(p => fs.existsSync(p));
    if (!csvPath) { console.error(`❌  CSV "${CSV_NAME}" nenalezeno ve složce projektu.`); process.exit(1); }

    const rows = parseCSV(csvPath).filter(r => r['Jméno'] || r['Telefonní číslo'] || r['Email']);
    console.log(`📦  ${rows.length} platných záznamů`);

    let token = getOAuthToken();
    if (!token) {
        console.log('🔑  Získávám access token z refresh tokenu...');
        try {
            token = await getAccessTokenFromRefreshToken(firebaseToken);
            console.log('✅  Token OK');
        } catch(e) {
            console.error('❌  Nepodařilo se získat OAuth token:', e.message);
            process.exit(1);
        }
    }
    if (!token) { console.error('❌  Nepodařilo se získat OAuth token. Zkus: gcloud auth application-default login'); process.exit(1); }

    const BATCH = 400; let ok = 0, errors = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH).map(r => ({ id: randomId(), data: mapRow(r) }));
        const writes = chunk.map(({ id, data }) => ({
            update: { name: `projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}/${id}`, fields: toFirestoreFields(data) }
        }));
        const res = await httpsPost(
            `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:batchWrite`,
            { writes },
            { Authorization: `Bearer ${token}` }
        );
        if (res.status === 200) { ok += chunk.length; console.log(`  ✅  ${Math.min(i+BATCH, rows.length)} / ${rows.length}`); }
        else { errors += chunk.length; console.error(`  ❌  HTTP ${res.status}:`, JSON.stringify(res.body).slice(0,200)); }
    }
    console.log(`\n🎉  Hotovo! Importováno: ${ok}, chyby: ${errors}`);
    if (errors > 0) console.log('   Tip: pokud vidíš 401, token vypršel — spusť znovu npx firebase login:ci');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });

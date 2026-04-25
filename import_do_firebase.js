// ============================================================
// IMPORT HISTORICKÝCH DAT DO FIREBASE — verze s tokenem
// Spuštění:
// FIREBASE_TOKEN="tvuj_token" node import_do_firebase.js
// ============================================================

const https = require("https");
const fs = require("fs");
const path = require("path");

const PROJECT_ID = "koupelny-navstevnost";
const DATA_FILE = path.join(__dirname, "historical_data.json");
const FIREBASE_TOKEN = process.env.FIREBASE_TOKEN;

if (!FIREBASE_TOKEN) {
  console.error("❌ Chybí FIREBASE_TOKEN!");
  console.error('   Spusť skript takto:');
  console.error('   FIREBASE_TOKEN="1//03..." node import_do_firebase.js');
  process.exit(1);
}

// Získá access token z refresh tokenu
function getAccessToken() {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: FIREBASE_TOKEN,
      client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
      client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    }).toString();

    const req = https.request({
      hostname: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const parsed = JSON.parse(data);
        if (parsed.access_token) resolve(parsed.access_token);
        else reject(new Error("Token error: " + data));
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Zapíše batch dokumentů přes Firestore REST API
function commitBatch(accessToken, writes) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ writes });
    const req = https.request({
      hostname: "firestore.googleapis.com",
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents:batchWrite`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) resolve();
        else reject(new Error(`HTTP ${res.statusCode}: ${data}`));
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Převede záznam na Firestore REST formát
function toFirestoreWrite(record) {
  const docPath = `projects/${PROJECT_ID}/databases/(default)/documents/daily_summaries/${record.studio}_${record.date}`;
  const toValue = (v) => {
    if (typeof v === "number") return { integerValue: String(Math.round(v)) };
    if (typeof v === "string") return { stringValue: v };
    if (typeof v === "boolean") return { booleanValue: v };
    return { nullValue: null };
  };
  const fields = {};
  for (const [key, val] of Object.entries(record)) {
    fields[key] = toValue(val);
  }
  return { update: { name: docPath, fields } };
}

async function importData() {
  console.log("🚀 Spouštím import historických dat...\n");

  if (!fs.existsSync(DATA_FILE)) {
    console.error(`❌ Soubor ${DATA_FILE} nenalezen!`);
    process.exit(1);
  }
  const records = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));

  console.log(`📊 Načteno ${records.length} záznamů`);
  const stats = {};
  records.forEach((r) => (stats[r.studio] = (stats[r.studio] || 0) + 1));
  Object.entries(stats).forEach(([s, c]) => console.log(`   • ${s}: ${c} dní`));
  console.log("");

  console.log("🔑 Přihlašuji se...");
  let accessToken;
  try {
    accessToken = await getAccessToken();
    console.log("✅ Přihlášení OK\n");
  } catch (err) {
    console.error("❌ Chyba přihlášení:", err.message);
    process.exit(1);
  }

  const BATCH_SIZE = 20;
  let totalWritten = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const writes = chunk.map(toFirestoreWrite);
    try {
      await commitBatch(accessToken, writes);
      totalWritten += chunk.length;
      const progress = Math.round((totalWritten / records.length) * 100);
      process.stdout.write(`\r⏳ ${totalWritten}/${records.length} záznamů (${progress}%)`);
    } catch (err) {
      errors++;
      if (errors <= 2) console.error(`\n❌ Chyba dávky:`, err.message);
    }
  }

  console.log("\n\n============================================================");
  console.log(`🎉 Import dokončen!`);
  console.log(`   ✅ Úspěšně zapsáno: ${totalWritten} záznamů`);
  if (errors > 0) console.log(`   ⚠️  Chyby: ${errors} dávek`);
  console.log(`   📁 Kolekce ve Firestore: "daily_summaries"`);
  console.log("============================================================\n");
}

importData().catch((err) => {
  console.error("❌ Neočekávaná chyba:", err.message);
  process.exit(1);
});

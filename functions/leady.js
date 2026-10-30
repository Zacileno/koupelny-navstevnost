// ── MODUL LEADY (public/leady/leady.html) ───────────────────────────────────
// Příjem kontaktů z pop-up formuláře na koupelnysyrovy.cz. Fáze 1: Make scénář
// dál plní Google Sheet a souběžně posílá stejná data sem (HTTP modul s hlavičkou
// X-Webhook-Token). Později se formulář na webu přepojí přímo sem a Make se vypne.
//
// Zápis do `leads` jde jen odsud (Firestore rules: allow create: if false).
// Tajný token leží v Firestore `config/leadWebhook.token` — na `config` nemá
// klient žádné pravidlo, takže ho čte jen Admin SDK. Nastavení:
// scripts/set-lead-webhook-token.js.

const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { addWorkingMinutes, FIRST_CONTACT_SLA_MIN } = require("./leady-sla");

const MAX_FIELD_LEN = 2000;
const TOKEN_CACHE_MS = 5 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

let tokenCache = { value: null, at: 0 };

async function getWebhookToken() {
  if (tokenCache.value && Date.now() - tokenCache.at < TOKEN_CACHE_MS) return tokenCache.value;
  const snap = await getFirestore().collection("config").doc("leadWebhook").get();
  tokenCache = { value: snap.data()?.token || null, at: Date.now() };
  return tokenCache.value;
}

function tokensMatch(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Payload z webu ani z Make nemá pevně dané názvy polí — hledáme podle klíče
// (case-insensitive, bez diakritiky) v plochém i jednou vnořeném objektu.
const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");
const normKey = (k) => String(k).normalize("NFD").replace(DIACRITICS_RE, "").toLowerCase();

function flatten(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        if (v2 == null || typeof v2 === "object") continue;
        out[normKey(k2)] = String(v2);
      }
    } else if (v != null) {
      out[normKey(k)] = String(v);
    }
  }
  return out;
}

function pick(fields, patterns) {
  for (const re of patterns) {
    const key = Object.keys(fields).find((k) => re.test(k));
    if (key && fields[key].trim()) return fields[key].trim().slice(0, MAX_FIELD_LEN);
  }
  return "";
}

function normalizePhone(raw) {
  let p = raw.replace(/[\s\-().\/]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (/^\d{9}$/.test(p)) p = "+420" + p;
  if (/^420\d{9}$/.test(p)) p = "+" + p;
  return /^\+\d{9,15}$/.test(p) ? p : "";
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Kanál a odhad studia z URL, ze které formulář přišel (UTM, gclid/fbclid...).
function parseSource(sourceUrl) {
  const result = { landingPath: "", utm: {}, channel: "direct", paid: false, studiosGuess: [] };
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    return result;
  }
  const q = url.searchParams;
  result.landingPath = url.pathname;
  for (const k of ["source", "medium", "campaign", "content", "term"]) {
    const v = q.get(`utm_${k}`);
    if (v) result.utm[k] = v.slice(0, 300);
  }
  const src = (result.utm.source || "").toLowerCase();
  if (q.has("gclid") || q.has("gbraid") || q.has("wbraid") || src === "google") result.channel = "google";
  else if (q.has("fbclid") || ["facebook", "instagram", "meta", "fb", "ig"].includes(src)) result.channel = "meta";
  else if (q.has("msclkid") || src === "bing") result.channel = "bing";
  else if (src.includes("seznam") || src === "sklik") result.channel = "seznam";
  else if (src) result.channel = src;
  else if (q.has("srsltid")) result.channel = "google";
  result.paid = ["cpc", "ppc", "paid", "paid_social"].includes((result.utm.medium || "").toLowerCase()) ||
    q.has("gclid") || q.has("gbraid") || q.has("msclkid");

  const hay = `${result.utm.campaign || ""} ${url.pathname}`.toLowerCase();
  if (/praha|prague|sckraj/.test(hay)) result.studiosGuess.push("praha");
  if (/brno/.test(hay)) result.studiosGuess.push("brno");
  if (/hradec|_hk\b|_hk_|hk$/.test(hay)) result.studiosGuess.push("hradec");
  if (/pardubic|pce/.test(hay)) result.studiosGuess.push("pardubice");
  return result;
}

exports.prijmoutLead = onRequest(
  { region: "europe-central2", maxInstances: 5 },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "method-not-allowed" });
      return;
    }

    const given = req.get("x-webhook-token") || req.query.token;
    if (!tokensMatch(given, await getWebhookToken())) {
      res.status(401).json({ ok: false, error: "unauthenticated" });
      return;
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const fields = flatten(body);
    const phoneRaw = pick(fields, [/^phone$/, /^(telefon|tel)$/, /phone|telefon|^tel/]);
    const emailRaw = pick(fields, [/^e?-?mail$/, /mail/]);
    const name = pick(fields, [/^(name|jmeno|full_?name)$/, /jmeno|name/]);
    const sourceUrl = pick(fields, [/^(url|source_?url|page_?url)$/, /url|href|stranka|page/]);

    const phone = normalizePhone(phoneRaw);
    const email = isEmail(emailRaw) ? emailRaw.toLowerCase() : "";

    // Prázdné/testovací odeslání ("test" místo čísla) zahodíme, ale vracíme 200,
    // ať Make scénář kvůli tomu nespadne a sheet se dál plní.
    if (!phone && !email) {
      console.warn("prijmoutLead: bez platného telefonu i e-mailu, zahazuji", { phoneRaw, emailRaw });
      res.status(200).json({ ok: false, ignored: "no-contact" });
      return;
    }

    const db = getFirestore();
    const now = new Date();

    // Stejné číslo/e-mail za posledních 30 dní → nový lead se založí, jen se
    // označí jako možný duplikát (Terka rozhodne, nic se neslučuje automaticky).
    let duplicateOfId = null;
    const since = Timestamp.fromMillis(now.getTime() - DUPLICATE_WINDOW_MS);
    const dupField = phone ? "phone" : "email";
    const dupSnap = await db.collection("leads").where(dupField, "==", phone || email).get();
    const dup = dupSnap.docs.find((d) => d.data().receivedAt?.toMillis() >= since.toMillis());
    if (dup) duplicateOfId = dup.id;

    const source = parseSource(sourceUrl);
    const slaDueAt = Timestamp.fromDate(addWorkingMinutes(now, FIRST_CONTACT_SLA_MIN));

    const rawJson = JSON.stringify(body).slice(0, 10000);

    const ref = await db.collection("leads").add({
      receivedAt: Timestamp.fromDate(now),
      source: "web-popup",
      phone,
      phoneRaw: phoneRaw.slice(0, 100),
      email,
      name,
      sourceUrl,
      ...source,
      status: "open",
      attempts: [],
      slaDueAt,
      nextActionAt: slaDueAt,
      firstAttemptAt: null,
      outcome: null,
      duplicateOfId,
      raw: rawJson,
      updatedAt: Timestamp.fromDate(now),
    });

    console.log("prijmoutLead: založen lead", ref.id, { channel: source.channel, duplicateOfId });
    res.status(200).json({ ok: true, id: ref.id });
  }
);

// Jen pro lokální ověření (index.js exportuje pouze prijmoutLead).
exports._internal = { parseSource, normalizePhone, flatten, pick };

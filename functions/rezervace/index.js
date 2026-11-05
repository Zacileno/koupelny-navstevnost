// ── MODUL REZERVACE (docs/rezervace-spec.md) ────────────────────────────────
// Náhrada Reservanta: dostupnost designérů, 1. schůzka (web, telefon, CX),
// jednosměrný push do Raynetu a čtení obsazenosti designérů z Raynetu.
//
// Zápis do `res_bookings` a `res_busy` jde JEN odsud (Firestore rules: allow
// write: if false) — každá změna rezervace tak projde validací, historií
// (`history[]`) a spustí Raynet push (trigger rezervaceRaynetSync).
//
// Funkce:
//  - volneTerminy, vytvoritRezervaci — veřejné onRequest (public/rezervovat/),
//    bez přihlášení, nikdy nevrací kalendáře ani jména klientů,
//  - rezervaceAkce — onCall pro interní stránky (public/rezervace/),
//  - rezervaceRaynetSync — Firestore trigger, push do Raynetu,
//  - rezervaceObsazenost — onSchedule, obsazenost z Raynetu do res_busy.

const crypto = require("crypto");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { computeSlots, BLOCKING_STATUSES, overlaps, horizonEnd, gapMs } = require("./sloty");
const { getRaynet, EXT_ID_PREFIX } = require("./raynet");
const { DEFAULT_HOME_REGIONS, eligibleDesigners, publicProfile, homeRegionsOf } = require("./designeri");
const { permanentShiftBlocks, studioCoverage } = require("./smeny");
const { pragueDateKey, fromPrague, TZ } = require("../shared/cas");
const { normalizePhone, isEmail } = require("../leady")._internal;

const REGION = "europe-central2";
const MIN_MS = 60000;
const DAY_MS = 86400000;
const STUDIOS = ["praha", "brno", "hradec", "pardubice"];
const STUDIO_NAMES = { praha: "Praha", brno: "Brno", hradec: "Hradec Králové", pardubice: "Pardubice" };
const SOURCES = ["web", "phone", "cx", "lead"];
const MAX_FIELD_LEN = 2000;

// Výchozí konfigurace — přepisuje ji dokument `config/rezervace` (stránka
// rezervace/nastaveni.html). Body ⚠️ ze specu jsou tady, ne natvrdo v logice.
const DEFAULT_CONFIG = {
  studios: Object.fromEntries(STUDIOS.map((s) => [s, { name: STUDIO_NAMES[s], address: "", openingHours: {} }])),
  homeRegions: DEFAULT_HOME_REGIONS, // ⚠️ oblasti pro návrh doma (designér má reservations.homeRegions)
  bulkEmail: "",            // ⚠️ hromadný rezervační e-mail (F2)
  alertRecipients: [],      // ⚠️ komu chodí alert "prázdný kalendář" (F2)
  privacyUrl: "",           // ⚠️ odkaz na zásady zpracování osobních údajů
  blockHolidays: true,      // ve státní svátek se nic nenabízí
  stepMin: 30,
  maxActivePerPhone: 3,     // max. budoucích aktivních rezervací na jeden telefon (web)
  travelMin: 60,            // ⚠️ čas na přesun před a po návrhu u klienta doma
  infolinePhone: "",        // jedno číslo jako infolinka (ukazuje se na /rezervovat/)
  coverageAlertDays: 60,    // jak daleko dopředu hlídat studio bez směny (2 měsíce)
  raynet: {
    busyEntities: ["event", "meeting"], // ⚠️ co designéři v Raynetu používají
    writeEntity: "event",               // ⚠️ Událost, nebo Schůzka
    cancelMode: "delete",               // ⚠️ "delete" | "rename"
    createContact: true,                // zakládat klienta, když se nenajde
    createBusinessCase: true,           // každá schůzka = obchodní případ (Martin 2026-11-05)
    businessCaseCategory: null,         // ⚠️ ID kategorie OP v Raynetu (číselník), nepovinné
    companyRating: "A", companyState: "A_POTENTIAL", companyRole: "A_SUBSCRIBER", // povinná pole klienta
    liveCheck: true,                    // živá kontrola obsazenosti těsně před zápisem
  },
};

let configCache = { value: null, at: 0 };

async function loadConfig() {
  if (configCache.value && Date.now() - configCache.at < 60000) return configCache.value;
  const snap = await getFirestore().collection("config").doc("rezervace").get();
  const data = snap.exists ? snap.data() : {};
  const value = {
    ...DEFAULT_CONFIG,
    ...data,
    studios: { ...DEFAULT_CONFIG.studios, ...(data.studios || {}) },
    raynet: { ...DEFAULT_CONFIG.raynet, ...(data.raynet || {}) },
  };
  configCache = { value, at: Date.now() };
  return value;
}

// ── načítání dat ────────────────────────────────────────────────────────────

const toDate = (v) => (v?.toDate ? v.toDate() : v instanceof Date ? v : v ? new Date(v) : null);

async function loadServices(db, { activeOnly = true } = {}) {
  const snap = await db.collection("res_services").get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => !activeOnly || s.active !== false)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

async function loadService(db, id) {
  if (!id || typeof id !== "string") throw new HttpsError("invalid-argument", "Chybí služba.");
  const snap = await db.collection("res_services").doc(id).get();
  if (!snap.exists || snap.data().active === false) throw new HttpsError("not-found", "Služba neexistuje.");
  return { id: snap.id, ...snap.data() };
}

async function loadDesigners(db) {
  const snap = await db.collection("users").where("reservations.enabled", "==", true).get();
  return snap.docs
    .map((d) => ({ slug: d.id, name: d.data().name, position: d.data().position, active: d.data().active, reservations: d.data().reservations || {} }))
    .filter((u) => u.active !== false);
}

// Bloky/rezervace se načítají jedním rozsahovým dotazem podle začátku (bez
// složených indexů — objem je malý), zbytek se filtruje v JS.
async function loadAvailability(db, from, to) {
  const snap = await db.collection("res_availability")
    .where("start", ">=", Timestamp.fromMillis(from - DAY_MS))
    .where("start", "<", Timestamp.fromMillis(to)).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => toDate(a.end).getTime() > from);
}

async function loadBookings(db, from, to) {
  const snap = await db.collection("res_bookings")
    .where("start", ">=", Timestamp.fromMillis(from - DAY_MS))
    .where("start", "<", Timestamp.fromMillis(to)).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadBusy(db, slugs) {
  if (!slugs.length) return {};
  const refs = slugs.map((s) => db.collection("res_busy").doc(s));
  const snaps = await db.getAll(...refs);
  return Object.fromEntries(snaps.filter((s) => s.exists).map((s) => [s.id, s.data().intervals || []]));
}

async function slotContext(db, { service, studio, region, designer, from, to, cfg }) {
  const designers = eligibleDesigners(await loadDesigners(db), service, { studio, region })
    .filter((d) => !designer || d.slug === designer);
  const slugs = designers.map((d) => d.slug);
  const [stored, bookings, busy] = await Promise.all([
    loadAvailability(db, from, to),
    loadBookings(db, from, to),
    loadBusy(db, slugs),
  ]);
  // Stálé směny (designér je ve studiu vždy podle otevírací doby) se dopočítají.
  const availability = [...stored, ...permanentShiftBlocks(designers, cfg.studios, from - DAY_MS, to)];
  return {
    designers,
    params: {
      service, availability, bookings, busy, studio, designers: slugs,
      stepMin: cfg.stepMin, blockHolidays: cfg.blockHolidays, travelMin: cfg.travelMin,
    },
  };
}

// ── validace vstupu ─────────────────────────────────────────────────────────

const cut = (v, n = MAX_FIELD_LEN) => (typeof v === "string" ? v.trim().slice(0, n) : "");

function validateClient(input, service) {
  const name = cut(input.name, 200);
  const phone = normalizePhone(cut(input.phone, 100));
  const emailRaw = cut(input.email, 200).toLowerCase();
  const email = isEmail(emailRaw) ? emailRaw : "";
  const address = cut(input.address, 500);
  if (!name) throw new HttpsError("invalid-argument", "Vyplňte prosím jméno.");
  if (!phone) throw new HttpsError("invalid-argument", "Zadejte prosím platné telefonní číslo.");
  if (emailRaw && !email) throw new HttpsError("invalid-argument", "E-mail nemá platný tvar.");
  if (service.type === "home" && !address) throw new HttpsError("invalid-argument", "U návrhu doma vyplňte prosím adresu.");
  return { client: { name, phone, email }, address, note: cut(input.note) };
}

function validateStart(value) {
  const start = new Date(value);
  if (!value || Number.isNaN(start.getTime())) throw new HttpsError("invalid-argument", "Chybí nebo je neplatný termín.");
  return start;
}

function validateStudio(service, studio) {
  if (service.type !== "studio") return null;
  if (!STUDIOS.includes(studio)) throw new HttpsError("invalid-argument", "Vyberte prosím studio.");
  return studio;
}

// Návrh doma: oblast, kde klient bydlí — podle ní se nabízí jen designéři,
// kteří tam jezdí. `required: false` jen pro interní výpis slotů (všechny oblasti).
function validateRegion(service, region, cfg, { required = true } = {}) {
  if (service.type !== "home") return null;
  if (!region && !required) return null;
  if (!(cfg.homeRegions || []).some((r) => r.id === region)) throw new HttpsError("invalid-argument", "Vyberte prosím oblast, kde bydlíte.");
  return region;
}

// ── zápis rezervace (transakce se zámkem designér+den) ──────────────────────

// Zámek `res_locks/{designer}_{den}` serializuje souběžné zápisy pro stejného
// designéra a den — dvě rezervace na stejný čas se tak nikdy obě nezapíšou.
async function writeWithLock(db, { designerSlug, start, end, bufferMin, travelMin, serviceType, excludeId }, write) {
  const dayKey = pragueDateKey(start);
  const lockRef = db.collection("res_locks").doc(`${designerSlug}_${dayKey}`);
  const bufMs = (bufferMin || 0) * MIN_MS;
  const travelMs = (travelMin || 0) * MIN_MS;
  await db.runTransaction(async (tx) => {
    await tx.get(lockRef);
    const same = await tx.get(db.collection("res_bookings")
      .where("designerSlug", "==", designerSlug).where("dayKey", "==", dayKey));
    const clash = same.docs.some((d) => {
      if (d.id === excludeId) return false;
      const b = d.data();
      if (!BLOCKING_STATUSES.includes(b.status)) return false;
      const gap = gapMs(serviceType, b.serviceType, bufMs, travelMs);
      return overlaps(start.getTime(), end.getTime(), b.start.toMillis() - gap, b.end.toMillis() + gap);
    });
    if (clash) throw new HttpsError("aborted", "Termín byl mezitím obsazen. Vyberte prosím jiný.");
    tx.set(lockRef, { updatedAt: FieldValue.serverTimestamp() });
    write(tx, dayKey);
  });
}

// Vlastní události platformy, které se nemají počítat jako obsazenost.
async function ownEventIds(db) {
  const snap = await db.collection("res_bookings").where("start", ">=", Timestamp.fromMillis(Date.now() - DAY_MS)).get();
  return new Set(snap.docs.map((d) => d.data().raynet?.eventId).filter(Boolean).map(String));
}

// Živá kontrola v Raynetu — chyba Raynetu rezervaci nikdy nezastaví.
async function raynetBusyAt(db, designer, start, end, cfg) {
  if (!cfg.raynet.liveCheck || !designer.reservations.raynetUserId) return false;
  const rn = await getRaynet();
  if (!rn) return false;
  try {
    const [events, own] = await Promise.all([
      rn.listCalendar(designer.reservations.raynetUserId, start, end, cfg.raynet.busyEntities),
      ownEventIds(db),
    ]);
    return events.some((e) => !own.has(String(e.id)));
  } catch (err) {
    console.warn("rezervace: živá kontrola Raynetu selhala, pokračuji bez ní", designer.slug, err.message);
    return false;
  }
}

/**
 * Společná cesta pro web i ruční zadání (spec kap. 4: "jde stejnou cestou").
 * @returns {Promise<object>} uložená rezervace (id, status, start, end, designerSlug)
 */
async function createBooking(input, { source, actor, internal }) {
  const db = getFirestore();
  const cfg = await loadConfig();
  const service = await loadService(db, input.serviceId);
  const studio = validateStudio(service, input.studio);
  const region = validateRegion(service, input.region, cfg);
  const start = validateStart(input.start);
  const end = new Date(start.getTime() + service.durationMin * MIN_MS);
  const { client, address, note } = validateClient(input, service);
  const ignoreLead = internal && input.ignoreLead === true;

  if (!internal && cfg.maxActivePerPhone > 0) {
    const mine = await db.collection("res_bookings").where("client.phone", "==", client.phone).get();
    const active = mine.docs.filter((d) => ["requested", "confirmed"].includes(d.data().status) && d.data().end.toMillis() > Date.now());
    if (active.length >= cfg.maxActivePerPhone) {
      throw new HttpsError("resource-exhausted", "Na tento telefon už je víc rezervací. Zavolejte nám prosím.");
    }
  }

  const { designers, params } = await slotContext(db, {
    service, studio, region, designer: input.designerSlug || null,
    from: start.getTime(), to: start.getTime() + 1, cfg,
  });
  const now = new Date();
  const free = computeSlots({ ...params, now, from: start, to: new Date(start.getTime() + 1), ignoreLead })
    .filter((s) => s.start.getTime() === start.getTime());
  if (!free.length) throw new HttpsError("failed-precondition", "Tento termín už není volný. Vyberte prosím jiný.");

  // Víc volných designérů → ten s nejméně rezervacemi v daný den.
  const dayKey = pragueDateKey(start);
  const load = (slug) => params.bookings.filter((b) => b.designerSlug === slug && b.dayKey === dayKey && b.status !== "cancelled").length;
  const candidates = free.map((s) => designers.find((d) => d.slug === s.designerSlug)).filter(Boolean)
    .sort((a, b) => load(a.slug) - load(b.slug));

  const ref = db.collection("res_bookings").doc();
  const status = internal && ["requested", "confirmed"].includes(input.status)
    ? input.status
    : (service.requiresConfirmation ? "requested" : "confirmed");
  const at = Timestamp.fromDate(now);

  for (const designer of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await raynetBusyAt(db, designer, start, end, cfg)) continue;
    const booking = {
      serviceId: service.id,
      serviceName: service.name,
      serviceType: service.type,
      designerSlug: designer.slug,
      studio,
      region,
      start: Timestamp.fromDate(start),
      end: Timestamp.fromDate(end),
      status,
      client,
      address: service.type === "home" ? address : "",
      note,
      source,
      leadId: cut(input.leadId, 100) || null,
      utm: sanitizeUtm(input.utm),
      sourceUrl: cut(input.sourceUrl, 1000),
      raynet: {},
      manageToken: crypto.randomBytes(24).toString("base64url"),
      history: [{ at, by: actor, action: "created", note: ignoreLead ? "předstih přebit interně" : "" }],
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
      updatedBy: actor,
    };
    // eslint-disable-next-line no-await-in-loop
    await writeWithLock(db, { designerSlug: designer.slug, start, end, bufferMin: service.bufferMin, travelMin: cfg.travelMin, serviceType: service.type }, (tx, day) => {
      tx.create(ref, { ...booking, dayKey: day });
    });
    return { id: ref.id, ...booking, designerName: designer.name };
  }
  throw new HttpsError("failed-precondition", "Tento termín už není volný. Vyberte prosím jiný.");
}

function sanitizeUtm(utm) {
  const out = {};
  if (!utm || typeof utm !== "object") return out;
  for (const k of ["source", "medium", "campaign", "content", "term"]) {
    if (typeof utm[k] === "string" && utm[k].trim()) out[k] = utm[k].trim().slice(0, 300);
  }
  return out;
}

// ── interní operace nad existující rezervací ────────────────────────────────

async function loadBooking(db, id) {
  if (!id || typeof id !== "string") throw new HttpsError("invalid-argument", "Chybí ID rezervace.");
  const ref = db.collection("res_bookings").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Rezervace neexistuje.");
  return { ref, booking: { id: snap.id, ...snap.data() } };
}

const historyEntry = (actor, action, note = "") => ({ at: Timestamp.now(), by: actor, action, note });

async function changeStatus(id, actor, from, to, action, note) {
  const db = getFirestore();
  const { ref, booking } = await loadBooking(db, id);
  if (!from.includes(booking.status)) {
    throw new HttpsError("failed-precondition", `Rezervaci ve stavu „${booking.status}“ nelze ${action}.`);
  }
  await ref.update({
    status: to,
    history: FieldValue.arrayUnion(historyEntry(actor, to, cut(note, 500))),
    updatedAt: Timestamp.now(),
    updatedBy: actor,
  });
  return { id, status: to };
}

async function moveBooking(input, actor) {
  const db = getFirestore();
  const cfg = await loadConfig();
  const { ref, booking } = await loadBooking(db, input.id);
  if (!["requested", "confirmed"].includes(booking.status)) {
    throw new HttpsError("failed-precondition", "Přesunout jde jen čekající nebo potvrzenou rezervaci.");
  }
  const service = await loadService(db, booking.serviceId);
  const start = validateStart(input.start);
  const end = new Date(start.getTime() + service.durationMin * MIN_MS);
  const designerSlug = input.designerSlug || booking.designerSlug;
  const { designers, params } = await slotContext(db, {
    service, studio: booking.studio, region: booking.region || null, designer: designerSlug, from: start.getTime(), to: start.getTime() + 1, cfg,
  });
  const free = computeSlots({
    ...params, now: new Date(), from: start, to: new Date(start.getTime() + 1),
    ignoreLead: input.ignoreLead === true, excludeBookingId: booking.id,
  }).some((s) => s.start.getTime() === start.getTime());
  if (!free) throw new HttpsError("failed-precondition", "Nový termín není volný.");
  const designer = designers.find((d) => d.slug === designerSlug);
  if (await raynetBusyAt(db, designer, start, end, cfg)) {
    throw new HttpsError("failed-precondition", "Designér má v tu dobu v Raynetu jinou schůzku.");
  }
  const oldStart = toDate(booking.start);
  await writeWithLock(db, { designerSlug, start, end, bufferMin: service.bufferMin, travelMin: cfg.travelMin, serviceType: service.type, excludeId: booking.id }, (tx, dayKey) => {
    tx.update(ref, {
      start: Timestamp.fromDate(start),
      end: Timestamp.fromDate(end),
      designerSlug,
      dayKey,
      "raynet.movedInRaynet": null,
      history: FieldValue.arrayUnion(historyEntry(actor, "moved",
        `${fmt(oldStart)} → ${fmt(start)}${designerSlug !== booking.designerSlug ? ` (${booking.designerSlug} → ${designerSlug})` : ""}`)),
      updatedAt: Timestamp.now(),
      updatedBy: actor,
    });
  });
  return { id: booking.id, start: start.toISOString(), designerSlug };
}

const fmt = (d) => d.toLocaleString("cs-CZ", { timeZone: TZ, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

// ── veřejné HTTP funkce (public/rezervovat/) ────────────────────────────────

const PUBLIC_CORS = [
  /^https:\/\/koupelny-navstevnost\.(web\.app|firebaseapp\.com)$/,
  /^https:\/\/(www\.)?koupelnysyrovy\.cz$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

// Jednoduchý limit na IP v rámci instance (max. 5 instancí) — proti
// automatickému zahlcení, ne neprůstřelná ochrana. Spolu s honeypotem.
const ipHits = new Map();
function rateLimited(req, max = 10, windowMs = 10 * MIN_MS) {
  const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) ipHits.clear();
  return hits.length > max;
}

function sendError(res, err) {
  if (err instanceof HttpsError) {
    const http = { "invalid-argument": 400, "not-found": 404, "failed-precondition": 409, aborted: 409, "resource-exhausted": 429 }[err.code] || 400;
    res.status(http).json({ ok: false, error: err.code, message: err.message });
    return;
  }
  console.error("rezervace: neočekávaná chyba", err);
  res.status(500).json({ ok: false, error: "internal", message: "Něco se pokazilo. Zkuste to prosím znovu, nebo nám zavolejte." });
}

const publicService = (s) => ({
  id: s.id, name: s.name, type: s.type, durationMin: s.durationMin,
  priceText: s.priceText || "", requiresConfirmation: !!s.requiresConfirmation, description: s.description || "",
});

exports.volneTerminy = onRequest({ region: REGION, maxInstances: 5, cors: PUBLIC_CORS }, async (req, res) => {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "method-not-allowed" });
      return;
    }
    const db = getFirestore();
    const cfg = await loadConfig();
    const q = req.query;
    const serviceId = cut(q.sluzba, 100);

    const designerSlug = cut(q.designer, 100) || null;
    const studioInfo = (id) => ({ id, name: cfg.studios[id]?.name || STUDIO_NAMES[id], address: cfg.studios[id]?.address || "" });

    // Bez služby: nabídka služeb, studií a oblastí pro první krok formuláře.
    // S `designer` (přímý odkaz z profilu designéra) navíc jeho profil a co
    // vede — formulář pak nabídne jen jeho služby, studia a oblasti.
    if (!serviceId) {
      const services = await loadServices(db);
      let designer = null;
      if (designerSlug) {
        const d = (await loadDesigners(db)).find((x) => x.slug === designerSlug);
        if (d) {
          designer = {
            ...publicProfile(d),
            services: (d.reservations.services || []).filter((id) => services.some((s) => s.id === id)),
            studios: d.reservations.studios || [],
            homeRegions: homeRegionsOf(d),
          };
        }
      }
      res.json({
        ok: true,
        services: services.map(publicService),
        studios: STUDIOS.map(studioInfo),
        homeRegions: cfg.homeRegions,
        designer,
        privacyUrl: cfg.privacyUrl || "",
        infolinePhone: cfg.infolinePhone || "",
      });
      return;
    }

    const service = await loadService(db, serviceId);
    const studio = validateStudio(service, cut(q.studio, 20));
    const region = validateRegion(service, cut(q.oblast, 40), cfg);
    const now = new Date();
    const od = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q.od || "");
    const fromDay = od ? fromPrague(+od[1], +od[2], +od[3], 0).getTime() : now.getTime();
    const from = Math.max(now.getTime(), fromDay);
    const to = Math.min(from + 31 * DAY_MS, horizonEnd(service, now));
    const { designers, params } = await slotContext(db, { service, studio, region, designer: null, from, to, cfg });
    const all = computeSlots({ ...params, now, from: new Date(from), to: new Date(to) });

    // Designéři pro výběr (firma tlačí konkrétní designéry): profil + nejbližší
    // volný termín. Kontakty ani obsazenost se ven nedávají, jen volné časy.
    const nextFree = {};
    for (const sl of all) if (!nextFree[sl.designerSlug]) nextFree[sl.designerSlug] = sl.start.toISOString();
    const list = designers
      .map((d) => ({ ...publicProfile(d), nextSlot: nextFree[d.slug] || null }))
      .sort((x, y) => (x.nextSlot || "9").localeCompare(y.nextSlot || "9") || x.name.localeCompare(y.name, "cs"));

    const chosen = designerSlug ? all.filter((sl) => sl.designerSlug === designerSlug) : all;
    const times = [...new Set(chosen.map((sl) => sl.start.getTime()))].sort((x, y) => x - y);
    res.json({
      ok: true,
      service: publicService(service),
      studio: studio ? studioInfo(studio) : null,
      region: region ? cfg.homeRegions.find((r) => r.id === region) : null,
      designers: list,
      designer: designerSlug ? list.find((d) => d.slug === designerSlug) || null : null,
      slots: times.map((t) => new Date(t).toISOString()),
    });
  } catch (err) {
    sendError(res, err);
  }
});

exports.vytvoritRezervaci = onRequest({ region: REGION, maxInstances: 5, cors: PUBLIC_CORS }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "method-not-allowed" });
      return;
    }
    if (rateLimited(req)) {
      res.status(429).json({ ok: false, error: "rate-limited", message: "Příliš mnoho pokusů. Zkuste to prosím za chvíli." });
      return;
    }
    const body = typeof req.body === "object" && req.body ? req.body : {};
    // Honeypot: skryté pole, které člověk nevyplní. Robotovi tváříme úspěch.
    if (cut(body.web)) {
      console.warn("vytvoritRezervaci: honeypot vyplněn, zahazuji");
      res.status(200).json({ ok: true, id: null });
      return;
    }
    const booking = await createBooking({
      serviceId: cut(body.sluzba, 100),
      studio: cut(body.studio, 20),
      region: cut(body.oblast, 40),
      designerSlug: cut(body.designer, 100) || null,
      start: body.start,
      name: body.name, phone: body.phone, email: body.email, address: body.address, note: body.note,
      utm: body.utm, sourceUrl: body.sourceUrl,
    }, { source: "web", actor: "web", internal: false });
    console.log("vytvoritRezervaci: založena", booking.id, { service: booking.serviceId, status: booking.status });
    res.status(200).json({
      ok: true,
      id: booking.id,
      status: booking.status,
      start: booking.start.toDate().toISOString(),
      end: booking.end.toDate().toISOString(),
      designerName: booking.designerName,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ── interní onCall (public/rezervace/) ──────────────────────────────────────

async function callerInfo(request) {
  const slug = request.auth?.token?.slug;
  if (!slug) throw new HttpsError("unauthenticated", "Přihlaste se prosím znovu.");
  const snap = await getFirestore().collection("users").doc(slug).get();
  const isAdmin = ["hr", "admin"].includes(snap.data()?.platformRole);
  // Každý si spravuje své rezervace (posun, zrušení). Všechny smí admin/HR a
  // ten, kdo má v nastavení „Spravuje všechny rezervace“ (CX, Matouš).
  return { slug, isAdmin, manageAll: isAdmin || snap.data()?.reservations?.manageAll === true };
}

async function assertCanManage(caller, id) {
  if (caller.manageAll) return;
  const snap = await getFirestore().collection("res_bookings").doc(String(id || "-")).get();
  if (snap.exists && snap.data().designerSlug !== caller.slug) {
    throw new HttpsError("permission-denied", "Můžeš spravovat jen svoje rezervace.");
  }
}

// ── nastavení designéra (users/{slug}.reservations) ─────────────────────────

// Co si designér smí změnit sám (mojeNastaveni) a co jen admin (nastavitDesignera).
const SELF_KEYS = ["studios", "homeRegions", "services", "publicPosition", "bio", "photoUrl"];
const ADMIN_ONLY_KEYS = ["enabled", "raynetUserId", "permanentShift", "manageAll"];
const ALL_KEYS = [...SELF_KEYS, ...ADMIN_ONLY_KEYS];

// Zvaliduje vstup a slije ho se stávajícím nastavením — klíče mimo `keys`
// zůstanou, jak byly (designér si tak nemůže sám zapnout třeba správu všech).
async function buildReservations(db, r, current, keys) {
  const services = (await loadServices(db, { activeOnly: false })).map((s) => s.id);
  const regionIds = ((await loadConfig()).homeRegions || []).map((x) => x.id);
  const raynetUserId = r.raynetUserId === "" || r.raynetUserId == null ? null : Number(r.raynetUserId);
  if (keys.includes("raynetUserId") && raynetUserId !== null && !Number.isInteger(raynetUserId)) {
    throw new HttpsError("invalid-argument", "Raynet ID musí být číslo.");
  }
  const photoUrl = cut(r.photoUrl, 500);
  if (keys.includes("photoUrl") && photoUrl && !/^https:\/\//.test(photoUrl)) {
    throw new HttpsError("invalid-argument", "Fotka musí být https:// odkaz.");
  }
  const next = {
    enabled: r.enabled === true,
    studios: (r.studios || []).filter((s) => STUDIOS.includes(s)),
    homeRegions: (r.homeRegions || []).filter((s) => regionIds.includes(s)),
    services: (r.services || []).filter((s) => services.includes(s)),
    raynetUserId,
    // Veřejný profil na /rezervovat/ (firma tlačí konkrétní designéry).
    publicPosition: cut(r.publicPosition, 100),
    bio: cut(r.bio, 400),
    photoUrl,
    // Vždy ve studiu (hlavní pracovní poměr) — směny podle otevírací doby.
    permanentShift: STUDIOS.includes(r.permanentShift) ? r.permanentShift : null,
    // Smí posouvat/rušit/potvrzovat rezervace všech (CX, vedení).
    manageAll: r.manageAll === true,
  };
  const out = { ...current };
  for (const k of keys) if (k in r) out[k] = next[k];
  for (const k of ALL_KEYS) if (out[k] === undefined) out[k] = k === "enabled" || k === "manageAll" ? false : (Array.isArray(next[k]) ? [] : null);
  return out;
}

exports.rezervaceAkce = onCall({ region: REGION }, async (request) => {
  const caller = await callerInfo(request);
  const data = request.data || {};
  const db = getFirestore();

  switch (data.action) {
    case "info": {
      const rn = await getRaynet();
      return { raynetConfigured: !!rn, raynetMock: !!rn?.cfg?.mock, isAdmin: caller.isAdmin, manageAll: caller.manageAll, slug: caller.slug };
    }

    case "sloty": {
      const cfg = await loadConfig();
      const service = await loadService(db, data.serviceId);
      const studio = validateStudio(service, data.studio);
      const region = validateRegion(service, data.region || null, cfg, { required: false });
      const now = new Date();
      const from = data.from ? new Date(data.from).getTime() : now.getTime();
      const to = Math.min((data.to ? new Date(data.to).getTime() : from + 14 * DAY_MS), from + 62 * DAY_MS);
      const { designers, params } = await slotContext(db, { service, studio, region, designer: data.designerSlug || null, from, to, cfg });
      const slots = computeSlots({ ...params, now, from: new Date(from), to: new Date(to), ignoreLead: data.ignoreLead === true });
      const names = Object.fromEntries(designers.map((d) => [d.slug, d.name]));
      return {
        slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString(), designerSlug: s.designerSlug, designerName: names[s.designerSlug] })),
      };
    }

    case "vytvorit": {
      const source = SOURCES.includes(data.source) && data.source !== "web" ? data.source : "phone";
      // Designér zakládá rezervace jen sobě, CX/admin komukoliv.
      if (!caller.manageAll && data.designerSlug && data.designerSlug !== caller.slug) {
        throw new HttpsError("permission-denied", "Můžeš zakládat jen svoje rezervace.");
      }
      const input = caller.manageAll ? data : { ...data, designerSlug: caller.slug };
      const b = await createBooking(input, { source, actor: caller.slug, internal: true });
      return { id: b.id, status: b.status, start: b.start.toDate().toISOString(), designerSlug: b.designerSlug };
    }

    case "potvrdit":
      await assertCanManage(caller, data.id);
      return changeStatus(data.id, caller.slug, ["requested"], "confirmed", "potvrdit", data.note);

    case "zrusit":
      await assertCanManage(caller, data.id);
      return changeStatus(data.id, caller.slug, ["requested", "confirmed"], "cancelled", "zrušit", data.note);

    case "stav": {
      if (!["done", "no_show"].includes(data.status)) throw new HttpsError("invalid-argument", "Stav musí být done nebo no_show.");
      await assertCanManage(caller, data.id);
      return changeStatus(data.id, caller.slug, ["confirmed", "done", "no_show"], data.status, "změnit", data.note);
    }

    case "presunout":
      await assertCanManage(caller, data.id);
      if (!caller.manageAll && data.designerSlug && data.designerSlug !== caller.slug) {
        throw new HttpsError("permission-denied", "Rezervaci můžeš přesunout jen v rámci svého kalendáře.");
      }
      return moveBooking(data, caller.slug);

    // Kalendář studia: kdo kdy drží směnu a dny, kdy má být studio otevřené,
    // ale nikdo tam není (alert na 2 měsíce dopředu).
    case "pokryti": {
      const cfg = await loadConfig();
      const studio = validateStudio({ type: "studio" }, data.studio);
      const from = data.from ? new Date(data.from).getTime() : Date.now();
      const days = Math.min(Number(data.days) || cfg.coverageAlertDays, 120);
      const to = from + days * DAY_MS;
      const designers = await loadDesigners(db);
      const stored = (await loadAvailability(db, from, to)).filter((a) => a.studio === studio);
      const shifts = [...stored, ...permanentShiftBlocks(designers, cfg.studios, from - DAY_MS, to)];
      const coverage = studioCoverage(studio, cfg.studios[studio], shifts, from, to);
      const iso = (d) => (d ? new Date(d).toISOString() : null);
      return {
        studio,
        openingHoursSet: Object.keys(cfg.studios[studio]?.openingHours || {}).length > 0,
        days: coverage.map((d) => ({
          date: d.date, open: d.open?.map(iso) || null, covered: d.covered,
          gaps: d.gaps.map(([a, b]) => [iso(a), iso(b)]), staff: d.staff,
        })),
        permanent: shifts.filter((x) => x.permanent && x.studio === studio)
          .map((x) => ({ designerSlug: x.designerSlug, start: iso(x.start), end: iso(x.end) })),
      };
    }

    case "nastavitDesignera": {
      if (!caller.isAdmin) throw new HttpsError("permission-denied", "Nastavení designérů smí měnit jen admin.");
      const slug = cut(data.slug, 100);
      const ref = db.collection("users").doc(slug);
      const snap = await ref.get();
      if (!slug || !snap.exists) throw new HttpsError("not-found", "Člověk neexistuje.");
      const reservations = await buildReservations(db, data.reservations || {}, snap.data().reservations || {}, ALL_KEYS);
      // Jen pod-objekt `reservations` — nic jiného v users/{slug} se nemění.
      await ref.update({ reservations });
      return { slug, reservations };
    }

    // Designér si sám nastaví, kde a co dělá, a svůj veřejný profil. Co má
    // dopad na ostatní (zapnutí, Raynet ID, stálá směna, správa všech), mění admin.
    case "mojeNastaveni": {
      const ref = db.collection("users").doc(caller.slug);
      const snap = await ref.get();
      if (!snap.exists) throw new HttpsError("not-found", "Profil neexistuje.");
      const reservations = await buildReservations(db, data.reservations || {}, snap.data().reservations || {}, SELF_KEYS);
      await ref.update({ reservations });
      return { slug: caller.slug, reservations };
    }

    default:
      throw new HttpsError("invalid-argument", "Neznámá akce.");
  }
});

// ── Raynet push (trigger) ───────────────────────────────────────────────────

const ACTIVE_IN_RAYNET = ["confirmed", "done", "no_show"];
const MAX_SYNC_ATTEMPTS = 10;

// Studio, ke kterému rezervace patří (u návrhu doma studio oblasti — oblasti
// mají stejné klíče jako studia). Jeho adresa jde ke klientovi v Raynetu kvůli
// středisku v Pohodě.
const bookingStudio = (b) => b.studio || b.region || null;

function studioAddress(cfg, key) {
  const st = cfg.studios[key] || {};
  const name = `Studio ${st.name || STUDIO_NAMES[key] || key || ""}`.trim();
  return { name, street: st.street || "", city: st.city || st.name || STUDIO_NAMES[key] || "", zipCode: st.zipCode || "" };
}

function bookingDescription(b) {
  return [
    `Rezervace z platformy (${b.source})`,
    `Klient: ${b.client?.name || ""}, ${b.client?.phone || ""}${b.client?.email ? `, ${b.client.email}` : ""}`,
    b.address ? `Adresa: ${b.address}` : "",
    b.note ? `Poznámka: ${b.note}` : "",
    b.utm?.campaign ? `Kampaň: ${b.utm.source || ""} / ${b.utm.campaign}` : "",
    `ID rezervace: ${b.id}`,
  ].filter(Boolean).join("\n");
}

function businessCasePayload(b, designer, cfg, companyId) {
  return {
    name: `${b.serviceName || "Schůzka"} – ${b.client?.name || ""}`.trim(),
    company: companyId,
    owner: designer.reservations.raynetUserId,
    validFrom: pragueDateKey(toDate(b.start)),
    description: bookingDescription(b),
    ...(cfg.raynet.businessCaseCategory ? { category: cfg.raynet.businessCaseCategory } : {}),
    _extId: `${EXT_ID_PREFIX}${b.id}`,
  };
}

function eventPayload(b, designer, cfg, { companyId, businessCaseId } = {}) {
  const studioName = b.studio ? (cfg.studios[b.studio]?.name || STUDIO_NAMES[b.studio]) : null;
  const place = b.serviceType === "home" ? b.address : [studioName, cfg.studios[b.studio]?.address].filter(Boolean).join(", ");
  return {
    title: `${b.serviceName || "Schůzka"} – ${b.client?.name || ""}`.trim(),
    owner: designer.reservations.raynetUserId,
    company: companyId || undefined,
    businessCase: businessCaseId || undefined,
    scheduledFrom: toDate(b.start).toISOString(),
    scheduledTill: toDate(b.end).toISOString(),
    meetingPlace: place || undefined,
    description: bookingDescription(b),
    _extId: `${EXT_ID_PREFIX}${b.id}`,
  };
}

const sameTime = (a, b) => (a ? toDate(a).getTime() : null) === (b ? toDate(b).getTime() : null);

// Idempotentní — porovná, co je v Raynetu (raynet.synced*), s rezervací a udělá
// jen rozdíl. Zápis výsledku do `raynet` spustí trigger znovu, ale ten už nic
// nenajde, takže se nezacyklí.
async function syncBooking(ref, b) {
  const r = b.raynet || {};
  const write = (patch) => ref.update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [`raynet.${k}`, v])));

  const rn = await getRaynet();
  if (!rn) {
    if (r.state !== "not_configured" && !r.eventId) await write({ state: "not_configured" });
    return;
  }
  const cfg = await loadConfig();
  const entity = r.entity || cfg.raynet.writeEntity;
  const active = ACTIVE_IN_RAYNET.includes(b.status);
  const needsCreate = active && !r.eventId;
  const designerChanged = active && r.eventId && r.syncedDesigner !== b.designerSlug;
  const timeChanged = active && r.eventId && !designerChanged && (!sameTime(r.syncedStart, b.start) || !sameTime(r.syncedEnd, b.end));
  const needsCancel = b.status === "cancelled" && r.eventId && !r.cancelledAt;
  if (!needsCreate && !designerChanged && !timeChanged && !needsCancel) {
    if (b.status === "requested" && r.state !== "waiting" && !r.eventId) await write({ state: "waiting" });
    return;
  }

  try {
    const designerSnap = await getFirestore().collection("users").doc(b.designerSlug).get();
    const designer = { slug: b.designerSlug, reservations: designerSnap.data()?.reservations || {} };

    if (needsCancel) {
      if (cfg.raynet.cancelMode === "rename") {
        await rn.updateEvent(entity, r.eventId, { title: `ZRUŠENO – ${b.serviceName || ""} – ${b.client?.name || ""}` });
      } else {
        await rn.deleteEvent(entity, r.eventId);
      }
      await write({ state: "cancelled", cancelledAt: Timestamp.now(), error: null, attempts: 0 });
      return;
    }

    if (!designer.reservations.raynetUserId) {
      await write({ state: "error", error: `Designér ${b.designerSlug} nemá vyplněné Raynet ID.`, attempts: MAX_SYNC_ATTEMPTS });
      return;
    }

    const bk = { ...b, id: ref.id };

    if (designerChanged) {
      await rn.deleteEvent(entity, r.eventId);
      // OP patří novému designérovi (vlastník), zůstává stejný případ.
      if (r.businessCaseId) await rn.updateBusinessCase(r.businessCaseId, { owner: designer.reservations.raynetUserId });
    }

    if (needsCreate || designerChanged) {
      // Každá schůzka = obchodní případ: klient (s adresou studia) → OP → událost.
      // Mezivýsledky se ukládají hned, ať opakování po chybě nezakládá duplicity.
      let companyId = r.companyId || null;
      if (!companyId) {
        const client = await rn.findOrCreateClient(b.client || {}, {
          ownerId: designer.reservations.raynetUserId,
          studioAddress: studioAddress(cfg, bookingStudio(b)),
          defaults: cfg.raynet,
          create: cfg.raynet.createContact,
        });
        companyId = client.id;
        if (companyId) await write({ companyId: String(companyId), companyCreated: client.created });
      }
      let businessCaseId = r.businessCaseId || null;
      if (!businessCaseId && companyId && cfg.raynet.createBusinessCase) {
        businessCaseId = await rn.createBusinessCase(businessCasePayload(bk, designer, cfg, companyId));
        await write({ businessCaseId: String(businessCaseId) });
      }
      const eventId = await rn.createEvent(cfg.raynet.writeEntity, eventPayload(bk, designer, cfg, { companyId, businessCaseId }));
      await write({
        state: "ok", entity: cfg.raynet.writeEntity, eventId: String(eventId),
        syncedStart: b.start, syncedEnd: b.end, syncedDesigner: b.designerSlug,
        syncedAt: Timestamp.now(), error: null, attempts: 0, movedInRaynet: null,
      });
      return;
    }

    // timeChanged — upravit jen vlastní událost.
    const { _extId, ...payload } = eventPayload(bk, designer, cfg, { companyId: r.companyId, businessCaseId: r.businessCaseId });
    await rn.updateEvent(entity, r.eventId, payload);
    await write({ state: "ok", syncedStart: b.start, syncedEnd: b.end, syncedAt: Timestamp.now(), error: null, attempts: 0 });
  } catch (err) {
    console.error("rezervace: Raynet push selhal", ref.id, err.message);
    await write({ state: "error", error: String(err.message).slice(0, 500), attempts: (r.attempts || 0) + 1, lastAttemptAt: Timestamp.now() });
  }
}

// Reaguje jen na změnu stavu/času/designéra (nebo založení). Zápisy do
// `raynet.*` (výsledek pushe, příznak přesunu) trigger ignoruje — jinak by se
// neúspěšný push opakoval donekonečna. Opakování řeší rezervaceObsazenost.
const SYNC_FIELDS = ["status", "start", "end", "designerSlug"];

exports.rezervaceRaynetSync = onDocumentWritten({ region: REGION, document: "res_bookings/{id}" }, async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;
  const before = event.data.before?.exists ? event.data.before.data() : null;
  const a = after.data();
  if (before && SYNC_FIELDS.every((f) => (f === "start" || f === "end") ? sameTime(before[f], a[f]) : before[f] === a[f])) return;
  await syncBooking(after.ref, { id: after.id, ...a });
});

// ── obsazenost z Raynetu (každých 10 min) ───────────────────────────────────

async function refreshBusy() {
  const rn = await getRaynet();
  if (!rn) return { skipped: "not_configured" };
  const db = getFirestore();
  const cfg = await loadConfig();
  const services = await loadServices(db);
  const now = new Date();
  const from = new Date(now.getTime() - DAY_MS);
  const to = new Date(Math.max(now.getTime() + 61 * DAY_MS, ...services.map((s) => horizonEnd(s, now))));

  // Vlastní budoucí rezervace s událostí v Raynetu → přeskočit + hlídat přesun.
  const ownSnap = await db.collection("res_bookings").where("start", ">=", Timestamp.fromDate(from)).get();
  const own = new Map();
  for (const d of ownSnap.docs) {
    const eventId = d.data().raynet?.eventId;
    if (eventId && d.data().status !== "cancelled") own.set(String(eventId), d);
  }

  const designers = (await loadDesigners(db)).filter((d) => d.reservations.raynetUserId);
  let ok = 0;
  // Sériově — Raynet povoluje max. 4 souběžná spojení a limit je sdílený s Make.
  for (const d of designers) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const events = await rn.listCalendar(d.reservations.raynetUserId, from, to, cfg.raynet.busyEntities);
      const intervals = [];
      for (const e of events) {
        const mine = own.get(String(e.id));
        if (mine) {
          const b = mine.data();
          const moved = !sameTime(e.start, b.start) || !sameTime(e.end, b.end);
          const flagged = !!b.raynet?.movedInRaynet;
          if (moved !== flagged) {
            // eslint-disable-next-line no-await-in-loop
            await mine.ref.update({ "raynet.movedInRaynet": moved ? { start: Timestamp.fromDate(e.start), end: Timestamp.fromDate(e.end), detectedAt: Timestamp.now() } : null });
          }
          continue;
        }
        intervals.push({ start: Timestamp.fromDate(e.start), end: Timestamp.fromDate(e.end), raynetEventId: String(e.id) });
      }
      // eslint-disable-next-line no-await-in-loop
      await db.collection("res_busy").doc(d.slug).set({ intervals, fetchedAt: Timestamp.now(), error: null });
      ok += 1;
    } catch (err) {
      console.error("rezervace: čtení obsazenosti selhalo", d.slug, err.message);
      // eslint-disable-next-line no-await-in-loop
      await db.collection("res_busy").doc(d.slug).set({ error: String(err.message).slice(0, 500), errorAt: Timestamp.now() }, { merge: true });
    }
  }

  // Opakování neúspěšných pushů.
  const failed = await db.collection("res_bookings").where("raynet.state", "==", "error").get();
  for (const d of failed.docs) {
    if ((d.data().raynet?.attempts || 0) >= MAX_SYNC_ATTEMPTS) continue;
    // eslint-disable-next-line no-await-in-loop
    await syncBooking(d.ref, { id: d.id, ...d.data() });
  }
  return { designers: designers.length, ok, retried: failed.size };
}

exports.rezervaceObsazenost = onSchedule({ region: REGION, schedule: "every 10 minutes", timeZone: TZ }, async () => {
  const result = await refreshBusy();
  console.log("rezervaceObsazenost", result);
});

exports._internal = { createBooking, moveBooking, changeStatus, syncBooking, refreshBusy, loadConfig, DEFAULT_CONFIG };

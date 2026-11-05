// Úzká integrace Rezervace → Raynet (docs/rezervace-spec.md kap. 2 a 5,
// zjištění k API v docs/rezervace-pruzkum.md).
//
// Rozsah výjimky z "Raynet bez integrace" — nic navíc:
//  - zápis: kontakt (jen když neexistuje) a událost pro rezervaci z platformy,
//    úprava a zrušení JEN těchto vlastních událostí,
//  - čtení: jen časy událostí/schůzek designérů (od–do, vlastník).
//
// Credentials: Firestore `config/raynet` { instanceName, username, apiKey },
// klientská pravidla žádná → čte jen Admin SDK. Nastavení: scripts/set-raynet-config.js.
// Bez `config/raynet` vrací getRaynet() null a rezervace fungují bez Raynetu.
//
// V emulátoru (FUNCTIONS_EMULATOR=true) a s `config/raynet.mock: true` se místo
// API použije mock nad kolekcí `_raynet_mock` — v produkci se mock nikdy nezapne.

const { getFirestore } = require("firebase-admin/firestore");

const BASE_URL = "https://app.raynet.cz/api/v2";
const CONFIG_CACHE_MS = 5 * 60 * 1000;
const EXT_ID_PREFIX = "platforma-rezervace:";
const TAG = "platforma-rezervace";

let configCache = { value: undefined, at: 0 };

async function loadConfig() {
  if (configCache.value !== undefined && Date.now() - configCache.at < CONFIG_CACHE_MS) return configCache.value;
  const snap = await getFirestore().collection("config").doc("raynet").get();
  const data = snap.exists ? snap.data() : null;
  configCache = { value: data, at: Date.now() };
  return data;
}

const isEmulator = () => process.env.FUNCTIONS_EMULATOR === "true";

// Raynet očekává/vrací ISO8601 s offsetem (dateFormat=ISO8601), viz průzkum.
const iso = (d) => new Date(d).toISOString();

function last9(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.slice(-9);
}

class RaynetApi {
  constructor(cfg) {
    this.cfg = cfg;
    this.base = cfg.baseUrl || BASE_URL;
    this.auth = "Basic " + Buffer.from(`${cfg.username}:${cfg.apiKey}`).toString("base64");
  }

  async call(method, path, { query, body } = {}) {
    const url = new URL(this.base + path);
    url.searchParams.set("dateFormat", "ISO8601");
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.auth,
        "X-Instance-Name": this.cfg.instanceName,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // ne-JSON odpověď (HTML chybová stránka) → chyba níže
    }
    if (!res.ok || json?.success === false || json?.success === "false") {
      const err = new Error(`Raynet ${method} ${path}: HTTP ${res.status} ${(json?.message || text || "").slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  // Všechny události i schůzky vlastníka překrývající interval [from, to).
  async listCalendar(ownerId, from, to, entities = ["event", "meeting"]) {
    const out = [];
    for (const entity of entities) {
      for (let offset = 0; offset < 10000; offset += 1000) {
        // eslint-disable-next-line no-await-in-loop
        const json = await this.call("GET", `/${entity}/`, {
          query: {
            "owner-id": ownerId,
            "scheduledFrom[LT]": iso(to),
            "scheduledTill[GT]": iso(from),
            limit: 1000,
            offset,
          },
        });
        const rows = json?.data || [];
        for (const r of rows) {
          if (!r.scheduledFrom || !r.scheduledTill) continue;
          if (r.status === "CANCELLED") continue;
          out.push({ id: r.id, entity, start: new Date(r.scheduledFrom), end: new Date(r.scheduledTill), extIds: r.extIds || null });
        }
        if (rows.length < 1000) break;
      }
    }
    return out;
  }

  // Kontakt: telefon (fulltext + ověření čísla), pak e-mail (přesná shoda),
  // jinak založit osobu (lze vypnout v config/rezervace.raynet.createContact).
  async findOrCreatePerson({ name, phone, email }, { ownerId, create = true }) {
    const want9 = last9(phone);
    if (want9.length === 9) {
      const json = await this.call("GET", "/person/", { query: { fulltext: want9, limit: 20 } });
      const hit = (json?.data || []).find((p) =>
        [p.contactInfo?.tel1, p.contactInfo?.tel2].some((t) => last9(t) === want9));
      if (hit) return { id: hit.id, created: false };
    }
    if (email) {
      const json = await this.call("GET", "/person/", { query: { "contactInfo.email": email, limit: 5 } });
      const hit = (json?.data || [])[0];
      if (hit) return { id: hit.id, created: false };
    }
    if (!create) return { id: null, created: false };
    const parts = String(name || "").trim().split(/\s+/);
    const lastName = parts.length > 1 ? parts.pop() : parts[0] || "Klient";
    const firstName = parts.length ? parts.join(" ") : "";
    const json = await this.call("PUT", "/person/", {
      body: {
        firstName,
        lastName,
        owner: ownerId,
        contactInfo: { email: email || null, tel1: phone || null, tel1Type: "mobil" },
        tags: [TAG],
      },
    });
    return { id: json.data.id, created: true };
  }

  async createEvent(entity, data) {
    const json = await this.call("PUT", `/${entity}/`, { body: { ...data, tags: [TAG] } });
    const id = json.data.id;
    try {
      await this.call("PUT", `/${entity}/${id}/extId/`, { body: { extId: data._extId } });
    } catch (err) {
      // Externí ID je jen pojistka — párujeme primárně podle uloženého eventId.
      console.warn("raynet: extId se nepodařilo uložit", id, err.message);
    }
    return id;
  }

  async getEvent(entity, id) {
    const json = await this.call("GET", `/${entity}/${id}/`);
    const r = json.data;
    return { id: r.id, start: new Date(r.scheduledFrom), end: new Date(r.scheduledTill) };
  }

  async updateEvent(entity, id, data) {
    await this.call("POST", `/${entity}/${id}/`, { body: data });
  }

  async deleteEvent(entity, id) {
    try {
      await this.call("DELETE", `/${entity}/${id}/`);
    } catch (err) {
      if (err.status !== 404) throw err; // už smazaná ručně → OK
    }
  }
}

// ── Mock (jen emulátor) ─────────────────────────────────────────────────────
// Události leží v kolekci `_raynet_mock`, ať jde v emulátoru vyzkoušet push
// i čtení obsazenosti (ručně přidaný dokument = "cizí" schůzka designéra).
class RaynetMock {
  constructor() {
    this.col = getFirestore().collection("_raynet_mock");
    this.cfg = { mock: true };
  }

  async listCalendar(ownerId, from, to) {
    const snap = await this.col.where("owner", "==", ownerId).get();
    return snap.docs
      .map((d) => ({ id: d.id, entity: d.data().entity || "event", start: d.data().start.toDate(), end: d.data().end.toDate() }))
      .filter((e) => e.start < to && e.end > from);
  }

  async findOrCreatePerson({ name, phone, email }) {
    return { id: `mock-person-${last9(phone) || email || name}`, created: true };
  }

  async createEvent(entity, data) {
    const ref = await this.col.add({
      entity, owner: data.owner, title: data.title, extId: data._extId,
      start: new Date(data.scheduledFrom), end: new Date(data.scheduledTill),
    });
    return ref.id;
  }

  async getEvent(entity, id) {
    const snap = await this.col.doc(String(id)).get();
    if (!snap.exists) { const e = new Error("not found"); e.status = 404; throw e; }
    return { id, start: snap.data().start.toDate(), end: snap.data().end.toDate() };
  }

  async updateEvent(entity, id, data) {
    const patch = {};
    if (data.scheduledFrom) patch.start = new Date(data.scheduledFrom);
    if (data.scheduledTill) patch.end = new Date(data.scheduledTill);
    if (data.title) patch.title = data.title;
    if (data.owner) patch.owner = data.owner;
    await this.col.doc(String(id)).set(patch, { merge: true });
  }

  async deleteEvent(entity, id) {
    await this.col.doc(String(id)).delete();
  }
}

// null = Raynet nenapojen (chybí config/raynet nebo je neúplný).
async function getRaynet() {
  const cfg = await loadConfig();
  if (cfg?.mock && isEmulator()) return new RaynetMock();
  if (!cfg?.instanceName || !cfg?.username || !cfg?.apiKey) return null;
  return new RaynetApi(cfg);
}

module.exports = { getRaynet, EXT_ID_PREFIX, TAG, last9, _resetCache: () => { configCache = { value: undefined, at: 0 }; } };

// Slotovací logika modulu Rezervace (docs/rezervace-spec.md, kap. 4).
// Čistý modul — žádný Firestore ani síť, jen data na vstupu → volné termíny.
// Testy: functions/rezervace/sloty.test.js (`npm test` ve functions/).
//
// Volný termín = blok dostupnosti − rezervace na platformě − obsazenost
// z Raynetu − minimální předstih − mimo horizont (− svátky, pokud se blokují).
// Sloty se zarovnávají na pražský "nástěnný" čas po `stepMin` (výchozí 30 min),
// takže i přes přechod letního/zimního času začínají v :00 a :30.

const { pragueParts, fromPrague, isHoliday, nextDay } = require("../shared/cas");

const MIN_MS = 60000;

// Stavy rezervace, které drží čas designéra obsazený.
const BLOCKING_STATUSES = ["requested", "confirmed", "done", "no_show"];

const toMs = (v) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : v?.toMillis ? v.toMillis() : new Date(v).getTime());

// Půlnoc pražského dne, který je `days` dní po dni `date` (pro horizont).
function startOfPragueDayAfter(date, days) {
  let { y, m, d } = pragueParts(date);
  for (let i = 0; i < days; i++) ({ y, m, d } = nextDay(y, m, d));
  return fromPrague(y, m, d, 0);
}

// Nejdřívější možný začátek rezervace: teď + minimální předstih v hodinách
// (studio 1 h, doma 48 h). Jedno číslo místo minut + dnů — tak to vidí i admin.
function earliestStart(service, now) {
  return toMs(now) + (service.minLeadHours || 0) * 60 * MIN_MS;
}

// Konec horizontu: půlnoc po (dnes + horizonDays) pražského času.
function horizonEnd(service, now) {
  return startOfPragueDayAfter(new Date(toMs(now)), (service.horizonDays || 60) + 1).getTime();
}

// První zarovnaný slot >= t (zarovnání na pražské minuty od půlnoci).
function alignUp(t, stepMin) {
  const p = pragueParts(new Date(t));
  const wholeMin = Math.ceil(p.min - 1e-9);
  const aligned = Math.ceil(wholeMin / stepMin) * stepMin;
  let res = fromPrague(p.y, p.m, p.d, aligned).getTime();
  // Na hraně přechodu času může fromPrague vrátit čas o hodinu dřív.
  while (res < t) res += stepMin * MIN_MS;
  return res;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Typy bloků dostupnosti (designér je vypisuje sám, proaktivně):
//  - kind 'flex' (volno): serviceTypes ['studio'] / ['home'] / obojí — "můžu na cokoliv",
//  - kind 'shift' (směna ve studiu): drží studio otevřené od–do, bere jen
//    konzultace ve studiu, návrh doma během směny ne.
// Staré bloky s jedním `serviceType` se čtou jako volno pro tu jednu službu.
function blockServiceTypes(a) {
  if (a.kind === "shift") return ["studio"];
  if (Array.isArray(a.serviceTypes)) return a.serviceTypes;
  return a.serviceType ? [a.serviceType] : [];
}

// Mezera, která musí zůstat mezi dvěma schůzkami: pauza služby + čas na
// přesun, pokud je aspoň jedna z nich u klienta doma (nebo neznámá z Raynetu
// a nová je doma).
function gapMs(newType, otherType, bufMs, travelMs) {
  return bufMs + (newType === "home" || otherType === "home" ? travelMs : 0);
}

/**
 * @param {object} p
 * @param {object} p.service          { id, type:'studio'|'home', durationMin, minLeadHours, horizonDays, bufferMin }
 * @param {Array}  p.availability     [{ designerSlug, kind:'flex'|'shift', serviceTypes[], studio?, start, end }]
 * @param {Array}  p.bookings         [{ id?, designerSlug, serviceType, start, end, status }]
 * @param {object} p.busy             { [designerSlug]: [{ start, end }] } — obsazenost z Raynetu
 * @param {Date}   p.now
 * @param {Date}   [p.from]           omezení okna (např. jen jeden týden)
 * @param {Date}   [p.to]
 * @param {string} [p.studio]         u studia povinné — bloky jen pro toto studio
 * @param {string[]} [p.designers]    povolení designéři (přiřazení ke službě/studiu)
 * @param {number} [p.stepMin=30]
 * @param {boolean} [p.ignoreLead]    interní uživatel přebíjí předstih
 * @param {boolean} [p.blockHolidays=true] ve státní svátek nenabízet nic
 * @param {string} [p.excludeBookingId] při přesunu ignorovat přesouvanou rezervaci
 * @param {number} [p.travelMin=0]    čas na přesun před a po návrhu u klienta doma
 * @param {Function} [p.serviceFor]   slug → služba s vlastními parametry designéra (serviceForDesigner)
 * @param {Function} [p.travelFor]    slug → čas na přesun designéra (min)
 * @returns {Array<{ start: Date, end: Date, designerSlug: string, studio: string|null }>}
 */
// Parametry, které si designér smí nastavit sám pro sebe (výchozí dává admin
// u služby). Cenu, potvrzování CX, název a aktivitu služby mění jen admin.
const OVERRIDABLE = ["durationMin", "minLeadHours", "horizonDays", "bufferMin"];

// Služba s vlastními parametry designéra: reservations.overrides[serviceId].
function serviceForDesigner(service, overrides) {
  const own = overrides?.[service.id] || {};
  const out = { ...service };
  for (const k of OVERRIDABLE) if (Number.isFinite(own[k])) out[k] = own[k];
  return out;
}

function computeSlots(p) {
  const { service } = p;
  const stepMin = p.stepMin || 30;
  const blockHolidays = p.blockHolidays !== false;
  const allowed = p.designers ? new Set(p.designers) : null;

  // Parametry po designérech: výchozí ze služby, případně jeho vlastní
  // (p.serviceFor / p.travelFor). Počítá se jednou na designéra.
  const per = {};
  const paramsOf = (slug) => {
    if (per[slug]) return per[slug];
    const svc = p.serviceFor ? p.serviceFor(slug) : service;
    let minStart = p.ignoreLead ? toMs(p.now) : earliestStart(svc, p.now);
    let maxStart = horizonEnd(svc, p.now);
    if (p.from) minStart = Math.max(minStart, toMs(p.from));
    if (p.to) maxStart = Math.min(maxStart, toMs(p.to));
    const travel = p.travelFor ? p.travelFor(slug) : p.travelMin;
    per[slug] = {
      durMs: svc.durationMin * MIN_MS,
      bufMs: (svc.bufferMin || 0) * MIN_MS,
      travelMs: (travel || 0) * MIN_MS,
      minStart, maxStart,
    };
    return per[slug];
  };

  // Obsazené intervaly po designérech (rezervace + Raynet); pauza a čas na
  // přesun se přičtou až při kontrole podle parametrů daného designéra.
  const taken = {};
  for (const b of p.bookings || []) {
    if (!BLOCKING_STATUSES.includes(b.status)) continue;
    if (p.excludeBookingId && b.id === p.excludeBookingId) continue;
    (taken[b.designerSlug] ||= []).push([toMs(b.start), toMs(b.end), b.serviceType]);
  }
  for (const [slug, intervals] of Object.entries(p.busy || {})) {
    for (const i of intervals || []) (taken[slug] ||= []).push([toMs(i.start), toMs(i.end), null]);
  }

  const seen = new Set();
  const out = [];
  for (const a of p.availability || []) {
    if (!blockServiceTypes(a).includes(service.type)) continue;
    if (service.type === "studio" && p.studio && a.studio !== p.studio) continue;
    if (allowed && !allowed.has(a.designerSlug)) continue;

    const { durMs, bufMs, travelMs, minStart, maxStart } = paramsOf(a.designerSlug);
    const busy = (taken[a.designerSlug] || []).map(([s, e, type]) => {
      const gap = gapMs(service.type, type, bufMs, travelMs);
      return [s - gap, e + gap];
    });
    const blockStart = toMs(a.start);
    const blockEnd = toMs(a.end);
    for (let t = alignUp(Math.max(blockStart, minStart), stepMin); t + durMs <= blockEnd && t < maxStart; t += stepMin * MIN_MS) {
      const end = t + durMs;
      if (blockHolidays) {
        const { y, m, d } = pragueParts(new Date(t));
        if (isHoliday(y, m, d)) continue;
      }
      if (busy.some(([s, e]) => overlaps(t, end, s, e))) continue;
      const key = `${a.designerSlug}|${t}`;
      if (seen.has(key)) continue; // překrývající se bloky téhož designéra
      seen.add(key);
      out.push({ start: new Date(t), end: new Date(end), designerSlug: a.designerSlug, studio: a.studio || null });
    }
  }
  out.sort((x, y) => x.start - y.start || x.designerSlug.localeCompare(y.designerSlug));
  return out;
}

// Je konkrétní termín pro designéra volný? (kontrola při zápisu rezervace)
function isSlotFree(p, designerSlug, start) {
  const t = toMs(start);
  return computeSlots({ ...p, designers: [designerSlug], from: new Date(t), to: new Date(t + 1) })
    .some((s) => s.start.getTime() === t && s.designerSlug === designerSlug);
}

module.exports = {
  BLOCKING_STATUSES,
  OVERRIDABLE,
  serviceForDesigner,
  blockServiceTypes,
  gapMs,
  computeSlots,
  isSlotFree,
  earliestStart,
  horizonEnd,
  startOfPragueDayAfter,
  overlaps,
};

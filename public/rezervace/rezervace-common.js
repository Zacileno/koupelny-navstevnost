// Sdílená logika interních stránek modulu Rezervace (kalendar/prehled/nastaveni).
// Zápis rezervací jde vždy přes Cloud Function `rezervaceAkce` (rules nedovolí
// přímý zápis), bloky dostupnosti a služby zapisuje klient přímo do Firestore.

import { initFirebase, CDN, isDemoMode } from '../shared/auth-common.js';

export const DEMO = isDemoMode();
// V demu jde vyzkoušet i pohled běžného designéra: ?demo=1&role=designer
export const DEMO_ADMIN = DEMO && new URLSearchParams(location.search).get('role') !== 'designer';
export const TZ = 'Europe/Prague';

export const STUDIO_LABELS = { praha: 'Praha', brno: 'Brno', hradec: 'Hradec Králové', pardubice: 'Pardubice' };
export const STUDIOS = Object.keys(STUDIO_LABELS);
// Oblasti pro návrh doma — výchozí, přepisuje config/rezervace.homeRegions
// (stejné jako DEFAULT_HOME_REGIONS ve functions/rezervace/designeri.js).
export const DEFAULT_HOME_REGIONS = [
    { id: 'praha', name: 'Praha a Střední Čechy' }, { id: 'brno', name: 'Brno a Jižní Morava' },
    { id: 'hradec', name: 'Hradec Králové a okolí' }, { id: 'pardubice', name: 'Pardubice a okolí' },
];
export const TYPE_LABELS = { studio: 'Ve studiu', home: 'U klienta doma' };
export const STATUS_LABELS = {
    requested: 'Čeká na potvrzení',
    confirmed: 'Potvrzeno',
    done: 'Proběhlo',
    no_show: 'Nedorazil',
    cancelled: 'Zrušeno',
};
export const SOURCE_LABELS = { web: 'Web', phone: 'Telefon', cx: 'CX', lead: 'Lead' };
export const RAYNET_STATE_LABELS = {
    ok: 'V Raynetu',
    waiting: 'Čeká na potvrzení',
    error: 'Chyba synchronizace',
    cancelled: 'Zrušeno i v Raynetu',
    not_configured: 'Raynet nenapojen',
};

// ── státní svátky a zavřené dny studia ──
// Kopie functions/shared/cas.js (isHoliday) a functions/rezervace/smeny.js
// (studioClosedOn) — hosting a functions se nasazují zvlášť, měnit obojí.
const FIXED_HOLIDAYS = new Set(['01-01', '05-01', '05-08', '07-05', '07-06', '09-28', '10-28', '11-17', '12-24', '12-25', '12-26']);
const HOLIDAY_NAMES = {
    '01-01': 'Nový rok', '05-01': 'Svátek práce', '05-08': 'Den vítězství', '07-05': 'Cyril a Metoděj', '07-06': 'Jan Hus',
    '09-28': 'Den české státnosti', '10-28': 'Vznik Československa', '11-17': 'Den boje za svobodu', '12-24': 'Štědrý den',
    '12-25': '1. svátek vánoční', '12-26': '2. svátek vánoční',
};
function easterSunday(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
// Název svátku pro den 'YYYY-MM-DD', jinak null.
export function holidayName(key) {
    const md = key.slice(5);
    if (FIXED_HOLIDAYS.has(md)) return HOLIDAY_NAMES[md];
    const [y, m, d] = key.split('-').map(Number);
    const t = Date.UTC(y, m - 1, d), easter = easterSunday(y);
    if (t === easter - 2 * 86400000) return 'Velký pátek';
    if (t === easter + 86400000) return 'Velikonoční pondělí';
    return null;
}
// Zavřené studio v den 'YYYY-MM-DD' → důvod (text), jinak null.
export function studioClosedReason(studioCfg, key) {
    const c = (studioCfg?.closures || []).find(x => x?.from && key >= x.from && key <= (x.to || x.from));
    if (c) return c.note ? `Zavřeno — ${c.note}` : 'Zavřeno';
    const h = holidayName(key);
    if (h && !studioCfg?.holidayOpen) return `Svátek — ${h}`;
    return null;
}

// ── Cloud Function ──
let _call = null;
export async function akce(action, data = {}) {
    if (DEMO) return demoAkce(action, data);
    if (!_call) {
        const { app } = await initFirebase();
        const { getFunctions, httpsCallable } = await import(`${CDN}/firebase-functions.js`);
        _call = httpsCallable(getFunctions(app, 'europe-central2'), 'rezervaceAkce');
    }
    const res = await _call({ action, ...data });
    return res.data;
}

// ── vlastní parametry designéra ──
// Výchozí hodnoty dává admin u služby; designér (nebo admin za něj) je může
// přepsat jen pro sebe. Prázdné pole = výchozí. Cenu a potvrzování CX ne.
export const OVERRIDE_FIELDS = [
    ['durationMin', 'Délka (min)'], ['minLeadHours', 'Nejdřív za (h)'], ['horizonDays', 'Nejpozději za (dní)'], ['bufferMin', 'Pauza (min)'],
];

export function overridesFormHtml(services, overrides = {}, travelMin = null, defaultTravel = 60) {
    const rows = services.map(sv => `<tr><td>${escapeHtml(sv.name)}</td>${OVERRIDE_FIELDS.map(([k]) =>
        `<td><input type="number" min="0" data-ov-service="${sv.id}" data-ov-key="${k}" placeholder="${escapeHtml(sv[k] ?? '')}" value="${escapeHtml(overrides?.[sv.id]?.[k] ?? '')}"></td>`).join('')}</tr>`).join('');
    return `<div class="table-wrap"><table class="tbl ov-tbl"><tr><th>Služba</th>${OVERRIDE_FIELDS.map(([, l]) => `<th>${l}</th>`).join('')}</tr>${rows}</table></div>
        <label class="hint" style="display:flex;gap:6px;align-items:center;margin-top:6px">Čas na přesun u návrhu doma (min):
            <input type="number" min="0" step="15" data-ov-travel placeholder="${escapeHtml(defaultTravel)}" value="${escapeHtml(travelMin ?? '')}" style="width:80px"></label>
        <p class="hint">Šedé číslo = výchozí od admina. Vyplň jen to, co chceš mít jinak.</p>`;
}

export function readOverrides(root) {
    const overrides = {};
    root.querySelectorAll('[data-ov-service]').forEach(inp => {
        if (inp.value === '') return;
        (overrides[inp.dataset.ovService] ||= {})[inp.dataset.ovKey] = Number(inp.value);
    });
    const t = root.querySelector('[data-ov-travel]')?.value;
    return { overrides, travelMin: t === '' || t == null ? null : Number(t) };
}

// ── formátování (vždy pražský čas) ──
export const toDate = (ts) => ts?.toDate?.() ?? (ts ? new Date(ts) : null);
export function fmtDateTime(ts) {
    const d = toDate(ts);
    return d ? d.toLocaleString('cs-CZ', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}
export function fmtTime(ts) {
    const d = toDate(ts);
    return d ? d.toLocaleTimeString('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '';
}
export function fmtDay(ts) {
    const d = toDate(ts);
    return d ? d.toLocaleDateString('cs-CZ', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric' }) : '';
}
export function formatPhone(p) {
    const m = /^\+420(\d{3})(\d{3})(\d{3})$/.exec(p || '');
    return m ? `${m[1]} ${m[2]} ${m[3]}` : (p || '');
}
export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

// Pražský čas → Date (pro <input type="date"/"time">). Offset se dopočítá.
export function pragueToDate(dateStr, timeStr = '00:00') {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    const p = pragueParts(new Date(guess));
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    return new Date(guess - (asUtc - guess));
}
export function pragueParts(date) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}
export function dateKey(date) {
    const p = pragueParts(date);
    return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
export function timeKey(date) {
    const p = pragueParts(date);
    return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
}
// Pondělí týdne, do kterého patří date (YYYY-MM-DD).
export function mondayKey(date) {
    const key = dateKey(date);
    const t = new Date(`${key}T12:00:00Z`);
    const dow = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - dow);
    return t.toISOString().slice(0, 10);
}
export function addDaysKey(key, n) {
    const t = new Date(`${key}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
}

export function raynetChip(b, raynetConfigured) {
    if (!raynetConfigured) return '<span class="chip chip--muted">Raynet nenapojen</span>';
    const r = b.raynet || {};
    if (r.movedInRaynet) return '<span class="chip chip--warn" title="Čas v Raynetu se liší od rezervace">⚠ Přesunuto v Raynetu — uprav v appce</span>';
    if (r.state === 'error') return `<span class="chip chip--danger" title="${escapeHtml(r.error || '')}">Raynet: chyba</span>`;
    if (r.state === 'ok') return '<span class="chip chip--ok">V Raynetu</span>';
    if (r.state === 'cancelled') return '<span class="chip chip--muted">Zrušeno v Raynetu</span>';
    return `<span class="chip chip--muted">${escapeHtml(RAYNET_STATE_LABELS[r.state] || 'Čeká na Raynet')}</span>`;
}

// ── DEMO ──
// Ukázková data bez Auth i Firestore (?demo=1). Akce se jen předstírají.

const demoNow = Date.now();
const H = 3600000;
function demoAt(dayOffset, hour, min = 0) {
    const key = addDaysKey(dateKey(new Date(demoNow)), dayOffset);
    return pragueToDate(key, `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
}

export const DEMO_SERVICES = [
    { id: 'konzultace-studio', name: 'Konzultace ve studiu', type: 'studio', durationMin: 60, minLeadHours: 1, horizonDays: 60, bufferMin: 0, requiresConfirmation: false, priceText: 'zdarma', active: true, order: 1 },
    { id: 'navrh-doma', name: 'Návrh u vás doma', type: 'home', durationMin: 120, minLeadHours: 48, horizonDays: 60, bufferMin: 0, requiresConfirmation: true, priceText: '4 990 Kč vč. DPH', active: true, order: 2 },
];

// Ukázková konfigurace studií pro demo (otevírací doba, zavřené dny).
const _demoDay = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toLocaleDateString('sv-SE', { timeZone: TZ }); };
export const DEMO_CONFIG = {
    travelMin: 60,
    studios: {
        praha: { name: 'Praha', street: 'Jesenická 410', city: 'Dobřejovice', zipCode: '', openingHours: { 2: ['12:00', '19:00'], 4: ['12:00', '19:00'], 6: ['10:00', '16:00'] },
            holidayOpen: false, closures: [{ from: _demoDay(9), to: _demoDay(11), note: 'inventura' }] },
        brno: { name: 'Brno', openingHours: { 2: ['12:00', '19:00'], 4: ['12:00', '19:00'], 6: ['10:00', '16:00'] }, holidayOpen: true, closures: [] },
    },
};

export const DEMO_USERS = {
    demo: { name: 'Demo Designérka', department: 'sales', position: 'Designérka', platformRole: 'admin', active: true, studios: ['praha'], reservations: { enabled: true, studios: ['praha'], services: ['konzultace-studio', 'navrh-doma'], raynetUserId: 12 } },
    'marek-kopriva': { name: 'Marek Kopřiva', department: 'sales', position: 'Designér', active: true, studios: ['praha'], reservations: { enabled: true, studios: ['praha', 'brno'], services: ['konzultace-studio'], raynetUserId: 15 } },
    'valerie': { name: 'Valerie', department: 'sales', position: 'Designérka', active: true, studios: ['brno'], reservations: { enabled: false, studios: [], services: [], raynetUserId: null } },
};

export function demoAvailability() {
    const out = [];
    for (let i = 0; i < 7; i++) {
        if (i % 2 === 0) out.push({ id: `a${i}s`, designerSlug: 'demo', kind: 'shift', serviceTypes: ['studio'], studio: 'praha', start: demoAt(i, 9), end: demoAt(i, 13) });
        else out.push({ id: `a${i}s`, designerSlug: 'demo', kind: 'flex', serviceTypes: ['studio', 'home'], studio: 'praha', start: demoAt(i, 9), end: demoAt(i, 13) });
        if (i % 2 === 0) out.push({ id: `a${i}h`, designerSlug: 'demo', kind: 'flex', serviceTypes: ['home'], start: demoAt(i, 14), end: demoAt(i, 18) });
    }
    return out;
}

export function demoBookings() {
    const base = { source: 'web', utm: {}, history: [], raynet: { state: 'ok', eventId: '1' }, note: '', address: '' };
    return [
        { ...base, id: 'b1', serviceId: 'konzultace-studio', serviceName: 'Konzultace ve studiu', serviceType: 'studio', designerSlug: 'demo', studio: 'praha',
          start: demoAt(1, 10), end: demoAt(1, 11), status: 'confirmed', client: { name: 'Jana Nováková', phone: '+420777111222', email: 'jana@example.test' },
          utm: { source: 'google', campaign: 'Rezervace_Praha' }, history: [{ at: new Date(demoNow - 2 * H), by: 'web', action: 'created', note: '' }] },
        { ...base, id: 'b2', serviceId: 'navrh-doma', serviceName: 'Návrh u vás doma', serviceType: 'home', designerSlug: 'demo', studio: null,
          start: demoAt(2, 14), end: demoAt(2, 16), status: 'requested', client: { name: 'Petr Svoboda', phone: '+420602333444', email: '' },
          address: 'Vinohradská 12, Praha 2', region: 'praha', raynet: { state: 'waiting' }, history: [{ at: new Date(demoNow - 5 * H), by: 'web', action: 'created', note: '' }] },
        { ...base, id: 'b3', serviceId: 'konzultace-studio', serviceName: 'Konzultace ve studiu', serviceType: 'studio', designerSlug: 'marek-kopriva', studio: 'praha',
          start: demoAt(3, 11), end: demoAt(3, 12), status: 'confirmed', source: 'phone', client: { name: 'Eva Malá', phone: '+420731555666', email: '' },
          raynet: { state: 'ok', eventId: '2', movedInRaynet: { start: demoAt(3, 13), end: demoAt(3, 14) } } },
        { ...base, id: 'b4', serviceId: 'konzultace-studio', serviceName: 'Konzultace ve studiu', serviceType: 'studio', designerSlug: 'demo', studio: 'praha',
          start: demoAt(-1, 9), end: demoAt(-1, 10), status: 'confirmed', source: 'cx', client: { name: 'Karel Dvořák', phone: '+420608777888', email: '' },
          raynet: { state: 'error', error: 'Raynet PUT /event/: HTTP 401' } },
    ];
}

export function demoBusy() {
    return { demo: [{ start: demoAt(1, 12), end: demoAt(1, 13) }, { start: demoAt(4, 9), end: demoAt(4, 10, 30) }] };
}

function demoAkce(action, data) {
    if (action === 'info') return { raynetConfigured: true, raynetMock: false, isAdmin: DEMO_ADMIN, manageAll: DEMO_ADMIN, slug: 'demo' };
    if (action === 'sloty') {
        const slots = [];
        for (let i = 1; i < 6; i++) for (const h of [9, 10, 11]) {
            slots.push({ start: demoAt(i, h).toISOString(), end: demoAt(i, h + 1).toISOString(), designerSlug: 'demo', designerName: 'Demo Designérka' });
        }
        return { slots };
    }
    return { id: data.id || 'demo-new', ok: true, demo: true };
}

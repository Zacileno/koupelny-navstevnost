// Sdílená logika interních stránek modulu Rezervace (kalendar/prehled/nastaveni).
// Zápis rezervací jde vždy přes Cloud Function `rezervaceAkce` (rules nedovolí
// přímý zápis), bloky dostupnosti a služby zapisuje klient přímo do Firestore.

import { initFirebase, CDN, isDemoMode } from '../shared/auth-common.js';

export const DEMO = isDemoMode();
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
    { id: 'konzultace-studio', name: 'Konzultace ve studiu', type: 'studio', durationMin: 60, minLeadMinutes: 60, minLeadDays: 0, leadDayMode: 'calendar', horizonDays: 60, bufferMin: 0, requiresConfirmation: false, priceText: 'zdarma', active: true, order: 1 },
    { id: 'navrh-doma', name: 'Návrh u vás doma', type: 'home', durationMin: 120, minLeadMinutes: 0, minLeadDays: 2, leadDayMode: 'calendar', horizonDays: 60, bufferMin: 0, requiresConfirmation: true, priceText: '4 990 Kč vč. DPH', active: true, order: 2 },
];

export const DEMO_USERS = {
    demo: { name: 'Demo Designérka', platformRole: 'admin', active: true, studios: ['praha'], reservations: { enabled: true, studios: ['praha'], services: ['konzultace-studio', 'navrh-doma'], raynetUserId: 12 } },
    'marek-kopriva': { name: 'Marek Kopřiva', active: true, studios: ['praha'], reservations: { enabled: true, studios: ['praha', 'brno'], services: ['konzultace-studio'], raynetUserId: 15 } },
    'valerie': { name: 'Valerie', active: true, studios: ['brno'], reservations: { enabled: false, studios: [], services: [], raynetUserId: null } },
};

export function demoAvailability() {
    const out = [];
    for (let i = 0; i < 7; i++) {
        out.push({ id: `a${i}s`, designerSlug: 'demo', serviceType: 'studio', studio: 'praha', start: demoAt(i, 9), end: demoAt(i, 13) });
        if (i % 2 === 0) out.push({ id: `a${i}h`, designerSlug: 'demo', serviceType: 'home', start: demoAt(i, 14), end: demoAt(i, 18) });
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
    if (action === 'info') return { raynetConfigured: true, raynetMock: false, isAdmin: true };
    if (action === 'sloty') {
        const slots = [];
        for (let i = 1; i < 6; i++) for (const h of [9, 10, 11]) {
            slots.push({ start: demoAt(i, h).toISOString(), end: demoAt(i, h + 1).toISOString(), designerSlug: 'demo', designerName: 'Demo Designérka' });
        }
        return { slots };
    }
    return { id: data.id || 'demo-new', ok: true, demo: true };
}

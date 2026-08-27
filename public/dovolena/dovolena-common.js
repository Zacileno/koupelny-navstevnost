import { initFirebase, CDN } from '../shared/auth-common.js';

// === STATUS ===

export const STATUS_LABELS = {
    confirmed: 'Potvrzeno',
    pending_collision: 'Čeká na vyřešení kolize',
    cancelled: 'Zrušeno',
    rejected: 'Zamítnuto',
};

export function statusBadgeClass(status) {
    switch (status) {
        case 'confirmed': return 'badge--confirmed';
        case 'pending_collision': return 'badge--collision';
        case 'cancelled': return 'badge--cancelled';
        case 'rejected': return 'badge--rejected';
        default: return 'badge--pending';
    }
}

// === DATE HELPERS ===

// <input type="date"> vrací 'YYYY-MM-DD' — parsujeme na půlnoc lokálního času,
// ať se datum neposune o den vlivem UTC převodu.
export function parseDateInput(value) {
    return new Date(`${value}T00:00:00`);
}

export function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function stripTime(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

export function formatMonthLabel(year, month) {
    return new Date(year, month, 1).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' });
}

// === KALENDÁŘNÍ MŘÍŽKA ===
// Sdílené mezi výběrem termínu (dovolena.html) a měsíčním přehledem
// (dovolena-dashboard.html) — týden od pondělí, celé řádky (i dny sousedních
// měsíců, jen vizuálně odlišené), ať mřížka nikdy nemá "díru".
export function buildMonthGrid(year, month) {
    const firstOfMonth = new Date(year, month, 1);
    const startWeekday = (firstOfMonth.getDay() + 6) % 7; // Po=0 ... Ne=6
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const cells = [];
    for (let i = startWeekday - 1; i >= 0; i--) {
        cells.push({ date: new Date(year, month - 1, daysInPrevMonth - i), inMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
        cells.push({ date: new Date(year, month, d), inMonth: true });
    }
    while (cells.length % 7 !== 0) {
        const last = cells[cells.length - 1].date;
        const next = new Date(last);
        next.setDate(next.getDate() + 1);
        cells.push({ date: next, inMonth: false });
    }
    return cells;
}

// === SUBSTITUTE PICKER ===

// Firemní adresář je zatím malý (~28 lidí), takže se natáhne celý a filtruje
// na klientovi — nemá smysl to řešit přes Firestore query/index.
export async function listSubstituteCandidates(excludeSlug) {
    const { db } = await initFirebase();
    const { collection, getDocs } = await import(`${CDN}/firebase-firestore.js`);
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        // Vyřadí i pár sirotčích users/{uid} dokumentů (bez emailu) ze staršího
        // testování Adaptace — skutečný adresář má u každého záznamu email.
        .filter(u => u.id !== excludeSlug && !u.external && u.email)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'cs'));
}

// === COLLISION ===

// Kolize = jiná (ne zrušená, ne zamítnutá) dovolená ve stejné manažerské
// skupině (managerSlug — u obchodu to díky studiovému dělení NENÍ totéž co
// department, viz docs/architektura.md), jejíž rozsah se překrývá s tím
// novým. Dotaz jede jen na rovnost `managerSlug` (bez indexu), zbytek se
// vyhodnotí na klientovi — objem dat na jednu manažerskou skupinu je v
// jednotkách záznamů.
export async function findCollision({ managerSlug, startDate, endDate, userId }) {
    if (!managerSlug) return null;
    const { db } = await initFirebase();
    const { collection, query, where, getDocs } = await import(`${CDN}/firebase-firestore.js`);
    const q = query(collection(db, 'vacations'), where('managerSlug', '==', managerSlug));
    const snap = await getDocs(q);

    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .find(v =>
            v.status !== 'cancelled' && v.status !== 'rejected' &&
            v.userId !== userId &&
            v.startDate.toDate() <= endDate &&
            v.endDate.toDate() >= startDate
        ) ?? null;
}

// === CRUD ===

export async function createVacationRequest({ userId, department, studios, managerSlug, startDate, endDate, substituteUserId, note }) {
    const { db } = await initFirebase();
    const { collection, addDoc, serverTimestamp } = await import(`${CDN}/firebase-firestore.js`);

    const collision = await findCollision({ managerSlug, startDate, endDate, userId });
    const status = collision ? 'pending_collision' : 'confirmed';

    const ref = await addDoc(collection(db, 'vacations'), {
        userId,
        department: department ?? null,
        studios: studios ?? [],
        managerSlug: managerSlug ?? null,
        startDate,
        endDate,
        substituteUserId,
        note: note ?? '',
        status,
        createdAt: serverTimestamp(),
        createdBy: userId,
    });

    return { id: ref.id, status, collidesWith: collision };
}

// Schválení/zamítnutí kolize manažerem (nebo CEO) — Firestore rules hlídají,
// že smí jen tohle pole a jen z pending_collision, viz firestore.rules.
export async function resolveCollision(vacationId, decision, resolverSlug) {
    const { db } = await initFirebase();
    const { doc, updateDoc, serverTimestamp } = await import(`${CDN}/firebase-firestore.js`);
    await updateDoc(doc(db, 'vacations', vacationId), {
        status: decision,
        resolvedBy: resolverSlug,
        resolvedAt: serverTimestamp(),
    });
}

export async function listMyVacations(userId) {
    const { db } = await initFirebase();
    const { collection, query, where, getDocs } = await import(`${CDN}/firebase-firestore.js`);
    const q = query(collection(db, 'vacations'), where('userId', '==', userId));
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => b.startDate.toMillis() - a.startDate.toMillis());
}

export async function listAllVacations() {
    const { db } = await initFirebase();
    const { collection, getDocs } = await import(`${CDN}/firebase-firestore.js`);
    const snap = await getDocs(collection(db, 'vacations'));
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => a.startDate.toMillis() - b.startDate.toMillis());
}

export async function cancelVacation(vacationId) {
    const { db } = await initFirebase();
    const { doc, updateDoc } = await import(`${CDN}/firebase-firestore.js`);
    await updateDoc(doc(db, 'vacations', vacationId), { status: 'cancelled' });
}

// === FIREBASE CONFIG (sdíleno napříč celou platformou) ===

export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDt0TY8ti1vAdSGp64IKneaLXjJLb2_qNw",
    authDomain: "koupelny-navstevnost.firebaseapp.com",
    projectId: "koupelny-navstevnost",
    storageBucket: "koupelny-navstevnost.firebasestorage.app",
    messagingSenderId: "263800017951",
    appId: "1:263800017951:web:012c10ee687fcadab9f12a",
};

export const CDN = "https://www.gstatic.com/firebasejs/12.9.0";

let _app, _db, _auth;

export async function initFirebase() {
    if (_app) return { app: _app, db: _db, auth: _auth };

    const { initializeApp } = await import(`${CDN}/firebase-app.js`);
    const { getFirestore } = await import(`${CDN}/firebase-firestore.js`);
    const { getAuth } = await import(`${CDN}/firebase-auth.js`);

    _app  = initializeApp(FIREBASE_CONFIG);
    _db   = getFirestore(_app);
    _auth = getAuth(_app);

    return { app: _app, db: _db, auth: _auth };
}

// === AUTH HELPERS ===

export async function getCurrentUser() {
    const { auth } = await initFirebase();
    return new Promise((resolve) => {
        const unsub = auth.onAuthStateChanged(user => {
            unsub();
            resolve(user);
        });
    });
}

// Identita v Dovolené (a dalších nových modulech) se řeší přes custom claim
// `slug`, nastavený při bootstrapu účtu (scripts/seed-users-auth.js) — přímo
// odpovídá ID dokumentu v kolekci `users` (stejné sloty jako u Návštěvnosti).
export async function getUserSlug() {
    const { auth } = await initFirebase();
    const user = auth.currentUser;
    if (!user) return null;
    const token = await user.getIdTokenResult();
    return token.claims.slug ?? null;
}

export async function getUserBySlug(slug) {
    const { db } = await initFirebase();
    const { doc, getDoc } = await import(`${CDN}/firebase-firestore.js`);
    const snap = await getDoc(doc(db, 'users', slug));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Vynutí přihlášení. Pokud uživatel není přihlášený nebo mu ještě chybí
// `slug` claim (účet založený, ale token ještě nebyl obnovený po přihlášení),
// pošle ho zpět na login s ?redirect= na aktuální stránku. Pokud má účet
// nastavené dočasné sdílené heslo (bootstrap bez fungujícího e-mailu — viz
// docs/architektura.md), přesměruje na vynucenou změnu hesla dřív, než pustí
// dál kamkoliv jinam.
export async function requireAuth(redirectPath = '/login.html') {
    const here = window.location.pathname + window.location.search;
    const user = await getCurrentUser();
    if (!user) {
        window.location.href = `${redirectPath}?redirect=${encodeURIComponent(here)}`;
        return null;
    }

    const slug = await getUserSlug();
    if (!slug) {
        window.location.href = `${redirectPath}?redirect=${encodeURIComponent(here)}&claimError=1`;
        return null;
    }

    const profile = await getUserBySlug(slug);

    const onChangePasswordPage = window.location.pathname.endsWith('/change-password.html');
    if (profile?.mustChangePassword && !onChangePasswordPage) {
        window.location.href = `/change-password.html?redirect=${encodeURIComponent(here)}`;
        return null;
    }

    return { user, slug, profile };
}

export async function signOutUser(redirectPath = '/login.html') {
    const { auth } = await initFirebase();
    await auth.signOut();
    window.location.href = redirectPath;
}

// === DATE HELPERS ===

export function formatDate(date) {
    if (!date) return '';
    const d = date instanceof Date ? date : date.toDate?.() ?? new Date(date);
    return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateShort(date) {
    if (!date) return '';
    const d = date instanceof Date ? date : date.toDate?.() ?? new Date(date);
    return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
}

// === TOAST ===

export function showToast(message, type = '') {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'toast' + (type ? ` toast--${type}` : '');
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => toast.classList.remove('visible'), 2800);
}

// === DEMO MÓD ===
// Aktivuje se URL parametrem ?demo=1 — přeskočí Firebase Auth i Firestore.

export function isDemoMode() {
    return new URLSearchParams(window.location.search).get('demo') === '1';
}

// === FIREBASE CONFIG ===

export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDt0TY8ti1vAdSGp64IKneaLXjJLb2_qNw",
    authDomain: "koupelny-navstevnost.firebaseapp.com",
    projectId: "koupelny-navstevnost",
    storageBucket: "koupelny-navstevnost.firebasestorage.app",
    messagingSenderId: "263800017951",
    appId: "1:263800017951:web:012c10ee687fcadab9f12a",
};

const CDN = "https://www.gstatic.com/firebasejs/12.9.0";

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

export async function getUserProfile(uid) {
    const { db, auth } = await initFirebase();
    const { doc, getDoc, collection, query, where, getDocs } = await import(`${CDN}/firebase-firestore.js`);

    // Nová cesta (admin konzole — functions/onboardEmployee): pokud má účet claim
    // `slug`, je users/{slug} autoritativní zdroj (pole `platformRole`), bez
    // dalšího hádání. Bez claimu (starší Adaptace účty, viz CLAUDE.md "dvojí
    // identita") spadni na starý postup níže.
    const current = auth.currentUser;
    if (current && current.uid === uid) {
        const token = await current.getIdTokenResult();
        const slug = token.claims.slug ?? null;
        if (slug) {
            const slugSnap = await getDoc(doc(db, 'users', slug));
            if (slugSnap.exists()) return { id: slugSnap.id, ...slugSnap.data() };
        }
    }

    // Firestore rules (legacyRole()) assume users/{uid} directly — check that first, deterministically.
    // A query on the `uid` field alone je nejednoznačná, pokud má člověk i slug profil,
    // jehož `uid` pole náhodou odpovídá téže hodnotě.
    const direct = await getDoc(doc(db, 'users', uid));
    if (direct.exists()) return { id: direct.id, ...direct.data() };

    const q = query(collection(db, 'users'), where('uid', '==', uid));
    const snap = await getDocs(q);
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };

    // fallback: lookup by email (for users not yet migrated to uid field)
    if (current?.email) {
        const q2 = query(collection(db, 'users'), where('email', '==', current.email));
        const snap2 = await getDocs(q2);
        if (!snap2.empty) return { id: snap2.docs[0].id, ...snap2.docs[0].data() };
    }
    return null;
}

// redirectPath: where to go after login
// profile.id je autoritativní "moje identita" pro Firestore dotazy (slug u
// nových lidí založených přes admin konzoli, uid u starší Adaptace) — volající
// stránky by měly dotazovat where(pole,'in',[user.uid, profile?.id]), ne jen
// user.uid, aby fungovaly pro obě cesty.
export async function requireAuth(allowedRoles, redirectPath = '/adaptace/login.html') {
    const user = await getCurrentUser();
    if (!user) {
        window.location.href = redirectPath;
        return null;
    }

    const profile = await getUserProfile(user.uid);

    if (allowedRoles) {
        const effectiveRole = profile?.role ?? profile?.platformRole;
        if (!profile || !allowedRoles.includes(effectiveRole)) {
            window.location.href = redirectPath;
            return null;
        }
    }

    return { user, profile };
}

export async function signOutUser() {
    const { auth } = await initFirebase();
    await auth.signOut();
    window.location.href = '/adaptace/login.html';
}

// === DATE HELPERS ===

export function addWorkDays(startDate, days) {
    const date = new Date(startDate);
    let added = 0;
    while (added < days) {
        date.setDate(date.getDate() + 1);
        const dow = date.getDay();
        if (dow !== 0 && dow !== 6) added++;
    }
    return date;
}

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

// studioKey může být jeden klíč (string) nebo víc studií najednou (pole) — např. projektový
// specialista pokrývající víc studií.
export function formatStudios(studioKey) {
    const keys = Array.isArray(studioKey) ? studioKey : [studioKey];
    return keys.filter(Boolean).map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(', ');
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

// === DEFAULT 14-DAY TEMPLATE ===

export const DEFAULT_TEMPLATE = {
    name: 'Obchodník 14 dní',
    role: 'obchodnik',
    isDefault: true,
    days: [
        {
            dayNumber: 1,
            label: 'Uvítání & nástup',
            type: 'milestone',
            requiresConfirmation: true,
            morningBlocks: [
                {
                    id: 'd1-m1',
                    title: 'Administrativa & přístupy',
                    department: 'vse',
                    durationMinutes: 120,
                    isOnsite: false,
                    tasks: [
                        'Podpis pracovní smlouvy a dokumentů',
                        'Předání notebooku, telefonu a přístupových karet',
                        'Zřízení firemního emailu a přístupů do systémů',
                        'Seznámení s bezpečnostními předpisy',
                    ],
                },
            ],
            afternoonBlocks: [
                {
                    id: 'd1-o1',
                    title: 'Tour po showroomu & tým',
                    department: 'obchod',
                    durationMinutes: 90,
                    isOnsite: false,
                    tasks: [
                        'Prohlídka showroomu s vedoucím',
                        'Představení celého týmu',
                        'Vysvětlení organizační struktury a rolí',
                        'První pohled do kalendáře adaptace',
                    ],
                },
            ],
        },
        {
            dayNumber: 2,
            label: 'Produktový svět',
            type: 'standard',
            requiresConfirmation: false,
            morningBlocks: [
                {
                    id: 'd2-m1',
                    title: 'Sortiment & výrobci',
                    department: 'obchod',
                    durationMinutes: 120,
                    isOnsite: false,
                    tasks: [
                        'Přehled klíčových výrobců (Grohe, Roca, Villeroy & Boch, Hansgrohe)',
                        'Kategorie produktů — vany, sprchy, WC, umyvadla, doplňky',
                        'Cenové segmenty — standard, premium, luxury',
                        'Prohlídka expozic showroomu s výkladem',
                    ],
                },
            ],
            afternoonBlocks: [
                {
                    id: 'd2-o1',
                    title: 'Katalogy & konfigurátory',
                    department: 'obchod',
                    durationMinutes: 90,
                    isOnsite: false,
                    tasks: [
                        'Práce s fyzickými katalogy a ceníky',
                        'Online konfigurátor výrobců — první kroky',
                        'Kde hledat technické listy a parametry',
                        'Samostatné procházení expozice s katalogem',
                    ],
                },
            ],
        },
        {
            dayNumber: 3,
            label: 'Zákazník & prodejní proces',
            type: 'standard',
            requiresConfirmation: false,
            morningBlocks: [
                {
                    id: 'd3-m1',
                    title: 'Fáze prodeje',
                    department: 'obchod',
                    durationMinutes: 90,
                    isOnsite: false,
                    tasks: [
                        'Typologie zákazníků Koupelny Syrový',
                        'Fáze prodeje — příchod, potřeby, nabídka, uzavření',
                        'Jak si zapamatovat zákazníka a jeho projekt',
                        'Časté chyby začínajících obchodníků',
                    ],
                },
            ],
            afternoonBlocks: [
                {
                    id: 'd3-o1',
                    title: 'CRM Raynet — základy',
                    department: 'obchod',
                    durationMinutes: 120,
                    isOnsite: false,
                    tasks: [
                        'Přihlášení a orientace v Raynetu',
                        'Zakládání kontaktu a obchodního případu',
                        'Zadávání aktivit a plánování follow-upů',
                        'Procvičení na testovacích datech',
                    ],
                },
            ],
        },
        {
            dayNumber: 4,
            label: 'Sklad & logistika',
            type: 'onsite',
            requiresConfirmation: false,
            morningBlocks: [
                {
                    id: 'd4-m1',
                    title: 'Návštěva skladu Chrast',
                    department: 'sklad',
                    durationMinutes: 180,
                    isOnsite: true,
                    onsiteLocation: 'Sklad Chrast',
                    tasks: [
                        'Prohlídka skladu a orientace v prostoru',
                        'Jak funguje příjem a expedice zboží',
                        'Stavy skladu — co je na cestě, co je k dispozici',
                        'Seznámení s vedoucím skladu a skladníky',
                    ],
                },
            ],
            afternoonBlocks: [
                {
                    id: 'd4-o1',
                    title: 'Logistika & dodací lhůty',
                    department: 'sklad',
                    durationMinutes: 120,
                    isOnsite: true,
                    onsiteLocation: 'Sklad Chrast',
                    tasks: [
                        'Jak odhadnout dodací lhůtu pro zákazníka',
                        'Co zákazníkovi slíbit a co ne — pravidla',
                        'Reklamační tok — od zákazníka do skladu',
                        'Nejčastější problémy a jak je řešit',
                    ],
                },
            ],
        },
        {
            dayNumber: 5,
            label: 'Projekty & vizualizace',
            type: 'standard',
            requiresConfirmation: false,
            morningBlocks: [
                {
                    id: 'd5-m1',
                    title: 'Základy projektování koupelen',
                    department: 'projekt',
                    durationMinutes: 120,
                    isOnsite: false,
                    tasks: [
                        'Jak číst půdorys a technické výkresy',
                        'Základní normy a rozměry (min. rozestupy, výšky)',
                        'Co si vždy zjistit od zákazníka před návrhem',
                        'Spolupráce obchodu a projektantů',
                    ],
                },
            ],
            afternoonBlocks: [
                {
                    id: 'd5-o1',
                    title: 'Vizualizační software',
                    department: 'projekt',
                    durationMinutes: 120,
                    isOnsite: false,
                    tasks: [
                        'Přihlášení a orientace ve vizualizačním softwaru',
                        'Vytvoření jednoduchého layoutu testovací koupelny',
                        'Přidání produktů z katalogu do vizualizace',
                        'Export a sdílení vizualizace se zákazníkem',
                    ],
                },
            ],
        },
        {
            dayNumber: 6,
            label: 'Finance & obchodní pravidla',
            type: 'standard',
            requiresConfirmation: false,
            morningBlocks: [
                {
                    id: 'd6-m1',
                    title: 'Ceny, marže, slevy',
                    department: 'finance',
                    durationMinutes: 90,
                    isOnsite: false,
                    tasks: [
                        'Cenová politika — kde je prostor pro slevy',
                        'Maržové cíle a jak je dosáhnout',
                        'Co odsouhlasit s vedoucím, co mohu samostatně',
                        'Nejčastější zákaznické argumenty a odpovědi',
                    ],
                },
            ],
            afternoonBlocks: [
                {
                    id: 'd6-o1',
                    title: 'Nabídky & objednávky v Pohodě',
                    department: 'finance',
                    durationMinutes: 90,
                    isOnsite: false,
                    tasks: [
                        'Orientace v ekonomickém systému Pohoda',
                        'Vytvoření a odeslání nabídky zákazníkovi',
                        'Postup při potvrzení objednávky',
                        'Jak sledovat stav zakázky v systému',
                    ],
                },
            ],
        },
        {
            dayNumber: 7,
            label: 'Test produktových znalostí',
            type: 'milestone',
            requiresConfirmation: true,
            morningBlocks: [
                {
                    id: 'd7-m1',
                    title: 'Opakování & Q&A',
                    department: 'obchod',
                    durationMinutes: 120,
                    isOnsite: false,
                    tasks: [
                        'Opakování klíčových produktových kategorií',
                        'Q&A session se senior obchodníkem',
                        'Procházení scénářů zákaznických situací',
                        'Příprava na odpolední hodnocení',
                    ],
                },
            ],
            afternoonBlocks: [
                {
                    id: 'd7-o1',
                    title: 'Hodnocení 1. týdne',
                    department: 'obchod',
                    durationMinutes: 90,
                    isOnsite: false,
                    tasks: [
                        'Ústní test produktových znalostí s vedoucím',
                        'Zpětná vazba na první týden',
                        'Identifikace oblastí ke zlepšení',
                        'Nastavení cílů pro 2. týden',
                    ],
                },
            ],
        },
        {
            dayNumber: 8,
            label: 'Shadowing I — u zákazníka',
            type: 'standard',
            requiresConfirmation: false,
            morningBlocks: [
                {
                    id: 'd8-m1',
                    title: 'Příprava na shadowing',
                    department: 'obchod',
                    durationMinutes: 60,
                    isOnsite: false,
                    tasks: [
                        'Briefing s vedoucím — co sledovat a na co se zaměřit',
                        'Přečtení historiky zákazníka, který dnes přijde',
                        'Připravit si zápisník a otázky',
                    ],
                },
            ],
            afternoonBlocks: [
                {
                    id: 'd8-o1',
                    title: 'Aktivní shadowing',
                    department: 'obchod',
                    durationMinutes: 180,
                    isOnsite: false,
                    tasks: [
                        'Pozorování celého zákaznického rozhovoru',
                        'Poznámky k technikám a přístupům obchodníka',
                        'Debriefing po rozhovoru — co fungovalo, co ne',
                        'Zápis poznatků do CRM jako budoucí reference',
                    ],
                },
            ],
        },
        {
            dayNumber: 9,
            label: 'Reklamace & servis',
            type: 'standard',
            requiresConfirmation: false,
            morningBlocks: [
                {
                    id: 'd9-m1',
                    title: 'Reklamační proces',
                    department: 'servis',
                    durationMinutes: 90,
                    isOnsite: false,
                    tasks: [
                        'Zákonné lhůty a práva zákazníka',
                        'Reklamace v Raynetu — zadání, průběh, uzavření',
                        'Kdy eskalovat na vedoucího',
                        'Jak komunikovat s nespokojených zákazníkem',
                    ],
                },
            ],
            afternoonBlocks: [
                {
                    id: 'd9-o1',
                    title: 'Montážní tým & koordinace',
                    department: 'montaz',
                    durationMinutes: 90,
                    isOnsite: false,
                    tasks: [
                        'Jak funguje montážní tým — kapacity a harmonogramy',
                        'Co mohu zákazníkovi slíbit ohledně montáže',
                        'Koordinace obchod-montáž při komplikacích',
                        'Zpětná vazba od montérů jako zdroj znalostí',
                    ],
                },
            ],
        },
        {
            dayNumber: 10,
            label: 'Realizace u klienta',
            type: 'onsite',
            requiresConfirmation: false,
            morningBlocks: [
                {
                    id: 'd10-m1',
                    title: 'Výjezd na probíhající realizaci',
                    department: 'montaz',
                    durationMinutes: 240,
                    isOnsite: true,
                    onsiteLocation: 'Dle aktuálního harmonogramu realizací',
                    tasks: [
                        'Přeprava s vedoucím nebo mistrem na místo',
                        'Kontrolní obchůzka — fáze, kvalita, problémy',
                        'Rozhovor s montérem — pohled z jejich strany',
                        'Porovnání původní objednávky s realitou',
                    ],
                },
            ],
            afternoonBlocks: [
                {
                    id: 'd10-o1',
                    title: 'Závěr a zápis',
                    department: 'montaz',
                    durationMinutes: 90,
                    isOnsite: false,
                    tasks: [
                        'Debriefing s vedoucím po výjezdu',
                        'Zápis poznatků — co z realizace platí pro obchod',
                        'Identifikace nejčastějších problémů ze zákaznické perspektivy',
                    ],
                },
            ],
        },
        {
            dayNumber: 11,
            label: 'První zákazník pod dozorem',
            type: 'wow',
            requiresConfirmation: false,
            morningBlocks: [
                {
                    id: 'd11-m1',
                    title: 'Příprava na první rozhovor',
                    department: 'obchod',
                    durationMinutes: 90,
                    isOnsite: false,
                    tasks: [
                        'Příprava vlastní struktury rozhovoru',
                        'Nácvik s vedoucím — roleplay zákaznické situace',
                        'Příprava showroomu a relevantní expozice',
                        'Mentální příprava a klíčové tipy od vedoucího',
                    ],
                },
            ],
            afternoonBlocks: [
                {
                    id: 'd11-o1',
                    title: 'Vedení zákaznického rozhovoru',
                    department: 'obchod',
                    durationMinutes: 120,
                    isOnsite: false,
                    tasks: [
                        'Vedení rozhovoru se zákazníkem (vedoucí přítomen)',
                        'Prezentace produktů podle zjištěných potřeb',
                        'Zpracování cenové nabídky',
                        'Debriefing s vedoucím — zpětná vazba ke každé fázi',
                    ],
                },
            ],
        },
        {
            dayNumber: 12,
            label: 'Shadowing II — celý případ',
            type: 'standard',
            requiresConfirmation: false,
            morningBlocks: [
                {
                    id: 'd12-m1',
                    title: 'Sledování celého zákaznického případu',
                    department: 'obchod',
                    durationMinutes: 240,
                    isOnsite: false,
                    tasks: [
                        'Shadowing od první poptávky po potvrzenou objednávku',
                        'Sledování práce s Raynetem v reálném čase',
                        'Poznámky k rozhodovacím momentům zákazníka',
                        'Jak senior obchodník řeší námitky a zpomalení',
                    ],
                },
            ],
            afternoonBlocks: [
                {
                    id: 'd12-o1',
                    title: 'Samostatné procvičení',
                    department: 'obchod',
                    durationMinutes: 120,
                    isOnsite: false,
                    tasks: [
                        'Samostatné procházení zákaznického scénáře v CRM',
                        'Vytvoření kompletní nabídky pro fiktivního zákazníka',
                        'Review nabídky s vedoucím',
                        'Identifikace zbývajících mezer v znalostech',
                    ],
                },
            ],
        },
        {
            dayNumber: 13,
            label: 'Opakování & příprava na závěr',
            type: 'standard',
            requiresConfirmation: false,
            morningBlocks: [
                {
                    id: 'd13-m1',
                    title: 'Opakování klíčových procesů',
                    department: 'obchod',
                    durationMinutes: 90,
                    isOnsite: false,
                    tasks: [
                        'Revize všech systémů — Raynet, Pohoda, vizualizace',
                        'Opakování cenové politiky a schvalovacích pravidel',
                        'Nejčastější zákaznické situace a jak je řešit',
                        'Otázky a odpovědi s vedoucím',
                    ],
                },
            ],
            afternoonBlocks: [
                {
                    id: 'd13-o1',
                    title: 'Plán na 1. měsíc',
                    department: 'obchod',
                    durationMinutes: 90,
                    isOnsite: false,
                    tasks: [
                        'Sestavení osobního plánu na první měsíc',
                        'Nastavení cílů (počet zákazníků, nabídky, objednávky)',
                        'Identifikace mentora pro průběžné konzultace',
                        'Příprava otázek na závěrečné hodnocení',
                    ],
                },
            ],
        },
        {
            dayNumber: 14,
            label: 'Závěrečné hodnocení',
            type: 'milestone',
            requiresConfirmation: true,
            morningBlocks: [
                {
                    id: 'd14-m1',
                    title: 'Prezentace 1. měsíčního plánu',
                    department: 'obchod',
                    durationMinutes: 60,
                    isOnsite: false,
                    tasks: [
                        'Prezentace osobního plánu vedoucímu',
                        'Diskuse nad realistností cílů',
                        'Potvrzení mentora a způsobu průběžného hodnocení',
                    ],
                },
            ],
            afternoonBlocks: [
                {
                    id: 'd14-o1',
                    title: 'Hodnotící rozhovor',
                    department: 'obchod',
                    durationMinutes: 90,
                    isOnsite: false,
                    tasks: [
                        'Sebehodnocení — co jsem se naučil, co mi ještě chybí',
                        'Hodnocení vedoucím — silné stránky a oblasti rozvoje',
                        'Nastavení checkpointů pro následující měsíce',
                        'Slavnostní ukončení adaptace a přivítání v týmu',
                    ],
                },
            ],
        },
    ],
};

// === PROJEKTOVÝ SPECIALISTA — 90 DENNÍ / TÝDENNÍ ŠABLONA ===
// confirmerRole: 'manager' | 'managerDeputy' | 'seniorSpecialist' | 'buddy' | null
// (null = informativní responsibleLabel, potvrzuje manažer/HR/admin jako dnes)

function g(id, text, responsibleLabel, confirmerRole = null) {
    return { id, text, responsibleLabel, confirmerRole };
}

export const PROJECT_SPECIALIST_TEMPLATE = {
    name: 'Projektový specialista/designér — 90 dní',
    role: 'projektovy_specialista',
    templateType: 'weekly',
    isDefault: true,
    phases: [
        {
            phaseNumber: 1,
            name: 'Znalosti',
            weekFrom: 1,
            weekTo: 4,
            goal: 'Vím. Rozumím. Orientuji se.',
            weeks: [
                {
                    weekNumber: 1,
                    goals: [
                        g('p1w1g1', 'Zná firmu, její strategii, hodnoty a kulturu.', 'CEO'),
                        g('p1w1g2', 'Orientuje se v provozu přiděleného studia, zná jeho fungování, organizaci práce a každodenní standardy.', 'Buddy', 'buddy'),
                        g('p1w1g3', 'Orientuje se ve struktuře firmy a ví, na koho se obrátit v jednotlivých situacích.', 'Manažer', 'manager'),
                        g('p1w1g4', 'Zná kompletní obchodní proces KS od první poptávky po servis.', 'Manažer', 'manager'),
                        g('p1w1g5', 'Má připravené pracovní prostředí a ovládá všechny firemní systémy na základní úrovni (Raynet, Pohoda, CAD, Drive = směny, email, app evidence návštěvnosti).', 'Buddy', 'buddy'),
                        g('p1w1g6', 'Má nastudované adaptační okruh Firemní kultura a zákaznická zkušenost.', 'Samostudium'),
                        g('p1w1g7', 'Orientuje se na webových stránkách společnosti, sociálních sítích a zná aktuální marketingové kampaně.', 'Samostudium'),
                        g('p1w1g8', 'Orientuje se v interní nástěnce společnosti = Nuclino, složkách na Drivu a ví, kde vyhledá potřebné informace.', 'Samostudium'),
                        g('p1w1g9', 'Správně eviduje návštěvnost klientů a rozumí významu kvalitních dat pro řízení společnosti.', 'Buddy', 'buddy'),
                    ],
                },
                {
                    weekNumber: 2,
                    goals: [
                        g('p1w2g1', 'Zná kompletní produktové portfolio KS.', 'Samostudium'),
                        g('p1w2g2', 'Orientuje se ve strategickém portfoliu a rozumí tomu, proč jej nabízíme.', 'Manažer', 'manager'),
                        g('p1w2g3', 'Zná hlavní výrobce a jejich konkurenční výhody.', 'Samostudium'),
                        g('p1w2g4', 'Orientuje se v trhu koupelen a hlavních konkurentech.', 'Manažer', 'manager'),
                        g('p1w2g5', 'Má nastudované adaptační okruh Sortiment a výrobci.', 'Samostudium'),
                        g('p1w2g6', 'Orientuje se v historii společnosti, její filozofii a dlouhodobé vizi.', 'CEO'),
                        g('p1w2g7', 'Orientuje se v referenčních realizacích společnosti a dokáže je využít při komunikaci s klientem.', 'Samostudium'),
                    ],
                },
                {
                    weekNumber: 3,
                    goals: [
                        g('p1w3g1', 'Rozumí technickým principům návrhu koupelny.', 'Senior projektový specialista', 'seniorSpecialist'),
                        g('p1w3g2', 'Zná technické parametry hlavních produktů.', 'Senior projektový specialista', 'seniorSpecialist'),
                        g('p1w3g3', 'Umí spočítat množství dlažby a prořez.', 'Senior projektový specialista', 'seniorSpecialist'),
                        g('p1w3g4', 'Orientuje se v technických řešeních realizací a jak to funguje na realizacích.', 'Koordinátor realizací'),
                        g('p1w3g5', 'Má nastudované adaptační okruh Technické znalosti.', 'Samostudium'),
                        g('p1w3g6', 'Orientuje se v obchodních podmínkách hlavních dodavatelů (záruky, dostupnosti, náhradní díly).', 'Buddy', 'buddy'),
                        g('p1w3g7', 'Orientuje se ve všech koupelnových kójích přiděleného studia, zná jejich obsah, hlavní produkty a jejich využití při obchodní schůzce.', 'Buddy', 'buddy'),
                    ],
                },
                {
                    weekNumber: 4,
                    goals: [
                        g('p1w4g1', 'Rozumí procesům realizace, logistiky, reklamací a servisu.', 'Provoz'),
                        g('p1w4g2', 'Rozumí CX procesu, procesu zpětné vazby a recenzí.', 'Manažer', 'manager'),
                        g('p1w4g3', 'Zná proces strategického portfolia.', 'Manažer', 'manager'),
                        g('p1w4g4', 'Rozumí ekonomickému toku zakázky od nabídky po fakturu.', 'Buddy', 'buddy'),
                        g('p1w4g5', 'Má nastudované adaptační okruh Realizace.', 'Samostudium'),
                        g('p1w4g6', 'Orientuje se v nejčastějších technických chybách při návrhu koupelen a zná jejich správná řešení.', 'Manažer', 'manager'),
                        g('p1w4g7', 'Orientuje se v nejčastějších reklamacích a jejich příčinách.', 'Provoz'),
                        g('p1w4g8', 'Rozumí svému obchodnímu plánu, ví, jaké KPI sleduje a jakými aktivitami je může ovlivnit.', 'Manažer', 'manager'),
                    ],
                },
            ],
        },
        {
            phaseNumber: 2,
            name: 'Dovednosti',
            weekFrom: 5,
            weekTo: 8,
            goal: 'Umím. Prakticky zvládám.',
            weeks: [
                {
                    weekNumber: 5,
                    goals: [
                        g('p2w5g1', 'Samostatně založí obchodní případ v Raynetu.', 'Buddy (na žádost)', 'buddy'),
                        g('p2w5g2', 'Samostatně vytvoří nabídku v Pohodě.', 'Buddy (na žádost)', 'buddy'),
                        g('p2w5g3', 'Samostatně vytvoří objednávku.', 'Buddy (na žádost)', 'buddy'),
                        g('p2w5g4', 'Samostatně vytvoří zálohovou fakturu.', 'Buddy (na žádost)', 'buddy'),
                        g('p2w5g5', 'Samostatně vytvoří konečnou fakturu.', 'Buddy (na žádost)', 'buddy'),
                        g('p2w5g6', 'Samostatně založí klienta v Raynetu.', 'Buddy (na žádost)', 'buddy'),
                        g('p2w5g7', 'Orientuje se v designových trendech koupelen a interiérů.', 'Samostudium'),
                        g('p2w5g8', 'Orientuje se v našich inspirativních realizacích.', 'Samostudium'),
                        g('p2w5g9', 'Píše obchodní e-maily podle firemního standardu a dodržuje požadovanou rychlost reakcí.', 'Manažer', 'manager'),
                    ],
                },
                {
                    weekNumber: 6,
                    note: 'Celý týden CAD.',
                    goals: [
                        g('p2w6g1', 'Vytvoří první vizualizaci.', 'Buddy (na žádost)', 'buddy'),
                        g('p2w6g2', 'Nahraje nové produkty.', 'Buddy (na žádost)', 'buddy'),
                        g('p2w6g3', 'Udělá spárořez.', 'Buddy (na žádost)', 'buddy'),
                        g('p2w6g4', 'Vytvoří render.', 'Buddy (na žádost)', 'buddy'),
                        g('p2w6g5', 'Připraví technickou dokumentaci.', 'Buddy (na žádost)', 'buddy'),
                        g('p2w6g6', 'Orientuje se ve všech základních funkcích CAD potřebných pro návrh koupelny a samostatně je využívá při své práci.', 'Samostudium'),
                        g('p2w6g7', 'Orientuje se v interních standardech tvorby vizualizací, technické dokumentace a renderů a aplikuje je při tvorbě návrhů.', 'Samostudium'),
                    ],
                },
                {
                    weekNumber: 7,
                    note: 'Celý týden obchod.',
                    goals: [
                        g('p2w7g1', 'Samostatně vede část obchodní schůzky.', 'Supervize manažer', 'manager'),
                        g('p2w7g2', 'Používá klasifikační otázky.', 'Supervize manažer', 'manager'),
                        g('p2w7g3', 'Používá adaptační otázky.', 'Supervize manažer', 'manager'),
                        g('p2w7g4', 'Umí představit strategické portfolio.', 'Supervize manažer', 'manager'),
                        g('p2w7g5', 'Umí představit služby KS.', 'Supervize manažer', 'manager'),
                        g('p2w7g6', 'Umí argumentovat na námitky (cena, produkt, řešení aj.).', 'Supervize manažer', 'manager'),
                        g('p2w7g7', 'Umí uklidnit a vyřešit krizovou situaci (reklamace, servis aj.).', 'Supervize manažer', 'manager'),
                        g('p2w7g8', 'Orientuje se v obchodních statistikách společnosti a rozumí základním KPI projektového specialisty.', 'Manažer', 'manager'),
                        g('p2w7g9', 'Orientuje se v nejčastějších důvodech ztracených obchodních případů.', 'Manažer', 'manager'),
                        g('p2w7g10', 'Dodržuje standard společnosti pro následnou komunikaci s klientem včetně follow-upu po obchodní schůzce.', 'Buddy', 'buddy'),
                    ],
                },
                {
                    weekNumber: 8,
                    goals: [
                        g('p2w8g1', 'Samostatně komunikuje s klientem.', ''),
                        g('p2w8g2', 'Umí představit služby KS.', 'Supervize manažer', 'manager'),
                        g('p2w8g3', 'Samostatně komunikuje s dodavateli.', ''),
                        g('p2w8g4', 'Umí představit služby KS.', 'Supervize manažer', 'manager'),
                        g('p2w8g5', 'Samostatně komunikuje s logistikou.', ''),
                        g('p2w8g6', 'Samostatně komunikuje s provozem.', ''),
                        g('p2w8g7', 'Dodržuje komunikační standard KS.', ''),
                        g('p2w8g8', 'Umí představit služby KS.', 'Supervize manažer', 'manager'),
                        g('p2w8g9', 'Orientuje se v nejčastějších typech klientů a jejich rozhodovacím procesu.', 'Manažer', 'manager'),
                        g('p2w8g10', 'Orientuje se v principech psychologie prodeje a budování důvěry.', 'Manažer', 'manager'),
                        g('p2w8g11', 'Rozumí svým kompetencím a ví, kdy a komu předává jednotlivé úkoly nebo požadavky.', 'Manažer', 'manager'),
                    ],
                },
            ],
        },
        {
            phaseNumber: 3,
            name: 'Myšlení a samostatnost',
            weekFrom: 9,
            weekTo: 12,
            goal: 'Přemýšlím a jednám samostatně.',
            weeks: [
                {
                    weekNumber: 9,
                    goals: [
                        g('p3w9g1', 'Chápe, proč máme strategické portfolio.', 'Manažer', 'manager'),
                        g('p3w9g2', 'Chápe ekonomiku zakázky.', 'Manažer', 'manager'),
                        g('p3w9g3', 'Chápe, proč dodržujeme obchodní proces.', 'Manažer', 'manager'),
                        g('p3w9g4', 'Chápe význam CX.', 'Manažer', 'manager'),
                        g('p3w9g5', 'Chápe význam rychlé komunikace.', 'Manažer', 'manager'),
                        g('p3w9g6', 'Rozlišuje priority své práce a samostatně rozhoduje o pořadí jednotlivých činností.', 'Manažer', 'manager'),
                        g('p3w9g7', 'Přebírá osobní odpovědnost za svěřený obchodní případ od první schůzky až po úspěšné dokončení realizace.', 'Manažer', 'manager'),
                    ],
                },
                {
                    weekNumber: 10,
                    goals: [
                        g('p3w10g1', 'Přemýšlí obchodně.', 'Manažer', 'manager'),
                        g('p3w10g2', 'Aktivně hledá příležitosti.', 'Manažer', 'manager'),
                        g('p3w10g3', 'Umí prioritizovat práci.', 'Manažer', 'manager'),
                        g('p3w10g4', 'Přichází s návrhy zlepšení.', 'Manažer', 'manager'),
                        g('p3w10g5', 'Aktivně pracuje s vlastními výsledky.', 'Manažer', 'manager'),
                        g('p3w10g6', 'Komunikuje napříč společností podle interních standardů a poskytuje kolegům úplné a srozumitelné informace.', 'Buddy', 'buddy'),
                        g('p3w10g7', 'Aktivně vyhledává zpětnou vazbu, otevřeně pracuje s vlastními chybami a přijímá opatření k jejich odstranění.', 'Manažer', 'manager'),
                        g('p3w10g8', 'Dodržuje všechny standardy společnosti při komunikaci, obchodování, návrhu i administrativě.', 'Manažer', 'manager'),
                    ],
                },
                {
                    weekNumber: 11,
                    goals: [
                        g('p3w11g1', 'Úspěšně absolvoval adaptační otázky: technické znalosti, výrobci a sortiment, CX, realizace, trh a konkurence, situační otázky.', 'Manažer', 'manager'),
                        g('p3w11g2', 'Průběžně vyhodnocuje svůj pokrok, aktivně si vyhledává příležitosti ke zlepšení a přebírá odpovědnost za svůj profesní rozvoj.', 'Manažer', 'manager'),
                    ],
                },
                {
                    weekNumber: 12,
                    goals: [
                        g('p3w12g1', 'Samostatně vede kompletní obchodní případ.', 'Supervize manažer', 'manager'),
                        g('p3w12g2', 'Samostatně vede obchodní schůzky.', 'Supervize manažer', 'manager'),
                        g('p3w12g3', 'Odevzdá marketingovou vizualizaci.', 'Supervize manažer', 'manager'),
                        g('p3w12g4', 'Úspěšně složí adaptační test.', 'Manažer', 'manager'),
                        g('p3w12g5', 'Má vytvořený roční rozvojový plán.', 'Supervize manažer', 'manager'),
                    ],
                },
            ],
        },
    ],
    ongoingCategories: [
        {
            key: 'obecne',
            label: 'Obecné (celých 90 dní)',
            goals: [
                { id: 'og-obecne-1', text: 'Je přítomen minimálně na 10 obchodních schůzkách zkušenějších projektových specialistů a po každé schůzce zašle manažerovi krátkou reflexi.', targetCount: 10 },
                { id: 'og-obecne-2', text: 'Samostatně vede minimálně 10 obchodních schůzek pod supervizí buddyho, senior projektového specialisty nebo manažera.', targetCount: 10 },
                { id: 'og-obecne-3', text: 'Absolvuje minimálně 3 návštěvy probíhajících realizací a rozumí návaznosti návrhu na samotnou realizaci.', targetCount: 3 },
                { id: 'og-obecne-4', text: 'Navštíví všechna studia společnosti a seznámí se s jejich konceptem, vystaveným sortimentem a specifiky.', targetCount: 4 },
                { id: 'og-obecne-5', text: 'Absolvuje minimálně 5 produktových školení strategických dodavatelů nebo interních produktových akademií.', targetCount: 5 },
                { id: 'og-obecne-6', text: 'Zpracuje minimálně 20 kompletních obchodních případů v systému Raynet a Pohoda (v různém stupni samostatnosti dle fáze adaptace).', targetCount: 20 },
                { id: 'og-obecne-7', text: 'Vytvoří minimálně 10 návrhů koupelen v CAD, z toho alespoň 3 kompletní vizualizace včetně renderů podle interních standardů společnosti.', targetCount: 10 },
                { id: 'og-obecne-8', text: 'Absolvuje minimálně 5 rozvojových setkání (1:1) se svým manažerem a po každém setkání zapracuje domluvené rozvojové kroky.', targetCount: 5 },
                { id: 'og-obecne-9', text: 'Úspěšně absolvuje všechny adaptační okruhy, produktové akademie a povinné studijní moduly předepsané adaptačním plánem.', targetCount: null },
                { id: 'og-obecne-10', text: 'Úspěšně složí závěrečné ověření znalostí a dovedností a získá doporučení manažera k přechodu na standardní výkon projektového specialisty.', targetCount: null },
                { id: 'og-obecne-11', text: 'Vyžádá si minimálně 15 zpětných vazeb od klientů nebo kolegů na svůj výkon a projde je s manažerem v rámci rozvojových setkání.', targetCount: 15 },
                { id: 'og-obecne-12', text: 'Navrhne minimálně 3 konkrétní zlepšení fungování studia, obchodního procesu nebo zákaznické zkušenosti.', targetCount: 3 },
                { id: 'og-obecne-13', text: 'Každý týden sepíše 3 nejdůležitější poznatky, které se během adaptace naučil, a 1 návrh na zlepšení fungování společnosti a pošle to svému manažerovi.', targetCount: 12 },
            ],
        },
        {
            key: 'obchod',
            label: 'Obchod',
            goals: [
                { id: 'og-obchod-1', text: 'Připraví minimálně 20 obchodních nabídek pro klienty.', targetCount: 20 },
                { id: 'og-obchod-2', text: 'Samostatně uzavře minimálně 5 obchodních případů.', targetCount: 5 },
                { id: 'og-obchod-3', text: 'Provede minimálně 10 kompletních follow-upů dle standardu společnosti.', targetCount: 10 },
                { id: 'og-obchod-4', text: 'Po každé samostatně vedené schůzce provede vlastní sebereflexi a projde ji s buddy nebo manažerem.', targetCount: null },
            ],
        },
        {
            key: 'produkt_technika',
            label: 'Produkt a technika',
            goals: [
                { id: 'og-produkt-1', text: 'Odprezentuje minimálně 5 strategických produktů před manažerem nebo týmem.', targetCount: 5 },
                { id: 'og-produkt-2', text: 'Absolvuje minimálně 3 technické konzultace s odborným poradcem nebo provozem.', targetCount: 3 },
                { id: 'og-produkt-3', text: 'Vyřeší minimálně 5 modelových technických situací z adaptačních otázek.', targetCount: 5 },
            ],
        },
        {
            key: 'realizace',
            label: 'Realizace',
            goals: [
                { id: 'og-realizace-1', text: 'Je přítomen minimálně u 3 předání hotové realizace klientovi.', targetCount: 3 },
                { id: 'og-realizace-2', text: 'Je přítomen minimálně u 2 reklamačních případů a rozumí jejich řešení.', targetCount: 2 },
            ],
        },
        {
            key: 'firemni_systemy',
            label: 'Firemní systémy',
            goals: [
                { id: 'og-systemy-1', text: 'Samostatně založí minimálně 30 obchodních případů v Raynetu bez chyb.', targetCount: 30 },
                { id: 'og-systemy-2', text: 'Samostatně vytvoří minimálně 20 objednávek v Pohodě bez nutnosti oprav.', targetCount: 20 },
            ],
        },
        {
            key: 'cx',
            label: 'CX',
            goals: [
                { id: 'og-cx-1', text: 'Vyžádá si minimálně 10 recenzí od klientů dle firemního procesu.', targetCount: 10 },
                { id: 'og-cx-2', text: 'Vyhodnotí minimálně 5 klientských zpětných vazeb a navrhne opatření ke zlepšení.', targetCount: 5 },
            ],
        },
        {
            key: 'rozvoj',
            label: 'Rozvoj',
            goals: [
                { id: 'og-rozvoj-1', text: 'Přečte minimálně jednu doporučenou odbornou knihu z oblasti obchodu, komunikace nebo psychologie a připraví její krátké shrnutí pro manažera.', targetCount: 1 },
                { id: 'og-rozvoj-2', text: 'Představí týmu minimálně jedno téma, které se během adaptace naučil a považuje ho za přínosné.', targetCount: 1 },
            ],
        },
        {
            key: 'firemni_kultura',
            label: 'Firemní kultura',
            goals: [
                { id: 'og-kultura-1', text: 'Poskytne minimálně 10 konstruktivních zpětných vazeb kolegům nebo buddy v souladu s firemní kulturou.', targetCount: 10 },
            ],
        },
        {
            key: 'marketing',
            label: 'Marketing',
            goals: [
                { id: 'og-marketing-1', text: 'Připraví minimálně 5 kvalitních fotografií nebo videí realizací či showroomu využitelných pro marketing společnosti.', targetCount: 5 },
            ],
        },
        {
            key: 'data',
            label: 'Data',
            goals: [
                { id: 'og-data-1', text: 'Každý týden vyhodnotí své obchodní výsledky a připraví krátké shrnutí pro rozvojové setkání s manažerem.', targetCount: 12 },
            ],
        },
    ],
};

// === TEMPLATE SEED ===
// Pokud výchozí šablona neexistuje, vytvoří ji. Volat jen z HR/admin contextu.
export async function ensureDefaultTemplate() {
    const { db } = await initFirebase();
    const { collection, query, where, getDocs, addDoc, serverTimestamp } =
        await import(`${CDN}/firebase-firestore.js`);

    const q = query(
        collection(db, 'adaptation_templates'),
        where('isDefault', '==', true),
        where('role', '==', 'obchodnik')
    );
    const snap = await getDocs(q);
    if (!snap.empty) return snap.docs[0].id;

    const ref = await addDoc(collection(db, 'adaptation_templates'), {
        ...DEFAULT_TEMPLATE,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
    return ref.id;
}

// Pokud šablona pro projektového specialistu neexistuje, vytvoří ji. Volat jen z HR/admin contextu.
export async function ensureProjectSpecialistTemplate() {
    const { db } = await initFirebase();
    const { collection, query, where, getDocs, addDoc, serverTimestamp } =
        await import(`${CDN}/firebase-firestore.js`);

    const q = query(
        collection(db, 'adaptation_templates'),
        where('isDefault', '==', true),
        where('role', '==', 'projektovy_specialista')
    );
    const snap = await getDocs(q);
    if (!snap.empty) return snap.docs[0].id;

    const ref = await addDoc(collection(db, 'adaptation_templates'), {
        ...PROJECT_SPECIALIST_TEMPLATE,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
    return ref.id;
}

// === ADAPTATION HELPERS ===

export function calcProgress(adaptation) {
    const days = adaptation.days ?? [];
    const total = days.length;
    const done = days.filter(d =>
        d.status === 'completed' || d.status === 'confirmed'
    ).length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function buildDayProgress(dayTemplate, startDate) {
    const planned = startDate
        ? addWorkDays(startDate, dayTemplate.dayNumber - 1)
        : null;

    const blocks = [
        ...dayTemplate.morningBlocks.map(b => ({
            blockId: b.id,
            tasks: b.tasks.map((_, i) => ({
                taskIndex: i,
                checkedByEmployee: false,
                checkedAt: null,
            })),
        })),
        ...dayTemplate.afternoonBlocks.map(b => ({
            blockId: b.id,
            tasks: b.tasks.map((_, i) => ({
                taskIndex: i,
                checkedByEmployee: false,
                checkedAt: null,
            })),
        })),
    ];

    return {
        dayNumber: dayTemplate.dayNumber,
        label: dayTemplate.label,
        type: dayTemplate.type,
        requiresConfirmation: dayTemplate.requiresConfirmation,
        morningBlocks: dayTemplate.morningBlocks,
        afternoonBlocks: dayTemplate.afternoonBlocks,
        plannedDate: planned ? planned.toISOString().split('T')[0] : null,
        actualDate: null,
        status: 'pending',
        blocks,
        employeeNote: '',
        supervisorNote: '',
        confirmedBy: null,
        confirmedAt: null,
    };
}

export function countPendingConfirmations(adaptation) {
    return (adaptation.days ?? []).filter(d => d.status === 'completed').length;
}

// === TÝDENNÍ ŠABLONA — HELPERY (projektový specialista) ===

export function buildWeeklyProgress(template, startDate) {
    const phases = template.phases.map(phase => ({
        phaseNumber: phase.phaseNumber,
        name: phase.name,
        goal: phase.goal,
        weekFrom: phase.weekFrom,
        weekTo: phase.weekTo,
        weeks: phase.weeks.map(week => {
            const planned = startDate ? addWorkDays(startDate, (week.weekNumber - 1) * 5) : null;
            return {
                weekNumber: week.weekNumber,
                note: week.note ?? null,
                plannedDate: planned ? planned.toISOString().split('T')[0] : null,
                goals: week.goals.map(goal => ({
                    ...goal,
                    status: 'pending',
                    checkedAt: null,
                    employeeNote: '',
                    confirmedBy: null,
                    confirmedAt: null,
                    supervisorNote: '',
                })),
            };
        }),
    }));

    const ongoingCategories = template.ongoingCategories.map(cat => ({
        key: cat.key,
        label: cat.label,
        goals: cat.goals.map(goal => ({
            ...goal,
            currentCount: 0,
            status: 'pending',
        })),
    }));

    return { phases, ongoingCategories };
}

export function calcWeeklyProgress(adaptation) {
    const allGoals = (adaptation.phases ?? []).flatMap(p => p.weeks.flatMap(w => w.goals));
    const total = allGoals.length;
    const done = allGoals.filter(g => g.status === 'completed' || g.status === 'confirmed').length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function countPendingWeeklyConfirmations(adaptation) {
    return (adaptation.phases ?? [])
        .flatMap(p => p.weeks.flatMap(w => w.goals))
        .filter(g => g.status === 'completed').length;
}

// === DEMO MÓD ===
// Aktivuje se URL parametrem ?demo=1 — přeskočí Firebase Auth i Firestore.

export function isDemoMode() {
    return new URLSearchParams(window.location.search).get('demo') === '1';
}

// Vrátí mock session pro demo mód (nahrazuje requireAuth)
export function demoSession(asRole = 'employee') {
    const profiles = {
        employee:   { uid: 'demo-employee',   name: 'Jana Nováčková',    role: 'employee',   studioKey: 'praha' },
        supervisor: { uid: 'demo-supervisor', name: 'Petr Vedoucí',      role: 'supervisor', studioKey: 'praha' },
        hr:         { uid: 'demo-hr',         name: 'HR Demo',           role: 'hr',         studioKey: 'praha' },
    };
    const profile = profiles[asRole] ?? profiles.employee;
    return { user: { uid: profile.uid, email: `${asRole}@demo.cz` }, profile };
}

// Mock adaptace nováčka — dny 1-5 hotové, den 6 aktuální, zbytek pending
export function buildDemoAdaptation() {
    const days = DEFAULT_TEMPLATE.days.map((tmpl, i) => {
        const allBlocks = [...tmpl.morningBlocks, ...tmpl.afternoonBlocks];
        const blocks = allBlocks.map(b => ({
            blockId: b.id,
            tasks: b.tasks.map((_, ti) => ({
                taskIndex: ti,
                checkedByEmployee: i < 5 ? true : (i === 5 ? ti < 2 : false),
                checkedAt: i < 5 ? '2026-04-20T08:00:00Z' : null,
            })),
        }));

        let status = 'pending';
        if (i < 4) status = 'confirmed';
        else if (i === 4) status = 'completed';

        const startDate = new Date('2026-04-21');
        const planned = addWorkDays(new Date(startDate), i);

        return {
            ...tmpl,
            plannedDate: planned.toISOString().split('T')[0],
            actualDate: i < 5 ? planned.toISOString().split('T')[0] : null,
            status,
            blocks,
            employeeNote: i === 4 ? 'Sklad Chrast byl super, hodně jsem se naučil o logistice.' : '',
            supervisorNote: i === 3 ? 'Výborně zvládnuto, aktivní přístup.' : '',
            confirmedBy: i < 4 ? 'demo-supervisor' : null,
            confirmedAt: i < 4 ? '2026-04-22T14:00:00Z' : null,
        };
    });

    return {
        id: 'demo-adaptation-1',
        employeeId: 'demo-employee',
        employeeName: 'Jana Nováčková',
        studioKey: 'praha',
        supervisorId: 'demo-supervisor',
        templateId: 'demo-template',
        startDate: { toDate: () => new Date('2026-04-21') },
        status: 'active',
        days,
        currentDayIndex: 5,
    };
}

// Mock seznam nováčků pro pohled vedoucího
export function buildDemoAdaptations() {
    const base = buildDemoAdaptation();
    const second = {
        ...base,
        id: 'demo-adaptation-2',
        employeeId: 'demo-employee-2',
        employeeName: 'Tomáš Začátečník',
        startDate: { toDate: () => new Date('2026-04-14') },
        currentDayIndex: 10,
        days: base.days.map((d, i) => ({
            ...d,
            status: i < 9 ? 'confirmed' : (i === 9 ? 'completed' : 'pending'),
            employeeNote: i === 9 ? 'Výjezd na realizaci v Holešovicích, vše OK.' : d.employeeNote,
            supervisorNote: i < 9 ? 'OK' : '',
        })),
    };
    return [base, second, buildDemoWeeklyAdaptation()];
}

const DEMO_WEEKLY_ROLES = {
    manager:          { uid: 'demo-manager',          name: 'Barča S' },
    managerDeputy:    { uid: 'demo-manager-deputy',   name: 'Matouš' },
    seniorSpecialist: { uid: 'demo-manager',          name: 'Barča S' },
    buddy:             { uid: 'demo-buddy',           name: 'Naty' },
};

// Mock adaptace pro šablonu "Projektový specialista/designér — 90 dní"
export function buildDemoWeeklyAdaptation() {
    const startDate = new Date('2026-05-04');
    const { phases, ongoingCategories } = buildWeeklyProgress(PROJECT_SPECIALIST_TEMPLATE, startDate);

    // Týden 1 hotový a potvrzený, týden 2 rozpracovaný (první 2 cíle čekají na potvrzení)
    phases[0].weeks[0].goals = phases[0].weeks[0].goals.map((goal, i) => ({
        ...goal,
        status: 'confirmed',
        checkedAt: '2026-05-08T16:00:00Z',
        employeeNote: i === 0 ? 'Bylo to super, hodně mi to dalo.' : '',
        confirmedBy: goal.confirmerRole ? DEMO_WEEKLY_ROLES[goal.confirmerRole].uid : 'demo-manager',
        confirmedAt: '2026-05-11T09:00:00Z',
        supervisorNote: i === 0 ? 'Souhlasím, výborný start.' : '',
    }));
    phases[0].weeks[1].goals = phases[0].weeks[1].goals.map((goal, i) => ({
        ...goal,
        status: i < 2 ? 'completed' : 'pending',
        checkedAt: i < 2 ? '2026-05-13T15:00:00Z' : null,
        employeeNote: i === 0 ? 'Ještě si nejsem úplně jistá, budu potřebovat doučit.' : '',
    }));

    // Pár průběžných kvótových cílů rozpracovaných
    ongoingCategories[0].goals = ongoingCategories[0].goals.map((goal, i) => {
        if (i !== 0) return goal;
        return { ...goal, currentCount: 3 };
    });
    ongoingCategories[1].goals = ongoingCategories[1].goals.map((goal, i) => {
        if (i !== 0) return goal;
        return { ...goal, currentCount: 8 };
    });

    return {
        id: 'demo-adaptation-3',
        employeeId: 'demo-employee-3',
        employeeName: 'Petra Nováková',
        studioKey: 'praha',
        templateType: 'weekly',
        templateId: 'demo-template-weekly',
        supervisorId: DEMO_WEEKLY_ROLES.manager.uid,
        roles: DEMO_WEEKLY_ROLES,
        startDate: { toDate: () => startDate },
        status: 'active',
        currentWeekIndex: 1,
        phases,
        ongoingCategories,
    };
}

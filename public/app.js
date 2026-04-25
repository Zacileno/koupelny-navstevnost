// === FUNNEL LOGIKA — KASKÁDOVÉ ZAŠKRTÁVÁNÍ ===
// Pořadí kroků funnelu (od nejnižšího po nejvyšší)
const funnelSteps = [
    'actKonzultace',
    'actDomluvenaSch',
    'actSchuzkaNavrh',
    'actCenovaNabidka',
    'actObjednavka',
];

function initFunnelLogic() {
    funnelSteps.forEach(function(stepId) {
        document.getElementById(stepId).addEventListener('change', function() {
            const clickedIndex = funnelSteps.indexOf(stepId);
            if (this.checked) {
                for (let i = 0; i <= clickedIndex; i++) {
                    document.getElementById(funnelSteps[i]).checked = true;
                }
            } else {
                for (let i = clickedIndex; i < funnelSteps.length; i++) {
                    document.getElementById(funnelSteps[i]).checked = false;
                }
            }
        });
    });
}

// === GLOBÁLNÍ PROMĚNNÉ ===
let todayVisitors = [];

// === URL PARAMETRY ===
// Předvyplní formulář přes odkaz, např.:
// index.html?studio=praha&user=barbora-lojkaskova
function applyUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const studioParam = params.get('studio');
    const userParam = params.get('user');

    if (studioParam) {
        const studioSelect = document.getElementById('studio');
        studioSelect.value = studioParam;
        studioSelect.dispatchEvent(new Event('change'));
    }

    if (userParam) {
        // Select obchodníků se teprve načítá z Firebase — uložíme si hodnotu
        window._pendingUserParam = userParam;
    }
}

// === NAČTENÍ OBCHODNÍKŮ Z FIRESTORE ===
async function loadUsers() {
    try {
        const { collection, query, where, getDocs, orderBy } = window.firestoreModules;

        const q = query(
            collection(window.db, 'users'),
            where('active', '==', true),
            orderBy('name', 'asc')
        );

        const snapshot = await getDocs(q);
        const userSelect = document.getElementById('user');

        userSelect.innerHTML = '<option value="">Vyber obchodníka...</option>';

        snapshot.forEach(doc => {
            const data = doc.data();
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = data.name;
            userSelect.appendChild(option);
        });

        // Pokud byl v URL parametr pro uživatele, předvyplň ho teď
        if (window._pendingUserParam) {
            userSelect.value = window._pendingUserParam;
            window._pendingUserParam = null;
        }

        console.log(`✅ Načteno ${snapshot.size} obchodníků`);

    } catch (error) {
        console.error('❌ Chyba při načítání obchodníků:', error);
        document.getElementById('user').innerHTML = '<option value="">Chyba načítání</option>';
    }
}

// === INICIALIZACE ===
document.addEventListener('DOMContentLoaded', function() {
    const dateInput = document.getElementById('date');
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;

    console.log('✅ Aplikace načtena!');
    initFunnelLogic();
    loadTodayRecords();
});

// Počkáme až bude Firebase ready, pak načteme uživatele a URL parametry
const waitForFirebase = setInterval(() => {
    if (window.db && window.firestoreModules) {
        clearInterval(waitForFirebase);
        loadUsers();
        applyUrlParams();
    }
}, 100);


// === FORMULÁŘ - JEDNOTLIVĚ ===
document.getElementById('individualFormElement').addEventListener('submit', async function(e) {
    e.preventDefault();

    const studio = document.getElementById('studio').value;
    const user = document.getElementById('user').value;
    const date = document.getElementById('date').value;

    if (!studio || !user) {
        alert('⚠️ Vyber studio a obchodníka!');
        return;
    }

    const visitorType = document.querySelector('input[name="visitorType"]:checked');
    if (!visitorType) {
        alert('⚠️ Vyber typ návštěvníka (Nový / Opakovaný)!');
        return;
    }

    const userSelect = document.getElementById('user');
    const userName = userSelect.options[userSelect.selectedIndex].text;

    const visitor = {
        mode: 'individual',
        studio: studio,
        user: user,
        userName: userName,
        date: date,
        timestamp: new Date().toISOString(),
        source: document.getElementById('source').value,
        isNew: visitorType.value === 'new',
        activities: {
            konzultace: document.getElementById('actKonzultace').checked,
            domluvenaSch: document.getElementById('actDomluvenaSch').checked,
            schuzkaNavrh: document.getElementById('actSchuzkaNavrh').checked,
            cenovaNabidka: document.getElementById('actCenovaNabidka').checked,
            objednavka: document.getElementById('actObjednavka').checked,
        },
        wantsDelivery: document.getElementById('wantsDelivery').checked,
        wantsRealization: document.getElementById('wantsRealization').checked,
    };

    console.log('📝 Ukládám návštěvníka:', visitor);

    try {
        const { collection, addDoc } = window.firestoreModules;
        await addDoc(collection(window.db, 'entries'), visitor);

        alert('✅ Návštěvník uložen!');

        // Reset formuláře — zachovej studio a obchodníka pro rychlé zadávání
        document.getElementById('individualFormElement').reset();
        document.getElementById('studio').value = studio;
        document.getElementById('user').value = user;

        todayVisitors.push(visitor);
        updateVisitorCount();
        loadTodayRecords();

    } catch (error) {
        console.error('❌ Chyba při ukládání:', error);
        alert('❌ Chyba při ukládání: ' + error.message);
    }
});


// === NAČTENÍ DNEŠNÍCH ZÁZNAMŮ ===
async function loadTodayRecords() {
    const today = document.getElementById('date').value;
    const studio = document.getElementById('studio').value;

    if (!studio) {
        document.getElementById('recordsList').innerHTML = '<p class="empty-state">Vyber studio pro zobrazení záznamů</p>';
        return;
    }

    try {
        const { collection, query, where, getDocs, orderBy } = window.firestoreModules;
        const q = query(
            collection(window.db, 'entries'),
            where('date', '==', today),
            where('studio', '==', studio),
            orderBy('timestamp', 'desc')
        );

        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            document.getElementById('recordsList').innerHTML = '<p class="empty-state">Zatím žádné záznamy pro dnes</p>';
            return;
        }

        let html = '';
        let totalVisitors = 0;

        querySnapshot.forEach((doc) => {
            const data = doc.data();

            if (data.mode === 'individual') {
                totalVisitors++;

                const activityLabels = {
                    konzultace: 'Konzultace',
                    domluvenaSch: 'Doml. schůzka',
                    schuzkaNavrh: 'Schůzka/návrh',
                    cenovaNabidka: 'Cenová nabídka',
                    objednavka: 'Objednávka',
                };

                const activeActivities = data.activities
                    ? Object.entries(data.activities)
                        .filter(([, val]) => val)
                        .map(([key]) => activityLabels[key] || key)
                        .join(', ')
                    : '—';

                const displayName = data.userName || data.user || '—';

                html += `
                    <div class="record-item">
                        <strong>${data.source || '—'}</strong> –
                        ${data.isNew ? '🆕 Nový' : '🔁 Opakovaný'}
                        ${activeActivities ? `· <em>${activeActivities}</em>` : ''}
                        <small>(${displayName}, ${new Date(data.timestamp).toLocaleTimeString('cs-CZ')})</small>
                    </div>
                `;
            }
        });

        html = `<p><strong>Celkem dnes: ${totalVisitors} návštěvníků</strong></p>` + html;
        document.getElementById('recordsList').innerHTML = html;

    } catch (error) {
        console.error('❌ Chyba při načítání:', error);
        document.getElementById('recordsList').innerHTML = '<p class="empty-state">Chyba při načítání záznamů</p>';
    }
}

// === AKTUALIZACE POČÍTADLA ===
function updateVisitorCount() {
    document.getElementById('visitorCount').textContent = todayVisitors.length;
}

// === WATCH PRO ZMĚNU STUDIA/DATA ===
document.getElementById('studio').addEventListener('change', loadTodayRecords);
document.getElementById('date').addEventListener('change', loadTodayRecords);

console.log('🚀 App.js načten!');

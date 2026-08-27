// ============================================================
//  CEO DASHBOARD — Koupelny Syrový
//  Měsíční pohled + YoY porovnání
// ============================================================

// === KONFIGURACE ===
const STUDIO_NAMES = {
    'praha':     'Praha',
    'brno':      'Brno',
    'hradec':    'Hradec Králové',
    'pardubice': 'Pardubice'
};

const CHART_COLORS = {
    blue:   '#179ED9',
    blue2:  '#0FBCBD',
    gold:   '#C5A66B',
    gold2:  '#B1B15D',
    green:  '#34d399',
    red:    '#f87171',
    muted:  'rgba(255,255,255,0.06)'
};

// Globální stav
let currentYear  = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-11
let currentStudio = 'all';
let viewMode = 'month';        // 'month' | 'custom'
let compareMode = 'full';      // 'full' | 'todate' — jen pro viewMode 'month'
let customDateFrom = '';
let customDateTo = '';
let allData = {};       // sloučená data aktuálního měsíce
let allDataPrev = {};   // sloučená data stejného měsíce loni
let entriesRaw = [];    // raw entries aktuálního měsíce (pro funnel/zdroje)
let charts = {};

// ============================================================
//  INICIALIZACE
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Datum v headeru
    document.getElementById('headerDate').textContent =
        new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    // Záložky — každá záložka ovládá jen svůj panel
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const panel = this.closest('.panel');
            panel.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            panel.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            panel.querySelector('#tab-' + this.dataset.tab).classList.add('active');
        });
    });

    // Měsíc navigace
    document.getElementById('prevMonth').addEventListener('click', () => {
        currentMonth--;
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        loadData();
    });
    document.getElementById('nextMonth').addEventListener('click', () => {
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        loadData();
    });

    // Studio filtr
    document.getElementById('studioFilter').addEventListener('change', e => {
        currentStudio = e.target.value;
        loadData();
    });
    document.getElementById('refreshBtn').addEventListener('click', loadData);

    // Funnel filtry
    document.getElementById('funnelStudio').addEventListener('change', updateFunnel);
    document.getElementById('funnelUser').addEventListener('change', updateFunnel);

    // Přepínač režimu období
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.view-mode-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            viewMode = this.dataset.mode;
            document.getElementById('monthNavWrap').style.display = viewMode === 'month' ? 'flex' : 'none';
            document.getElementById('customRangeWrap').style.display = viewMode === 'custom' ? 'flex' : 'none';
            document.getElementById('yoyBadge').style.display = viewMode === 'month' ? 'flex' : 'none';
            document.getElementById('compareModeWrap').style.display = viewMode === 'month' ? 'flex' : 'none';
            if (viewMode === 'month') loadData();
        });
    });

    // Přepínač celý měsíc / do dnešního dne
    document.querySelectorAll('.compare-mode-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.compare-mode-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            compareMode = this.dataset.compare;
            if (viewMode === 'month') loadData();
        });
    });

    // Custom datum range
    document.getElementById('customFrom').addEventListener('change', applyCustomRange);
    document.getElementById('customTo').addEventListener('change', applyCustomRange);
});

function applyCustomRange() {
    customDateFrom = document.getElementById('customFrom').value;
    customDateTo   = document.getElementById('customTo').value;
    if (customDateFrom && customDateTo && customDateFrom <= customDateTo) loadData();
}

// Počkáme na Firebase
const waitForFirebase = setInterval(() => {
    if (window.db && window.firestoreModules) {
        clearInterval(waitForFirebase);
        loadUsers();
        loadData();
    }
}, 100);


// ============================================================
//  HELPER: datum range pro měsíc
// ============================================================
function getMonthRange(year, month) {
    const from = new Date(year, month, 1);
    const to   = new Date(year, month + 1, 0); // poslední den měsíce
    return {
        from: from.toISOString().split('T')[0],
        to:   to.toISOString().split('T')[0]
    };
}

function formatMonthLabel(year, month) {
    return new Date(year, month, 1).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' });
}

function toDateStr(year, month, day) {
    // Stavíme string přímo z lokálních y/m/d — na rozdíl od toISOString() (UTC)
    // se v časových pásmech za UTC (např. US) neposune o den zpět.
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Poslední použité rozsahy — pro popisky v YoY grafu/badge
let lastRangeInfo = { currTo: '', prevTo: '', isTodate: false };


// ============================================================
//  NAČTENÍ OBCHODNÍKŮ
// ============================================================
async function loadUsers() {
    try {
        const { collection, query, where, getDocs, orderBy } = window.firestoreModules;
        const q = query(collection(window.db, 'users'), where('active', '==', true), orderBy('name', 'asc'));
        const snap = await getDocs(q);
        const sel = document.getElementById('funnelUser');
        snap.forEach(doc => {
            const o = document.createElement('option');
            o.value = doc.id;
            o.textContent = doc.data().name;
            sel.appendChild(o);
        });
    } catch (e) { console.error('Chyba obchodníci:', e); }
}


// ============================================================
//  NAČTENÍ DAT (aktuální měsíc + stejný měsíc loni)
// ============================================================
async function loadData() {
    showLoading(true);

    try {
        let dateFrom, dateTo, prevFrom, prevTo;

        if (viewMode === 'custom') {
            dateFrom = customDateFrom;
            dateTo   = customDateTo;
            // Pro custom mode YoY není k dispozici — použijeme stejné období
            prevFrom = dateFrom;
            prevTo   = dateTo;
        } else {
            const range     = getMonthRange(currentYear, currentMonth);
            const rangePrev = getMonthRange(currentYear - 1, currentMonth);
            dateFrom = range.from;
            dateTo   = range.to;
            prevFrom = rangePrev.from;
            prevTo   = rangePrev.to;

            // "Do dnešního dne" — ořízne obě období na stejný počet dní od 1. v měsíci,
            // ať se rozjetý měsíc neporovnává nespravedlivě s celým loňským měsícem.
            // U měsíce, který už skončil, nemá co ořezávat — chová se jako "Celý měsíc".
            const today = new Date();
            const isCurrentMonth = currentYear === today.getFullYear() && currentMonth === today.getMonth();
            if (compareMode === 'todate' && isCurrentMonth) {
                const day = today.getDate();
                dateTo = toDateStr(currentYear, currentMonth, day);
                const prevDaysInMonth = new Date(currentYear - 1, currentMonth + 1, 0).getDate();
                prevTo = toDateStr(currentYear - 1, currentMonth, Math.min(day, prevDaysInMonth));
            }
            lastRangeInfo = { currTo: dateTo, prevTo, isTodate: compareMode === 'todate' && isCurrentMonth };
        }

        updateMonthDisplay();

        const fetchPrev = viewMode === 'month';
        const [curr, prev] = await Promise.all([
            fetchMonthData(dateFrom, dateTo, currentStudio),
            fetchPrev ? fetchMonthData(prevFrom, prevTo, currentStudio) : Promise.resolve({ merged: {}, entries: [] })
        ]);

        allData     = curr.merged;
        entriesRaw  = curr.entries;
        allDataPrev = prev.merged;

        updateKPIs();
        updateLineChart();
        if (viewMode === 'month') updateYoYChart(curr, prev);
        updateBarChart();
        updatePieChart();
        updateFunnel();
        updateTable();
        updateStudiaDetail();

    } catch (err) {
        console.error('❌ Chyba načítání:', err);
        showError(err.message);
    } finally {
        showLoading(false);
    }
}


// ============================================================
//  FETCH DAT PRO JEDNO OBDOBÍ
// ============================================================
async function fetchMonthData(dateFrom, dateTo, studio) {
    const { collection, query, where, getDocs, orderBy } = window.firestoreModules;

    // Entries
    let eQuery;
    if (studio === 'all') {
        eQuery = query(collection(window.db, 'entries'),
            where('date', '>=', dateFrom), where('date', '<=', dateTo),
            orderBy('date', 'asc'));
    } else {
        eQuery = query(collection(window.db, 'entries'),
            where('date', '>=', dateFrom), where('date', '<=', dateTo),
            where('studio', '==', studio),
            orderBy('date', 'asc'));
    }
    const eSnap = await getDocs(eQuery);
    const entries = [];
    eSnap.forEach(doc => entries.push({ id: doc.id, ...doc.data() }));

    // Summaries
    let sQuery;
    if (studio === 'all') {
        sQuery = query(collection(window.db, 'daily_summaries'),
            where('date', '>=', dateFrom), where('date', '<=', dateTo),
            orderBy('date', 'asc'));
    } else {
        sQuery = query(collection(window.db, 'daily_summaries'),
            where('date', '>=', dateFrom), where('date', '<=', dateTo),
            where('studio', '==', studio),
            orderBy('date', 'asc'));
    }
    const sSnap = await getDocs(sQuery);
    const summaries = [];
    sSnap.forEach(doc => summaries.push({ id: doc.id, ...doc.data() }));

    const merged = mergeCollections(entries, summaries);
    return { entries, summaries, merged };
}


// ============================================================
//  SLOUČENÍ KOLEKCÍ
// ============================================================
function mergeCollections(entries, summaries) {
    const merged = {};
    summaries.forEach(doc => {
        const key = `${doc.studio}_${doc.date}`;
        merged[key] = { studio: doc.studio, date: doc.date,
            total: doc.celkem || 0, novi: doc.novi || 0, opak: 0, source: 'historical' };
    });
    const groups = {};
    entries.forEach(e => {
        if (!e.date || !e.studio || e.mode !== 'individual') return;
        const key = `${e.studio}_${e.date}`;
        if (!groups[key]) groups[key] = { studio: e.studio, date: e.date, total: 0, novi: 0, opak: 0, source: 'new' };
        groups[key].total++;
        if (e.isNew) groups[key].novi++; else groups[key].opak++;
    });
    Object.keys(groups).forEach(key => {
        if (merged[key]) {
            merged[key].total += groups[key].total;
            merged[key].novi  += groups[key].novi;
            merged[key].opak  += groups[key].opak;
        } else {
            merged[key] = groups[key];
        }
    });
    return merged;
}


// ============================================================
//  ZOBRAZENÍ MĚSÍCE V NAVIGACI
// ============================================================
function updateMonthDisplay() {
    document.getElementById('monthCurrent').textContent =
        formatMonthLabel(currentYear, currentMonth);
    document.getElementById('lineChartBadge').textContent =
        formatMonthLabel(currentYear, currentMonth);

    const badge = document.getElementById('yoyBadge');
    if (viewMode === 'month' && lastRangeInfo.isTodate) {
        const day = parseInt(lastRangeInfo.currTo.split('-')[2], 10);
        badge.textContent = `↕ Poměrové srovnání: 1.–${day}. den vs. loni 1.–${day}.`;
    } else {
        badge.textContent = '↕ Porovnání se stejným měsícem loni';
    }

    // "Do dnešního dne" má smysl jen u aktuálního (rozjetého) měsíce — starší měsíce jsou už kompletní
    const today = new Date();
    const isCurrentMonth = currentYear === today.getFullYear() && currentMonth === today.getMonth();
    const todateBtn = document.querySelector('.compare-mode-btn[data-compare="todate"]');
    if (todateBtn) {
        todateBtn.disabled = !isCurrentMonth;
        todateBtn.title = isCurrentMonth
            ? 'Porovná jen dny od začátku měsíce do dneška — u rozjetého měsíce spravedlivější než celý měsíc'
            : 'Dostupné jen pro aktuální rozjetý měsíc — starší měsíce jsou už kompletní';
    }
}


// ============================================================
//  KPI KARTY + YoY porovnání
// ============================================================
function updateKPIs() {
    // Aktuální měsíc
    let total = 0, novi = 0, opak = 0, obj = 0;
    Object.values(allData).forEach(d => {
        total += d.total || 0;
        novi  += d.novi  || 0;
        opak  += d.opak  || 0;
    });
    entriesRaw.forEach(e => {
        if (e.mode === 'individual' && e.activities?.objednavka) obj++;
    });

    // Loňský měsíc
    let totalP = 0, noviP = 0, opakP = 0;
    Object.values(allDataPrev).forEach(d => {
        totalP += d.total || 0;
        noviP  += d.novi  || 0;
        opakP  += d.opak  || 0;
    });

    document.getElementById('kpiTotal').textContent = total.toLocaleString('cs-CZ');
    document.getElementById('kpiNovi').textContent  = novi.toLocaleString('cs-CZ');
    document.getElementById('kpiOpak').textContent  = opak.toLocaleString('cs-CZ');
    document.getElementById('kpiObj').textContent   = obj.toLocaleString('cs-CZ');

    setCompare('kpiTotalCmp', total, totalP);
    setCompare('kpiNoviCmp',  novi,  noviP);
    setCompare('kpiOpakCmp',  opak,  opakP);
    // Objednávky — nemáme historická data, zobrazíme jen počet
    const objEl = document.getElementById('kpiObjCmp');
    objEl.textContent = 'jen nová data (formulář)';
    objEl.className = 'kpi-compare';
}

function setCompare(elId, curr, prev) {
    const el = document.getElementById(elId);
    if (prev === 0) {
        el.textContent = 'loni: žádná data';
        el.className = 'kpi-compare';
        return;
    }
    const diff = curr - prev;
    const pct  = ((diff / prev) * 100).toFixed(0);
    const sign = diff >= 0 ? '+' : '';
    el.textContent = `vs. loni: ${sign}${diff} (${sign}${pct} %)`;
    el.className = 'kpi-compare ' + (diff >= 0 ? 'up' : 'down');
}


// ============================================================
//  ČÁROVÝ GRAF — dny v měsíci
// ============================================================
function updateLineChart() {
    const ctx = document.getElementById('lineChart');
    if (charts.line) charts.line.destroy();

    // Sestavíme všechny dny v měsíci
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const labels = [];
    const dataTotal = [], dataNoví = [];

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        labels.push(d);
        let dayTotal = 0, dayNovi = 0;
        Object.values(allData).forEach(row => {
            if (row.date === dateStr) { dayTotal += row.total; dayNovi += row.novi || 0; }
        });
        dataTotal.push(dayTotal);
        dataNoví.push(dayNovi);
    }

    charts.line = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Celkem',
                    data: dataTotal,
                    borderColor: CHART_COLORS.blue,
                    backgroundColor: 'rgba(23,158,217,0.08)',
                    tension: 0.4, fill: true, pointRadius: 3,
                    pointBackgroundColor: CHART_COLORS.blue
                },
                {
                    label: 'Noví',
                    data: dataNoví,
                    borderColor: CHART_COLORS.gold,
                    backgroundColor: 'rgba(197,166,107,0.06)',
                    tension: 0.4, fill: true, pointRadius: 3,
                    pointBackgroundColor: CHART_COLORS.gold
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#9aa0b0', font: { family: 'Montserrat', size: 11 }, boxWidth: 12 } }
            },
            scales: {
                x: { ticks: { color: '#5a6070', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                y: { beginAtZero: true, ticks: { color: '#5a6070', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
            }
        }
    });
}


// ============================================================
//  YoY GRAF — aktuální vs. loňský měsíc (bar)
// ============================================================
function updateYoYChart(curr, prev) {
    const ctx = document.getElementById('yoyChart');
    if (charts.yoy) charts.yoy.destroy();

    const currTotal = Object.values(curr.merged).reduce((s, d) => s + (d.total || 0), 0);
    const prevTotal = Object.values(prev.merged).reduce((s, d) => s + (d.total || 0), 0);
    const currNovi  = Object.values(curr.merged).reduce((s, d) => s + (d.novi  || 0), 0);
    const prevNovi  = Object.values(prev.merged).reduce((s, d) => s + (d.novi  || 0), 0);

    let currLabel = formatMonthLabel(currentYear, currentMonth);
    let prevLabel = formatMonthLabel(currentYear - 1, currentMonth);
    if (lastRangeInfo.isTodate) {
        const day = parseInt(lastRangeInfo.currTo.split('-')[2], 10);
        const prevDay = parseInt(lastRangeInfo.prevTo.split('-')[2], 10);
        currLabel += ` (1.–${day}.)`;
        prevLabel += ` (1.–${prevDay}.)`;
    }

    charts.yoy = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Celkem', 'Noví'],
            datasets: [
                {
                    label: prevLabel,
                    data: [prevTotal, prevNovi],
                    backgroundColor: 'rgba(197,166,107,0.4)',
                    borderColor: CHART_COLORS.gold,
                    borderWidth: 1,
                    borderRadius: 5
                },
                {
                    label: currLabel,
                    data: [currTotal, currNovi],
                    backgroundColor: 'rgba(23,158,217,0.5)',
                    borderColor: CHART_COLORS.blue,
                    borderWidth: 1,
                    borderRadius: 5
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#9aa0b0', font: { family: 'Montserrat', size: 10 }, boxWidth: 10 } }
            },
            scales: {
                x: { ticks: { color: '#5a6070', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                y: { beginAtZero: true, ticks: { color: '#5a6070', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
            }
        }
    });

    // Delta text pod grafem
    const delta = currTotal - prevTotal;
    const pct   = prevTotal > 0 ? ((delta / prevTotal) * 100).toFixed(0) : '–';
    const sign  = delta >= 0 ? '+' : '';
    const color = delta >= 0 ? '#34d399' : '#f87171';
    document.getElementById('yoyDelta').innerHTML =
        `Celkem: <strong style="color:${color}">${sign}${delta}</strong> (${sign}${pct} %)<br>
        <span style="color:#5a6070;font-size:11px;">${prevLabel}: ${prevTotal} → ${currLabel}: ${currTotal}</span>`;
}


// ============================================================
//  BAR CHART — studia
// ============================================================
function updateBarChart() {
    const ctx = document.getElementById('barChart');
    if (charts.bar) charts.bar.destroy();

    const totals = { 'praha': 0, 'brno': 0, 'hradec': 0, 'pardubice': 0 };
    Object.values(allData).forEach(d => {
        if (totals[d.studio] !== undefined) totals[d.studio] += d.total;
    });

    charts.bar = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(totals).map(s => STUDIO_NAMES[s]),
            datasets: [{
                label: 'Návštěvníci',
                data: Object.values(totals),
                backgroundColor: [
                    'rgba(23,158,217,0.7)',
                    'rgba(15,188,189,0.7)',
                    'rgba(197,166,107,0.7)',
                    'rgba(177,177,93,0.7)'
                ],
                borderRadius: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#9aa0b0', font: { size: 11 } }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: '#5a6070', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
            }
        }
    });
}


// ============================================================
//  PIE CHART — zdroje
// ============================================================
function updatePieChart() {
    const ctx = document.getElementById('pieChart');
    if (charts.pie) charts.pie.destroy();

    const sourceTotals = {
        instagram: 0, web: 0, facebook: 0, doporuceni: 0, walkin: 0,
        'influencer-mammadomisha': 0, 'influencer-partlova': 0, 'influencer-hustle': 0, jine: 0
    };
    const sourceNames = {
        instagram: 'Instagram', web: 'Web', facebook: 'Facebook',
        doporuceni: 'Doporučení', walkin: 'Walk-in',
        'influencer-mammadomisha': 'Mammadomisha',
        'influencer-partlova': 'Partlova',
        'influencer-hustle': 'Hustle & Chill',
        jine: 'Jiné'
    };

    entriesRaw.forEach(e => {
        if (sourceTotals[e.source] !== undefined) sourceTotals[e.source]++;
        else if (e.source) sourceTotals['jine']++;
    });

    const hasData = Object.values(sourceTotals).some(v => v > 0);
    const keys    = hasData ? Object.keys(sourceTotals).filter(k => sourceTotals[k] > 0) : ['jine'];

    charts.pie = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: hasData ? keys.map(k => sourceNames[k]) : ['Žádná data'],
            datasets: [{
                data: hasData ? keys.map(k => sourceTotals[k]) : [1],
                backgroundColor: hasData
                    ? ['#179ED9','#0FBCBD','#8FA378','#C5A66B','#B1B15D','#A08660','#34d399','#f59e0b','#5a6070']
                    : ['#252a38'],
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: '#9aa0b0', font: { family: 'Montserrat', size: 10 }, boxWidth: 10, padding: 8 }
                }
            }
        }
    });
}


// ============================================================
//  FUNNEL
// ============================================================
function updateFunnel() {
    const studio = document.getElementById('funnelStudio').value;
    const user   = document.getElementById('funnelUser').value;

    const filtered = entriesRaw.filter(e => {
        if (e.mode !== 'individual') return false;
        if (studio !== 'all' && e.studio !== studio) return false;
        if (user   !== 'all' && e.user   !== user)   return false;
        return true;
    });

    const total = filtered.length;
    const counts = { konzultace: 0, domluvenaSch: 0, schuzkaNavrh: 0, cenovaNabidka: 0, objednavka: 0 };
    filtered.forEach(e => {
        if (e.activities) {
            // Nový formát
            if (e.activities.konzultace)    counts.konzultace++;
            if (e.activities.domluvenaSch)  counts.domluvenaSch++;
            if (e.activities.schuzkaNavrh)  counts.schuzkaNavrh++;
            if (e.activities.cenovaNabidka) counts.cenovaNabidka++;
            if (e.activities.objednavka)    counts.objednavka++;
        } else {
            // Starý formát — mapujeme jen dostupná pole
            if (e.consultation) counts.konzultace++;
            if (e.design3d)     counts.schuzkaNavrh++;
        }
    });

    const steps = [
        { key: 'konzultace',    label: 'Konzultace' },
        { key: 'domluvenaSch',  label: 'Doml. schůzka' },
        { key: 'schuzkaNavrh',  label: 'Schůzka / návrh' },
        { key: 'cenovaNabidka', label: 'Cenová nabídka' },
        { key: 'objednavka',    label: 'Objednávka' },
    ];

    const container = document.getElementById('funnelBars');

    if (total === 0) {
        container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px 0;font-size:13px;">Žádná data pro zvolené filtry</p>';
        return;
    }

    // Celkový řádek
    let html = `
        <div class="funnel-row">
            <div class="funnel-label" style="font-weight:700;color:var(--brand-blue);">Celkem návštěvníků</div>
            <div class="funnel-bar-wrap"><div class="funnel-bar-fill" style="width:100%;background:var(--brand-blue);opacity:0.3;"></div></div>
            <div class="funnel-count" style="color:var(--brand-blue);">${total}</div>
            <div class="funnel-pct">100 %</div>
        </div>`;

    steps.forEach(({ key, label }) => {
        const count = counts[key];
        const pct   = total > 0 ? ((count / total) * 100).toFixed(0) : 0;
        const width = total > 0 ? (count / total) * 100 : 0;
        html += `
            <div class="funnel-row">
                <div class="funnel-label">↳ ${label}</div>
                <div class="funnel-bar-wrap">
                    <div class="funnel-bar-fill" style="width:${width}%;"></div>
                </div>
                <div class="funnel-count">${count}</div>
                <div class="funnel-pct">${pct} %</div>
            </div>`;
    });

    container.innerHTML = html;
}


// ============================================================
//  TABULKA
// ============================================================
function updateTable() {
    const tbody = document.getElementById('tableBody');
    const sorted = Object.values(allData).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);

    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--muted);">Žádná data pro zvolený měsíc</td></tr>';
        return;
    }

    tbody.innerHTML = sorted.map(day => {
        const [y, m, d] = day.date.split('-');
        const srcIcon = day.source === 'historical' ? '📁' : '✏️';
        const canEdit = day.source !== 'historical';
        const editBtn = canEdit
            ? `<button class="btn-row-detail" onclick="openDetail('${day.studio}','${day.date}')">🔍 Detail</button>`
            : `<span title="Historická data — editace není dostupná">📁</span>`;
        return `<tr>
            <td>${d}.${m}.${y}</td>
            <td><strong>${STUDIO_NAMES[day.studio] || day.studio}</strong></td>
            <td>${day.total}</td>
            <td>${day.novi  || 0}</td>
            <td>${day.opak  || 0}</td>
            <td>${editBtn}</td>
        </tr>`;
    }).join('');
}


// ============================================================
//  DETAIL ŘÁDKU — modal se záznamy dne
// ============================================================
async function openDetail(studio, date) {
    const modal = document.getElementById('detailModal');
    const content = document.getElementById('detailContent');
    const title = document.getElementById('detailTitle');

    const [y, m, d] = date.split('-');
    title.textContent = `${d}.${m}.${y} — ${STUDIO_NAMES[studio] || studio}`;
    content.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px;">Načítám záznamy…</p>';
    modal.classList.add('active');

    try {
        const { collection, query, where, getDocs, orderBy } = window.firestoreModules;
        const q = query(
            collection(window.db, 'entries'),
            where('date', '==', date),
            where('studio', '==', studio),
            orderBy('timestamp', 'asc')
        );
        const snap = await getDocs(q);
        const entries = [];
        snap.forEach(doc => entries.push({ id: doc.id, ...doc.data() }));

        if (entries.length === 0) {
            content.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px;">Žádné záznamy pro tento den.</p>';
            return;
        }

        const sourceNames = {
            instagram: 'Instagram', web: 'Web', facebook: 'Facebook',
            doporuceni: 'Doporučení', walkin: 'Walk-in',
            'influencer-mammadomisha': 'Mammadomisha',
            'influencer-partlova': 'Partlova',
            'influencer-hustle': 'Hustle & Chill',
            jine: 'Jiné'
        };

        content.innerHTML = entries.map(e => {
            const cas = e.timestamp ? new Date(e.timestamp).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '–';
            const src = sourceNames[e.source] || e.source || '–';
            const typ = e.isNew ? '🆕 Nový' : '🔁 Opakovaný';
            const jmeno = e.userName || e.user || '–';

            return `<div class="detail-row" id="row-${e.id}">
                <div class="detail-row-info">
                    <span class="detail-time">${cas}</span>
                    <span class="detail-name">${jmeno}</span>
                    <span class="detail-type">${typ}</span>
                    <span class="detail-source">${src}</span>
                </div>
                <div class="detail-row-actions">
                    <button class="btn-edit" onclick="editEntry('${e.id}', '${e.source}', ${e.isNew}, '${e.date}')">✏️ Upravit</button>
                    <button class="btn-delete" onclick="deleteEntry('${e.id}')">🗑 Smazat</button>
                </div>
            </div>`;
        }).join('');

    } catch (err) {
        content.innerHTML = `<p style="color:var(--danger);padding:16px;">❌ Chyba: ${err.message}</p>`;
    }
}

function closeDetail() {
    document.getElementById('detailModal').classList.remove('active');
    document.getElementById('editForm').classList.add('hidden');
}


// ============================================================
//  SMAZÁNÍ ZÁZNAMU
// ============================================================
async function deleteEntry(id) {
    if (!confirm('Opravdu smazat tento záznam? Akce je nevratná.')) return;

    try {
        const { deleteDoc, doc } = window.firestoreModules;
        await deleteDoc(doc(window.db, 'entries', id));

        // Odstraníme řádek z UI
        const row = document.getElementById('row-' + id);
        if (row) row.remove();

        // Pokud nezbyly záznamy, zobrazíme hlášku
        const content = document.getElementById('detailContent');
        if (!content.querySelector('.detail-row')) {
            content.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px;">Všechny záznamy byly smazány.</p>';
        }

        // Refresh dat v pozadí
        loadData();

    } catch (err) {
        alert('❌ Chyba při mazání: ' + err.message);
    }
}


// ============================================================
//  EDITACE ZÁZNAMU
// ============================================================
function editEntry(id, source, isNew, date) {
    const form = document.getElementById('editForm');
    form.classList.remove('hidden');
    form.dataset.entryId = id;

    document.getElementById('editSource').value = source || '';
    document.getElementById('editIsNew').value = isNew ? 'true' : 'false';
    document.getElementById('editDate').value = date || '';

    // Scrollneme na formulář
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function saveEdit() {
    const form = document.getElementById('editForm');
    const id = form.dataset.entryId;
    const source = document.getElementById('editSource').value;
    const isNew = document.getElementById('editIsNew').value === 'true';

    const date = document.getElementById('editDate').value;
    try {
        const { updateDoc, doc } = window.firestoreModules;
        const updateData = { source, isNew };
        if (date) updateData.date = date;
        await updateDoc(doc(window.db, 'entries', id), updateData);

        form.classList.add('hidden');
        alert('✅ Záznam upraven.');
        closeDetail();
        loadData();

    } catch (err) {
        alert('❌ Chyba při ukládání: ' + err.message);
    }
}


// ============================================================
//  STUDIA DETAIL — grouped bar po dnech
// ============================================================
function updateStudiaDetail() {
    const ctx = document.getElementById('studiaDetailChart');
    if (!ctx) return;
    if (charts.studiaDetail) charts.studiaDetail.destroy();

    const studios = ['praha', 'brno', 'hradec', 'pardubice'];
    const colors  = ['rgba(23,158,217,0.8)', 'rgba(15,188,189,0.8)', 'rgba(197,166,107,0.8)', 'rgba(177,177,93,0.8)'];

    // Sestavíme unikátní seřazené dny
    const daysSet = new Set();
    Object.values(allData).forEach(d => daysSet.add(d.date));
    const days = Array.from(daysSet).sort();

    if (days.length === 0) {
        ctx.parentElement.innerHTML = '<p style="color:var(--muted);text-align:center;padding:32px;">Žádná data</p>';
        return;
    }

    const labels = days.map(d => {
        const [y, m, dd] = d.split('-');
        return `${dd}.${m}`;
    });

    const datasets = studios.map((s, i) => ({
        label: STUDIO_NAMES[s],
        data: days.map(day => {
            const key = `${s}_${day}`;
            return allData[key] ? allData[key].total : 0;
        }),
        backgroundColor: colors[i],
        borderRadius: 3,
        borderSkipped: false
    }));

    charts.studiaDetail = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#9aa0b0', font: { family: 'Montserrat', size: 11 }, boxWidth: 12 } }
            },
            scales: {
                x: {
                    stacked: false,
                    ticks: { color: '#5a6070', font: { size: 9 }, maxRotation: 45 },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#5a6070', font: { size: 10 } },
                    grid: { color: 'rgba(255,255,255,0.04)' }
                }
            }
        }
    });
}


// ============================================================
//  POMOCNÉ FUNKCE
// ============================================================
function showLoading(show) {
    document.getElementById('loadingOverlay').classList.toggle('active', show);
    const btn = document.getElementById('refreshBtn');
    btn.textContent = show ? '⏳' : '↻ Obnovit';
    btn.disabled = show;
}

function showError(message) {
    document.getElementById('tableBody').innerHTML =
        `<tr><td colspan="6" style="text-align:center;padding:24px;color:#f87171;">❌ Chyba: ${message}</td></tr>`;
}

console.log('🚀 Dashboard.js načten!');

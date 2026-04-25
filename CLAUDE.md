# Koupelny Syrový — Platform

## O projektu
Interní platforma pro Koupelny Syrový. Cílem do 2027/28 je kompletní vlastní systém pokrývající vztah se zákazníkem — od návštěvy showroomu po dokončenou realizaci.

**Filosofie:** Naše kompetence jsou ve vztahu se zákazníkem, ne v účetnictví. Pohoda (ERP/účetnictví) a Raynet (CRM, obchodní případy, reklamace) zůstávají outsourcovány. Platforma je nadstavba, která doplňuje to, co tyto systémy neumí.

---

## Technický stack

- **Firebase projekt:** `koupelny-navstevnost` (Blaze plán)
- **Hosting:** `koupelny-navstevnost.web.app`
- **Databáze:** Firebase Firestore
- **Storage:** Firebase Storage (fotodokumentace realizací)
- **Frontend:** Vanilla JS + CSS, Chart.js 4.4.0, Montserrat font
- **Lokální cesta:** `/Users/martinpaclik/Desktop/koupelny-navstevnost`
- **GitHub:** repozitář `koupelny-syrovy-platform` (private)
- **Struktura:** `public/` = frontend, `functions/` = Cloud Functions

### Studia a klíče
| Studio | Firestore klíč |
|--------|---------------|
| Praha | `praha` |
| Brno | `brno` |
| Hradec Králové | `hradec` |
| Pardubice | `pardubice` |

### Design systém
- Primární barva: `#179ED9` (modrá)
- Akcentní barva: `#C5A66B` (zlatá)
- Font: Montserrat
- Styl: tmavý CEO dashboard

---

## Existující moduly

### 1. Návštěvnost
- **Účel:** Evidence návštěv showroomů, funnel kroky, zdroje
- **Formulář:** `public/index.html` + `public/app.js`
- **Dashboard:** `public/dashboard.html` + `public/dashboard.js`
- **Firestore kolekce:** `visits`
- **Pomocné:** kolekce `users` (11 obchodníků, pole `active`)
- **URL parametry:** `?studio=praha&user=barbora-lojkaskova` (osobní odkazy)
- **Funkce dashboardu:** KPI s YoY, měsíční navigace, srovnání studií, funnel, zdroje

### 2. CX Zpětná vazba
- **Účel:** Telefonické dotazování zákazníků po dokončení zakázky
- **Formulář:** `public/cx.html` (zadává Terka)
- **Dashboard:** `public/cx-dashboard.html` (pro CEO)
- **Firestore kolekce:** `cx_feedback` (794 historických záznamů)
- **Klíčová data:** NPS (doporučení 1–10), spokojenost (0–10), sel by znovu, stav hovoru
- **Stavy hovoru:** Dokončeno / Nezvednutý hovor / Zavolat jindy / Již kontaktováno / Až bude hotové / Nemá zájem / Domluven termín

### 3. Realizace
- **Účel:** Kontrolní záznamy z průběhu staveb, fotodokumentace
- **Formulář:** `public/realizace/realizace.html`
- **Dashboard:** `public/realizace/realizace-dashboard.html`
- **Firestore kolekce:** `realizace`
- **Klíčová data:** klient, místo, datum/čas, typ, parta, fáze stavby, výsledek kontroly, spokojenost, kvalita, riziko, fotky
- **Storage:** fotodokumentace v Firebase Storage, HEIC konverze ✅

---

## Otevřené technické dluhy

| Priorita | Úkol | Modul |
|----------|------|-------|
| 🔴 Vysoká | Firebase Authentication (e-mail + heslo) | Všechny moduly |
| 🟡 Střední | Admin správa obchodníků (přidat, deaktivovat) | Návštěvnost |
| 🟢 Nízká | Notifikační systém (připomínky vyplňování) | Všechny moduly |

---

## Napojení na externí systémy

| Systém | Účel | Integrace |
|--------|------|-----------|
| **Pohoda** | Účetnictví, ERP, prodeje, reporting středisek | Záměrně outsourcováno, bez přímé integrace |
| **Raynet** | CRM, obchodní případy, reklamace | Záměrně outsourcováno, bez přímé integrace |

> Rozhodnutí o napojení (API, export/import) musí být vědomé a odůvodněné. Výchozí stav = bez integrace.

---

## Architekturní principy

1. **Business logika patří do Cloud Functions**, ne do frontendu
2. **Data model dokumentovat** — to je co se jednou bude migrovat
3. **Žádné vendor-specific featury hluboko v logice** — Firebase Auth OK, Firestore dotazy obalit do service vrstvy
4. **Firebase je správná volba pro tuto fázi** — nemigrovat předčasně
5. **Každé větší rozhodnutí zapsat do `docs/architektura.md`**
6. **CLAUDE.md je source of truth** — aktualizovat při každém dokončeném úkolu

---

## Vývojářské flow

### Co řešit kde

| Úkol | Nástroj |
|------|---------|
| Architektura, zadání, rozhodnutí, dokumentace | Claude chat (projekt Koupelny Syrový) |
| Psaní kódu, refaktoring, práce v souborech | Claude Code |
| Deploy, git, Firebase CLI, skripty | Warp |
| Debugování logiky v kódu | Claude Code |
| Nová feature (zadání → implementace) | Claude chat → Claude Code |

### Časté příkazy (Warp)

```bash
# Přejít do projektu
cd /Users/martinpaclik/Desktop/koupelny-navstevnost

# Deploy všeho
firebase deploy

# Deploy jen hosting
firebase deploy --only hosting

# Deploy jen functions
firebase deploy --only functions

# Deploy jen Firestore rules
firebase deploy --only firestore:rules

# Lokální emulátory
firebase emulators:start

# Reauth pokud vyprší token
firebase login --reauth

# Spustit Claude Code v projektu
claude
```

---

## Roadmapa (hrubá)

### Fáze 1 — Stabilizace (2026)
- [ ] Firebase Authentication na všech modulech
- [x] GitHub repozitář
- [x] HEIC konverze fotek
- [ ] Administrace obchodníků

### Fáze 2 — Rozšíření (2026–2027)
- [ ] Modul: Reklamace (doplněk k Raynetu)
- [ ] Modul: Zakázky — přehled a stavy
- [ ] Notifikace a připomínky
- [ ] Vlastní doména

### Fáze 3 — Platforma (2027–2028)
- [ ] Vědomá rozhodnutí o napojení na Pohodu / Raynet
- [ ] Přístupová práva podle rolí (obchodník, vedoucí, CEO)
- [ ] Případná migrace z Firebase pokud to bude dávat smysl

---

*Poslední aktualizace: duben 2026*

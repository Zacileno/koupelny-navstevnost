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
- **Login:** ✅ sdílený platformový login (`requireAuth()` z `shared/auth-common.js`) — přidáno 2026-08-27, viz technické dluhy níže
- **Formulář:** `public/index.html` + `public/app.js`
- **Dashboard:** `public/dashboard.html` + `public/dashboard.js`
- **Firestore kolekce:** `visits`
- **Pomocné:** kolekce `users` — firemní adresář (28 lidí, všechna oddělení), ne jen obchodníci. Struktura dokumentu: ID = slug (např. `barbora-lojkaskova`).
  - `name` (string), `active` (boolean) — **`active` řídí jen viditelnost ve výběru "Obchodník" na formuláři Návštěvnosti** (16 aktivních = obchodní tým), neznamená obecně "zaměstnaný ve firmě"
  - `department` (string) — `sales` / `accounting` / `operations` / `realization` / `marketing`
  - `studios` (pole stringů, může být prázdné nebo víc hodnot) — `praha` / `brno` / `hradec` / `pardubice`; u vlastního odkazu se studio i tak předává přes URL parametr, pole slouží pro budoucí filtrování/reporting
  - `position` (string), `email` (string), `phone` (string), `personalPhone` (string, nepovinné) — čtení kolekce teď vyžaduje přihlášení (`allow read: if isSignedIn()`), viz Bezpečnostní audit
  - `external` (boolean, nepovinné) — true pro externí dodavatele/agentury (KMi Stav, Zacileno, externí právník/účetní)
- **URL parametry:** `?studio=praha&user=barbora-lojkaskova` (osobní odkazy) — funguje beze změny, jen teď až po přihlášení
- **Funkce dashboardu:** KPI s YoY, měsíční navigace, srovnání studií, funnel, zdroje

### 2. CX Zpětná vazba
- **Účel:** Telefonické dotazování zákazníků po dokončení zakázky
- **Login:** ✅ sdílený platformový login — přidáno 2026-08-27
- **Formulář:** `public/cx.html` (zadává Terka)
- **Dashboard:** `public/cx-dashboard.html` (pro CEO)
- **Firestore kolekce:** `cx_feedback` (794 historických záznamů)
- **Klíčová data:** NPS (doporučení 1–10), spokojenost (0–10), sel by znovu, stav hovoru
- **Stavy hovoru:** Dokončeno / Nezvednutý hovor / Zavolat jindy / Již kontaktováno / Až bude hotové / Nemá zájem / Domluven termín

### 3. Realizace
- **Účel:** Kontrolní záznamy z průběhu staveb, fotodokumentace
- **Login:** ✅ sdílený platformový login — přidáno 2026-08-27
- **Formulář:** `public/realizace/realizace.html`
- **Dashboard:** `public/realizace/realizace-dashboard.html`
- **Firestore kolekce:** `realizace`
- **Klíčová data:** klient, místo, datum/čas, typ, parta, fáze stavby, výsledek kontroly, spokojenost, kvalita, riziko, fotky
- **Storage:** fotodokumentace v Firebase Storage, HEIC konverze ✅ (Storage rules samotná ale zůstávají neauditovaná, viz Bezpečnostní audit)

### 4. Adaptace
- **Účel:** Digitální adaptační plán nových zaměstnanců
- **Login:** `public/adaptace/login.html` (Firebase Auth — email + heslo)
- **Plán nováčka:** `public/adaptace/muj-plan.html`
- **Pohled vedoucího:** `public/adaptace/tym.html`
- **Sdílená logika:** `public/adaptace/adaptace-common.js`
- **Styly:** `public/adaptace/adaptace.css`
- **Firestore kolekce:** `adaptation_templates`, `adaptations`
- **Demo mód:** přidat `?demo=1` k libovolné URL — přeskočí auth i Firestore (pro druhou šablonu přidat `&plan=weekly` na `muj-plan.html`)
- **Dvě šablony vedle sebe** (rozlišené polem `templateType` na dokumentu `adaptations`; chybějící pole = stará šablona):
  - `templateType: 'daily'` (implicitní) — **Obchodník 14 dní**, pevné dny s ráno/odpoledne bloky, jeden `supervisorId`. `DEFAULT_TEMPLATE` v `adaptace-common.js`.
  - `templateType: 'weekly'` — **Projektový specialista/designér, 90 dní / 12 týdnů ve 3 fázích** (Znalosti/Dovednosti/Myšlení a samostatnost) + průřezový seznam kvótových cílů po kategoriích (Obchod, CAD, Realizace, CX, Marketing...). `PROJECT_SPECIALIST_TEMPLATE` v `adaptace-common.js`. Adaptace má navíc pole `roles` se 4 jmenovanými osobami na adaptaci (`manager`, `managerDeputy`, `seniorSpecialist`, `buddy`) — u nich je vždy jen jméno (`uid: null`), zobrazují se u cílů informativně, bez loginu.
  - **Potvrzovat smí kterýkoliv z 6 manažerů/adminů** (Martin, Matouš, Barča, Jakub Krčmarik, Jan "Honza" Lagron, Kristýna Syrová), ne jen jmenovaný `manager` na konkrétní adaptaci — mají se moct zastupovat. Řeší to globální role `admin` na jejich `users/{uid}` dokumentu (`isSupervisorOrAbove()` ve Firestore rules), ne per-adaptaci `roles` mapa — ta zůstává jen pro zobrazení "kdo je čí manažer".
  - **⚠️ Dvojí identita — past k opakování:** `tym.html`/`muj-plan.html` čtou roli z `users/{uid}` (doc ID = Firebase Auth UID), zatímco sdílený login/Dovolená čtou ze `users/{slug}` (doc ID = jméno-slug, s vlastním polem `uid` uvnitř) — **dva různé dokumenty pro jednoho člověka**, žádná automatická provázanost. `getUserProfile()` v `adaptace-common.js` to obchází zkusmo (nejdřív `getDoc(users/{uid})`, pak dotaz na pole `uid`, pak na `email`), ale pokud se `users/{uid}` admin dokument založí na **jiný e-mail/alias, než jaký má člověk skutečně přiřazený k Auth účtu** (např. "barca.syrova@..." místo skutečného "barbora.syrova@..."), založí se tím tichý **duplicitní Auth účet** s jiným UID, na který nikdo nikdy nepřihlásí — a člověk s reálným účtem nemá žádný `role` dokument, takže ho `adaptace/login.html` (`redirect()`) vždy pošle na `/muj-plan.html` místo `/tym.html`, bez chybové hlášky. **Zjištěno a opraveno 2026-07-22:** přesně tohle postihlo Barboru Syrovou — opraveno zápisem `role: admin` na její skutečné UID (`8P9XiyZCf6gm6iu56AW8Yuk0lQD2`), stejným vzorem jako u ostatních 5 (ověřeno, že Martin/Matouš/Jakub/Honza mají `users/{uid}` doc uid shodné se svým reálným Auth účtem, jen Barbora ne). Osiřelý duplicitní účet `barca.syrova@koupelny-syrovy.cz` (`uid: tadbrl6lFeWZv2TiBIxZa0EG74K3`, nikdy nepřihlášen) smazán (Auth účet i Firestore doc). Při zakládání dalšího admina vždy ověřit e-mail proti existujícímu `users/{slug}.email`, ne psát z hlavy/přezdívky.
  - **Firestore pravidlo:** pole `phases`/`ongoingCategories`/`days` jsou v Firestore vždy přepisována jako celé pole najednou (`updateDoc(ref, { phases })`), ne dot-path na konkrétní index (`phases.0.weeks.1...`) — Firestore neumí adresovat prvek pole podle indexu. Viz komentář `withGoalUpdate`/`toggleGoal` v `muj-plan.html`/`tym.html`.
  - **Zpětná vazba u každého cíle:** každý cíl týdenní šablony má `employeeNote` (píše nováček) a `supervisorNote` (píše manažer), nezávisle na confirm/reject akci. UI: kliknutím na cíl se otevře modal (`muj-plan.html` pro nováčka, "Zkontrolovat" v `tym.html` pro manažera) s poznámkou od druhé strany a polem pro vlastní — první verze (vždy viditelný inline textarea u každého cíle) byla nepřehledná, poznámka od manažera se snadno přehlédla. Řádek cíle navíc nese viditelný zlatý badge "💬 Poznámka od manažera/nováčka", když poznámka existuje. **Bez notifikace:** nováček se o nové poznámce od manažera dozví jen tak, že si příště otevře svůj plán a uvidí badge — není to push/e-mail, to je pozdější práce (viz `Notifikační systém` v technických dluzích).
- **Zahájení nové adaptace (mezikrok, dokud neexistuje admin konzole):** `scripts/seed-adaptation.js --config <json> [--dry-run]` — idempotentně založí Firebase Auth účty (e-mail+heslo, bez Workspace) + `users/{uid}` dokumenty pro nováčka a jmenované role, a založí `adaptations` dokument ze šablony. Config shape viz `scripts/seed-adaptation.example.json`.
- **Stav:** Fáze 1 (MVP, obě šablony) ✅ · Fáze 2–4 otevřené (admin konzole na zahájení adaptace přes UI stále chybí — seed skript je jen mezikrok). **Auth byl v kódu hotový, ale Firebase Authentication service samotný nebyl v projektu zapnutý až do 2026-07-16** (zjištěno při bootstrapu Dovolené) — do té doby přes Adaptaci nikdy neproběhlo přihlášení mimo demo mód (`?demo=1`). Teď je zapnutý (Email/Password provider), takže by měla fungovat i reálná přihlášení — nebylo ale zatím ověřeno na účtu založeném přes `seed-adaptation.js`.
- **Reálně založené adaptace (týdenní šablona):** Petra Hindráková (Hradec Králové + Pardubice), Kateřina Kounovská, Pavel Blacký (oba Praha), Karolína Šrámková, Yvetta Hrubá (obě Brno) — všech 5 s nástupem 13.7.2026; Jan Vodička (Pardubice) s nástupem 3.8.2026. Manažer podle studia (mapování z `docs/architektura.md`, org chart pro Dovolenou): Praha/Brno → Jakub Krčmarik, Hradec/Pardubice → Barbora Syrová. Buddy: Kateřina a Pavel → Marek Kopřiva, Petra → Naty Pokorná, Karolína → Valerie, Yvetta → Marek Hořčík, Jan → Marek Kopřiva.
- **⚠️ Past k opakování:** Barbora Syrová měla dřív duplicitní Auth účet na chybný e-mail `barca.syrova@koupelny-syrovy.cz` (zkratka jména místo celého "Barbora") — používal se v `roles.manager` u Petřiny adaptace, dokud nebyl smazán jako osiřelý. Správný, jediný platný účet je `barbora.syrova@koupelny-syrovy.cz`. Při zakládání dalších lidí vždy ověřit celé jméno v e-mailu, ne zkratku/přezdívku.

### 5. Dovolená
- **Účel:** Evidence dovolených zaměstnanců — kdo je pryč, kdo ho zastupuje (+ kontakt), CEO přehled napříč firmou
- **Login:** Firebase Auth od začátku, přes nově vznikající **sdílený platformový login** (viz níže) — ne vlastní login stránka jen pro tento modul
- **Workflow:**
  1. Zaměstnanec se přihlásí a založí žádost o dovolenou (od–do, poznámka nepovinná)
  2. Ke každé žádosti vybere zástupce — **vybírá se vždy znovu při zadání** (ne pevně přiřazený k osobě), typicky někdo ze stejného oddělení/studia
  3. Kontrola kolize v rámci `managerSlug` (ne `department` — obchod má dva manažery podle studia, viz níže): pokud se žádost nepřekrývá s jinou dovolenou ve stejné manažerské skupině → rovnou `confirmed`. Pokud koliduje → status `pending_collision`
  4. **Schvaluje přiřazený manažer** (`managerSlug`), CEO Matouš Syrový vždy jako pojistka — na samostatné stránce `dovolena-schvaleni.html`, ne v obecném přehledu. Schválí → `confirmed`, zamítne → `rejected` (odlišné od `cancelled` = zrušil sám žadatel)
  5. Obecný přehled (přístupný celé firmě, ne jen manažerům/CEO): kdo je aktuálně a v nejbližší době na dovolené, kdo ho zastupuje + kontakt (telefon/e-mail z `users`), seznam nevyřešených kolizí (jen k nahlédnutí, bez akcí)
- **Formulář žádosti:** `public/dovolena/dovolena.html` — vlastní kalendářový range-picker (od-do jedním kliknutím, ne dva oddělené `<input type="date">`), zástup (vybírá se vždy znovu z celofiremního adresáře kromě externích — jen záznamy s vyplněným emailem), poznámka, seznam vlastních žádostí + zrušení
- **Obecný přehled (celá firma):** `public/dovolena/dovolena-dashboard.html` — měsíční kalendář (prev/next navigace, vzor jako `dashboard.js`), dny obsazené dovolenou mají barevný pill „Jméno (Zástup)" (kolize odlišené barvou), pod kalendářem tabulka „Nadcházející dovolené" (jméno, termín, zástup, kontakt, stav — vše od dneška dál), sekce nevyřešených kolizí nahoře jako čistě informativní seznam karet (žádné akce), nenápadný odkaz „Máš X ke schválení" jen tomu, kdo má co řešit
- **Schvalování (jen přiřazený manažer / CEO):** `public/dovolena/dovolena-schvaleni.html` — fronta kolizí čekajících na rozhodnutí konkrétního uživatele, s kontextem "koliduje s" (kdo jiný ze stejné manažerské skupiny má překryv), tlačítka Schválit/Zamítnout
- **Sdílená logika:** `public/dovolena/dovolena-common.js` (Firestore CRUD, detekce kolize podle `managerSlug`, `resolveCollision`, status labely včetně `rejected`, `buildMonthGrid`/`formatMonthLabel` — sdílená kalendářní mřížka)
- **Firestore kolekce:** `vacations`
  - `userId` (slug, ref `users`), `startDate`, `endDate`, `substituteUserId` (slug, ref `users`, volen per žádost)
  - `note` (string, nepovinné)
  - `status`: `confirmed` / `pending_collision` / `cancelled` / `rejected`
  - `department`, `studios`, `managerSlug` (denormalizováno z `users` v čase zadání — `managerSlug` je klíč pro detekci kolize i určení schvalovatele)
  - `resolvedBy`, `resolvedAt` (kdo/kdy kolizi schválil nebo zamítl)
  - `createdAt`, `createdBy`
  - Kolize se dopočítává na klientovi (rovnostní dotaz na `managerSlug`, přesah rozsahu vyhodnocen v JS) — objem dat na manažerskou skupinu je malý, nemá smysl řešit composite indexy
- **`users/{slug}.managerSlug`:** kdo danou osobu manažersky kryje — zapsáno ručně podle organigramu (2026-07-16), viz `docs/architektura.md` pro přesné mapování a odůvodnění (obchod se dělí po studiích na dva manažery, ne jeden za celé oddělení)
- **Firestore rules:** `vacations` — čtení všem přihlášeným, vlastník smí upravit svou žádost (zrušení), přiřazený manažer nebo CEO smí jen posunout `pending_collision` → `confirmed`/`rejected` (a jen tahle pole)
- **Stav:** ✅ Nasazeno na produkci a ověřeno end-to-end (2026-07-16): login → vynucená změna hesla → žádost o dovolenou → kolize → schválení manažerem → CEO/obecný přehled se zástupem a kontaktem. Schvalování kolizí hotovo.

### 6. Sdílený platformový login
- **Účel:** Jedno přihlášení (e-mail + heslo) napříč celou platformou místo samostatné login stránky pro každý modul.
- **Login:** `public/login.html` (kořen) — e-mail/heslo, „Zapomenuté heslo?“ (sendPasswordResetEmail), `?redirect=` návrat na cílovou stránku (výchozí bez redirectu: `/dovolena/dovolena.html`, jediný modul, co login zatím používá)
- **Vynucená změna hesla:** `public/change-password.html` + pole `users/{slug}.mustChangePassword` (boolean) — `requireAuth()` na něj přesměruje dřív, než pustí kamkoliv dál. Firestore rules dovolují vlastníkovi shodit tohle pole z `true` na `false` a nic jiného v `users/{slug}` (`request.auth.token.slug == slug`, `affectedKeys().hasOnly(['mustChangePassword'])`).
- **Sdílená logika:** `public/shared/auth-common.js` (Firebase init, `requireAuth`, `getUserSlug`, `getUserBySlug`, toast/date helpery) + `public/shared/shared.css` (stejné vizuální komponenty jako `adaptace.css`, samostatná kopie)
- **Identita:** custom claim `slug` na Firebase Auth účtu = ID dokumentu v `users/{slug}` — Firestore rules ho čtou přes `request.auth.token.slug` bez dalšího dotazu
- **Adaptace zatím nepřipojena:** `public/adaptace/login.html` běží dál nezávisle beze změny, sjednocení je pozdější úklid (viz technický dluh)
- **Bootstrap účtů:** `scripts/seed-users-auth.js` — idempotentně založí Auth účet přes Admin SDK, nastaví claim `slug`, zapíše `uid` do `users/{slug}`. Dvě cesty k prvnímu heslu:
  - `--send`/`--send-all` (e-mail s odkazem) — **nefunkční**, Firebase e-mail nedošel ani na firemní doménu, ani na kontrolní adresu mimo firmu (viz `docs/architektura.md`), příčina nedohledána (mimo časové možnosti)
  - `--shared-password` (`--only <slug>` pro test / `--all` pro všechny) — **aktuálně používaná cesta**, nastaví všem stejné dočasné heslo `"ZmenSiHeslo"` + `mustChangePassword: true`, vynucená změna řeší bezpečnostní okno
  - **Idempotentní i vůči vlastnímu heslu:** účet s `mustChangePassword === false` (člověk si už heslo sám nastavil) skript při dalším běhu nepřepíše — bez toho by každé další spuštění (např. `--all` kvůli novému kolegovi) tiše vrátilo heslo všem zpátky na sdílené. Opraveno 2026-07-16 poté, co to takhle potkalo Martina, viz `docs/architektura.md`.
  - ⚠️ **Firebase Authentication service nebyl v projektu vůbec zapnutý** až do 2026-07-16 — první spuštění skriptu spadlo na `auth/configuration-not-found`. Zapnuto ručně ve Firebase Console (Authentication → Sign-in providers → Email/Password → Enable). Nutno mít na paměti, že totéž tichým způsobem blokovalo i Adaptaci (viz její stav výše).
- **Stav:** ✅ Nasazeno na produkci. 23 z 23 aktuálních zaměstnanců má účet se sdíleným heslem (4 externí a 1 deaktivovaná osoba záměrně vynecháni). Zbytkové riziko dočasného sdíleného hesla vědomě akceptováno pod časovým tlakem — detail a odůvodnění v `docs/architektura.md`. E-mailová cesta k prvnímu heslu zůstává jako nedořešený technický dluh pro budoucí návrat k individuálním heslům.

### 7. Admin konzole (Lidé)
- **Účel:** Jedna admin stránka pro přidání nového člověka do evidence Návštěvnosti (a volitelně rovnou zahájení Adaptace v jedné akci) a pro jeho deaktivaci, až skončí — bez nutnosti Firebase/GCP přístupu nebo lokálního spuštění skriptu. Řeší přímo problém, který předtím vynucoval ruční `node` skripty s gcloud přihlášením pro každého nového člověka.
- **Stránka:** `public/admin/lide.html` — přístup jen pro `platformRole` `hr`/`admin`, jinak redirect na `/login.html`. Formulář "Přidat člověka" (adresářová pole + volitelně checkbox "Zahájit rovnou adaptaci" s výběrem manažera/data nástupu/rolí) a tabulka lidí s tlačítkem "Deaktivovat".
- **Cloud Functions:** `functions/index.js` — `onboardEmployee` a `offboardEmployee` (`onCall`, v2, `europe-central2`; první `onCall` funkce v projektu, dosud existoval jen Storage trigger `konvertujHeic`). Zápis do `users` jde jen odsud (Firestore rules mají `allow create: if false`), volající musí mít `platformRole` `hr`/`admin` na svém `users/{slug}` dokumentu (`requireAdminCaller`). `onboardEmployee` validuje povinná pole i existenci `managerSlug`/rolí, zamítne duplicitní e-mail (`already-exists`), založí Auth účet se sdíleným heslem `ZmenSiHeslo` + `mustChangePassword:true` (stejný vzor jako `seed-users-auth.js`) a volitelně i `adaptations` dokument (šablonu `phases`/`ongoingCategories` počítá klient přes `buildWeeklyProgress` z `adaptace-common.js`, funkce jen ukládá hotové). `offboardEmployee` nastaví `active:false`, zablokuje Auth účet a případnou aktivní adaptaci přepne na `status:'ended'` — **nikdy nemaže**, historie (Dovolená, CX, Realizace) zůstává navázaná.
- **Nové pole `users/{slug}.platformRole`** (`employee`/`supervisor`/`hr`/`admin`, nepovinné) — určuje oprávnění v appce (kdo smí do admin konzole, kdo potvrzuje cíle v Adaptaci). Nastaveno zatím jen šesti stávajícím adminům/manažerům (`scripts/backfill-admin-platform-role.js`, jednorázově) a nově zakládaným lidem přes `onboardEmployee`.
- **Fázový přístup k dvojí identitě (vědomé rozhodnutí, ne dokončená migrace):** Adaptace historicky vede samostatný `users/{uid}` dokument s polem `role` (viz past u modulu Adaptace výše) — **6 lidí uprostřed živé 90denní adaptace** (Kateřina, Pavel, Karolína, Yvetta, Petra + jejich manažeři) na něm zůstává beze změny, aby se nesahalo na živá data pod časovým tlakem. Firestore rules (`legacyRole()`/`slugRole()`/`userRole()` v `firestore.rules`) i klientský kód (`getUserProfile` v `adaptace-common.js`, dotazy v `tym.html`/`muj-plan.html`/`login.html`) proto zkouší **obě cesty**: nejdřív `slug` claim + `platformRole`, při jeho absenci spadnou na starý `uid` + `role`. Podobně `adaptations.roles.{key}` má u starých záznamů klíč `uid`, u nových (přes admin konzoli) klíč `slug` — obojí rules podporují. Zpětné domigrování těch 6 lidí na jednotnou identitu zůstává otevřený, neurgentní úklid (viz technické dluhy).
- **Ověřeno end-to-end 2026-08-07/08** (bez použití reálných hesel — přes dočasný QA test účet smazaný po testu): onboarding bez i s adaptací (`phases`/`roles.manager.slug` správně), zamítnutí duplicitního e-mailu, zamítnutí volání od ne-admina, offboarding (deaktivace, zablokování loginu, `status:'ended'` na adaptaci, zmizení z dropdownu Návštěvnosti), Firestore rules dual-path (zaměstnanec čte vlastní adaptaci, cizí je mu zamítnuta) — vše přes přímé HTTP volání funkcí a Firestore REST API s reálným Firebase ID tokenem, protože GUI test přes Browser pane cestou vypadl (viz past níže).
- **Stav:** ✅ Nasazeno na produkci a ověřeno. Editace existujících lidí (mimo aktivní/neaktivní) zatím není — přirozený další krok.

---

## Otevřené technické dluhy

| Priorita | Úkol | Modul |
|----------|------|-------|
| ✅ Hotovo | ~~Firebase Authentication — implementovat pro ostatní moduly~~ — přidáno 2026-08-27 do všech 6 stránek (`index.html`, `dashboard.html`, `cx.html`, `cx-dashboard.html`, `realizace/realizace.html`, `realizace/realizace-dashboard.html`) přes sdílený `requireAuth()`; `firestore.rules` zpřísněna na `entries`/`cx_feedback`/`realizace`/`daily_summaries`/`users` (čtení i zápis jen přihlášeným). Ověřeno end-to-end (přihlášený zápis/čtení funguje, nepřihlášený REST dotaz vrací `PERMISSION_DENIED`). | Návštěvnost, CX, Realizace |
| ✅ Hotovo | ~~Kolekce `users` veřejně čitelná~~ — součást opravy výše, `allow read: if isSignedIn()` | Návštěvnost |
| 🔴 Vysoká | Denní šablona (`toggleTask`/`completeDay`/`confirmDay`/`rejectDay`) zapisuje do Firestore přes dot-path na index pole (`days.5.blocks`) — Firestore neumí adresovat prvek pole podle indexu. Nikdy neodhaleno, protože se dosud používal jen demo mód (`isDemoMode()` obchází Firestore). Opravit stejným vzorem jako u nové týdenní šablony (celé pole `days` přepsat najednou) před prvním reálným použitím mimo demo. | Adaptace |
| 🟡 Střední | Adaptace: zahájení adaptace přes UI (admin console — Fáze 3) | Adaptace |
| 🟡 Střední | Adaptace: plovoucí termíny přes Cloud Functions (Fáze 2) | Adaptace |
| 🟡 Střední | Adaptace: HR dashboard (Fáze 4) | Adaptace |
| ✅ Hotovo | ~~Admin správa obchodníků (přidat, deaktivovat)~~ — `public/admin/lide.html` + `onboardEmployee`/`offboardEmployee`, nasazeno 2026-08-08 | Návštěvnost |
| ✅ Hotovo | ~~Dořešit přístup pro Elišku do admin konzole~~ — `platformRole: admin` nastaveno 2026-08-08. Externí spolupracovnice (Zacileno, `external: true`), vědomě povoleno; založen i chybějící Auth účet (`seed-users-auth.js --only`, jinak se přeskakují externí). `active: false` záměrně ponecháno — nemá se objevit v Návštěvnosti ani jinde. | Admin konzole |
| 🟡 Střední | Natočit krátké instruktážní video k admin konzoli (`/admin/lide.html` — přidání člověka, volitelná adaptace, deaktivace) a nasdílet všem 6 manažerům/adminům, ať to nepoužívá jen Martin | Admin konzole |
| 🟡 Střední | Zpětně domigrovat 6 lidí z Adaptace (`users/{uid}` + starý `roles.{key}.uid`) na jednotnou `users/{slug}` identitu — dnes běží přes dual-path fallback v rules i klientu (viz modul Admin konzole), funkční, ale ne uklizené. Vyžaduje doplnit chybějící adresářová pole (telefon, pozice) u 5 z nich, co dosud nemají slug dokument vůbec. | Adaptace |
| 🔴 Vysoká | **Bezpečnostní audit** — projít a rozhodnout prioritizaci opravy všech otevřených bezpečnostních děr napříč platformou. Podrobný inventář viz sekce `Bezpečnostní audit` níže — je jich víc, než kolik pokryjí jednotlivé řádky téhle tabulky, a část se nastřádala i z tohoto sezení (org policy výjimka, širší role na Cloud Function service accountu). | Všechny moduly |
| 🟢 Nízká | Manažer se o nové kolizi ke schválení dozví jen když sám navštíví `dovolena-schvaleni.html` — bez notifikace (e-mail/push), spadá pod obecný dluh "Notifikační systém" níže | Dovolená |
| 🟡 Střední | Sdílený login běží na dočasném společném heslu (`ZmenSiHeslo` + vynucená změna) místo bezpečnějších individuálních — Firebase e-mail (`sendPasswordResetEmail`/`accounts:sendOobCode`) nedošel ani na firemní doménu, ani na kontrolní adresu mimo firmu, příčina nedohledána. Než se doručování opraví (vlastní ověřená odesílací doména / transakční e-mailová služba), zůstává bezpečnostní okno, dokud si každý heslo sám nezmění. | Sdílený login |
| 🟢 Nízká | Migrovat Adaptace na sdílený platformový login (dnes vlastní `adaptace/login.html`) — dovršilo by to sjednocení identity započaté u Admin konzole (viz dluh výše) | Adaptace, Sdílený login |
| 🟡 Střední | URL struktura je dnes nekonzistentní (Návštěvnost a login v kořeni, ostatní moduly v podsložkách typu `/dovolena/`, `/adaptace/`, `/admin/`) a matoucí. Chceme do toho sáhnout a zároveň připravit **rozcestníkovou úvodní stránku po loginu** pro lidi s přístupem do víc modulů — dnešní `resolveTarget()` v `login.html` jen hádá JEDEN cíl (Adaptace vs. Dovolená) podle toho, jestli má člověk aktivní adaptaci, což pro někoho s přístupem do víc věcí (např. admina) nedává smysl. Souvisí i s plánovanou "Vlastní doménou" v roadmapě. | Sdílený login |
| 🟢 Nízká | Notifikační systém (připomínky vyplňování) | Všechny moduly |

---

## Bezpečnostní audit — TODO (zapsáno 2026-08-08, zatím jen inventář, ne opraveno)

Konsolidovaný seznam všech známých otevřených bezpečnostních děr napříč platformou — vznikl při procházení `firestore.rules` a nasazování admin konzole, kdy vyšlo najevo, že je toho otevřeno víc, než kolik zachycovala tabulka technických dluhů zvlášť. Účel: mít **jedno místo**, odkud se dá bezpečnost projít a systematicky opravit, ne že se na jednotlivé díry přijde nahodile.

### ✅ Firestore rules — plný nechráněný zápis (ne jen čtení) — OPRAVENO 2026-08-27
Přímo v `firestore.rules` měly tři kolekce `allow write: if true` — **kdokoliv na internetu bez přihlášení** mohl zapisovat, přepisovat i mazat, ne jen číst:
- `entries` (Návštěvnost — záznamy o návštěvách)
- `cx_feedback` (zákaznická zpětná vazba — NPS, spokojenost)
- `realizace` (kontrolní záznamy staveb + odkazy na fotodokumentaci)

Oprava vyžadovala víc než jen úpravu pravidla — formuláře i jejich dashboardy (6 stránek celkem) neměly žádné přihlášení vůbec, takže se nejdřív musely nagatovat přes sdílený `requireAuth()` (stejný vzor jako Dovolená/Adaptace/Admin konzole), teprve pak šlo `allow write` (i `allow read`, viz níže) zpřísnit na `isSignedIn()` bez rozbití appky. Identita zápisu (obchodník, parta, "Terka") se neměnila — to zůstává výběr ze seznamu/radio, ne vázané na přihlášeného uživatele; brána je jen na úrovni stránky.

### ✅ `users` kolekce — veřejně čitelná (`allow read: if true`) — OPRAVENO 2026-08-27
Zápis byl correctly zamčený (`allow create: if false`) už dřív, čtení ne — celofiremní adresář včetně osobních telefonů byl čitelný bez přihlášení. Opraveno ve stejném kroku jako výše (`allow read: if isSignedIn()`) — vyžadovalo to zároveň zagatovat i 3 dashboardy (`dashboard.html`, `cx-dashboard.html`, `realizace-dashboard.html`), co `users` taky četly bez loginu.

### Firebase Storage — pravidla nikdy neauditovaná, možná nejsou vůbec verzovaná
V repu neexistuje `storage.rules` soubor a `firebase.json` nemá žádnou `storage` sekci — Storage (fotodokumentace realizací) běží na výchozích pravidlech nastavených přímo v konzoli, mimo git, nikdy v rámci tohohle projektu nezkontrolovaných. **Nejvyšší priorita k ověření** — nevíme, jestli je to zamčené nebo plně otevřené pro čtení/zápis/mazání.

### Sdílené dočasné heslo (`ZmenSiHeslo`)
Existující dluh (viz tabulka) — většina týmu pořád běží na společném hesle, dokud si ho sami nezmění. Bezpečnostní okno otevřené, dokud se nevyřeší doručování e-mailů.

### Z tohohle sezení — dvě věci, co se rozvolnily kvůli nasazení admin konzole
1. **Cloud Functions runtime service account** (`<project-number>-compute@developer.gserviceaccount.com`) dostal role **Cloud Datastore User** + **Firebase Authentication Admin** na úrovni **celého projektu**, ne jen pro `onboardEmployee`/`offboardEmployee`. Znamená to, že cokoliv, co poběží pod týmž default service accountem (i budoucí funkce), bude mít stejně široký přístup k celé Firestore databázi a celému Firebase Auth, ne jen k `users`/`adaptations`. Bezpečnější varianta: dedikovaný service account jen pro tyhle dvě funkce s užšími rolemi.
2. **Org policy `iam.allowedPolicyMemberDomains`** (Domain Restricted Sharing) byla pro tenhle projekt přepnuta na **"Override → Replace → Allow all"**, aby šlo `onCall` funkce vůbec zveřejnit (Cloud Run vyžaduje `allUsers` jako invoker). To je organizační bezpečnostní default, co se tímhle krokem vypnul — stojí za ověření, jestli to neotevírá i jiné služby/IAM bindings v projektu veřejnosti, ne jen tyhle dvě funkce.

### Co naopak vypadá v pořádku (ověřeno, ne jen předpokládáno)
- `users/{slug}` update rule je úzce scoped (vlastník smí shodit jen `mustChangePassword`, nic jiného)
- `vacations` update rule pro schvalování kolizí je úzce scoped (jen `status`/`resolvedBy`/`resolvedAt`, jen přiřazený manažer/CEO)
- Nové Cloud Functions (`onboardEmployee`/`offboardEmployee`) mají vlastní auth check (`requireAdminCaller`) nezávislý na Firestore rules — ověřeno end-to-end 2026-08-07/08
- `entries`/`cx_feedback`/`realizace`/`daily_summaries`/`users` teď vyžadují přihlášení na čtení i zápis — ověřeno end-to-end 2026-08-27 (přihlášený uživatel čte/zapisuje beze změny, nepřihlášený REST dotaz na kteroukoliv z 5 kolekcí vrací `PERMISSION_DENIED`)

**Zbývá z původního seznamu:** Storage pravidla (nejvyšší priorita — pořád neověřeno), sdílené heslo `ZmenSiHeslo`, a dvě věci rozvolněné kvůli admin konzoli (širší role na Cloud Function service accountu, vypnutá org policy).

**Doporučený další krok:** projít zbývající body, u každého rozhodnout risk vs. dopad opravy, a buď opravit rovnou, nebo vědomě zapsat proč se odkládá (stejně jako u sdíleného hesla).

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

# Pozor: worktree trap
# Soubory z git worktree zkopírovat do hlavního projektu před deployem:
cp -r worktree/public/adaptace public/adaptace
```

---

## Známé pasti

### Git worktree trap
Soubory vytvořené v git worktree nejsou automaticky v hlavní větvi. `git merge` hlásí "already up to date" a soubory se na hosting nedostanou.
**Řešení:** po práci v worktree vždy `cp -r` do hlavního projektu, pak `firebase deploy`.

### Nová `onCall` Cloud Function — dva neviditelné bloky při prvním deployi
Zjištěno 2026-08-07/08 při nasazení `onboardEmployee`/`offboardEmployee` (první `onCall` funkce v projektu — do té doby existoval jen Storage trigger `konvertujHeic`, který tohle nikdy nepotkal):
1. **`firebase deploy --only functions` může "uspět", ale funkce přesto nejde zavolat.** Firebase potřebuje nastavit IAM `allUsers`/Cloud Run Invoker na podkladovou Cloud Run službu (`onCall` si ověřuje identitu sám uvnitř, ale Cloud Run musí požadavek pustit dovnitř). Pokud se to nepovede, CLI to nahlásí jako chybu při PRVNÍM pokusu — ale při dalším `deploy` bez změny zdrojového kódu Firebase krok tiše přeskočí ("Skipped — no changes detected") a vypíše "Deploy complete!", i když IAM binding pořád chybí. **Ověřit vždy přímo:** `curl -X POST <function-url>` bez auth — Google Frontend 403 (HTML) = binding chybí, `{"error":{"status":"UNAUTHENTICATED"}}` (JSON) = binding je OK a request se dostal až do naší funkce.
   - Pokud selže s `IAM policy update failed` / `Domain Restricted Sharing` — projekt je pod Google Workspace organizací s enforced `constraints/iam.allowedPolicyMemberDomains`, co blokuje `allUsers` jako principal na čemkoliv v organizaci. Oprava: `console.cloud.google.com/iam-admin/orgpolicies/iam-allowedPolicyMemberDomains?project=<projekt>` → Manage policy → **Override parent's policy** → **Replace** → Add a rule → **Allow all** → Set policy. Až pak jde `allUsers`/Cloud Run Invoker přidat na obě služby v Cloud Run konzoli (Services → zaškrtnout službu → panel Permissions → Add principal).
2. **I s opraveným IAM bindingem může funkce padat na `PERMISSION_DENIED` uvnitř kódu** (`Firestore.getAll ... Missing or insufficient permissions`) — 2nd gen funkce bez vlastního service accountu běží pod **default Compute service account** (`<project-number>-compute@developer.gserviceaccount.com`), který na nových GCP projektech **nemá automaticky Editor** roli. Oprava: `IAM & Admin → IAM` → najít tenhle service account → přidat role **Cloud Datastore User** (Firestore) a **Firebase Authentication Admin** (pokud funkce volá `admin.auth()`).
3. **Lokální Admin SDK skripty** (`admin.credential.applicationDefault()`) mohou selhat na `auth/internal-error` / "requires a quota project" při volání Auth API (Firestore funguje, Auth ne) — chybí quota project na ADC. Oprava: `gcloud auth application-default set-quota-project <projekt>`.

Všechny tři jsou samostatné bloky, potkaly se za sebou v tomhle pořadí — žádný z nich nezpůsobí chybu, dokud se nezkusí přesně ta věc, co potřebuje. Při přidávání další `onCall`/`onRequest` funkce do tohohle projektu počítat s tím, že oba IAM kroky (Cloud Run invoker, Compute SA role) může být potřeba nastavit ručně přes konzoli — CLI/gcloud to samo nedokončí, pokud narazí na organizační policy nebo chybějící oprávnění, a "Deploy complete!" to neřekne.

---

## Roadmapa (hrubá)

### Fáze 1 — Stabilizace (2026)
- [x] Firebase Authentication (Adaptace — hotovo)
- [x] Firebase Authentication (ostatní moduly — Návštěvnost, CX, Realizace, přidáno 2026-08-27)
- [x] GitHub repozitář
- [x] HEIC konverze fotek
- [x] Administrace obchodníků (admin konzole `public/admin/lide.html`, onboarding i offboarding)

### Fáze 2 — Rozšíření (2026–2027)
- [ ] Adaptace: plovoucí termíny (Cloud Functions)
- [ ] Adaptace: admin console (zahájení adaptace, správa šablon)
- [ ] Adaptace: HR dashboard
- [ ] Modul: Reklamace (doplněk k Raynetu)
- [ ] Modul: Zakázky — přehled a stavy
- [x] Modul: Dovolená — evidence, zástupy, CEO přehled, schvalování kolizí manažerem (kompletní, nasazeno a ověřeno na produkci)
- [x] Sdílený platformový login (nasazeno, celý tým má účet; dočasné sdílené heslo místo e-mailu, viz technický dluh; Adaptace zatím na svém vlastním loginu — sjednocení je pozdější úklid)
- [ ] Notifikace a připomínky
- [ ] Vlastní doména

### Fáze 3 — Platforma (2027–2028)
- [ ] Vědomá rozhodnutí o napojení na Pohodu / Raynet
- [ ] Přístupová práva podle rolí (obchodník, vedoucí, CEO)
- [ ] Případná migrace z Firebase pokud to bude dávat smysl

---

*Poslední aktualizace: 2026-08-27 — první dvě kritické položky z bezpečnostního auditu opravené: Návštěvnost, CX a Realizace (+ jejich 3 dashboardy, celkem 6 stránek) dostaly stejnou přihlašovací bránu jako Dovolená/Adaptace/Admin konzole (`requireAuth()` ze `shared/auth-common.js`), a `firestore.rules` byla zpřísněna — `entries`/`cx_feedback`/`realizace`/`daily_summaries`/`users` teď vyžadují přihlášení na čtení i zápis místo `allow read/write: if true`. Datový model se neměnil (obchodník/parta/"Terka" zůstávají výběr ze seznamu, ne vázané na přihlášeného uživatele) — brána je čistě na úrovni stránky. Dvě stránky (`index.html`+`app.js`, `dashboard.html`+`dashboard.js`) používají classic script + `window.db` bridge vzor (auth gate v inline module scriptu nastaví `window.db` až po přihlášení, `app.js`/`dashboard.js` se nemění); zbylé 4 mají celou logiku v jednom module scriptu, tam šla úprava přímo. Všech 6 stránek sjednoceno na `shared/auth-common.js`, smazán duplikovaný inline Firebase config, co každá stránka měla svůj vlastní. Ověřeno end-to-end přes dočasné QA test účty (smazané po testu): nepřihlášený dostane redirect na login i `PERMISSION_DENIED` z REST API, přihlášený má formuláře i dashboardy funkční beze změny (reálný zápis do `entries` otestován a smazán). Zbývající body bezpečnostního auditu (Storage pravidla, sdílené heslo, service account scope, org policy) viz sekce "Bezpečnostní audit" — samostatný úkol.

---

*Předchozí aktualizace: 2026-08-08 — admin konzole pro lidi (`public/admin/lide.html`) nasazena a ověřena end-to-end: HR/admin teď může jednou akcí založit člověka do evidence Návštěvnosti a volitelně rovnou zahájit jeho Adaptaci, i deaktivovat člověka, co skončil — bez GitHub/Firebase přístupu, dřív to šlo jen ručním Node skriptem s gcloud přihlášením. Backend: nové `onCall` Cloud Functions `onboardEmployee`/`offboardEmployee` (`functions/index.js`, první callable funkce v projektu), nové pole `users/{slug}.platformRole` (zatím jen u 6 stávajících adminů/manažerů + nově zakládaných lidí). Vědomě fázový přístup k dvojí identitě Adaptace/Návštěvnosti (viz modul "Admin konzole" výše a technické dluhy) — Firestore rules i klientský kód teď zkouší novou (slug) i starou (uid) cestu souběžně, takže 6 lidí uprostřed živé adaptace zůstalo nedotčeno, zpětné domigrování je samostatný pozdější úklid. Nasazení narazilo na tři samostatné, dřív nepotkané pasti kolem první `onCall` funkce v projektu (IAM invoker binding, Domain Restricted Sharing org policy, chybějící role na default Compute service accountu) — zapsáno do Známých pastí. Ověřeno bez zásahu do reálných účtů/hesel — přes dočasný QA test účet (smazaný po testu) a přímá HTTP/Firestore REST volání s reálným Firebase ID tokenem, protože Browser pane cestou vypadl.

---

*Předchozí aktualizace: červenec 2026 — modul Dovolená (`public/dovolena/`) a sdílený platformový login (`public/login.html`, `public/shared/`) nasazeny na produkci a ověřeny end-to-end: žádost o dovolenou s výběrem zástupce per žádost, detekce kolize na klientovi, CEO přehled s výraznou sekcí kolizí; identita přes Firebase Auth custom claim `slug` napojený na `users/{slug}`; Firebase Authentication service musel Martin ručně zapnout v konzoli (nebyl v projektu vůbec zapnutý, tichy blokoval i Adaptaci); e-mail s odkazem na nastavení hesla (`sendPasswordResetEmail`/`accounts:sendOobCode`) se ukázal nedoručitelný i mimo firemní doménu, takže bootstrap `scripts/seed-users-auth.js` běží přes `--shared-password` (dočasné heslo `ZmenSiHeslo` pro všechny + vynucená změna při prvním loginu přes nové `public/change-password.html` a pole `users/{slug}.mustChangePassword`) — vědomé bezpečnostní kompromisní řešení pod časovým tlakem, zapsáno jako technický dluh; 23 z 23 aktuálních zaměstnanců má účet (4 externí a 1 deaktivovaná osoba vynecháni); cestou se opravena špatná data v `users` (chybějící e-mail u Vladimíra Jiráska, dvě adresy v jednom poli u Terezy Kotasové) a nalezeny 4 sirotčí `users/{uid}` dokumenty z dřívějšího testu Adaptace, které způsobovaly duplicity ve výběru zástupce — opraveno na úrovni kódu; formulář žádosti dostal vlastní kalendářový range-picker a obecný přehled měsíční kalendář s navigací (`buildMonthGrid` sdílené mezi oběma); **schvalování kolizí dokončeno** — nové pole `users/{slug}.managerSlug` (zapsáno podle organigramu, který Martin dodal) nahradilo `department` jako klíč pro detekci kolize i určení schvalovatele, protože obchodní tým se ve skutečnosti dělí po studiích na dva manažery (Jakub Krčmarik, Barbora Syrová), ne jeden za celé oddělení; schvalování běží na samostatné `dovolena-schvaleni.html` (jen přiřazený manažer + CEO Matouš jako pojistka), obecný přehled zůstal čistě k náhledu pro celou firmu bez akcí; přidán stav `rejected`; ověřeno end-to-end na produkci reálnou kolizí — vše viz `docs/architektura.md`; Adaptace zůstává na vlastním loginu, sjednocení je pozdější úklid — vše viz `docs/architektura.md`; kolekce `users` rozšířena na celofiremní adresář (28 lidí, všechna oddělení): nová pole `department`, `studios` (pole), `position`, `email`, `phone`, `personalPhone`, `external`; Barbora Lojkásková deaktivována (již ve firmě není); zjištěno, že kolekce má veřejně čitelná Firestore rules — zapsáno jako technický dluh; Adaptace: přidána druhá šablona "Projektový specialista/designér — 90 dní" (`templateType: 'weekly'`) vedle stávající 14denní obchodnické, s jmenovanými rolemi na adaptaci (`roles`: buddy/manažer/senior/zástupce) a rozšířenými Firestore rules (`isAssignedRole`); přidán `scripts/seed-adaptation.js` jako mezikrok pro zahájení adaptace bez admin konzole — viz `docs/architektura.md`*

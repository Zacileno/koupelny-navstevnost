# Modul Rezervace — specifikace (náhrada Reservanta)

*Stav: návrh 2026-11-05 · zdroj: call Martin × Eliška 2026-11-03 (Fireflies), porada 2026-10-28 · body označené ⚠️ čekají na odsouhlasení Martinem — do té doby platí uvedený výchozí stav a je konfigurovatelný, ne natvrdo v kódu.*

---

## 1. Proč

- Obousměrná synchronizace Reservanto ↔ Raynet přes Make padá na edge casech.
- Reservanto neumí oddělit pravidla pro dvě služby. Když se nastaví rezervace nejdřív za 2 dny, platí to i pro showroom.
- Strategie 2027: studia jedou od 01/2027 na rezervaci, od 1. 12. 2026 hybridní provoz. Je potřeba měřit cestu kampaň → rezervace → schůzka.

## 2. Klíčové rozhodnutí — kdo co vlastní

| Co | Kde | Poznámka |
|---|---|---|
| Dostupnost designérů (bloky podle služby) | **Platforma** | Jediný zdroj pravdy pro „kdy můžu“ |
| 1. schůzka (web, telefon, CX, lead) | **Platforma** → jednosměrně do Raynetu | Platforma hlídá pravidla a spouští notifikace |
| Přesun / zrušení 1. schůzky | **Platforma** | Jinak klient dostane SMS na starý termín |
| 2. a další schůzky (obchodní případ) | **Raynet, jako dnes** | Designéři nemění návyk |
| Obsazenost designéra | Platforma **čte z Raynetu jen časy událostí** (od–do, vlastník) | Odečte je z volných bloků, nic nezapisuje zpět |

**Pravidlo pro designéry:** „V appce si vypisuješ, kdy můžeš. Schůzky plánuješ, kde jsi zvyklý.“

**Výjimka z „Raynet bez integrace“** (rozhodl Martin 2026-11-05), úzce vymezená:
- **Zápis:** kontakt (jen pokud neexistuje) a událost pro schůzku vzniklou na platformě, plus úprava a zrušení **jen těchto vlastních událostí**.
- **Čtení:** jen časy událostí designérů. Žádné čtení obchodních případů ani obsahu cizích událostí.
- Žádná úprava záznamů, které platforma sama nezaložila.
- Obousměrná synchronizace objektů výslovně ne.

## 3. Služby

| | Konzultace ve studiu | Návrh u vás doma |
|---|---|---|
| Místo | konkrétní studio | adresa klienta |
| Nejdřívější rezervace | ⚠️ výchozí za 1 hodinu („kdykoliv“) | **nejdřív za 2 dny** (kalendářní; ⚠️ nebo pracovní?) |
| Délka | ⚠️ výchozí 60 min | ⚠️ výchozí 120 min |
| Cena | zdarma | 4 990 Kč vč. DPH (konfigurace, jen zobrazení) |
| Stav po odeslání klientem | `confirmed` | `requested` → CX potvrdí po telefonu a úhradě zálohy |
| Kdo ji smí vést | designéři přiřazení ke studiu | designéři s povolenou službou „doma“ |

- ⚠️ Platba se v systému neřeší. Zálohovku posílá CX ručně, systém jen eviduje stav.
- ⚠️ Horizont rezervací: výchozí 60 dní dopředu.
- Služby jsou data (kolekce), ne kód. Další služba (např. SYROVÝ PRO — rezervace studia partnerem) = nový záznam plus případně nové pravidlo.

## 4. Designéři a dostupnost

- Designér je existující `users/{slug}` a dostane navíc `reservations{enabled, studios[], services[], raynetUserId}`.
- Dostupnost jsou **konkrétní bloky** (od–do) vázané na službu, u studia i na studio. Ve fázi 1 se neřeší opakovací pravidla. Místo nich je tlačítko „zkopírovat týden“.
- Příklad: „doma celý pátek, ve studiu Praha jen odpoledne“ = dva bloky.
- ⚠️ Bloky pro studio by měly ležet v otevírací době studia. UI na to upozorní, ale nezablokuje.
- **Volný termín** = blok dostupnosti − rezervace na platformě − obsazenost z Raynetu − minimální předstih − mimo horizont. Krok slotů 30 min, délka podle služby.
- Ruční zadání (CX nebo designér po telefonu) jde stejnou cestou jako web. Pravidlo předstihu smí přebít jen interní uživatel, s varováním.

## 5. Raynet

- **Push** (Firestore trigger na změnu rezervace):
  - potvrzená rezervace → najít kontakt podle telefonu, pak e-mailu, jinak založit osobu → založit událost (vlastník = `raynetUserId`, čas, místo, popis, ID rezervace),
  - přesun → upravit tuto událost,
  - zrušení → zrušit nebo smazat tuto událost.
  - Výsledek a chyba se zapisují do `res_bookings.raynet{}`. Při chybě se zkouší znovu, rezervace kvůli Raynetu nikdy nespadne.
- **Čtení obsazenosti:** naplánovaná funkce (výchozí každých 10 min) načte události designérů na horizont 60 dní do cache `res_busy/{slug}`. Vlastní události se poznají podle ID rezervace a přeskočí se.
- **Živá kontrola při potvrzení:** těsně před zápisem rezervace se obsazenost designéra v daném čase ověří v Raynetu ještě jednou.
- **Hlídání přesunu v Raynetu:** když se čas vlastní události v Raynetu liší od rezervace, přehled ukáže varování „přesunuto v Raynetu — uprav v appce“.
- **Credentials:** dokument `config/raynet`, čte jen Admin SDK. Stejný vzor jako `config/leadWebhook`.
- **Nejdřív ověřit** (fáze 0): způsob autentizace, filtrování událostí podle vlastníka a období, limity volání, webhooky (mohly by nahradit pravidelné čtení), uložení externího ID na události a vyhledání kontaktu podle telefonu.

## 6. Notifikace (fáze 2)

- **Kopie každé rezervace** na hromadný rezervační e-mail (chce Matouš). ⚠️ Adresa?
- **Potvrzení** klientovi i designérovi, včetně odkazu na zrušení nebo přesun (token v URL). Reservanto to dnes umí, nesmí to zmizet.
- **SMS den předem** klientovi.
- **Alert, když designér nemá vypsané termíny** (konkrétní služba a studio bez volného slotu v příštích N dnech). Komu ⚠️?
- **Kanál:** SmartEmailing API přes Cloud Function. Stavět jako **sdílenou notifikační službu** (`functions/notifikace/`), ne jen pro rezervace, protože stejný dluh mají Dovolená i Leady.
- Další nová externí integrace. Rozhodl Martin (call 2026-11-03).

## 7. Veřejná rezervace

- Stránka `public/rezervovat/` **bez přihlášení**. Je to první veřejný frontend na platformě.
- **Žádné přímé čtení ani zápis do Firestore z veřejné stránky.** Vše jde přes funkce:
  - `volneTerminy` (GET): služba, studio?, designér?, období → vrátí jen sloty, nikdy kalendáře ani jména klientů,
  - `vytvoritRezervaci` (POST): validace, honeypot, kontrola kolize v transakci, živá kontrola Raynetu, zápis.
- **Přímé odkazy:** `?sluzba=…&studio=…&designer=…` (pro profily designérů a kampaně, s UTM).
- UTM a zdroj se ukládají k rezervaci kvůli měření kampaň → rezervace.
- Vložení na koupelnysyrovy.cz (odkaz nebo iframe) a CTA „Rezervovat osobní konzultaci“ řeší Zacíleno, až bude systém v pilotu.

## 8. Datový model

**`res_services/{id}`** — `name`, `type` (`studio`/`home`), `durationMin`, `minLeadMinutes`, `horizonDays`, `requiresConfirmation`, `priceText`, `active`, `order`

**`res_availability/{id}`** — `designerSlug`, `serviceType` (`studio`/`home`), `studio` (jen u studia), `start`, `end`, `createdBy`, `createdAt`

**`res_bookings/{id}`**
- `serviceId`, `serviceType`, `designerSlug`, `studio`, `start`, `end`
- `status`: `requested` / `confirmed` / `done` / `no_show` / `cancelled`
- `client{name, phone (+420…), email}`, `address` (doma), `note`
- `source`: `web` / `phone` / `cx` / `lead`, `leadId`, `utm{}`, `sourceUrl`
- `raynet{contactId, eventId, syncedAt, error, movedInRaynet}`
- `manageToken`, `history[]` (kdo, kdy, co)
- `createdAt`, `createdBy`, `updatedAt`, `updatedBy`

**`res_busy/{slug}`** — `intervals[]{start, end, raynetEventId}`, `fetchedAt`

**`config/raynet`**, **`config/rezervace`** (studijní otevírací doby, hromadný e-mail, intervaly)

**`users/{slug}.reservations`** — `enabled`, `studios[]`, `services[]`, `raynetUserId`

- Časy jako Firestore `Timestamp`, logika v `Europe/Prague`.
- Telefon normalizovaný stejně jako v `leads`, aby šlo párovat lead ↔ rezervace.

## 9. Firestore rules

- `res_services`, `config/rezervace`: čtení pro přihlášené, zápis jen admin.
- `res_availability`: čtení pro přihlášené, zápis jen vlastník (`designerSlug == request.auth.token.slug`) nebo admin.
- `res_bookings`, `res_busy`: čtení pro přihlášené, **zápis jen přes funkce**. Interní úpravy (potvrzení, přesun, zrušení) jdou přes `onCall` funkce, aby se vždy spustil Raynet push a historie.
- `config/raynet`: bez klientských pravidel.
- Role: v duchu CLAUDE.md zatím přihlášený vs. admin, žádné nové role.

## 10. Interní stránky (sdílený login, `requireAuth()`, demo mód `?demo=1`)

- **`rezervace/kalendar.html` (designér):** týden, moje bloky podle služby, moje rezervace, šedě obsazeno z Raynetu, „zkopírovat týden“.
- **`rezervace/prehled.html` (CX, vedoucí):** všechny rezervace s filtrem (studio, designér, služba, stav), ruční rezervace po telefonu, potvrzení žádostí o návrh doma, přesun a zrušení, varování „přesunuto v Raynetu“, stav synchronizace s Raynetem.
- **`rezervace/nastaveni.html` (admin):** služby, přiřazení designérů ke službám a studiím, `raynetUserId`, otevírací doby studií.

## 11. Fáze

- **F0 Průzkum (bez kódu):**
  - Raynet API (body z kapitoly 5),
  - co přesně dělá dnešní Make scénář Reservanto → Raynet (pole, kontakt, párování),
  - co Reservanto dnes umí a nesmí se ztratit.
  - Výstup: `docs/rezervace-pruzkum.md`.
- **F1 Jádro:** model, rules, nastavení, kalendář designéra, slotovací logika, interní ruční rezervace, veřejná stránka (neodkazovaná, pilot), Raynet push i čtení obsazenosti.
- **F2 Notifikace:** SmartEmailing (e-mail a SMS), hromadný e-mail, odkaz pro správu rezervace, alert prázdného kalendáře. **Bez F2 se Reservanto nevypíná.**
- **F3 Napojení a reporting:**
  - Leady (uzavření jako schůzka → rezervace místo ručního `meeting{}`),
  - Návštěvnost (rezervace vs. „na blind“),
  - reporting rezervací (kampaň → rezervace → uskutečněno), počty schůzek po designérech (Matouš),
  - vložení na web, přechod z Reservanta.
- **Později:** SYROVÝ PRO rezervace partnerem (externí účty → nejdřív Bezpečnostní audit a role).

## 12. Dopady na existující moduly

- **Leady:** v F1 se nesahá. `meeting{}` zůstává. Napojení přijde v F3.
- **Návštěvnost:** v F1 se nesahá.
- **`users`:** přibude pod-objekt `reservations`. Úzká rule pro vlastníka (`mustChangePassword`) se nesmí rozvolnit a `onboardEmployee`/`offboardEmployee` nesmí pole přepsat.
- **SLA logika z Leadů** (`leady-sla.js`, svátky): nekopírovat třetí kopii. Svátky a pražský čas vytáhnout do sdílené utility pro functions. Kopii v `public/leady/` nechat beze změny.
- **Funkce:**
  - první veřejné rezervační `onRequest` funkce (Cloud Run Invoker `allUsers`, viz Známé pasti),
  - pravděpodobně **první `onSchedule` funkce** v projektu (Cloud Scheduler API, IAM). Počítat s pastmi jako u první `onCall`.
- **Hosting:** `public/rezervovat/` je první stránka bez `requireAuth()`. Nesmí načítat `auth-common.js` způsobem, který přesměruje na login.

## 13. Otevřené body k odsouhlasení (⚠️)

1. Návrh doma jako `requested` → potvrzení CX po úhradě zálohy, platba mimo systém.
2. Předstih: studio 1 h, doma 2 dny. Kalendářní, nebo pracovní dny?
3. Délky služeb 60 / 120 min.
4. Horizont 60 dní.
5. Adresa hromadného rezervačního e-mailu.
6. Komu chodí alert „prázdný kalendář“.
7. Zakládat v Raynetu kontakt, když se nenajde (riziko duplicit), nebo jen událost bez kontaktu a CX spáruje?
8. Infolinka (obsazená linka, ~10 hovorů denně) je mimo tento modul. Martin řeší s Petrem.

**Doplněno z průzkumu F0 (`docs/rezervace-pruzkum.md`), 2026-11-05:**

9. Rozestup mezi schůzkami (buffer) — `res_services.bufferMin`, výchozí 0.
10. Vlastní pole ve veřejném formuláři (např. „Co plánujete“) — ve F1 jen volná poznámka.
11. Souhlas se zpracováním osobních údajů ve veřejném formuláři — ve F1 informativní text s odkazem na zásady (`config/rezervace.privacyUrl`), bez checkboxu.
12. Která entita Raynetu — Událost, nebo Schůzka (dnešní Make scénář)? Výchozí Událost, `config/rezervace.raynet.writeEntity`. Obsazenost se čte z obou.
13. Zrušení v Raynetu smazáním (výchozí), nebo přejmenováním — `config/rezervace.raynet.cancelMode`.

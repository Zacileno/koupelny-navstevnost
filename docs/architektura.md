# Architektura — rozhodnutí

Log větších architektonických rozhodnutí platformy. Detaily modulů viz `CLAUDE.md`.

---

## 2026-07-16 — Modul Dovolená

**Kontext:** Potřeba jednoduché evidence dovolených — kdo je pryč, kdo ho zastupuje a jak ho kontaktovat, s přehledem pro CEO napříč celou firmou.

**Rozhodnuto:**

1. **Zadávání žádostí — self-service se schválením.** Zaměstnanec si žádost zakládá sám (ne HR/vedoucí za něj), ale žádost prochází schvalovacím krokem při kolizi (viz bod 3). Vyžaduje Firebase Auth účet pro každého zaměstnance.

2. **Zástup se vybírá při každé žádosti**, není to pevně přiřazená hodnota u osoby v `users`. Důvod: reálný zástup se mění podle toho, kdo je zrovna k dispozici, pevný default by rychle zastaral a musel by se ručně přepisovat.

3. **Schvalování kolizí — vědomě odloženo.** Když je z jednoho oddělení (`department`) na dovolené víc lidí najednou v překrývajícím se období, něco to musí schválit — ale kdo (vedoucí oddělení? CEO? jen upozornění bez blokace?) zatím není rozhodnuto. Do rozhodnutí bude kolize jen viditelná jako `pending_collision` stav v CEO přehledu, bez vynucené blokace. Toto je explicitně poslední věc, která se v tomto modulu doděla, ne blokující pro zahájení práce na zbytku.

4. **Auth od začátku, ne dodatečně, a sdílený napříč platformou** (viz samostatné rozhodnutí "Sdílený platformový login" níže) — Dovolená bude první modul, který sdílený login používá.

**Datový model (návrh):**

Kolekce `vacations`:
| Pole | Typ | Poznámka |
|------|-----|----------|
| `userId` | string (slug) | ref na `users` |
| `startDate`, `endDate` | date | |
| `substituteUserId` | string (slug) | ref na `users`, voleno per žádost |
| `note` | string, nepovinné | |
| `status` | `confirmed` \| `pending_collision` \| `cancelled` | |
| `department`, `studios` | denormalizováno z `users` v čase zadání | kvůli kolizním dotazům bez joinů |
| `createdAt`, `createdBy` | | |

**Otevřeno:** mechanismus schválení kolize (kdo, kdy, jak) — viz technický dluh v `CLAUDE.md`.

**Implementováno (2026-07-16):** `public/dovolena/dovolena.html` (žádost), `public/dovolena/dovolena-dashboard.html` (CEO přehled), `public/dovolena/dovolena-common.js`. Kolize se počítá čistě na klientovi (rovnostní dotaz na `department`, přesah rozsahu vyhodnocen v JS) — vědomě bez composite indexu, protože objem dat na jedno oddělení je v jednotkách záznamů. Ověřeno jen po stránce "neautentizovaný uživatel se správně přesměruje" — plný flow (založení žádosti, detekce kolize, CEO přehled) čeká na první reálný účet ze `seed-users-auth.js`.

---

## 2026-07-16 — Schvalování kolizí

**Kontext:** Bod 3 výše byl vědomě odložený. Martin dodal `Kontakty - všechna oddělení_.md` (interní organigram) a rozhodl, kdo má kolize schvalovat.

**Zjištění z organigramu, které změnilo návrh:** Obchodní tým (`department: sales`) nemá jednoho vedoucího — dělí se po studiích na dva manažery (Jakub Krčmarik: Praha+Brno, Barbora Syrová: Pardubice+Hradec Králové). Kolize počítaná jen podle `department` by tak nesprávně slučovala dva reálně nezávislé týmy. **Řešení:** nové pole `users/{slug}.managerSlug` (kdo danou osobu manažersky kryje) se stalo jedinou grupovací i schvalovací klíčem — nahrazuje `department` v `findCollision`. Pro sales se tím přirozeně rozpadne na dvě skupiny; pro ostatní oddělení efektivně vychází nastejno jako `department`, ale bez zvláštního kódu navíc.

**Mapování `managerSlug` (zapsáno přímo do `users`, 22 lidí):**
- sales/Praha+Brno → `jakub-krcmarik`; sales/Pardubice+Hradec → `barbora-syrova`
- Jakub, Barbora (jsou sami manažeři), Kristýna Syrová (bez studiové vazby) → `matous-syrovy`
- operations (Martina Pišvejcová, Veronika Tkáčová, Vladimír Jirásek) → `jan-lagron`; Jan Lagron sám → `matous-syrovy`
- realizace: Petr Lochman, Tereza Kotasová → `matous-syrovy` (v organigramu bez jasného manažera, Martinovo explicitní rozhodnutí)
- accounting (Šárka Syrová), marketing (Martin Paclík) → `matous-syrovy` (fallback, žádný jasný manažer/je to oni sami)
- Matouš Syrový (CEO) → bez pole, špička hierarchie

**Univerzální fallback:** kdykoliv není jasný manažer nebo je žadatel sám manažer, jde to na CEO Matouše Syrového — natvrdo `mySlug() == 'matous-syrovy'` ve Firestore rules (malá firma, jeden CEO, nemá smysl to zobecňovat na roli).

**Mechanismus schválení — záměrně oddělená stránka, ne tlačítka v obecném přehledu.** Martin chtěl `dovolena-dashboard.html` zachovat jako čistý přehled přístupný celé firmě (kalendář, tabulka, seznam kolizí bez akcí). Schvalování je nová `public/dovolena/dovolena-schvaleni.html` — vidí a řeší tam jen ten, komu `managerSlug` žádosti odpovídá jeho vlastnímu slugu, plus CEO vždy (pojistka). Obecný přehled dostal jen nenápadný odkaz „Máš X ke schválení", viditelný výhradně tomu, kdo má co řešit.

**Datový model — rozšíření:**
- `vacations.managerSlug` — denormalizace `users/{userId}.managerSlug` v čase zadání (stejný vzor jako `department`/`studios`), určuje grupování i schvalovatele.
- `vacations.status` — přidán čtvrtý stav `rejected` (odlišný od `cancelled`: zamítl manažer, ne zrušil sám žadatel). Zamítnuté/zrušené dovolené mizí z kalendáře a tabulky nadcházejících, ale zůstávají vidět v „Moje dovolené" u žadatele.
- `vacations.resolvedBy`, `resolvedAt` — kdo a kdy kolizi rozhodl.

**Firestore rules:** nové `allow update` pro `vacations` — smí jen ten, kde `mySlug() == resource.data.managerSlug` nebo `mySlug() == 'matous-syrovy'`, jen když je stav `pending_collision`, jen posun na `confirmed`/`rejected`, a jen tahle tři pole (`status`, `resolvedBy`, `resolvedAt`) — nejde to zneužít k přepsání zbytku žádosti.

**Ověřeno end-to-end na produkci:** reálná kolize (Nikola Moon, spadá pod Barboru) → Barbora ji viděla na `dovolena-schvaleni.html` s kontextem „Koliduje s: Natálie Pokorná" → Schválit → `status: confirmed`, `resolvedBy: barbora-syrova`. Testovací data i dočasná hesla po sobě uklizena, oba účty vráceny do stavu „ještě nepřihlášeno" (sdílené heslo + `mustChangePassword: true`), ať si Nikola a Barbora projdou reálně stejný first-login flow jako zbytek týmu.

**Zůstává otevřené:** notifikace (manažer se o nové kolizi dozví, jen když sám navštíví `dovolena-schvaleni.html` — bez push/e-mailu, viz existující dluh „Notifikační systém").

---

## 2026-07-16 — Sdílený platformový login

**Kontext:** Do teď má Firebase Auth jen Adaptace, s vlastní login stránkou (`public/adaptace/login.html`) a vlastní kopií Firebase inicializace v `adaptace-common.js`. Modul Dovolená je druhý modul, který auth potřebuje — a v `CLAUDE.md` je jako dluh zapsané zavedení auth i pro Návštěvnost, CX a Realizaci. Bez zásahu by tak postupně vznikaly 4–5 skoro identických login stránek a oddělených účtů.

**Rozhodnuto:** Jeden sdílený login pro celou platformu, ne per-modul.

- **Technický fakt, který to umožňuje:** Firebase Auth účty jsou vázané na celý Firebase projekt (`koupelny-navstevnost`), ne na konkrétní modul/stránku. Stejný e-mail a heslo tedy může fungovat napříč Adaptací, Dovolenou i budoucími moduly bez jakékoliv extra práce na straně Firebase — je to čistě otázka, jestli si to frontend takhle postaví.
- **Návrh struktury:**
  - Nová sdílená stránka `public/login.html` (kořen, ne pod konkrétním modulem)
  - Sdílený JS modul (např. `public/shared/auth-common.js`) — vytáhne `initFirebase`/`getUserProfile`/`getCurrentUser` z `adaptace-common.js` na jedno místo, aby to nebylo duplikované v každém modulu
  - Po přihlášení redirect: pokud uživatel přišel z chráněné stránky (`?redirect=...`), vrátí se tam; jinak na jednoduchý výběr modulů podle toho, k čemu má přístup
- **Migrace Adaptace:** `public/adaptace/login.html` zůstává funkční (nic se nerozbije, Auth je sdílené na úrovni projektu už teď), ale je to teď duplicitní kód k postupnému sjednocení — nejde o urgentní refaktor, jen o vědomý technický dluh.
- **Zakládání účtů a první heslo:** administrátorský Node skript (rozšíření vzoru `scripts/seed-adaptation.js`) projede kolekci `users`, pro každého bez Auth účtu založí účet přes Admin SDK (`admin.auth().createUser`) s náhodným heslem, které se nikam neukládá ani nevypisuje, a rovnou spustí Firebase `sendPasswordResetEmail` na jeho e-mail. Uživatel dostane standardní Firebase e-mail s odkazem „nastavte si heslo" a heslo si zvolí sám. Nikdo (včetně admina) tak nikdy neuvidí ani nepřenáší heslo v plaintextu — bezpečnější než dosavadní ruční předávání dočasných hesel u Adaptace.
- **Zapomenuté heslo:** login stránka dostane odkaz „Zapomenuté heslo?", který znovu spustí `sendPasswordResetEmail` — dřív nebo později to bude potřeba i tak, dává smysl udělat to hned se sdíleným loginem.

**Otevřeno:** přesný design "výběru modulů" po loginu (kdo vidí které moduly — zatím není řešeno přístupové řízení podle role, to je Fáze 3 v `CLAUDE.md`).

**Implementováno (2026-07-16):** `public/login.html`, `public/shared/auth-common.js`, `public/shared/shared.css`, `scripts/seed-users-auth.js`. Dvě odchylky od původního návrhu výše, obě vědomé:

- Místo `getUserProfile`/`uid`-based identity (vzor z Adaptace) se používá custom claim `slug` na Auth účtu, který přímo odpovídá ID dokumentu `users/{slug}` — umožňuje to Firestore rules ověřovat vlastnictví (`request.auth.token.slug`) bez extra `get()` dotazu. Nastavuje se v `seed-users-auth.js` přes `admin.auth().setCustomUserClaims`.
- Místo klientského `sendPasswordResetEmail` z prohlížeče volá bootstrap skript přímo Identity Toolkit REST endpoint (`accounts:sendOobCode`) ze serveru — funkčně stejný výsledek (Firebase pošle standardní e-mail s odkazem na nastavení hesla), ale nevyžaduje to přidávat klientský `firebase` npm balíček jen pro jeden skript.
- Místo "výběru modulů" po loginu bez `?redirect=` parametru je zatím natvrdo default `/dovolena/dovolena.html`, protože je to jediný modul, co sdílený login používá. Skutečný picker dává smysl řešit, až přibude druhý modul na sdíleném loginu.
- Bezpečnostní pojistka navíc oproti návrhu: `seed-users-auth.js` má `--send` (jen s `--only <slug>`, pro test na jednom účtu) oddělené od `--send-all` (hromadné rozeslání) — nejde je spustit zaměnit omylem.
- **Skript zatím neběžel proti produkci.** Až bude čas testovat: `node scripts/seed-users-auth.js --only <slug> --send` na jeden účet (doporučeno Martinův), pak teprve `--send-all` pro zbytek.

**Ověřeno na produkci (2026-07-16):** Při prvním spuštění `--only martin-paclik --send` skript spadl na `auth/configuration-not-found` — Firebase Authentication nebyl pro projekt `koupelny-navstevnost` vůbec zapnutý (potvrzeno i read-only `listUsers()`, který vracel stejnou chybu — v projektu neexistoval žádný Auth účet, ani z Adaptace). Tohle je systémové nastavení projektu, ne něco, co jde zapnout skriptem — Martin ho zapnul ručně ve Firebase Console (Authentication → Sign-in providers → Email/Password → Enable → Save). Po zapnutí skript proběhl bez chyby: účet založen, claim `slug` nastaven, `uid` zapsán do `users/martin-paclik`, e-mail s odkazem na nastavení hesla odeslán na `martin.paclik@koupelny-syrovy.cz`. **Zjištění:** Adaptace měla v `CLAUDE.md` status "Fáze 0 (Auth) ✅", ale reálně přes ni nikdy neproběhlo přihlášení mimo demo mód (`?demo=1`) — kód existoval, backend service nikdy nebyl zapnutý.

**Pivot na sdílené dočasné heslo (2026-07-16):** E-mail s odkazem na nastavení hesla nedošel ani na `koupelny-syrovy.cz`, ani (kontrolní test) na Martinovu vlastní doménu `zacileno.cz` — obě prázdné i po kontrole spamu, což ukazuje na problém s doručováním u tohoto Firebase projektu obecně, ne na filtr konkrétní firemní domény. Diagnostika (DNS/SPF/DKIM u odesílací domény Firebase) by zabrala čas, který Martin pod tlakem neměl, takže padlo vědomé rozhodnutí přejít na dočasné sdílené heslo pro bootstrap:

- Všichni dostanou stejné dočasné heslo `"ZmenSiHeslo"` (konstanta `SHARED_PASSWORD` v `seed-users-auth.js`, spouští se přes `--shared-password`).
- Aby dočasné heslo nezůstalo trvalou dírou (kdokoliv ze znalosti hesla + e-mailu kolegy by se mohl přihlásit za něj), přidán vynucovací gate: `users/{slug}.mustChangePassword` (boolean, `true` při bootstrapu). `requireAuth()` v `shared/auth-common.js` kontroluje tento flag a přesměruje na novou stránku `public/change-password.html`, než pustí kamkoliv dál. Po úspěšné změně hesla (`updatePassword`) klient nastaví `mustChangePassword: false` — Firestore rules u `users/{slug}` to dovolují jen vlastníkovi (`request.auth.token.slug == slug`) a jen jako jedinou dovolenou změnu pole (`affectedKeys().hasOnly(['mustChangePassword'])`, hodnota musí být `false`) — nejde tak zneužít k přepsání jiných polí cizího profilu.
- `--send`/`--send-all` (e-mailová cesta) zůstávají v skriptu zachované pro případ, že se doručování později opraví — obě cesty jde spustit, ale ne zároveň.
- Bezpečnostní pojistka zachována i pro sdílené heslo: `--shared-password` vyžaduje buď `--only <slug>` (test na jednom účtu), nebo výslovné `--all`.
- **Zbytkové riziko** (Martin ho vědomě akceptoval kvůli časovému tlaku): dokud si všichni heslo nezmění, kdokoliv znalý `"ZmenSiHeslo"` by se s cizím firemním e-mailem mohl přihlásit za kolegu. Menší dopad, protože Dovolená zatím vystavuje jen termíny nepřítomnosti a kontakty, ne citlivější data. Doporučeno časem přejít zpět na individuální hesla, až se vyřeší doručování e-mailu (vlastní ověřená odesílací doména nebo transakční e-mailová služba) — zapsáno jako technický dluh v `CLAUDE.md`.
- **Bug v datech objevený při běhu:** `users/tereza-kotasova.email` obsahoval dvě adresy v jednom stringu (`"fakturace@syrovydevelopment.cz, pece@koupelny-syrovy.cz"`) — Firebase to odmítl jako neplatný formát a shodil celý běh skriptu uprostřed (opraveno: per-uživatel try/catch, jedna chyba už neshodí zbytek běhu). `users/vladimir-jirasek` neměl e-mail vůbec. Martin upřesnil správné adresy (`pece@koupelny-syrovy.cz`, `vladimir.jirasek@koupelny-syrovy.cz`), opraveno přímo v Firestore.
- **Nasazeno a ověřeno end-to-end na produkci:** `firestore.rules` (přes `firebase deploy --only firestore:rules`) i `public/` (přes `firebase deploy --only hosting`) nasazeny — odchylka od CLAUDE.md konvence "deploy přes Warp", vědomě po explicitním souhlasu Martina v konverzaci. Plný flow (login sdíleným heslem → vynucená změna → žádost o dovolenou → CEO přehled se zástupem a kontaktem) prošel na `koupelny-navstevnost.web.app`. **Výsledek bootstrapu:** 23 z 23 aktuálních zaměstnanců má účet, 4 externí a 1 deaktivovaná osoba (Barbora Lojkásková, bez e-mailu) záměrně vynecháni.
- Mimochodem objeveno (nesouvisí s Dovolenou): čtyři sirotčí dokumenty v `users` klíčované Firebase UID místo slugem (`{uid, name, role, studioKey}` pro Matouše Syrového, Martina Paclíka, Petru Hindrákovou a "Barča Syrová" — duplicita Barbory Syrové, patrně z dřívějšího ručního testu Adaptace) — způsobovaly duplicity ve výběru zástupce v Dovolené (opraveno filtrem na `email` v `listSubstituteCandidates`), a později smazány (2026-07-16, na Martinovo přání).

**Bug objevený po nasazení (2026-07-16):** Po `--shared-password --all` Martinovi přestalo fungovat přihlášení heslem, které si sám nastavil — `ensureAuthUser` totiž při každém běhu skriptu s `--shared-password` bezpodmínečně přepsalo heslo *i* u účtů, které už prošly vynucenou změnou, a `ensureMustChangePassword` jim zase natvrdo nastavilo `mustChangePassword: true`. Důsledek: kdykoliv by se skript v budoucnu spustil znovu (např. `--all` kvůli nasazení nového kolegy), tiše by to všem 23 lidem vrátilo heslo na `"ZmenSiHeslo"` a zrušilo jejich vlastní — bez jejich vědomí. **Oprava:** `ensureAuthUser` dostal parametr `alreadyPersonalized` (odvozený z `users/{slug}.mustChangePassword === false`) — u takových účtů heslo ani `mustChangePassword` už nesahá. Ověřeno přes `--dry-run`: skript teď u `martin-paclik` (jediný, kdo si heslo v tu chvíli reálně změnil) hlásí přeskočení, u zbytku týmu normální reset. Invariant do budoucna: jakmile má `mustChangePassword: false`, skript se toho účtu na heslo/flag už nikdy nedotkne.

---

## 2026-07-16 — Adaptace: druhá šablona (Projektový specialista/designér, 90 dní)

**Kontext:** Modul Adaptace měl jen jednu šablonu ("Obchodník 14 dní") — pevné dny s ráno/odpoledne bloky, jeden `supervisorId` na adaptaci. Reálný plán pro roli Projektový specialista/designér má jinou strukturu: 90 dní / 12 týdnů ve 3 fázích, cíle vázané na konkrétní jmenovanou osobu (buddy, manažer, senior specialista, zástupce manažera — ne jeden generický vedoucí), plus průřezový seznam kvótových cílů (např. "min. 20 obchodních nabídek") platný celých 90 dní, nevázaný na den.

**Rozhodnuto:**

1. **Dvě šablony vedle sebe, ne migrace.** Nové pole `templateType` na dokumentu `adaptations` (`'daily'` implicitně, `'weekly'` pro novou šablonu) rozhoduje, který render/write kód se použije v `muj-plan.html`/`tym.html`. Stará šablona a její data zůstávají nedotčená.

2. **Jmenované role per adaptaci, ale potvrzuje výhradně manažer.** Adaptace nese mapu `roles: { manager, managerDeputy, seniorSpecialist, buddy }` (`{uid, name}` u každé role) — buddy/senior specialista/zástupce manažera se zobrazují u cílů jako informace, kdo s daným cílem pomáhá, ale nemají Firebase Auth účet ani Firestore přístup (`uid: null`). Jediná role s přístupem je `manager`, protože ten reálně adaptaci vyhodnocuje a potvrzuje — proto Firestore rules `isAssignedRole()` kontrolují jen jeho, ne globální roli `supervisor`. Jedna fyzická osoba může být ve dvou slotech zároveň (např. manažer je zároveň senior specialista).

3. **Zápis do Firestore vždy jako celé pole, nikdy dot-path na index.** Firestore neumí adresovat prvek pole podle indexu (`phases.0.weeks.1.goals.2.status` nefunguje spolehlivě — pole nejsou mapy). Nový kód (`toggleGoal`, `confirmGoal`, `withGoalUpdate` v `muj-plan.html`/`tym.html`) proto vždy čte celé pole `phases`/`ongoingCategories`, změní jeden prvek immutable mapováním a zapíše celé pole zpátky. **Pozor:** stávající starý kód pro denní šablonu (`toggleTask`, `completeDay`, `confirmDay`, `rejectDay`) tento anti-pattern používá (`days.${i}.blocks`) — nebylo to opravováno v rámci téhle práce (mimo rozsah), ale je to nutné ověřit/opravit, až se denní šablona poprvé použije mimo demo mód.

4. **Kvótové cíle bez per-goal potvrzování.** Cíle s `targetCount` (např. "min. 5 follow-upů") se jen sčítají (`currentCount`), auto-`completed` při dosažení cíle, bez samostatného kroku potvrzení vedoucím — jinak by potvrzovací fronta byla zahlcená desítkami drobných čísel. Cíle bez kvóty (`targetCount: null`) jsou prostý checkbox se stejnou logikou jako týdenní cíle.

5. **Zahájení adaptace bez admin konzole.** Dokud neexistuje Fáze 3 admin UI, `scripts/seed-adaptation.js` (Node, `firebase-admin`, stejný vzor jako `scripts/import-cx-feedback.js`) idempotentně založí Auth účty (e-mail+heslo) + `users` dokumenty pro nováčka a jmenované role a založí `adaptations` dokument ze šablony přes `buildWeeklyProgress()`.

**Otevřeno:** ~~oprava array-dot-path bugu ve staré denní šabloně (bod 3)~~ — opraveno, viz níže.

**Opraveno (2026-07-16):** `toggleTask`/`completeDay` v `muj-plan.html` a `confirmDay`/`rejectDay` v `tym.html` přepsány na stejný vzor jako `toggleGoal`/`withGoalUpdate` — nová `withDayUpdate(days, dayIndex, patch)` klonuje pole `days` a mění jen jeden prvek, zápis vždy `updateDoc(ref, { days })` (u `completeDay` navíc `currentDayIndex` jako samostatné skalární pole). Ověřeno mimo demo mód: Firestore emulátor nešlo spustit (chybí Java runtime, instalace OpenJDK vědomě přeskočena), místo toho Node test (`toggleTask`/`completeDay`/`confirmDay`/`rejectDay` extrahované přímo ze souborů a spuštěné proti fake Firestore, který vynucuje reálné omezení — dot-path segment nesmí adresovat prvek pole) potvrdil: zápis je vždy jediné pole `days` (nikdy dot-path), ostatní dny zůstávají nedotčené, cílový den se změní správně. Starý dot-path vzor byl týmž testem ověřen jako by ho reálný Firestore odmítl.

---

## 2026-07-17 — Adaptace: getUserProfile vracel špatný profil (admin práva nefungovala)

**Kontext:** Martin nahlásil, že `tym.html` ho po přihlášení přesměrovává na `muj-plan.html`, přestože měl mít roli `admin`.

**Zjištění:** `getUserProfile(uid)` dotazoval `users` kolekci přes `where('uid','==',uid)` — dotaz na hodnotu pole, ne přímý `get()` podle ID dokumentu. Firestore rules (`userRole()`) přitom vždy počítaly s přímým `get(users/{uid})`. Když měl někdo zároveň slug-keyed profil ze sdíleného loginu/Dovolené (`users/martin-paclik`, s polem `uid` nastaveným při bootstrapu) i uid-keyed profil z Adaptace (`users/{uid}`, s rolí `admin`), dotaz mohl vrátit kterýkoliv z nich — v tomto případě ten špatný (slug-keyed, bez pole `role`). Navíc se ukázalo, že `users/{uid}` dokumenty pro Martina, Matouše, Barču a Petru se z prvního běhu `seed-adaptation.js` vůbec nezapsaly (příčina nedohledána, pozdější běhy pro ostatní lidi fungovaly správně) — opraveno ručním zápisem přes Admin SDK.

**Oprava:** `getUserProfile` teď zkouší nejdřív přímý `getDoc(users/{uid})` (stejný předpoklad jako mají rules), a teprve pak padá zpátky na dotaz podle pole `uid` a nakonec podle e-mailu. Deterministické i do budoucna, kdyby oba typy profilu u někoho koexistovaly.

---

## 2026-07-17 — Sdílený login: chytrý výchozí redirect + zavření mustChangePassword mezery

**Kontext:** Adaptace zatím nepoužívá sdílený `requireAuth()` (viz dřívější rozhodnutí — není to urgentní refaktor), takže `/adaptace/muj-plan.html` sám o sobě nekontroluje `mustChangePassword`. Zároveň `/login.html` měl natvrdo výchozí přesměrování na `/dovolena/dovolena.html`, i pro lidi, co mají aktivní adaptaci a nic v Dovolené.

**Rozhodnuto:** `public/login.html` teď po přihlášení (bez explicitního `?redirect=`) sám zjistí, jestli přihlášený má aktivní `adaptations` dokument (`employeeId == uid`, `status in ['active','paused']`) — pokud ano, pošle ho na `/adaptace/muj-plan.html`, jinak zůstává výchozí `/dovolena/dovolena.html`. Zároveň se **formulářové přihlášení teď vždy provede přes sdílené `requireAuth()`** (dřív to dělal jen "už přihlášený" auto-redirect blok, ne samotné odeslání formuláře) — tím se `mustChangePassword` kontroluje centrálně na jednom místě při loginu, bez ohledu na to, kam se pak směruje, takže vynucená změna hesla funguje i pro cestu do Adaptace, přestože `muj-plan.html` samo o sobě tuhle kontrolu neumí.

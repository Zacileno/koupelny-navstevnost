# Modul Rezervace — průzkum (fáze 0)

*2026-11-05 · navazuje na `docs/rezervace-spec.md`. U každého bodu je uvedeno, jestli je **ověřeno** (zdroj) nebo **odhad** (vyzkoušet na živém Raynetu, až bude `config/raynet`).*

Zdroj pro Raynet: oficiální dokumentace API v2 `https://app.raynet.cz/api/doc/` (OpenAPI, staženo 2026-11-05). Na živém Raynetu se nic nezkoušelo, credentials zatím nejsou.

## Verdikt ke stop podmínce

**Pokračujeme fází 1.** Obě podmínky z tasku jsou splněné:

- události jde číst podle vlastníka a období (`owner-id`, `scheduledFrom[GE]`/`[LT]`) — **ověřeno** (dokumentace),
- vlastní událost jde spolehlivě poznat: platforma si ukládá `raynet.eventId` u rezervace a při čtení obsazenosti přeskočí události s tímto ID. Navíc dostane událost externí ID `platforma-rezervace:<bookingId>` a štítek. Párování podle uloženého ID nezávisí na tom, jestli seznam vrací `extIds` — **ověřeno** (ID vrací `PUT /event/` v odpovědi).

## 1. Raynet API

| Téma | Zjištění | Stav |
|---|---|---|
| Base URL | `https://app.raynet.cz/api/v2/` | ověřeno |
| Autentizace | HTTP Basic `uživatel:API klíč` + hlavička `X-Instance-Name: <instance>`. Alternativně Bearer token (`GET /userAccount/bearerToken/`). Použijeme Basic — nic se neobnovuje. API klíč si generuje uživatel v Raynetu (Nastavení účtu). | ověřeno |
| Technický uživatel | Zápisy a čtení půjdou pod jedním uživatelem, jehož klíč je v `config/raynet`. Ten musí **vidět kalendáře všech designérů** (bezpečnostní úroveň) — jinak čtení obsazenosti vrátí méně, než je pravda. | odhad, ověřit na instanci |
| Časová zóna | `yyyy-MM-dd HH:mm` je v časové zóně API uživatele. Bezpečnější je ISO8601 s offsetem pro zápis a `dateFormat=ISO8601` pro čtení — implementováno tak. | ověřeno |
| Seznam událostí | `GET /event/?owner-id=<id>&scheduledFrom[LT]=<do>&scheduledTill[GT]=<od>&limit=1000&offset=…` (filtry `owner-id`, `scheduledFrom`, `scheduledTill` s operátory GT/GE/LT/LE, max `limit` 1000) | ověřeno |
| Schůzky vs. události | Raynet má dvě kalendářní entity: **Událost** (`/event/`) a **Schůzka** (`/meeting/`), obě s `owner-id`. Nevíme, kterou designéři používají pro 2. schůzky → čtení obsazenosti čte obě (konfigurovatelné `config/rezervace.raynet.busyEntities`, výchozí `["event","meeting"]`). | API ověřeno, používání odhad |
| Vlastník | `owner` = **ID kontaktní osoby** uživatele Raynetu (ne ID uživatelského účtu). Do `users/{slug}.reservations.raynetUserId` patří tohle ID. Dohledá se v `GET /userAccount/` (osoba navázaná na účet). | ověřeno (popis pole), konkrétní hodnoty odhad |
| Založení události | `PUT /event/` s `title`, `owner`, `person`, `scheduledFrom`, `scheduledTill`, `description`, `meetingPlace`, `tags`. Odpověď `{ data: { id } }` | ověřeno |
| Úprava | `POST /event/{id}/` (stejná pole) | ověřeno |
| Zrušení | `DELETE /event/{id}/`. Spec připouští „zrušit nebo smazat“ — implementováno **smazáním** (jednoznačné, obsazenost se uvolní). Alternativa: přejmenovat na „ZRUŠENO – …“; přepnutelné v `config/rezervace.raynet.cancelMode` (`delete`/`rename`). | ověřeno |
| Externí ID | `PUT /{entity}/{id}/extId/` body `{ extId }`, entita `event` podporovaná; čtení `GET /event/ext/{extId}/`. Používáme `platforma-rezervace:<bookingId>`. | ověřeno |
| Kontakt podle e-mailu | `GET /person/?contactInfo.email=<email>` (operátor EQ) | ověřeno |
| Kontakt podle telefonu | **Pro telefon filtr v dokumentaci není.** Jen `fulltext=…`. Implementováno: fulltext podle posledních 9 číslic, výsledky se ověří normalizací `contactInfo.tel1`/`tel2`. Jestli fulltext hledá v telefonech (a ve formátu s mezerami) — **odhad, nutno vyzkoušet**. Pořadí ve specu (telefon, pak e-mail) proto v kódu je: telefon (fulltext + ověření), pak e-mail. | částečně |
| Založení osoby | `PUT /person/` s `firstName`, `lastName`, `contactInfo { email, tel1, tel1Type }`, `owner` | ověřeno |
| Limity | 24 000 požadavků/den na instanci (reset o půlnoci UTC), max 4 souběžná spojení na klienta, 429 při překročení, 20 chybných loginů z IP = blok 60 min. Čtení obsazenosti à 10 min × ~16 designérů × 2 entity ≈ 4 600/den + živé kontroly → v limitu, ale ne zanedbatelné (instance sdílí limit i s Make). Volání jdou sériově, ne paralelně. | ověřeno |
| Webhooky | Existují (`PUT /webhook/`, `entityFilter: ["Event","Meeting"]`, `record.created/updated/deleted`, hlavička `X-RAYNETCRM-Token`, payload obsahuje `entityName`, `entityId`, `extIds`, opakované doručení při výpadku). **Mohou později nahradit pravidelné čtení** i hlídání „přesunuto v Raynetu“. Ve F1 záměrně ne: payload nenese čas ani vlastníka (musí se stejně dočíst detail), přidal by další veřejný endpoint a polling je jednodušší na ladění. | ověřeno |
| Optimistic lock | API zápis `_version` ignoruje — POST přepíše i to, co mezitím změnil člověk v prohlížeči. Proto přesun z platformy nejdřív načte detail a porovná čas (detekce „přesunuto v Raynetu“). | ověřeno |

## 2. Dnešní Make scénář Reservanto → Raynet

**Nepřečteno — agent nemá přístup do Make** (žádný nástroj ani přihlášení v této session). Otevřený bod pro Martina/Elišku, odpovědět před pilotem:

1. Jaká pole jde z Reservanta do Raynetu (název události, popis, místo, kategorie)?
2. Zakládá scénář kontakt (osobu), páruje na existující? Podle čeho?
3. Páruje na obchodní případ? (Platforma podle specu OP nezakládá ani nečte.)
4. Co dělá při přesunu a zrušení v Reservantu?
5. Je to **Událost** nebo **Schůzka** v Raynetu? → určuje, co mají designéři v kalendáři a jakou entitu má platforma zakládat. F1 zakládá Událost (podle specu), přepnutelné v `config/rezervace.raynet.writeEntity` (`event`/`meeting`).
6. Kategorie / štítek události, podle kterého se dnes reportuje (Matouš: počty schůzek po designérech)?

Nic v Make se neměnilo.

## 3. Reservanto — co dnes umí a nová verze nesmí ztratit

Zdroj: `reservanto.cz/vlastnosti` (veřejný web, 2026-11-05) + spec. Které z toho Koupelny Syrový reálně používají, z webu poznat nejde — **odhad, potvrdit s Eliškou/CX**.

| Funkce Reservanta | Ve specu | Poznámka |
|---|---|---|
| Rezervační formulář na webu (barvy, logo) | ✅ kap. 7 | |
| Potvrzovací e-mail, editovatelné šablony | ✅ F2 | |
| SMS připomínka | ✅ F2 | |
| Zrušení / přesun klientem přes odkaz | ✅ F2 (`manageToken`) | |
| Vlastní pole ve formuláři (rezervace i klient) | ⚠️ doplněno do specu | např. „Co plánujete“, fotky koupelny? |
| Souhlas se zpracováním osobních údajů ve formuláři | ⚠️ doplněno do specu | veřejný formulář sbírá jméno/telefon/e-mail → odkaz na zásady + text souhlasu; ve F1 je text informativní |
| Online platby, vouchery, e-shop, věrnostní program, sklad, POS | mimo | platba zálohy řeší CX ručně (spec ⚠️1) |
| Dotazník spokojenosti po návštěvě | mimo | dělá CX telefonicky (modul CX) |
| Přehled historie klienta, reporty | F3 | |
| Rozestup mezi schůzkami (buffer) | ⚠️ doplněno do specu | Reservanto ho běžně má; implementováno `bufferMin` na službě, výchozí 0 |
| Export do kalendáře designéra (Google/iCal) | — | nepotřeba: událost se zakládá v Raynetu, designér ji tam vidí |

## 4. Co z průzkumu plyne pro F1

- `config/raynet`: `{ instanceName, username, apiKey, baseUrl? }`, čte jen Admin SDK.
- Klient Raynetu (`functions/rezervace/raynet.js`) sériový, s `dateFormat=ISO8601`, mock v emulátoru přes `RAYNET_MOCK=1`.
- Vlastní událost se pozná podle `raynet.eventId` uloženého u rezervace (primárně) a extId/štítku (pojistka).
- Před pilotem ověřit na živé instanci: hledání osoby podle telefonu (fulltext), viditelnost kalendářů technického uživatele, která entita (Událost/Schůzka) se v kalendáři designérů používá.

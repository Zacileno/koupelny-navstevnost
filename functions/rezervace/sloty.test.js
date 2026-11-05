// Unit testy slotovací logiky. Spuštění: `npm test` ve functions/ (node:test, bez závislostí).

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeSlots, isSlotFree, earliestStart } = require("./sloty");
const { fromPrague } = require("../shared/cas");

const P = (y, m, d, h, min = 0) => fromPrague(y, m, d, h * 60 + min);
const hhmm = (date) => date.toLocaleTimeString("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" });

const STUDIO = { id: "konzultace-studio", type: "studio", durationMin: 60, minLeadHours: 1, horizonDays: 60 };
const HOME = { id: "navrh-doma", type: "home", durationMin: 120, minLeadHours: 48, horizonDays: 60 };

const studioBlock = (start, end, slug = "jana", studio = "praha") => ({ designerSlug: slug, serviceType: "studio", studio, start, end });
const homeBlock = (start, end, slug = "jana") => ({ designerSlug: slug, serviceType: "home", start, end });

test("studio: krok 30 min, délka 60 min, jen v bloku", () => {
  const now = P(2026, 11, 9, 8); // po 9. 11. 8:00
  const slots = computeSlots({ service: STUDIO, availability: [studioBlock(P(2026, 11, 10, 9), P(2026, 11, 10, 11))], now, studio: "praha" });
  assert.deepEqual(slots.map((s) => hhmm(s.start)), ["09:00", "09:30", "10:00"]);
  assert.equal(slots[0].end - slots[0].start, 60 * 60000);
});

test("studio: předstih jen 1 hodina", () => {
  const now = P(2026, 11, 10, 9, 10); // út 9:10
  const slots = computeSlots({ service: STUDIO, availability: [studioBlock(P(2026, 11, 10, 9), P(2026, 11, 10, 13))], now, studio: "praha" });
  // 9:10 + 60 min = 10:10 → první zarovnaný slot 10:30, ještě týž den.
  assert.equal(hhmm(slots[0].start), "10:30");
  assert.deepEqual(slots.map((s) => hhmm(s.start)), ["10:30", "11:00", "11:30", "12:00"]);
});

test("studio: blok pro jiné studio se nenabízí", () => {
  const now = P(2026, 11, 9, 8);
  const slots = computeSlots({ service: STUDIO, availability: [studioBlock(P(2026, 11, 10, 9), P(2026, 11, 10, 11), "jana", "brno")], now, studio: "praha" });
  assert.equal(slots.length, 0);
});

test("doma: předstih 48 hodin", () => {
  const now = P(2026, 11, 11, 15); // st 11. 11. 15:00 → nejdřív pá 13. 11. 15:00
  const availability = [
    homeBlock(P(2026, 11, 12, 8), P(2026, 11, 12, 16)), // čt — moc brzy
    homeBlock(P(2026, 11, 13, 8), P(2026, 11, 13, 19)), // pá — až od 15:00
  ];
  const slots = computeSlots({ service: HOME, availability, now });
  assert.equal(slots[0].start.getTime(), P(2026, 11, 13, 15).getTime());
  assert.deepEqual(slots.map((s) => hhmm(s.start)), ["15:00", "15:30", "16:00", "16:30", "17:00"]);
  assert.equal(earliestStart(HOME, now), P(2026, 11, 13, 15).getTime());
});

test("kolize s rezervací na platformě (vč. bufferu)", () => {
  const now = P(2026, 11, 9, 8);
  const availability = [studioBlock(P(2026, 11, 10, 9), P(2026, 11, 10, 12))];
  const bookings = [{ id: "b1", designerSlug: "jana", start: P(2026, 11, 10, 10), end: P(2026, 11, 10, 11), status: "confirmed" }];
  let slots = computeSlots({ service: STUDIO, availability, bookings, now, studio: "praha" });
  assert.deepEqual(slots.map((s) => hhmm(s.start)), ["09:00", "11:00"]);

  // Zrušená rezervace čas neblokuje.
  slots = computeSlots({ service: STUDIO, availability, bookings: [{ ...bookings[0], status: "cancelled" }], now, studio: "praha" });
  assert.equal(slots.length, 5);

  // Buffer 30 min: 9:00 (končí 10:00, buffer do 10:30 přes začátek 10:00) i 11:00 padají.
  slots = computeSlots({ service: { ...STUDIO, bufferMin: 30 }, availability, bookings, now, studio: "praha" });
  assert.deepEqual(slots.map((s) => hhmm(s.start)), []);

  // Při přesunu se přesouvaná rezervace neblokuje sama.
  slots = computeSlots({ service: STUDIO, availability, bookings, now, studio: "praha", excludeBookingId: "b1" });
  assert.equal(slots.length, 5);
});

test("kolize s obsazeností z Raynetu", () => {
  const now = P(2026, 11, 9, 8);
  const availability = [studioBlock(P(2026, 11, 10, 9), P(2026, 11, 10, 12)), studioBlock(P(2026, 11, 10, 9), P(2026, 11, 10, 12), "petr")];
  const busy = { jana: [{ start: P(2026, 11, 10, 9, 15), end: P(2026, 11, 10, 10, 45) }] };
  const slots = computeSlots({ service: STUDIO, availability, busy, now, studio: "praha" });
  const jana = slots.filter((s) => s.designerSlug === "jana").map((s) => hhmm(s.start));
  const petr = slots.filter((s) => s.designerSlug === "petr").map((s) => hhmm(s.start));
  assert.deepEqual(jana, ["11:00"]);
  assert.deepEqual(petr, ["09:00", "09:30", "10:00", "10:30", "11:00"]);
});

test("horizont: za hranicí horizontu se nic nenabízí", () => {
  const now = P(2026, 11, 9, 8);
  const svc = { ...STUDIO, horizonDays: 7 };
  const availability = [
    studioBlock(P(2026, 11, 16, 9), P(2026, 11, 16, 10)), // dnes + 7 dní → ještě OK
    studioBlock(P(2026, 11, 17, 9), P(2026, 11, 17, 10)), // dnes + 8 → mimo
  ];
  const slots = computeSlots({ service: svc, availability, now, studio: "praha" });
  assert.deepEqual(slots.map((s) => s.start.getTime()), [P(2026, 11, 16, 9).getTime()]);
});

test("přechod na letní čas (29. 3. 2026): sloty sedí na pražský čas", () => {
  const now = P(2026, 3, 20, 8);
  const availability = [
    studioBlock(P(2026, 3, 27, 9), P(2026, 3, 27, 10)), // pá, zimní čas (UTC+1)
    studioBlock(P(2026, 3, 30, 9), P(2026, 3, 30, 10)), // po, letní čas (UTC+2)
  ];
  const slots = computeSlots({ service: STUDIO, availability, now, studio: "praha" });
  assert.deepEqual(slots.map((s) => s.start.toISOString()), ["2026-03-27T08:00:00.000Z", "2026-03-30T07:00:00.000Z"]);
});

test("přechod na zimní čas (25. 10. 2026): sloty sedí na pražský čas", () => {
  const now = P(2026, 10, 20, 8);
  const availability = [
    studioBlock(P(2026, 10, 24, 9), P(2026, 10, 24, 10, 30)), // so, letní čas (UTC+2)
    studioBlock(P(2026, 10, 26, 9), P(2026, 10, 26, 10, 30)), // po, zimní čas (UTC+1)
  ];
  const slots = computeSlots({ service: STUDIO, availability, now, studio: "praha" });
  assert.deepEqual(slots.map((s) => s.start.toISOString()), [
    "2026-10-24T07:00:00.000Z", "2026-10-24T07:30:00.000Z",
    "2026-10-26T08:00:00.000Z", "2026-10-26T08:30:00.000Z",
  ]);
  assert.deepEqual(slots.map((s) => hhmm(s.start)), ["09:00", "09:30", "09:00", "09:30"]);
});

test("ve státní svátek se nic nenabízí (pokud se svátky blokují)", () => {
  const now = P(2026, 11, 9, 8);
  const availability = [studioBlock(P(2026, 11, 17, 9), P(2026, 11, 17, 11))]; // 17. 11. svátek
  assert.equal(computeSlots({ service: STUDIO, availability, now, studio: "praha" }).length, 0);
  assert.equal(computeSlots({ service: STUDIO, availability, now, studio: "praha", blockHolidays: false }).length, 3);
  // Velikonoční pondělí 2027 = 29. 3. 2027 (pohyblivý svátek).
  const easter = [studioBlock(P(2027, 3, 29, 9), P(2027, 3, 29, 11))];
  assert.equal(computeSlots({ service: { ...STUDIO, horizonDays: 400 }, availability: easter, now, studio: "praha" }).length, 0);
});

test("interní uživatel smí přebít předstih", () => {
  const now = P(2026, 11, 11, 15);
  const availability = [homeBlock(P(2026, 11, 12, 8), P(2026, 11, 12, 12))];
  assert.equal(computeSlots({ service: HOME, availability, now }).length, 0);
  assert.equal(computeSlots({ service: HOME, availability, now, ignoreLead: true }).length, 5);
});

test("isSlotFree: konkrétní termín a designér", () => {
  const now = P(2026, 11, 9, 8);
  const p = {
    service: STUDIO, now, studio: "praha",
    availability: [studioBlock(P(2026, 11, 10, 9), P(2026, 11, 10, 12))],
    bookings: [{ designerSlug: "jana", start: P(2026, 11, 10, 10), end: P(2026, 11, 10, 11), status: "requested" }],
  };
  assert.equal(isSlotFree(p, "jana", P(2026, 11, 10, 9)), true);
  assert.equal(isSlotFree(p, "jana", P(2026, 11, 10, 10)), false);
  assert.equal(isSlotFree(p, "jana", P(2026, 11, 10, 9, 15)), false); // nezarovnaný čas
  assert.equal(isSlotFree(p, "petr", P(2026, 11, 10, 9)), false); // nemá blok
});

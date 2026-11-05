// Unit testy slotovací logiky. Spuštění: `npm test` ve functions/ (node:test, bez závislostí).

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeSlots, isSlotFree, earliestStart, serviceForDesigner } = require("./sloty");
const { fromPrague } = require("../shared/cas");

const P = (y, m, d, h, min = 0) => fromPrague(y, m, d, h * 60 + min);
const hhmm = (date) => date.toLocaleTimeString("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" });

const STUDIO = { id: "konzultace-studio", type: "studio", durationMin: 60, minLeadHours: 1, horizonDays: 60 };
const HOME = { id: "navrh-doma", type: "home", durationMin: 120, minLeadHours: 48, horizonDays: 60 };

const studioBlock = (start, end, slug = "jana", studio = "praha") => ({ designerSlug: slug, kind: "flex", serviceTypes: ["studio"], studio, start, end });
const homeBlock = (start, end, slug = "jana") => ({ designerSlug: slug, kind: "flex", serviceTypes: ["home"], start, end });
const bothBlock = (start, end, slug = "jana", studio = "praha") => ({ designerSlug: slug, kind: "flex", serviceTypes: ["studio", "home"], studio, start, end });
const shift = (start, end, slug = "jana", studio = "praha") => ({ designerSlug: slug, kind: "shift", studio, start, end });

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

test("volno na obojí: jeden blok nabízí studio i návrh doma", () => {
  const now = P(2026, 11, 9, 8);
  const availability = [bothBlock(P(2026, 11, 12, 9), P(2026, 11, 12, 13))];
  assert.equal(computeSlots({ service: STUDIO, availability, now, studio: "praha" }).length, 7);
  assert.deepEqual(computeSlots({ service: HOME, availability, now }).map((s) => hhmm(s.start)), ["09:00", "09:30", "10:00", "10:30", "11:00"]);
});

test("volno na obojí: rezervace jedné služby zabere čas i pro druhou", () => {
  const now = P(2026, 11, 9, 8);
  const availability = [bothBlock(P(2026, 11, 12, 9), P(2026, 11, 12, 13))];
  const bookings = [{ designerSlug: "jana", serviceType: "home", start: P(2026, 11, 12, 9), end: P(2026, 11, 12, 11), status: "confirmed" }];
  assert.deepEqual(computeSlots({ service: STUDIO, availability, bookings, now, studio: "praha" }).map((s) => hhmm(s.start)), ["11:00", "11:30", "12:00"]);
});

test("směna ve studiu: konzultace ano, návrh doma ne", () => {
  const now = P(2026, 11, 9, 8);
  const availability = [shift(P(2026, 11, 12, 9), P(2026, 11, 12, 18))];
  assert.equal(computeSlots({ service: STUDIO, availability, now, studio: "praha" }).length, 17);
  assert.equal(computeSlots({ service: HOME, availability, now }).length, 0);
  assert.equal(computeSlots({ service: STUDIO, availability, now, studio: "brno" }).length, 0);
});

test("čas na přesun kolem návrhu doma", () => {
  const now = P(2026, 11, 9, 8);
  const availability = [bothBlock(P(2026, 11, 12, 8), P(2026, 11, 12, 16))];
  const bookings = [{ designerSlug: "jana", serviceType: "home", start: P(2026, 11, 12, 10), end: P(2026, 11, 12, 12), status: "confirmed" }];
  // Konzultace ve studiu: 60 min přesun před a po výjezdu (10–12) → nejdřív 13:00, nejpozději končí v 9:00.
  const studio = computeSlots({ service: STUDIO, availability, bookings, now, studio: "praha", travelMin: 60 }).map((s) => hhmm(s.start));
  assert.deepEqual(studio, ["08:00", "13:00", "13:30", "14:00", "14:30", "15:00"]);
  // Bez přesunu by šlo hned 12:00.
  assert.ok(computeSlots({ service: STUDIO, availability, bookings, now, studio: "praha" }).some((s) => hhmm(s.start) === "12:00"));
  // Studio vs. studio se přesun neuplatní.
  const b2 = [{ ...bookings[0], serviceType: "studio" }];
  assert.ok(computeSlots({ service: STUDIO, availability, bookings: b2, now, studio: "praha", travelMin: 60 }).some((s) => hhmm(s.start) === "12:00"));
});

test("starý tvar bloku (serviceType) dál funguje", () => {
  const now = P(2026, 11, 9, 8);
  const old = [{ designerSlug: "jana", serviceType: "studio", studio: "praha", start: P(2026, 11, 12, 9), end: P(2026, 11, 12, 10) }];
  assert.equal(computeSlots({ service: STUDIO, availability: old, now, studio: "praha" }).length, 1);
});

test("vlastní parametry designéra přepíšou výchozí (jen jeho)", () => {
  const now = P(2026, 11, 12, 8);
  const availability = [studioBlock(P(2026, 11, 12, 9), P(2026, 11, 12, 13)), studioBlock(P(2026, 11, 12, 9), P(2026, 11, 12, 13), "petr")];
  const overrides = { jana: { "konzultace-studio": { minLeadHours: 3, durationMin: 90 } } };
  const slots = computeSlots({ service: STUDIO, availability, now, studio: "praha", serviceFor: (slug) => serviceForDesigner(STUDIO, overrides[slug]) });
  const jana = slots.filter((s) => s.designerSlug === "jana");
  const petr = slots.filter((s) => s.designerSlug === "petr");
  // Jana: nejdřív za 3 h (11:00), schůzka 90 min (do 13:00 se vejde jen 11:00 a 11:30).
  assert.deepEqual(jana.map((s) => hhmm(s.start)), ["11:00", "11:30"]);
  assert.equal(jana[0].end - jana[0].start, 90 * 60000);
  // Petr: výchozí (1 h předstih, 60 min) → od 9:00.
  assert.equal(hhmm(petr[0].start), "09:00");
  assert.equal(petr[0].end - petr[0].start, 60 * 60000);
});

test("vlastní parametry: cenu ani potvrzování CX přepsat nejde", () => {
  const svc = { ...STUDIO, priceText: "zdarma", requiresConfirmation: false };
  const eff = serviceForDesigner(svc, { "konzultace-studio": { priceText: "1 Kč", requiresConfirmation: true, minLeadHours: "x", bufferMin: 15 } });
  assert.equal(eff.priceText, "zdarma");
  assert.equal(eff.requiresConfirmation, false);
  assert.equal(eff.minLeadHours, 1); // neplatné číslo se ignoruje
  assert.equal(eff.bufferMin, 15);
});

test("vlastní čas na přesun designéra", () => {
  const now = P(2026, 11, 9, 8);
  const availability = [bothBlock(P(2026, 11, 12, 8), P(2026, 11, 12, 16))];
  const bookings = [{ designerSlug: "jana", serviceType: "home", start: P(2026, 11, 12, 10), end: P(2026, 11, 12, 12), status: "confirmed" }];
  const studio = computeSlots({ service: STUDIO, availability, bookings, now, studio: "praha", travelMin: 60, travelFor: () => 30 }).map((s) => hhmm(s.start));
  assert.ok(studio.includes("12:30") && !studio.includes("12:00"));
});

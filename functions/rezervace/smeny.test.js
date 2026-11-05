const test = require("node:test");
const assert = require("node:assert/strict");
const { permanentShiftBlocks, studioCoverage } = require("./smeny");
const { fromPrague } = require("../shared/cas");

const P = (y, m, d, h, min = 0) => fromPrague(y, m, d, h * 60 + min);
// Po–Pá 9–18, So 9–12, Ne zavřeno.
const STUDIO = { openingHours: { 1: ["09:00", "18:00"], 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["09:00", "12:00"] } };

test("stálá směna (např. Barča v Pardubicích) = otevírací doba, bez neděle a svátku", () => {
  const designers = [{ slug: "barbora", reservations: { permanentShift: "pardubice" } }, { slug: "jiny", reservations: {} }];
  // Po 16. 11. – Ne 22. 11. 2026, 17. 11. je svátek.
  const blocks = permanentShiftBlocks(designers, { pardubice: STUDIO }, P(2026, 11, 16, 0), P(2026, 11, 23, 0));
  assert.deepEqual(blocks.map((b) => b.id.split("-").slice(-1)[0]), ["16", "18", "19", "20", "21"]);
  assert.ok(blocks.every((b) => b.designerSlug === "barbora" && b.kind === "shift" && b.studio === "pardubice"));
  assert.equal(blocks[0].start.getTime(), P(2026, 11, 16, 9).getTime());
  assert.equal(blocks[4].end.getTime(), P(2026, 11, 21, 12).getTime()); // sobota do 12
});

test("pokrytí studia: díra v otevírací době se najde", () => {
  const shifts = [
    { kind: "shift", studio: "praha", designerSlug: "a", start: P(2026, 11, 16, 9), end: P(2026, 11, 16, 13) },
    { kind: "shift", studio: "praha", designerSlug: "b", start: P(2026, 11, 16, 14), end: P(2026, 11, 16, 18) },
    { kind: "shift", studio: "praha", designerSlug: "a", start: P(2026, 11, 18, 8), end: P(2026, 11, 18, 18) },
    { kind: "flex", studio: "praha", designerSlug: "c", start: P(2026, 11, 19, 9), end: P(2026, 11, 19, 18) }, // volno ≠ směna
    { kind: "shift", studio: "brno", designerSlug: "d", start: P(2026, 11, 20, 9), end: P(2026, 11, 20, 18) },
  ];
  const days = studioCoverage("praha", STUDIO, shifts, P(2026, 11, 16, 0), P(2026, 11, 21, 0));
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  assert.equal(byDate["2026-11-16"].covered, false);
  assert.deepEqual(byDate["2026-11-16"].gaps.map(([s, e]) => [s.getTime(), e.getTime()]), [[P(2026, 11, 16, 13).getTime(), P(2026, 11, 16, 14).getTime()]]);
  assert.deepEqual(byDate["2026-11-16"].staff, ["a", "b"]);
  assert.equal(byDate["2026-11-17"].open, null); // svátek
  assert.equal(byDate["2026-11-18"].covered, true);
  assert.equal(byDate["2026-11-19"].covered, false); // jen volno, žádná směna
  assert.equal(byDate["2026-11-20"].covered, false); // směna je v Brně
});

test("studio bez otevírací doby nemá co hlídat", () => {
  const days = studioCoverage("praha", { openingHours: {} }, [], P(2026, 11, 16, 0), P(2026, 11, 18, 0));
  assert.ok(days.every((d) => d.open === null && d.covered));
});

test("pokrytí počítá i se směnami uloženými jako Firestore Timestamp", () => {
  const ts = (d) => ({ toMillis: () => d.getTime() });
  const shifts = [{ kind: "shift", studio: "praha", designerSlug: "a", start: ts(P(2026, 11, 16, 9)), end: ts(P(2026, 11, 16, 18)) }];
  const days = studioCoverage("praha", STUDIO, shifts, P(2026, 11, 16, 0), P(2026, 11, 17, 0));
  assert.equal(days[0].covered, true);
  assert.deepEqual(days[0].staff, ["a"]);
});

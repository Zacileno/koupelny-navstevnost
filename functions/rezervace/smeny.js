// Směny ve studiu a pokrytí otevírací doby (čistý modul, testy v smeny.test.js).
//
// Studio je otevřené podle `config/rezervace.studios[x].openingHours`
// ({ "1": ["09:00","18:00"], … }, 1 = pondělí). Otevřené ho drží designér na
// směně (blok kind 'shift'). Kdo je ve studiu vždycky (hlavní pracovní poměr,
// např. Barča v Pardubicích), má `reservations.permanentShift = '<studio>'` —
// jeho směny se dopočítají z otevírací doby, nemusí je vypisovat.

const { pragueParts, fromPrague, nextDay, isHoliday, dayOfWeek } = require("../shared/cas");

// Čas z Firestore Timestamp, Date i ISO řetězce → ms.
const ms = (v) => (v?.toMillis ? v.toMillis() : new Date(v).getTime());

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
};

// Pražské dny (y, m, d) v intervalu [from, to).
function eachDay(from, to, fn) {
  let { y, m, d } = pragueParts(new Date(from));
  for (let guard = 0; guard < 800; guard++) {
    const start = fromPrague(y, m, d, 0).getTime();
    if (start >= to) return;
    fn(y, m, d);
    ({ y, m, d } = nextDay(y, m, d));
  }
}

// Otevírací doba studia v daný den → [start, end] (ms), nebo null (zavřeno / svátek).
function openingOn(studioCfg, y, m, d) {
  const hours = studioCfg?.openingHours || {};
  const isoDow = ((dayOfWeek(y, m, d) + 6) % 7) + 1; // 1 = pondělí
  const h = hours[String(isoDow)];
  if (!h || isHoliday(y, m, d)) return null;
  return [fromPrague(y, m, d, toMin(h[0])).getTime(), fromPrague(y, m, d, toMin(h[1])).getTime()];
}

// Virtuální směny pro designéry se stálou směnou.
function permanentShiftBlocks(designers, studios, from, to) {
  const out = [];
  for (const des of designers) {
    const studio = des.reservations?.permanentShift;
    if (!studio || !studios[studio]) continue;
    eachDay(from, to, (y, m, d) => {
      const open = openingOn(studios[studio], y, m, d);
      if (!open) return;
      out.push({
        id: `stala-${des.slug}-${y}-${m}-${d}`, designerSlug: des.slug, kind: "shift", studio,
        start: new Date(open[0]), end: new Date(open[1]), permanent: true,
      });
    });
  }
  return out;
}

/**
 * Pokrytí otevírací doby směnami pro jedno studio.
 * @returns {Array<{ date: string, open: [Date, Date]|null, covered: boolean, gaps: Array<[Date, Date]>, staff: string[] }>}
 */
function studioCoverage(studioKey, studioCfg, shifts, from, to) {
  const days = [];
  eachDay(from, to, (y, m, d) => {
    const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const open = openingOn(studioCfg, y, m, d);
    if (!open) {
      days.push({ date, open: null, covered: true, gaps: [], staff: [] });
      return;
    }
    const mine = shifts
      .filter((s) => s.kind === "shift" && s.studio === studioKey)
      .map((s) => [ms(s.start), ms(s.end), s.designerSlug])
      .filter(([s, e]) => s < open[1] && e > open[0])
      .sort((a, b) => a[0] - b[0]);
    const gaps = [];
    let cursor = open[0];
    for (const [s, e] of mine) {
      if (s > cursor) gaps.push([cursor, Math.min(s, open[1])]);
      cursor = Math.max(cursor, e);
      if (cursor >= open[1]) break;
    }
    if (cursor < open[1]) gaps.push([cursor, open[1]]);
    days.push({
      date,
      open: [new Date(open[0]), new Date(open[1])],
      covered: gaps.length === 0,
      gaps: gaps.map(([s, e]) => [new Date(s), new Date(e)]),
      staff: [...new Set(mine.map((x) => x[2]))],
    });
  });
  return days;
}

module.exports = { openingOn, permanentShiftBlocks, studioCoverage };

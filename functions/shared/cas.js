// Sdílená utilita pro functions: pražský čas a státní svátky ČR.
// Používají ji Leady (leady-sla.js) i Rezervace (rezervace/sloty.js).
//
// Cloud Functions běží v UTC, veškerá business logika (pracovní doba, předstih
// rezervace, dny) se ale počítá v pražském "nástěnném" čase.
//
// ⚠️ Klientská kopie pro Leady (public/leady/leady-sla.js) zůstává samostatná —
// hosting a functions se nasazují zvlášť. Změnu svátků promítnout i tam.

const TZ = "Europe/Prague";
const DAY_MS = 86400000;

// Státní svátky ČR s pevným datem (MM-DD); Velký pátek a Velikonoční pondělí
// se dopočítávají z data Velikonoc.
const FIXED_HOLIDAYS = new Set([
  "01-01", "05-01", "05-08", "07-05", "07-06", "09-28",
  "10-28", "11-17", "12-24", "12-25", "12-26",
]);

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

// Date → pražské { y, m, d, min } (min = minuty od půlnoci, i se zlomkem sekund).
function pragueParts(date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, min: +p.hour * 60 + +p.minute + +p.second / 60 };
}

// Pražský "nástěnný" čas → Date. Offset (zimní/letní čas) se dopočítá zpětně.
function fromPrague(y, m, d, minutes) {
  const guess = Date.UTC(y, m - 1, d) + minutes * 60000;
  const p = pragueParts(new Date(guess));
  const asUtc = Date.UTC(p.y, p.m - 1, p.d) + p.min * 60000;
  return new Date(guess - (asUtc - guess));
}

function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}

function isHoliday(y, m, d) {
  if (FIXED_HOLIDAYS.has(`${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`)) return true;
  const t = Date.UTC(y, m - 1, d);
  const easter = easterSunday(y);
  return t === easter - 2 * DAY_MS || t === easter + DAY_MS;
}

// 0 = neděle … 6 = sobota (kalendářní den, nezávisle na časové zóně).
function dayOfWeek(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isWorkingDay(y, m, d) {
  const dow = dayOfWeek(y, m, d);
  if (dow === 0 || dow === 6) return false;
  return !isHoliday(y, m, d);
}

function nextDay(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// "YYYY-MM-DD" pražského dne, do kterého Date patří.
function pragueDateKey(date) {
  const { y, m, d } = pragueParts(date);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

module.exports = {
  TZ,
  pragueParts,
  fromPrague,
  easterSunday,
  isHoliday,
  dayOfWeek,
  isWorkingDay,
  nextDay,
  pragueDateKey,
};

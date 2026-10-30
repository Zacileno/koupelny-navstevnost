// SLA pro leady z webového pop-up formuláře (modul Leady, public/leady/).
//
// ⚠️ Kopie functions/leady-sla.js (tam se počítá SLA prvního kontaktu, tady
// termín dalšího pokusu). Hosting a functions se nasazují zvlášť, sdílet jeden soubor
// nejde — při změně pracovní doby, svátků nebo SLA upravit OBA soubory.
//
// Všechno se počítá v pražském čase (Cloud Functions běží v UTC).

const TZ = 'Europe/Prague';
const WORK_START_MIN = 8 * 60;   // 8:00
const WORK_END_MIN = 17 * 60;    // 17:00
const WORKDAY_MIN = WORK_END_MIN - WORK_START_MIN;

// První pokus o kontakt do 2 pracovních hodin (lead v noci/o víkendu → 10:00
// dalšího pracovního dne). Další pokus po nezvednutí do 1 pracovního dne.
export const FIRST_CONTACT_SLA_MIN = 120;
export const RETRY_SLA_MIN = WORKDAY_MIN;
export const MAX_ATTEMPTS = 3;

// Státní svátky ČR s pevným datem (MM-DD); Velký pátek a Velikonoční pondělí
// se dopočítávají z data Velikonoc.
const FIXED_HOLIDAYS = new Set([
  '01-01', '05-01', '05-08', '07-05', '07-06', '09-28',
  '10-28', '11-17', '12-24', '12-25', '12-26',
]);

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function pragueParts(date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, min: +p.hour * 60 + +p.minute + +p.second / 60 };
}

// Pražský 'nástěnný' čas → Date. Offset (zimní/letní čas) se dopočítá zpětně.
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

export function isWorkingDay(y, m, d) {
  const t = Date.UTC(y, m - 1, d);
  const dow = new Date(t).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  if (FIXED_HOLIDAYS.has(`${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)) return false;
  const easter = easterSunday(y);
  const DAY = 86400000;
  return t !== easter - 2 * DAY && t !== easter + DAY;
}

function nextDay(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// Přičte pracovní minuty (Po–Pá 8–17, mimo svátky). Čas mimo pracovní dobu se
// nepočítá — lead v sobotu ráno + 120 min = pondělí 10:00.
export function addWorkingMinutes(date, minutes) {
  let { y, m, d, min } = pragueParts(date);
  let remaining = minutes;
  for (let guard = 0; guard < 400; guard++) {
    if (isWorkingDay(y, m, d) && min < WORK_END_MIN) {
      if (min < WORK_START_MIN) min = WORK_START_MIN;
      const available = WORK_END_MIN - min;
      if (remaining <= available) return fromPrague(y, m, d, min + remaining);
      remaining -= available;
    }
    ({ y, m, d } = nextDay(y, m, d));
    min = WORK_START_MIN;
  }
  throw new Error('addWorkingMinutes: nenalezen pracovní den');
}


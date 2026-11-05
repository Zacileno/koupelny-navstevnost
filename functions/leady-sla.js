// SLA pro leady z webového pop-up formuláře (modul Leady, public/leady/).
//
// ⚠️ Stejná logika je i v public/leady/leady-sla.js (klient počítá termín
// dalšího pokusu). Hosting a functions se nasazují zvlášť, sdílet jeden soubor
// nejde — při změně pracovní doby, svátků nebo SLA upravit OBA soubory.
//
// Všechno se počítá v pražském čase (Cloud Functions běží v UTC). Pražský čas
// a svátky jsou ve sdílené utilitě functions/shared/cas.js (používá ji i Rezervace).

const { pragueParts, fromPrague, isWorkingDay, nextDay } = require("./shared/cas");

const WORK_START_MIN = 8 * 60;   // 8:00
const WORK_END_MIN = 17 * 60;    // 17:00
const WORKDAY_MIN = WORK_END_MIN - WORK_START_MIN;

// První pokus o kontakt do 2 pracovních hodin (lead v noci/o víkendu → 10:00
// dalšího pracovního dne). Další pokus po nezvednutí do 1 pracovního dne.
const FIRST_CONTACT_SLA_MIN = 120;
const RETRY_SLA_MIN = WORKDAY_MIN;
const MAX_ATTEMPTS = 3;

// Přičte pracovní minuty (Po–Pá 8–17, mimo svátky). Čas mimo pracovní dobu se
// nepočítá — lead v sobotu ráno + 120 min = pondělí 10:00.
function addWorkingMinutes(date, minutes) {
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
  throw new Error("addWorkingMinutes: nenalezen pracovní den");
}

module.exports = {
  FIRST_CONTACT_SLA_MIN,
  RETRY_SLA_MIN,
  MAX_ATTEMPTS,
  addWorkingMinutes,
  isWorkingDay,
  fromPrague,
};

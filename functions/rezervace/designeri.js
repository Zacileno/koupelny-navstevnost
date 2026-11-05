// Kdo smí vést kterou rezervaci (čistý modul, testy v designeri.test.js).
//
// Studio: designér musí mít službu a dané studio v `reservations.studios`.
// Návrh doma: designér musí mít službu a oblast klienta v `reservations.homeRegions`.
// Když homeRegions chybí, platí jeho studia (Pražák jezdí po Praze a okolí,
// ne do Brna) — oblasti mají stejné klíče jako studia, viz DEFAULT_HOME_REGIONS.

// Výchozí oblasti pro návrh u klienta doma (⚠️ přepisuje config/rezervace.homeRegions).
const DEFAULT_HOME_REGIONS = [
  { id: "praha", name: "Praha a Střední Čechy" },
  { id: "brno", name: "Brno a Jižní Morava" },
  { id: "hradec", name: "Hradec Králové a okolí" },
  { id: "pardubice", name: "Pardubice a okolí" },
];

function homeRegionsOf(designer) {
  const r = designer.reservations || {};
  return Array.isArray(r.homeRegions) ? r.homeRegions : (r.studios || []);
}

function eligibleDesigners(designers, service, { studio = null, region = null } = {}) {
  return designers.filter((d) => {
    const r = d.reservations || {};
    if (!(r.services || []).includes(service.id)) return false;
    if (service.type === "studio") return (r.studios || []).includes(studio);
    if (service.type === "home") return !region || homeRegionsOf(d).includes(region);
    return true;
  });
}

// Co o designérovi smí ven na veřejnou stránku (žádný telefon/e-mail).
function publicProfile(d) {
  const r = d.reservations || {};
  return {
    slug: d.slug,
    name: d.name || d.slug,
    position: r.publicPosition || d.position || "",
    bio: r.bio || "",
    photoUrl: r.photoUrl || "",
  };
}

module.exports = { DEFAULT_HOME_REGIONS, homeRegionsOf, eligibleDesigners, publicProfile };

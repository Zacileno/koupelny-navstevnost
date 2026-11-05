const test = require("node:test");
const assert = require("node:assert/strict");
const { eligibleDesigners, publicProfile, homeRegionsOf } = require("./designeri");

const STUDIO = { id: "konzultace-studio", type: "studio" };
const HOME = { id: "navrh-doma", type: "home" };
const designers = [
  { slug: "prazak", name: "Pražák", reservations: { services: ["konzultace-studio", "navrh-doma"], studios: ["praha"] } },
  { slug: "brnak", name: "Brňák", reservations: { services: ["navrh-doma"], studios: ["brno"], homeRegions: ["brno"] } },
  { slug: "vychod", name: "Východ", reservations: { services: ["navrh-doma"], studios: ["hradec"], homeRegions: ["hradec", "pardubice"] } },
  { slug: "jen-studio", name: "Jen studio", reservations: { services: ["konzultace-studio"], studios: ["praha", "brno"] } },
];
const slugs = (list) => list.map((d) => d.slug);

test("studio: jen designéři přiřazení k danému studiu", () => {
  assert.deepEqual(slugs(eligibleDesigners(designers, STUDIO, { studio: "praha" })), ["prazak", "jen-studio"]);
  assert.deepEqual(slugs(eligibleDesigners(designers, STUDIO, { studio: "brno" })), ["jen-studio"]);
});

test("doma: jen designéři působící v oblasti klienta — Pražák nejezdí do Brna", () => {
  assert.deepEqual(slugs(eligibleDesigners(designers, HOME, { region: "brno" })), ["brnak"]);
  assert.deepEqual(slugs(eligibleDesigners(designers, HOME, { region: "praha" })), ["prazak"]);
  assert.deepEqual(slugs(eligibleDesigners(designers, HOME, { region: "pardubice" })), ["vychod"]);
});

test("doma: bez vyplněných oblastí platí studia designéra", () => {
  assert.deepEqual(homeRegionsOf(designers[0]), ["praha"]);
  assert.deepEqual(homeRegionsOf(designers[2]), ["hradec", "pardubice"]);
});

test("veřejný profil neobsahuje kontakty", () => {
  const p = publicProfile({ slug: "x", name: "X", position: "Designér", email: "x@y.cz", phone: "777", reservations: { bio: "Bio" } });
  assert.deepEqual(Object.keys(p).sort(), ["bio", "name", "photoUrl", "position", "slug"]);
});

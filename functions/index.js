const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getStorage } = require("firebase-admin/storage");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const heicConvert = require("heic-convert");
const path = require("path");

initializeApp();

exports.konvertujHeic = onObjectFinalized(
  { region: "europe-central2" },
  async (event) => {
    const filePath = event.data.name;
    const contentType = event.data.contentType;

    if (!contentType || !contentType.toLowerCase().includes("heic")) {
      console.log("Není HEIC soubor, přeskakuji:", filePath);
      return null;
    }

    if (filePath.includes("_converted")) {
      return null;
    }

    console.log("Konvertuji HEIC soubor:", filePath);

    const bucket = getStorage().bucket();
    const db = getFirestore();

    const [heicBuffer] = await bucket.file(filePath).download();

    const jpegBuffer = await heicConvert({
      buffer: heicBuffer,
      format: "JPEG",
      quality: 0.85,
    });

    const jpegPath = filePath.replace(/\.heic$/i, "_converted.jpg");

    await bucket.file(jpegPath).save(Buffer.from(jpegBuffer), {
      metadata: { contentType: "image/jpeg" },
    });

    const jpegUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(jpegPath)}?alt=media`;

    console.log("Konverze hotova, nová URL:", jpegUrl);

    const snapshot = await db
      .collection("realizace")
      .where("foto", "array-contains", event.data.mediaLink)
      .get();

    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      const foto = doc.data().foto;
      const novaFota = foto.map((url) =>
        url.includes(path.basename(filePath)) ? jpegUrl : url
      );
      await doc.ref.update({ foto: novaFota });
      console.log("Firestore aktualizován pro dokument:", doc.id);
    } else {
      console.log("Záznam ve Firestore nenalezen, URL nebyla aktualizována.");
    }

    return null;
  }
);

// ── ADMIN KONZOLE (public/admin/lide.html) ──────────────────────────────────
// Jediné místo, které smí zakládat/deaktivovat lidi v `users` — Firestore rules
// mají na tuhle kolekci "allow create: if false", takže veškerý zápis jde přes
// Admin SDK tady, ne přímo z klienta. Viz plán "Admin konzole pro lidi" v
// CLAUDE.md pro kontext dvojí identity (users/{slug} vs users/{uid} z Adaptace).

const DEPARTMENTS = ["sales", "accounting", "operations", "realization", "marketing"];
const STUDIOS = ["praha", "brno", "hradec", "pardubice"];
const PLATFORM_ROLES = ["employee", "supervisor", "hr", "admin"];
const SHARED_PASSWORD = "ZmenSiHeslo";

async function requireAdminCaller(request) {
  const slug = request.auth?.token?.slug;
  if (!slug) {
    throw new HttpsError("unauthenticated", "Přihlaste se prosím znovu.");
  }
  const snap = await getFirestore().collection("users").doc(slug).get();
  const platformRole = snap.data()?.platformRole;
  if (!["hr", "admin"].includes(platformRole)) {
    throw new HttpsError("permission-denied", "Tuto akci smí provést jen HR nebo admin.");
  }
  return slug;
}

const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

function slugify(name) {
  return name
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function generateUniqueSlug(db, name) {
  const base = slugify(name);
  if (!base) {
    throw new HttpsError("invalid-argument", "Ze jména se nepodařilo vytvořit slug.");
  }
  let slug = base;
  let n = 2;
  while ((await db.collection("users").doc(slug).get()).exists) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

exports.onboardEmployee = onCall({ region: "europe-central2" }, async (request) => {
  await requireAdminCaller(request);

  const db = getFirestore();
  const auth = getAuth();
  const data = request.data || {};
  const { name, email, department, studios, position, phone, managerSlug } = data;
  const personalPhone = data.personalPhone || "";
  const platformRole = data.platformRole || null;
  const adaptation = data.adaptation || null;

  if (!name || typeof name !== "string") {
    throw new HttpsError("invalid-argument", "Chybí jméno.");
  }
  if (!email || typeof email !== "string") {
    throw new HttpsError("invalid-argument", "Chybí e-mail.");
  }
  if (!DEPARTMENTS.includes(department)) {
    throw new HttpsError("invalid-argument", `Oddělení musí být jedno z: ${DEPARTMENTS.join(", ")}.`);
  }
  if (!Array.isArray(studios) || !studios.every((s) => STUDIOS.includes(s))) {
    throw new HttpsError("invalid-argument", `Studia musí být pole z: ${STUDIOS.join(", ")}.`);
  }
  if (!position || typeof position !== "string") {
    throw new HttpsError("invalid-argument", "Chybí pozice.");
  }
  if (!phone || typeof phone !== "string") {
    throw new HttpsError("invalid-argument", "Chybí telefon.");
  }
  if (!managerSlug || typeof managerSlug !== "string") {
    throw new HttpsError("invalid-argument", "Chybí manažer (managerSlug).");
  }
  if (platformRole && !PLATFORM_ROLES.includes(platformRole)) {
    throw new HttpsError("invalid-argument", `platformRole musí být jedno z: ${PLATFORM_ROLES.join(", ")}.`);
  }

  const managerSnap = await db.collection("users").doc(managerSlug).get();
  if (!managerSnap.exists) {
    throw new HttpsError("invalid-argument", `Manažer users/${managerSlug} neexistuje.`);
  }

  if (adaptation) {
    if (!["weekly", "daily"].includes(adaptation.templateType)) {
      throw new HttpsError("invalid-argument", "adaptation.templateType musí být 'weekly' nebo 'daily'.");
    }
    if (!adaptation.startDate) {
      throw new HttpsError("invalid-argument", "Chybí adaptation.startDate.");
    }
    if (!adaptation.roles?.manager?.slug) {
      throw new HttpsError("invalid-argument", "Chybí adaptation.roles.manager.slug.");
    }
    const roleEntries = Object.entries(adaptation.roles);
    for (const [key, entry] of roleEntries) {
      if (entry?.slug) {
        // eslint-disable-next-line no-await-in-loop
        const roleSnap = await db.collection("users").doc(entry.slug).get();
        if (!roleSnap.exists) {
          throw new HttpsError("invalid-argument", `adaptation.roles.${key}.slug (${entry.slug}) neexistuje v users.`);
        }
      }
    }
  }

  let existingAuthUser = null;
  try {
    existingAuthUser = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
  }
  if (existingAuthUser) {
    throw new HttpsError("already-exists", `Účet s e-mailem ${email} už existuje.`);
  }

  const slug = await generateUniqueSlug(db, name);
  const authUser = await auth.createUser({ email, password: SHARED_PASSWORD, displayName: name });
  await auth.setCustomUserClaims(authUser.uid, { slug });

  const userDoc = {
    name,
    active: true,
    department,
    studios,
    position,
    email,
    phone,
    personalPhone,
    managerSlug,
    uid: authUser.uid,
    mustChangePassword: true,
  };
  if (platformRole) {
    userDoc.platformRole = platformRole;
  }
  await db.collection("users").doc(slug).set(userDoc);

  let adaptationId = null;
  if (adaptation) {
    const adaptationDoc = {
      employeeId: slug,
      employeeName: name,
      studioKey: studios,
      templateType: adaptation.templateType,
      templateId: adaptation.templateId || null,
      supervisorId: adaptation.roles.manager.slug,
      roles: adaptation.roles,
      startDate: Timestamp.fromDate(new Date(adaptation.startDate)),
      status: "active",
      phases: adaptation.phases || [],
      ongoingCategories: adaptation.ongoingCategories || [],
    };
    const ref = await db.collection("adaptations").add(adaptationDoc);
    adaptationId = ref.id;
  }

  return { slug, uid: authUser.uid, adaptationId };
});

exports.offboardEmployee = onCall({ region: "europe-central2" }, async (request) => {
  await requireAdminCaller(request);

  const db = getFirestore();
  const auth = getAuth();
  const { slug } = request.data || {};

  if (!slug || typeof slug !== "string") {
    throw new HttpsError("invalid-argument", "Chybí slug.");
  }

  const userRef = db.collection("users").doc(slug);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", `users/${slug} neexistuje.`);
  }

  await userRef.set({ active: false }, { merge: true });

  const uid = userSnap.data().uid;
  if (uid) {
    try {
      await auth.updateUser(uid, { disabled: true });
    } catch (err) {
      if (err.code !== "auth/user-not-found") throw err;
    }
  }

  const adaptationsSnap = await db
    .collection("adaptations")
    .where("employeeId", "==", slug)
    .where("status", "in", ["active", "paused"])
    .get();
  await Promise.all(
    adaptationsSnap.docs.map((doc) => doc.ref.set({ status: "ended" }, { merge: true }))
  );

  return { slug, endedAdaptations: adaptationsSnap.size };
});
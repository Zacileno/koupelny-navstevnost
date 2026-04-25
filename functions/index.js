const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { initializeApp } = require("firebase-admin/app");
const { getStorage } = require("firebase-admin/storage");
const { getFirestore } = require("firebase-admin/firestore");
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
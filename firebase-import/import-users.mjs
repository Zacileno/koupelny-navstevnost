import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDt0TY8ti1vAdSGp64IKneaLXjJLb2_qNw",
  authDomain: "koupelny-navstevnost.firebaseapp.com",
  projectId: "koupelny-navstevnost",
  storageBucket: "koupelny-navstevnost.firebasestorage.app",
  messagingSenderId: "263800017951",
  appId: "1:263800017951:web:012c10ee687fcadab9f12a",
  measurementId: "G-9PH88D78DP"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const users = [
  { id: "barbora-lojkaskova",   name: "Barbora Lojkásková" },
  { id: "marek-kopriva",        name: "Marek Kopřiva" },
  { id: "nikola-moon",          name: "Nikola Moon" },
  { id: "valerie-brosingerova", name: "Valerie Brosingerová" },
  { id: "natalie-pokorna",      name: "Natálie Pokorná" },
  { id: "barbora-stanclova",    name: "Barbora Štanclová" },
  { id: "marek-horcik",         name: "Marek Hôrčík" },
  { id: "barbora-syrova",       name: "Barbora Syrová" },
  { id: "jakub-krcmarik",       name: "Jakub Krčmarik" },
  { id: "kristyna-syrova",      name: "Kristýna Syrová" },
];

console.log("🚀 Začínám import obchodníků...");

for (const user of users) {
  await setDoc(doc(db, "users", user.id), {
    name: user.name,
    active: true
  });
  console.log(`✅ Přidán: ${user.name}`);
}

console.log("🎉 Hotovo! Všichni obchodníci jsou v databázi.");
process.exit(0);

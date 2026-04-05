import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, updateDoc, doc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCWgqGvXzXWBUWd_W-q7uEuARIBZj_JXyI",
  authDomain: "peptide-inventory.firebaseapp.com",
  projectId: "peptide-inventory",
  storageBucket: "peptide-inventory.firebasestorage.app",
  messagingSenderId: "547049240971",
  appId: "1:547049240971:web:83b2e836fee57bb41f578e",
};

const FIXED_MASS_PAD_Y = 5;
const FIXED_MASS_RADIUS = 10;
const FIXED_MASS_TEXT_COLOR = "#ffffff";

const DEFAULT_VERTICAL_LABEL_DESIGN = {
  centerLeftPercent: 78,
  centerTopPercent: 63,
  centerWidth: 235,
  centerGap: 8,
  nameFontSize: 30,
  nameLineHeight: 0.92,
  strengthFontSize: 18,
  massTextColor: FIXED_MASS_TEXT_COLOR,
  strengthPadY: FIXED_MASS_PAD_Y,
  strengthPadX: 12,
  strengthRadius: FIXED_MASS_RADIUS,
  footerLeft: 165,
  footerTop: 360,
  footerFontSize: 7,
  qrLeft: 35,
  qrTop: 22,
  qrWidth: 110,
  qrMaxHeight: 110,
  lotLeft: 90,
  lotTop: 8,
  lotFontSize: 10,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  const snap = await getDocs(collection(db, "c&pProductList"));
  let updated = 0;
  let skipped = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (data.verticalLabelDesign) {
      console.log(`[SKIP]   ${docSnap.id} — already has verticalLabelDesign`);
      skipped++;
    } else {
      await updateDoc(doc(db, "c&pProductList", docSnap.id), {
        verticalLabelDesign: DEFAULT_VERTICAL_LABEL_DESIGN,
      });
      console.log(`[WROTE]  ${docSnap.id} (${data.product || docSnap.id})`);
      updated++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

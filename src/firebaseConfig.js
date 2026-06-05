import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyCWgqGvXzXWBUWd_W-q7uEuARIBZj_JXyI",
  authDomain: "peptide-inventory.firebaseapp.com",
  projectId: "peptide-inventory",
  storageBucket: "peptide-inventory.firebasestorage.app",
  messagingSenderId: "547049240971",
  appId: "1:547049240971:web:83b2e836fee57bb41f578e",
  measurementId: "G-1W58JMJN37"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

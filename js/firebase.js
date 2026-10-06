// Firebase inicializálás. Az SDK verziója csak itt szerepel.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  connectFirestoreEmulator,
  getFirestore,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
export {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Helyi fejlesztés: http://localhost:<port>/?emulator → a Firebase Emulatorhoz kapcsolódik.
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
export const USE_EMULATOR = isLocal && new URLSearchParams(location.search).has('emulator');

export const CONFIG_MISSING = !USE_EMULATOR
  && (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('IDE_') || firebaseConfig.projectId.includes('PROJEKT'));

const config = USE_EMULATOR
  ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-dontesek', appId: 'demo-app' }
  : firebaseConfig;

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);
auth.languageCode = 'hu';

if (USE_EMULATOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  // Fülönként külön belépés, hogy két felhasználó egy böngészőben is kipróbálható legyen.
  await setPersistence(auth, browserSessionPersistence);
}

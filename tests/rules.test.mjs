// Firestore-szabálytesztek. Futtatás: npm run test:rules
// (a Firebase Emulator indítja és leállítja a Firestore-emulátort).

import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const ADMIN1 = { uid: 'admin1', email: 'admin1@example.com' };
const ADMIN2 = { uid: 'admin2', email: 'admin2@example.com' };
const MEMBER = { uid: 'member1', email: 'member1@example.com' };

let env;

const ctx = (u, extra = {}) =>
  env.authenticatedContext(u.uid, { email: u.email, email_verified: true, ...extra }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

const vote = (decisionId, optionId, uid) => ({
  decisionId,
  optionId,
  uid,
  updatedAt: serverTimestamp(),
});
const message = (uid, text, decisionId = null) => ({
  uid,
  text,
  decisionId,
  createdAt: serverTimestamp(),
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-dontesek',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'config/app'), {
      // A nagybetűs token-e-mail kisbetűsítve is egyezzen.
      admins: [ADMIN1.email, ADMIN2.email],
      // A naplót csak admin2 nézheti.
      logViewers: [ADMIN2.email],
    });
    await setDoc(doc(db, 'sessions/s_admin1'), {
      uid: 'admin1', startedAt: new Date(), lastSeenAt: new Date(), endedAt: null,
    });
    await setDoc(doc(db, 'sessions/s_admin1_closed'), {
      uid: 'admin1', startedAt: new Date(), lastSeenAt: new Date(), endedAt: new Date(),
    });
    await setDoc(doc(db, 'users/admin1'), { displayName: 'Admin Egy', lastSeen: new Date() });
    await setDoc(doc(db, 'status/szint'), {
      state: 'closed',
      chosenOptionId: 'foldszint',
      closedBy: 'admin1',
      closedAt: new Date(),
    });
    await setDoc(doc(db, 'votes/intezmeny__admin2'), {
      decisionId: 'intezmeny',
      optionId: 'ovoda',
      uid: 'admin2',
      updatedAt: new Date(),
    });
    await setDoc(doc(db, 'votes/szint__admin1'), {
      decisionId: 'szint',
      optionId: 'foldszint',
      uid: 'admin1',
      updatedAt: new Date(),
    });
    await setDoc(doc(db, 'messages/m_admin2'), {
      uid: 'admin2',
      text: 'Szia!',
      decisionId: null,
      createdAt: new Date(),
    });
  });
});

describe('Kijelentkezve semmi nem olvasható', () => {
  for (const path of ['config/app', 'users/admin1', 'votes/intezmeny__admin2', 'status/szint', 'messages/m_admin2']) {
    it(`get ${path}`, async () => {
      await assertFails(getDoc(doc(anon(), path)));
    });
  }
  for (const col of ['users', 'votes', 'status', 'messages']) {
    it(`list ${col}`, async () => {
      await assertFails(getDocs(collection(anon(), col)));
    });
  }
  it('kijelentkezve nem lehet írni', async () => {
    await assertFails(setDoc(doc(anon(), 'messages/x'), message('x', 'hello')));
  });
});

describe('Nem admin (tag) nem fér hozzá', () => {
  it('nem olvas semmit', async () => {
    const db = ctx(MEMBER);
    await assertFails(getDoc(doc(db, 'config/app')));
    await assertFails(getDocs(collection(db, 'votes')));
    await assertFails(getDocs(collection(db, 'messages')));
    await assertFails(getDocs(collection(db, 'status')));
    await assertFails(getDocs(collection(db, 'users')));
  });
  it('nem szavazhat', async () => {
    await assertFails(setDoc(doc(ctx(MEMBER), 'votes/intezmeny__member1'), vote('intezmeny', 'ovoda', 'member1')));
  });
  it('nem írhat üzenetet', async () => {
    await assertFails(setDoc(doc(ctx(MEMBER), 'messages/x'), message('member1', 'hello')));
  });
  it('nem zárhat le döntést', async () => {
    await assertFails(setDoc(doc(ctx(MEMBER), 'status/intezmeny'), {
      state: 'closed', chosenOptionId: 'ovoda', closedBy: 'member1', closedAt: serverTimestamp(),
    }));
  });
  it('nem törölheti más üzenetét', async () => {
    await assertFails(deleteDoc(doc(ctx(MEMBER), 'messages/m_admin2')));
  });
});

describe('Ellenőrizetlen e-mail', () => {
  it('admin címmel, de email_verified=false: nincs hozzáférés', async () => {
    const db = ctx(ADMIN1, { email_verified: false });
    await assertFails(getDoc(doc(db, 'config/app')));
    await assertFails(setDoc(doc(db, 'votes/intezmeny__admin1'), vote('intezmeny', 'ovoda', 'admin1')));
  });
});

describe('Admin olvasás', () => {
  it('mindent olvas', async () => {
    const db = ctx(ADMIN1);
    await assertSucceeds(getDoc(doc(db, 'config/app')));
    await assertSucceeds(getDocs(collection(db, 'votes')));
    await assertSucceeds(getDocs(collection(db, 'messages')));
    await assertSucceeds(getDocs(collection(db, 'status')));
    await assertSucceeds(getDocs(collection(db, 'users')));
  });
  it('a token e-mailje kis- és nagybetűtől függetlenül egyezik', async () => {
    const db = ctx({ uid: 'admin1', email: 'Admin1@Example.COM' });
    await assertSucceeds(getDoc(doc(db, 'config/app')));
  });
});

describe('Szavazás', () => {
  it('admin szavazhat a saját nevében', async () => {
    await assertSucceeds(setDoc(doc(ctx(ADMIN1), 'votes/intezmeny__admin1'), vote('intezmeny', 'altalanos', 'admin1')));
  });
  it('admin átteheti a szavazatát', async () => {
    const db = ctx(ADMIN2);
    await assertSucceeds(setDoc(doc(db, 'votes/intezmeny__admin2'), vote('intezmeny', 'altalanos', 'admin2')));
  });
  it('admin visszavonhatja a saját szavazatát', async () => {
    await assertSucceeds(deleteDoc(doc(ctx(ADMIN2), 'votes/intezmeny__admin2')));
  });
  it('más nevében nem lehet szavazni (idegen kulcs)', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'votes/intezmeny__admin2'), vote('intezmeny', 'altalanos', 'admin2')));
  });
  it('más nevében nem lehet szavazni (idegen uid mező)', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'votes/intezmeny__admin1'), vote('intezmeny', 'altalanos', 'admin2')));
  });
  it('más szavazatát nem lehet törölni', async () => {
    await assertFails(deleteDoc(doc(ctx(ADMIN1), 'votes/intezmeny__admin2')));
  });
  it('a kulcs és a decisionId egyezzen', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'votes/letszam__admin1'), vote('intezmeny', 'altalanos', 'admin1')));
  });
  it('hibás formátumú optionId elutasítva', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'votes/intezmeny__admin1'), vote('intezmeny', 'Általános!', 'admin1')));
  });
  it('plusz mező elutasítva', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'votes/intezmeny__admin1'), { ...vote('intezmeny', 'ovoda', 'admin1'), x: 1 }));
  });
  it('nem szerveridő elutasítva', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'votes/intezmeny__admin1'), { ...vote('intezmeny', 'ovoda', 'admin1'), updatedAt: new Date() }));
  });
});

describe('Lezárt döntés', () => {
  it('lezárt döntésre nem lehet új szavazatot leadni', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN2), 'votes/szint__admin2'), vote('szint', 'foldszint', 'admin2')));
  });
  it('lezárt döntésnél nem lehet szavazatot áttenni', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'votes/szint__admin1'), vote('szint', 'alagsor', 'admin1')));
  });
  it('lezárt döntésnél nem lehet szavazatot visszavonni', async () => {
    await assertFails(deleteDoc(doc(ctx(ADMIN1), 'votes/szint__admin1')));
  });
});

describe('Döntés lezárása és újranyitása', () => {
  it('admin lezárhat', async () => {
    await assertSucceeds(setDoc(doc(ctx(ADMIN1), 'status/intezmeny'), {
      state: 'closed', chosenOptionId: 'altalanos', closedBy: 'admin1', closedAt: serverTimestamp(),
    }));
  });
  it('admin újranyithat', async () => {
    await assertSucceeds(setDoc(doc(ctx(ADMIN2), 'status/szint'), {
      state: 'open', chosenOptionId: null, closedBy: null, closedAt: null,
    }));
  });
  it('lezárás opció nélkül elutasítva', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'status/intezmeny'), {
      state: 'closed', chosenOptionId: null, closedBy: 'admin1', closedAt: serverTimestamp(),
    }));
  });
  it('lezárás más nevében elutasítva', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'status/intezmeny'), {
      state: 'closed', chosenOptionId: 'ovoda', closedBy: 'admin2', closedAt: serverTimestamp(),
    }));
  });
  it('ismeretlen állapot elutasítva', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'status/intezmeny'), {
      state: 'paused', chosenOptionId: null, closedBy: null, closedAt: null,
    }));
  });
});

describe('Üzenetek', () => {
  it('admin írhat a saját nevében', async () => {
    await assertSucceeds(setDoc(doc(ctx(ADMIN1), 'messages/a'), message('admin1', 'Szerintem az általános iskola.', 'intezmeny')));
  });
  it('más nevében nem lehet üzenetet írni', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'messages/a'), message('admin2', 'Hamis')));
  });
  it('1000 karakter még elfogad', async () => {
    await assertSucceeds(setDoc(doc(ctx(ADMIN1), 'messages/a'), message('admin1', 'é'.repeat(1000))));
  });
  it('1000 karakternél hosszabb üzenet elutasítva', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'messages/a'), message('admin1', 'a'.repeat(1001))));
  });
  it('üres üzenet elutasítva', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'messages/a'), message('admin1', '')));
  });
  it('plusz mező elutasítva', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'messages/a'), { ...message('admin1', 'x'), pinned: true }));
  });
  it('hibás decisionId elutasítva', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'messages/a'), message('admin1', 'x', '../config')));
  });
  it('üzenet nem módosítható, a szerzőnek sem', async () => {
    await assertFails(updateDoc(doc(ctx(ADMIN2), 'messages/m_admin2'), { text: 'Átírva' }));
  });
  it('a szerző törölheti', async () => {
    await assertSucceeds(deleteDoc(doc(ctx(ADMIN2), 'messages/m_admin2')));
  });
  it('más üzenetét senki nem törölheti, admin sem', async () => {
    await assertFails(deleteDoc(doc(ctx(ADMIN1), 'messages/m_admin2')));
  });
});

describe('Felhasználói profil', () => {
  it('admin a saját profilját írhatja', async () => {
    await assertSucceeds(setDoc(doc(ctx(ADMIN2), 'users/admin2'), { displayName: 'Admin Kettő', photoURL: null, lastSeen: serverTimestamp() }));
  });
  it('más profilját nem írhatja', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN2), 'users/admin1'), { displayName: 'X', lastSeen: serverTimestamp() }));
  });
  it('színsorszám 0–7 között elfogadva', async () => {
    await assertSucceeds(setDoc(doc(ctx(ADMIN2), 'users/admin2'), { displayName: 'B', colorIndex: 7, lastSeen: serverTimestamp() }));
  });
  it('színsorszám tartományon kívül vagy nem egész: elutasítva', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN2), 'users/admin2'), { displayName: 'B', colorIndex: 8, lastSeen: serverTimestamp() }));
    await assertFails(setDoc(doc(ctx(ADMIN2), 'users/admin2'), { displayName: 'B', colorIndex: '1', lastSeen: serverTimestamp() }));
  });
  it('e-mail mező nem kerülhet a profilba', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN2), 'users/admin2'), { displayName: 'X', email: ADMIN2.email, lastSeen: serverTimestamp() }));
  });
});

describe('Belépési napló (sessions)', () => {
  const newSession = (uid) => ({ uid, startedAt: serverTimestamp(), lastSeenAt: serverTimestamp(), endedAt: null });

  it('admin rögzítheti a saját belépését', async () => {
    await assertSucceeds(setDoc(doc(ctx(ADMIN1), 'sessions/uj'), newSession('admin1')));
  });
  it('más nevében nem lehet belépést rögzíteni', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'sessions/uj'), newSession('admin2')));
  });
  it('nem admin nem rögzíthet belépést', async () => {
    await assertFails(setDoc(doc(ctx(MEMBER), 'sessions/uj'), newSession('member1')));
  });
  it('létrehozáskor nem lehet lezárt és nem lehet plusz mező', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'sessions/uj'), { ...newSession('admin1'), endedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(ctx(ADMIN1), 'sessions/uj'), { ...newSession('admin1'), ip: '1.2.3.4' }));
  });
  it('a saját nyitott munkamenet frissíthető (aktivitás, kilépés)', async () => {
    const db = ctx(ADMIN1);
    await assertSucceeds(updateDoc(doc(db, 'sessions/s_admin1'), { lastSeenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(db, 'sessions/s_admin1'), { lastSeenAt: serverTimestamp(), endedAt: serverTimestamp() }));
  });
  it('a kezdés ideje és a tulajdonos nem írható át', async () => {
    const db = ctx(ADMIN1);
    await assertFails(updateDoc(doc(db, 'sessions/s_admin1'), { startedAt: serverTimestamp(), lastSeenAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, 'sessions/s_admin1'), { uid: 'admin2', lastSeenAt: serverTimestamp() }));
  });
  it('lezárt munkamenet nem módosítható', async () => {
    await assertFails(updateDoc(doc(ctx(ADMIN1), 'sessions/s_admin1_closed'), { lastSeenAt: serverTimestamp() }));
  });
  it('más munkamenete nem módosítható', async () => {
    await assertFails(updateDoc(doc(ctx(ADMIN2), 'sessions/s_admin1'), { lastSeenAt: serverTimestamp() }));
  });
  it('a naplót csak a logViewers-ben szereplő admin olvashatja', async () => {
    await assertSucceeds(getDocs(collection(ctx(ADMIN2), 'sessions')));
    await assertFails(getDocs(collection(ctx(ADMIN1), 'sessions')));
    await assertFails(getDoc(doc(ctx(ADMIN1), 'sessions/s_admin1')));
    await assertFails(getDocs(collection(ctx(MEMBER), 'sessions')));
    await assertFails(getDocs(collection(anon(), 'sessions')));
  });
  it('naplóbejegyzést senki nem törölhet', async () => {
    await assertFails(deleteDoc(doc(ctx(ADMIN2), 'sessions/s_admin1')));
    await assertFails(deleteDoc(doc(ctx(ADMIN1), 'sessions/s_admin1')));
  });
});

describe('A config nem írható', () => {
  it('admin sem írhatja', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN1), 'config/app'), { admins: [ADMIN1.email, MEMBER.email] }));
    await assertFails(updateDoc(doc(ctx(ADMIN1), 'config/app'), { admins: [] }));
    await assertFails(deleteDoc(doc(ctx(ADMIN1), 'config/app')));
  });
  it('tag sem írhatja', async () => {
    await assertFails(setDoc(doc(ctx(MEMBER), 'config/app'), { admins: [MEMBER.email] }));
  });
});

describe('Minden más út tiltva', () => {
  it('ismeretlen gyűjtemény', async () => {
    await assertFails(getDoc(doc(ctx(ADMIN1), 'secrets/x')));
    await assertFails(setDoc(doc(ctx(ADMIN1), 'secrets/x'), { a: 1 }));
  });
});

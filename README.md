# Konyhatervezési döntések – döntési oldal

Az Élelmezési menedzsment B projektcsoport közös döntési oldala. Itt állapodunk meg a konyhatervezési feladat 18 kérdésében: szavazás, döntések lezárása, döntésenkénti hozzászólások és egy közös csevegő.

- **Cím:** https://bos-tom.github.io/ElelmezesMenedzsment_B/
- **Repó:** https://github.com/bos-tom/ElelmezesMenedzsment_B
- **Technika:** sima HTML + CSS + JavaScript (build nélkül), GitHub Pages, Firebase (Google-belépés + Cloud Firestore, ingyenes Spark csomag).
- **Hozzáférés:** csak a `config/app` dokumentumban felsorolt adminok. Aki más Google-fiókkal lép be, a „Nincs hozzáférésed” képernyőt látja, a kijelentkezett látogató pedig csak a belépési gombot.

> Az oldal Claude (MI) közreműködésével készült. Ezt a bemutatóban is fel kell tüntetni.

---

## Telepítés lépésről lépésre

Egyszer kell végigcsinálni, kb. 20 perc. Ha egy menüpont neve angol, az angol felületű Firebase-konzol szövegét írtam.

### 1. Firebase-projekt és Firestore létrehozása

1. Nyisd meg a https://console.firebase.google.com oldalt, és lépj be a saját Google-fiókoddal.
2. **Create a project** (Projekt létrehozása) → név, pl. `elelmezes-dontesek` → **Continue**.
3. A Google Analyticset **kapcsold ki** (nem kell) → **Create project**.
4. Bal oldalt **Build → Firestore Database** → **Create database**.
5. Helyszín: egy európai régió, pl. **`eur3 (Europe)`**. Ezt később nem lehet megváltoztatni.
6. Mód: **Start in production mode** (éles mód). → **Create**.

### 2. Google-belépés bekapcsolása

1. **Build → Authentication** → **Get started**.
2. **Sign-in method** fül → **Google** → kapcsold be (**Enable**).
3. **Support email for project**: válaszd ki a saját címedet → **Save**.

### 3. Engedélyezett domain felvétele

1. **Authentication → Settings** fül → **Authorized domains**.
2. **Add domain** → írd be: `bos-tom.github.io` → **Add**.

(A `localhost` alapból benne van, az a helyi próbához kell.)

### 4. A `js/firebase-config.js` kitöltése

1. Bal felül a fogaskerék → **Project settings** → **General** fül.
2. Lent a **Your apps** résznél kattints a **`</>`** (Web) ikonra.
3. App nickname: pl. `dontesi-oldal`. A **Firebase Hosting** jelölőnégyzetet **ne** pipáld be. → **Register app**.
4. Megjelenik egy kódrészlet egy `const firebaseConfig = { ... }` résszel. Ennek a tartalmát másold át a repó `js/firebase-config.js` fájljába, a mintamezők helyére:

   ```js
   export const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "elelmezes-dontesek.firebaseapp.com",
     projectId: "elelmezes-dontesek",
     storageBucket: "elelmezes-dontesek.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abc123..."
   };
   ```

   Ezek az adatok **nem titkosak**, nyugodtan bekerülhetnek a nyilvános repóba. Az adatokat a biztonsági szabályok védik (6. lépés).

### 5. Az admin-lista: `config/app` dokumentum

Ez dönti el, ki láthatja az oldalt. A címek csak itt szerepelnek, a kódban nem.

1. **Firestore Database → Data** fül → **Start collection**.
2. Collection ID: **`config`** → **Next**.
3. Document ID: **`app`** (ne az automatikus azonosító legyen!).
4. Mező hozzáadása:
   - Field: **`admins`**
   - Type: **array**
   - Az elemek mind **string** típusúak, egy-egy Google-fiókos e-mail-cím, **csupa kisbetűvel**:

   ```json
   {
     "admins": [
       "elso.admin@gmail.com",
       "masodik.admin@gmail.com",
       "harmadik.admin@gmail.com",
       "negyedik.admin@gmail.com",
       "otodik.admin@gmail.com",
       "hatodik.admin@gmail.com"
     ]
   }
   ```

   A minta helyére a csoport 6 tagjának valódi címét írd. Pontosan azt a címet add meg, amellyel a tag a Google-be belép.
5. **Save**.

Később új tagot ugyanitt, egy új tömbelemmel lehet felvenni. Az oldalt ehhez nem kell újra közzétenni, elég, ha az illető újratölti.

> Ha a `config/app` dokumentum hiányzik vagy rossz a neve, **mindenki** a „Nincs hozzáférésed” képernyőt fogja látni.

### 6. A biztonsági szabályok közzététele

**A) A konzolban (egyszerűbb):**

1. **Firestore Database → Rules** fül.
2. Töröld a meglévő szöveget, és másold be a repó `firestore.rules` fájljának teljes tartalmát.
3. **Publish**.

**B) Parancssorból** (ha van Node.js a gépeden):

```bash
npm install
npx firebase login
npx firebase use --add
npm run deploy:rules
```

(A `firebase use --add` megkérdezi, melyik projekt; válaszd ki az 1. lépésben létrehozottat.)

### 7. GitHub Pages bekapcsolása

Ehhez a kódnak már fent kell lennie a GitHubon (push után).

1. https://github.com/bos-tom/ElelmezesMenedzsment_B → **Settings** → bal oldalt **Pages**.
2. **Source:** *Deploy from a branch*.
3. **Branch:** `main`, mappa: **`/ (root)`** → **Save**.
4. 1–2 perc múlva az oldal elérhető: https://bos-tom.github.io/ElelmezesMenedzsment_B/

### 8. Kipróbálás és a link kiküldése

1. Nyisd meg a címet, lépj be a saját (admin) fiókoddal, és adj le egy próbaszavazatot.
2. Egy másik böngészőből (vagy inkognitóablakból) egy másik admin fiókkal nézd meg, hogy a szavazat és egy csevegőüzenet azonnal megjelenik-e.
3. Ha minden működik, küldd ki a linket a csoportnak.

---

## Hibaelhárítás

| Mit látsz | Mi a teendő |
|---|---|
| „A js/firebase-config.js még nincs kitöltve.” | 4. lépés. |
| „Ez a webcím nincs engedélyezve a belépéshez” | 3. lépés: a `bos-tom.github.io` hiányzik az Authorized domains közül. |
| Belépés után mindenki „Nincs hozzáférésed”-et kap | 5. lépés: a dokumentum neve pontosan `config` / `app`, a mező `admins` tömb, a címek kisbetűsek. Ellenőrizd a 6. lépést is. |
| Csak egy tag kapja ezt | Az ő címe nincs az `admins` tömbben, elírták, vagy más fiókkal lépett be. |
| Mobilon nem nyílik meg a belépőablak | Az oldal ilyenkor automatikusan átirányításos belépésre vált. Ha így sem megy, a böngésző ne blokkolja a felugró ablakokat. |

---

## Mire figyelj

- **A `data/dontesek.json` nyilvános.** A GitHub Pages minden fájlt belépés nélkül kiszolgál, így a kérdések és az érvek letölthetők. A szavazatok, a nevek és a csevegés viszont a Firestore-ban vannak, azokat csak az adminok látják.
- A tartalmat (kérdések, opciók, érvek) a `data/dontesek.json` adja. A döntések és opciók `id`-jére vannak kötve a szavazatok, ezeket ne nevezd át.
- E-mail-cím nem kerül sem az adatbázisba (a `config/app` kivételével), sem a felületre; a tagoknál csak a név és a profilkép látszik.

## Hogyan működik

| Firestore | Tartalom | Ki írhatja |
|---|---|---|
| `config/app` | `admins`: az engedélyezett e-mailek | senki a weboldalról, csak a konzol |
| `users/{uid}` | név, profilkép, utolsó belépés | mindenki a sajátját |
| `votes/{döntés}__{uid}` | a tag szavazata egy döntésben | mindenki a sajátját, lezárt döntésnél senki |
| `status/{döntés}` | nyitott / lezárva, elfogadott opció, ki és mikor zárta le | admin |
| `messages/{id}` | csevegőüzenet (1–1000 karakter), opcionális döntéscímkével | mindenki a saját nevében; módosítani nem lehet; törölni a szerző vagy admin tud |

Szerepkörök: mivel csak adminok férnek hozzá, minden belépő tag szavazhat, írhat, lezárhat és újranyithat döntést, és bármely üzenetet törölhet. Ezért külön „Admin” jelvény sincs a felületen.

Fájlok:

```
index.html              az oldal váza
css/style.css           megjelenés (világos és sötét téma)
js/firebase-config.js   a Firebase-projekt adatai (4. lépés)
js/firebase.js          Firebase-inicializálás (SDK 10.14.1, CDN-ről)
js/app.js               belépés, adatbetöltés, összesítő, döntéskártyák
js/votes.js             szavazás, lezárás, újranyitás
js/chat.js              közös csevegő és döntésenkénti hozzászólások
js/dom.js               segédfüggvények
data/dontesek.json      a döntések tartalma
firestore.rules         biztonsági szabályok
tests/rules.test.mjs    a szabályok automatikus tesztjei
scripts/dev.mjs         helyi próbaszerver az emulatorhoz
firebase.json           a Firebase CLI beállításai (szabályok, emulator)
```

## Fejlesztőknek: helyi próba és szabálytesztek

Kell hozzá: **Node.js 20+** és **Java JDK 21+** (a Firebase Emulator miatt).

```bash
npm install
```

Szabálytesztek (Firestore Emulatorral, 52 eset):

```bash
npm run test:rules
```

Helyi próba hamis Google-fiókokkal, a valódi Firebase-projekt érintése nélkül:

```bash
npm run dev
```

Utána nyisd meg: http://localhost:5500/?emulator. Belépéskor az emulator saját ablaka jön fel. Adj meg `admin1@example.com` vagy `admin2@example.com` címet (ezek a próba-adminok), vagy bármilyen más címet a „Nincs hozzáférésed” képernyő kipróbálásához. Az `?emulator` nélkül és nem `localhost`-on az oldal mindig a valódi Firebase-projekthez kapcsolódik.

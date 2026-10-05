# Döntési oldal – Élelmezési menedzsment projektcsoport

Ez a mappa egy kis webalkalmazás forrása. Egy egyetemi projektcsoport ezen az oldalon állapodik meg a konyhatervezési feladat 18 kérdésében, mielőtt szétosztják a munkát. Ez a fájl a teljes fejlesztési leírás. Kezdés előtt olvasd végig, a végén lévő **Nyitott kérdések** részt pedig tedd fel Tomnak, mielőtt az érintett részt megírod.

## 1. Mit kell elkészíteni

Statikus oldal a **GitHub Pagesen**, **Firebase** háttérrel (Authentication + Cloud Firestore, ingyenes Spark csomag). Négy része van, fentről lefelé:

1. **Összesítő**: egy táblázat a 18 döntésről. Döntésenként mutassa a vezető opciót, a szavazatok számát és az állapotot (nyitott / lezárva, és ha lezárva, mi lett a döntés).
2. **Döntések**: a meglévő tartalom (kérdés, hatás, opciók, mellette/ellene érvek forráscímkével, Claude javaslata). Opciónként: szavazatszám, a szavazók neve, az **adminok külön jelvénnyel** megjelölve, és a saját szavazat kiemelve.
3. **Csevegő**: egy közös, valós idejű csevegőablak az oldal alján. Egy üzenet opcionálisan egy döntéshez címkézhető (legördülő lista). A címke a döntésre ugró hivatkozás, az admin üzenetei jelvényt kapnak.
4. **Források**: a meglévő forrásjegyzék és az MI-nyilatkozat.

A felület nyelve **magyar**.

## 2. A meglévő anyag (ebben a mappában)

- `data/dontesek.json`: a tartalom egyetlen forrása. Szerkezete: `sources` (forráskód → leírás) és `groups[] → decisions[] → options[] → pros/cons`. Egy érv háromelemű tömb: `[szöveg, forráskód, hely]`. Az `MI` forráskód a nem tananyagból származó állítás, ezt sárga, szaggatott keretes címke jelöli. A döntések `id`-je stabil, erre kell kötni a szavazatokat. **A tartalmat ne írd át**, csak olvasd be.
- `reference/konyhatervezesi-dontesek.html`: a jelenlegi, csak olvasható előnézet. **Ez a vizuális minta**: tartsd meg a színtokeneket (világos és sötét téma), a betűpárt (Archivo címekhez, IBM Plex Sans szöveghez, IBM Plex Mono címkékhez), az elrendezést (bal oldali tartalomjegyzék, jobbra a döntéskártyák) és a forráscímkék stílusát. A benne lévő `localStorage`-os „Ezt támogatom” jelölést a valódi szavazás váltja fel.

## 3. Technológia

- Build lépés nélkül: sima HTML + CSS + ES-modulos JavaScript, hogy a GitHub Pages közvetlenül kiszolgálja.
- Firebase JS SDK v10 moduláris változata a `https://www.gstatic.com/firebasejs/10.x.x/...` CDN-ről, rögzített verzióval.
- Bejelentkezés: **Google-fiókkal** (Firebase Auth, `signInWithPopup`, mobilon `signInWithRedirect` tartalékként).
- Valós idő: Firestore `onSnapshot` a szavazatokra, az állapotokra és a csevegőre.
- A Firebase webes konfiguráció (`apiKey` stb.) nem titok, mehet a repóba a `js/firebase-config.js` fájlba. A védelmet a biztonsági szabályok adják, ezért azok a legfontosabb rész.

Javasolt szerkezet:

```
/index.html
/css/style.css
/js/firebase-config.js     # Tom tölti ki a Firebase-konzolból
/js/app.js                 # belépés, adatbetöltés, renderelés
/js/votes.js
/js/chat.js
/data/dontesek.json
/firestore.rules
/firebase.json             # csak a szabályok CLI-s telepítéséhez
/README.md                 # telepítési útmutató Tomnak, magyarul
```

## 4. Szerepkörök

- **Admin (5 fő)**: a projektcsoport tagjai. A rendszer e-mail-cím alapján ismeri fel őket, a cím a Firestore `config/app` dokumentum `admins` tömbjében van. Szavaz, csevegőt ír, **lezárhat és újranyithat döntést**, bármely üzenetet törölhet. Mindenhol „Admin” jelvény jelöli.
- **Tag**: bárki más, aki a linkkel és Google-fiókkal belép. Olvas és csevegőt ír. Szavazhat-e? Ezt a `config/app.membersCanVote` kapcsoló dönti el, alapértéke `false` (lásd: Nyitott kérdések).
- **Kijelentkezett látogató**: csak egy belépési képernyőt lát, a tartalmat nem.

Az admin-listát kódba ne írd be. A `config/app` dokumentumot Tom tölti ki a Firebase-konzolban, a kliens csak olvassa.

## 5. Adatmodell (Firestore)

| Gyűjtemény / dokumentum | Mezők | Ki írhatja |
|---|---|---|
| `config/app` | `admins: string[]` (kisbetűs e-mailek), `membersCanVote: bool` | senki a kliensből (csak konzol) |
| `users/{uid}` | `displayName`, `photoURL`, `lastSeen` | csak a saját |
| `votes/{decisionId}__{uid}` | `decisionId`, `optionId`, `uid`, `updatedAt` (szerveridő) | csak a saját; lezárt döntésnél senki |
| `status/{decisionId}` | `state: "open" \| "closed"`, `chosenOptionId`, `closedBy`, `closedAt` | csak admin |
| `messages/{autoId}` | `uid`, `text` (1–1000 karakter), `decisionId` (vagy `null`), `createdAt` (szerveridő) | létrehozás: a saját nevében; módosítás: senki; törlés: a szerző vagy admin |

- Szavazatonként egy dokumentum, a kulcs `decisionId__uid`, így felhasználónként és döntésenként egy szavazat lehet. A szavazás visszavonása a dokumentum törlése.
- Az e-mail-cím **ne** kerüljön a `users` dokumentumba, és a felületen se jelenjen meg; elég a név és a profilkép. Az admin-ellenőrzés a hitelesítési tokenből (`request.auth.token.email`) történik.
- A `decisionId` és az `optionId` csak a `dontesek.json`-ban létező érték lehet. A kliens ezt ellenőrizze, a szabályok pedig legalább a formátumot (`^[a-z0-9_]{1,40}$`).

## 6. Biztonsági szabályok

Ezt írd meg teljes egészében a `firestore.rules`-ba, és teszteld (lásd 9. pont). Alapelvek:

- Minden olvasáshoz bejelentkezés és **ellenőrzött e-mail** kell (`request.auth.token.email_verified == true`; Google-fióknál ez teljesül).
- `isAdmin()` = a token e-mailje (kisbetűsítve) benne van a `get(/databases/$(database)/documents/config/app).data.admins` tömbben.
- `votes`: létrehozás és frissítés csak akkor, ha a dokumentumkulcs `decisionId + "__" + request.auth.uid`, a mezőkészlet pontosan az elvárt, `updatedAt == request.time`, a döntés `status` dokumentuma nem `closed`, és a felhasználó admin, vagy `membersCanVote == true`. Törlés: a saját szavazat, nyitott döntésnél.
- `messages`: létrehozásnál `uid == request.auth.uid`, a `text` sztring 1 és 1000 karakter között, `createdAt == request.time`, és nincs más mező. Módosítás tilos. Törlés: a szerző vagy admin.
- `status`: írás csak adminnak, olvasás mindenkinek, aki be van lépve.
- `config`: olvasás belépve, írás senkinek.
- Minden más út: tiltva.

## 7. Felület és viselkedés

- **Belépés**: a fejlécben „Belépés Google-fiókkal” gomb; belépve név, profilkép, „Kilépés”, adminnál jelvény.
- **Szavazás**: opciónként „Erre szavazok” gomb, a saját választás kiemelve. Újrakattintás visszavonja, másik opció választása átteszi a szavazatot. Az opció alatt a szavazók nevei, adminok elöl és jelvénnyel. Lezárt döntésnél a gombok tiltottak, a kiválasztott opció „Elfogadva” címkét kap.
- **Döntés lezárása** (csak admin): „Döntés lezárása” gomb, a lezáráskor választani kell egy opciót. A megerősítés az oldalon belül történjen, ne `confirm()`-mal. Újranyitás ugyanígy.
- **Csevegő**: legújabb üzenet alul, automatikus görgetés, kivéve ha a felhasználó felfelé görgetett. Az üzenetnél név, idő (helyi idő, magyar formátum), opcionális döntéscímke; adminnál jelvény. Enter küld, Shift+Enter új sor. Gyors egymás utáni küldés ellen kliensoldali korlát (pl. 2 másodperc).
- **Biztonság a felületen**: felhasználói szöveget kizárólag `textContent`-tel szabad megjeleníteni, `innerHTML` soha.
- **Összesítő**: a táblázat a döntésekre hivatkozik; a döntés a lap tetejéről egy kattintással elérhető.
- **Hozzáférhetőség és mobil**: 400 px szélességen is működjön, vízszintes görgetés nélkül; látható fókusz; a gombok szövege mondja meg, mi történik.
- **Hibák**: érthető magyar üzenet. Példák: „Nincs jogosultságod szavazni ebben a döntésben.” „A döntés le van zárva.” „Nem sikerült elküldeni, próbáld újra.”
- Az oldal alján maradjon ott a nyilatkozat, hogy az oldal Claude (MI) közreműködésével készült. A tárgy szabálya szerint ezt a bemutatóban is fel kell tüntetni.

## 8. Telepítés (README.md, Tomnak, lépésről lépésre, magyarul)

1. Firebase-projekt létrehozása (Analytics nélkül), Firestore létrehozása **éles módban**, európai régióban (pl. `eur3`).
2. Authentication → Sign-in method → **Google** bekapcsolása.
3. Authentication → Settings → Authorized domains: `<github-felhasználónév>.github.io` hozzáadása.
4. Project settings → Web app regisztrálása → a konfiguráció bemásolása a `js/firebase-config.js`-be.
5. Firestore-ban a `config/app` dokumentum létrehozása: `admins` (az 5 e-mail-cím, kisbetűvel) és `membersCanVote` (`false`).
6. A `firestore.rules` tartalmának közzététele (a konzolban bemásolva vagy `firebase deploy --only firestore:rules`).
7. GitHub-repó → Settings → Pages → forrás: `main` ág, gyökérmappa.
8. A link kiküldése a csoportnak.

## 9. Ellenőrzés, mielőtt késznek nyilvánítod

- A szabályokat teszteld a Firebase Emulatorral és a `@firebase/rules-unit-testing` csomaggal. Az alábbi eseteknek mind teljesülniük kell:
  - kijelentkezve semmi nem olvasható;
  - tag nem szavazhat, ha `membersCanVote == false`;
  - más nevében nem lehet szavazni vagy üzenetet írni;
  - lezárt döntésre nem lehet szavazni;
  - nem admin nem zárhat le döntést, és nem törölheti más üzenetét;
  - 1000 karakternél hosszabb üzenet elutasítva;
  - a `config` nem írható.
- Kézi próba két böngészőprofillal (egy admin, egy tag): szavazat és üzenet valós időben megjelenik a másiknál.
- Mobilnézet (400 px) és sötét téma átnézése.
- A `dontesek.json` mind a 18 döntése és minden forráscímke megjelenik.

## 10. Nem része a feladatnak

Fájlfeltöltés, értesítések (e-mail vagy push), opciók szerkesztése a felületen, több projekt kezelése, analitika.

## 11. Nyitott kérdések (kérdezd meg Tomot)

1. **Szavazhatnak-e a nem admin tagok?** A leírás alapértéke: nem, csak olvasnak és csevegnek.
2. Mi legyen a GitHub-repó neve, és melyik fiók alatt lesz? Ettől függ a `github.io`-cím.
3. Az 5 admin Google-fiókos e-mail-címe. Ezt Tom a konzolban adja meg, a kódba nem kerül.
4. Látszódjon-e a szavazók neve mindenkinek, vagy csak a szavazatszám? A leírás alapértéke: látszik a név.

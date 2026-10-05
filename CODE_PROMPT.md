Készítsd el a döntési oldalt a mappában lévő CLAUDE.md fejlesztési leírás alapján. Olvasd végig a leírást, a data/dontesek.json adatfájlt és a reference/konyhatervezesi-dontesek.html vizuális mintát, mielőtt kódot írsz.

A leírás „Nyitott kérdések” részére itt a válasz, ezekkel dolgozz:

1. Szavazhatnak-e a nem admin tagok?
   Válasz: [IGEN / NEM]

2. GitHub-repó neve és fiókja:
   Fiók (felhasználónév): [...]
   Repó neve: [...]
   Az oldal címe így: https://[fiók].github.io/[repó]/

3. Az 5 admin Google-fiókos e-mail-címe (ezt nem kell a kódba írni, csak a README-ben szereplő config/app példába tedd bele, hogy be tudjam másolni a Firebase-konzolba):
   1. [...]
   2. [...]
   3. [...]
   4. [...]
   5. [...]

4. Látszódjon-e a szavazók neve mindenkinek, vagy csak a szavazatszám?
   Válasz: [NÉV LÁTSZIK / CSAK SZÁM]

Munkamenet:
- Először írj egy rövid tervet (fájlok, sorrend), és várd meg, hogy jóváhagyjam.
- Utána építsd meg az oldalt, írd meg a firestore.rules-t, és futtasd le a leírás 9. pontjában szereplő szabálytesteket a Firebase Emulatorral. Ha valamelyik teszt nem megy át, javítsd, és futtasd újra.
- A végén írd meg a magyar nyelvű README.md-t lépésről lépésre: Firebase-projekt, Google-belépés, engedélyezett domain, firebase-config.js kitöltése, config/app dokumentum, szabályok közzététele, GitHub Pages bekapcsolása.
- A git-repót inicializáld, és készíts első commitot, de csak akkor pusholj, ha kifejezetten kérem.
- A dontesek.json tartalmát ne változtasd meg.
- Ha a leírás valamelyik pontja nem egyértelmű, kérdezz, ne találgass.

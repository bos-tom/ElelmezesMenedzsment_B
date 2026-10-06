// Helyi próba a Firebase Emulatorral: npm run dev
// Feltölti a config/app dokumentumot, és kiszolgálja az oldalt.
// Megnyitás: http://localhost:5500/?emulator
// Belépés az emulator ablakában: a csoport egyik címével (admin-config.local.json),
// vagy ha nincs ilyen fájl, admin1@example.com / admin2@example.com próbacímmel.

import { createReadStream, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 5500;
const TEST_ADMINS = ['admin1@example.com', 'admin2@example.com'];
// Becenév csak az elsőnek, hogy a Google-névre visszaesés is kipróbálható legyen.
const TEST_NAMES = { 'admin1@example.com': 'Anna' };

// A csoport valódi címei az admin-config.local.json-ból (nincs a gitben).
let local = { admins: [], names: {} };
try {
  local = JSON.parse(readFileSync(new URL('../admin-config.local.json', import.meta.url), 'utf8'));
} catch {
  console.log('admin-config.local.json nem található – csak a próbacímekkel indul.');
}
// Ha van local fájl, csak a csoport valódi tagjai kerülnek be (a próbafiókok nem);
// a próbafiókok csak akkor, ha nincs local fájl.
const hasLocal = Array.isArray(local.admins) && local.admins.length > 0;
const lower = (a) => (a || []).map((e) => String(e).toLowerCase());
const ADMINS = hasLocal ? lower(local.admins) : TEST_ADMINS;
const NAMES = hasLocal ? (local.names || {}) : TEST_NAMES;
const LOG_VIEWERS = hasLocal ? lower(local.logViewers) : ['admin2@example.com'];
const MALE = hasLocal ? lower(local.male) : ['admin2@example.com'];
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

const res = await fetch(
  `http://${FIRESTORE}/v1/projects/demo-dontesek/databases/(default)/documents/config/app`,
  {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        admins: { arrayValue: { values: ADMINS.map((e) => ({ stringValue: e })) } },
        names: {
          mapValue: {
            fields: Object.fromEntries(Object.entries(NAMES).map(([e, n]) => [e, { stringValue: n }])),
          },
        },
        logViewers: { arrayValue: { values: LOG_VIEWERS.map((e) => ({ stringValue: e })) } },
        male: { arrayValue: { values: MALE.map((e) => ({ stringValue: e })) } },
      },
    }),
  },
);
if (!res.ok) throw new Error(`config/app feltöltése sikertelen: ${res.status} ${await res.text()}`);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(ROOT, urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath);
  if (!file.startsWith(ROOT) || file.includes(`${path.sep}node_modules${path.sep}`)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = path.join(file, 'index.html');
    statSync(file);
  } catch {
    res.writeHead(404).end('Nincs ilyen fájl');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`Döntési oldal: http://localhost:${PORT}/?emulator`);
  console.log(`Belépni tudó címek (${ADMINS.length}): ${ADMINS.join(', ')}`);
});

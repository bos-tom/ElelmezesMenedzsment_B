// Helyi próba a Firebase Emulatorral: npm run dev
// Feltölti a config/app dokumentumot két próba-admin címmel, és kiszolgálja az oldalt.
// Megnyitás: http://localhost:5500/?emulator
// A Google-belépés ablakában (emulator) adj meg egy fiókot az alábbi címek egyikével.

import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 5500;
const ADMINS = ['admin1@example.com', 'admin2@example.com'];
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

const res = await fetch(
  `http://${FIRESTORE}/v1/projects/demo-dontesek/databases/(default)/documents/config/app`,
  {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: { admins: { arrayValue: { values: ADMINS.map((e) => ({ stringValue: e })) } } },
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
  console.log(`Próba-adminok: ${ADMINS.join(', ')}`);
});

// Glass Player on http://localhost:1003 (Nexus frames it from here with ?embed=1), or another port: node serve.mjs 1006.
// It also keeps the disk copy of the app's data in data/db, written only when the app sends it.
import { createServer } from 'node:http';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.gif': 'image/gif' };
const DB = join(here, 'data', 'db');
const DOCS = /^(manifest|local|trackCache|trackFeatures|behaviorEvents|userModel|recommendations)\.json$/;
const COVERS = /^covers\/[0-9a-f]{64}\.(png|jpg|webp|gif|bin)$/;
const bodyOf = async (req) => { const parts = []; for await (const part of req) parts.push(part); return Buffer.concat(parts); };

// A write needs the X-GP header, which another site can't send without a preflight this server never answers
async function database(req, res, name) {
  if (!DOCS.test(name) && !COVERS.test(name)) return res.writeHead(404).end();
  const file = join(DB, name);
  if (req.method === 'GET') {
    const body = await readFile(file).catch(() => null);
    if (!body) return res.writeHead(404).end();
    return res.writeHead(200, { 'Content-Type': types[extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  }
  if (req.method !== 'PUT') return res.writeHead(405).end();
  if (req.headers['x-gp'] !== '1') return res.writeHead(403).end();
  const body = await bodyOf(req);
  if (COVERS.test(name) && await stat(file).catch(() => null)) return res.writeHead(204).end();   // named by its content, so it can't differ
  if (name === 'manifest.json') {
    const current = await readFile(file, 'utf8').then(JSON.parse, () => ({ revision: 0 }));
    if (current.revision !== Number(req.headers['x-gp-base'])) return res.writeHead(409).end();
  }
  await mkdir(join(DB, 'covers'), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, body);
  await rename(temporary, file);
  res.writeHead(204).end();
}

createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (pathname.startsWith('/db/')) return database(req, res, pathname.slice(4)).catch((error) => { console.error(error); res.writeHead(500).end(); });
  let path = normalize(pathname).replace(/^([\\/]\.\.)+/, '');
  if (/^[\\/]data([\\/]|$)/i.test(path)) return res.writeHead(404).end();
  if (path === '\\' || path === '/') path = 'index.html';
  try {
    const body = await readFile(join(here, path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(Number(process.argv[2]) || 1003, '127.0.0.1', function () { console.log(`Glass Player: http://localhost:${this.address().port}`); });

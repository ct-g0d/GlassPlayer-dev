// CinemaX UI demo on http://localhost:1003. Files in this folder win; anything else (app.css, build/app.js)
// comes from the project root, so the demo always runs the real, current build.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const roots = [here, join(here, '..')];
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json' };

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([\\/]\.\.)+/, '');
  if (path === '\\' || path === '/') path = 'index.html';
  for (const root of roots) {
    try {
      const body = await readFile(join(root, path));
      res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      return res.end(body);
    } catch {}
  }
  res.writeHead(404).end();
}).listen(1003, '127.0.0.1', () => console.log('Glass Player CinemaX UI: http://localhost:1003'));

// Serves this folder on localhost:1007. A second copy just exits quietly if the port is taken.
const http = require('http'), fs = require('fs'), path = require('path');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  const name = path.basename(new URL(req.url, 'http://localhost').pathname) || 'index.html';
  const type = types[path.extname(name)];
  if (!type) return res.writeHead(404).end();
  fs.readFile(path.join(__dirname, name), (error, body) => error ? res.writeHead(404).end() : res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body));
});
server.on('error', () => {});
server.listen(1007, '127.0.0.1');

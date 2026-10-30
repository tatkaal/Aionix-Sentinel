// Serves the portal fixture at http://localhost:4173/{claude,chatgpt,gemini} and accepts the
// prompt endpoints with 200 so the MAIN-world backstop is exercised end to end.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(import.meta.dirname, 'fixtures/portal.html'));
createServer((req, res) => {
  if (req.method === 'POST') {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
}).listen(4173, () => console.log('fixtures on http://localhost:4173'));

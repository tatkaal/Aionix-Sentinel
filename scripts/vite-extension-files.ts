import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep, extname, dirname } from 'node:path';
import type { Plugin } from 'vite';

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.onnx': 'application/octet-stream',
  '.txt': 'text/plain',
  '.woff2': 'font/woff2',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export interface ExtensionFileEntry {
  path: string;
  size: number;
}

function listFiles(root: string): ExtensionFileEntry[] {
  if (!existsSync(root)) return [];
  return walk(root)
    .map((p) => ({ path: relative(root, p).split(sep).join('/'), size: statSync(p).size }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Exposes the built MV3 extension (`dist-extension/`) to the Workbench under `/extension/`
 * so the Source workspace can zip it client-side. Dev: served by middleware. Build: copied.
 */
export function extensionFilesPlugin(extDir = 'dist-extension'): Plugin {
  let outDir = 'dist';
  return {
    name: 'aionix-extension-files',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use('/extension/', (req, res, next) => {
        const url = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
        if (url === '/files.json') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ built: existsSync(extDir), files: listFiles(extDir) }));
          return;
        }
        const file = join(extDir, url);
        if (!file.startsWith(extDir) || !existsSync(file) || statSync(file).isDirectory()) return next();
        res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      const files = listFiles(extDir);
      const target = join(outDir, 'extension');
      mkdirSync(target, { recursive: true });
      for (const f of files) {
        const dest = join(target, f.path);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(extDir, f.path), dest);
      }
      writeFileSync(join(target, 'files.json'), JSON.stringify({ built: files.length > 0, files }));
      if (files.length === 0) {
        this.warn(`"${extDir}" not found — run "npm run build:ext" first so the ZIP packager has files.`);
      }
    },
  };
}

import hljs from 'highlight.js/lib/core';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import { zipSync } from 'fflate';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, EmptyState, Panel, Segmented, WorkspaceHeader, cx } from '../../components/ui';
import { downloadBlob } from '../../lib/download';
import './code.css';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);

const sources = {
  ...import.meta.glob('/src/extension/**/*.{ts,tsx,html,json,css}', { query: '?raw', import: 'default' }),
  ...import.meta.glob('/src/engine/**/*.ts', { query: '?raw', import: 'default' }),
  ...import.meta.glob('/src/shared/brand/*.{ts,tsx,css}', { query: '?raw', import: 'default' }),
} as Record<string, () => Promise<string>>;

interface BuiltFile {
  path: string;
  size: number;
}

const TEXT_EXT = /\.(js|json|html|css|mjs|txt|md)$/;
const STORED = /\.(wasm|onnx|bin|png|woff2)$/; // already dense — store without deflate

function lang(path: string) {
  if (/\.(ts|tsx|js|mjs)$/.test(path)) return 'typescript';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.html')) return 'xml';
  if (path.endsWith('.css')) return 'css';
  return null;
}

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

function CodeView({ text, path }: { text: string; path: string }) {
  const html = useMemo(() => {
    const l = lang(path);
    return l && text.length < 400_000 ? hljs.highlight(text, { language: l }).value : null;
  }, [text, path]);
  const lines = text.split('\n').length;
  return (
    <div className="flex max-h-[640px] overflow-auto rounded-lg bg-obsidian text-xs leading-[1.6]">
      <pre aria-hidden className="sticky left-0 shrink-0 border-r border-hairline bg-obsidian px-3 py-3 text-right font-mono text-subtle select-none">
        {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
      </pre>
      {html ? (
        <pre className="hljs min-w-0 flex-1 px-4 py-3 font-mono" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="min-w-0 flex-1 px-4 py-3 font-mono text-muted">{text}</pre>
      )}
    </div>
  );
}

export function SourceView() {
  const [mode, setMode] = useState<'source' | 'package'>('source');
  const [built, setBuilt] = useState<{ built: boolean; files: BuiltFile[] } | null>(null);
  const [selected, setSelected] = useState('/src/extension/manifest.json');
  const [content, setContent] = useState<string>('');
  const [zipping, setZipping] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    fetch('/extension/files.json')
      .then((r) => r.json())
      .then(setBuilt)
      .catch(() => setBuilt({ built: false, files: [] }));
  }, []);

  const sourcePaths = useMemo(() => Object.keys(sources).sort(), []);
  const paths = mode === 'source' ? sourcePaths : (built?.files ?? []).map((f) => f.path);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (mode === 'source') {
        const loader = sources[selected];
        setContent(loader ? await loader() : '');
      } else {
        const f = built?.files.find((x) => x.path === selected);
        if (!f) return setContent('');
        if (!TEXT_EXT.test(f.path)) return setContent(`(binary · ${fmtSize(f.size)})`);
        setContent(await (await fetch(`/extension/${f.path}`)).text());
      }
    };
    void load().then(() => cancelled && setContent(''));
    return () => {
      cancelled = true;
    };
  }, [mode, selected, built]);

  useEffect(() => {
    setSelected(mode === 'source' ? '/src/extension/manifest.json' : 'manifest.json');
  }, [mode]);

  const totalSize = (built?.files ?? []).reduce((n, f) => n + f.size, 0);

  const downloadZip = async () => {
    if (!built?.files.length) return;
    setZipping({ done: 0, total: built.files.length });
    const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
    for (const [i, f] of built.files.entries()) {
      const bytes = new Uint8Array(await (await fetch(`/extension/${f.path}`)).arrayBuffer());
      entries[f.path] = [bytes, { level: STORED.test(f.path) ? 0 : 6 }];
      setZipping({ done: i + 1, total: built.files.length });
    }
    const zip = zipSync(entries);
    downloadBlob('aionix-sentinel-extension-v0.1.0.zip', zip, 'application/zip');
    setZipping(null);
  };

  // Group paths by directory for the file tree.
  const groups = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const p of paths) {
      const rel = mode === 'source' ? p.replace(/^\/src\//, '') : p;
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.';
      g.set(dir, [...(g.get(dir) ?? []), p]);
    }
    return [...g.entries()];
  }, [paths, mode]);

  return (
    <>
      <WorkspaceHeader
        eyebrow="Manifest V3 · zero remote code"
        title="Extension Source & ZIP Packager"
        description="The complete extension as it ships: content script, MAIN-world backstop, service worker, offscreen engine, popup, ONNX Runtime wasm, MiniLM INT8 and the compiled vault / FST indexes. Download it and load it unpacked in chrome://extensions."
        actions={
          <Button variant="primary" disabled={!built?.files.length || !!zipping} onClick={() => void downloadZip()}>
            {zipping ? `Packing ${zipping.done}/${zipping.total}…` : `Download .zip${built?.files.length ? ` (${fmtSize(totalSize)})` : ''}`}
          </Button>
        }
      />
      {built && !built.built && (
        <p className="mb-6 rounded-lg border border-amber/30 bg-amber/[0.06] px-4 py-3 text-[13px] text-[#FCD34D]">
          No built extension found. Run <code className="font-mono">npm run build:ext</code> (or <code className="font-mono">npm run build</code>) and reload this page.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        <Panel
          title="Files"
          actions={<Segmented size="sm" label="View" value={mode} onChange={setMode} options={[{ value: 'source', label: 'TypeScript' }, { value: 'package', label: 'Built package' }]} />}
          bodyClassName="max-h-[700px] overflow-y-auto p-2"
        >
          {paths.length === 0 ? (
            <EmptyState title="Nothing to show" />
          ) : (
            groups.map(([dir, files]) => (
              <div key={dir} className="mb-2">
                <div className="px-2 py-1 font-mono text-[11px] text-subtle">{dir}/</div>
                {files.map((p) => {
                  const f = built?.files.find((x) => x.path === p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setSelected(p)}
                      className={cx('flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left font-mono text-xs', selected === p ? 'bg-luminous/10 text-luminous' : 'text-muted hover:bg-white/[0.03] hover:text-alabaster')}
                    >
                      <span className="truncate">{p.split('/').at(-1)}</span>
                      {f && <span className="shrink-0 text-subtle">{fmtSize(f.size)}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </Panel>
        <div className="min-w-0 space-y-6">
          <Panel title={<span className="font-mono text-[13px]">{selected.replace(/^\/src\//, 'src/')}</span>} actions={mode === 'package' ? <Badge tone="brand">as shipped</Badge> : <Badge>source</Badge>}>
            <CodeView text={content} path={selected} />
          </Panel>
          <Panel title="Install">
            <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-muted">
              <li>Download the .zip above and extract it to a folder.</li>
              <li>
                Open <code className="font-mono text-alabaster">chrome://extensions</code> and switch on <span className="text-alabaster">Developer mode</span>.
              </li>
              <li>
                Choose <span className="text-alabaster">Load unpacked</span> and select the extracted folder.
              </li>
              <li>Open claude.ai, chatgpt.com or gemini.google.com. The popup shows the Tier 2 route the hardware probe picked and the offscreen memory reading.</li>
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}

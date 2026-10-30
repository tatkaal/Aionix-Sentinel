// Tier 3 Path B — Exact Data Match. Two signals, both computed without shipping document text:
//  1. Salted SHA-256 hashes of structured CRM / registry fields (names, account numbers, IDs, MRNs).
//  2. MiniLM embeddings of vault chunks in an in-memory Orama vector index (cosine > 0.95).
import { create, insertMultiple, search, type AnyOrama } from '@orama/orama';
import type { Embedder } from '../embed/minilm';
import { sha256Hex } from '../telemetry';
import type { CategoryId, Finding, FindingSource } from '../types';
import type { AssetKind } from './vault-format';

export const EDM_SIMILARITY = 0.95;
const MAX_QUERY_WINDOWS = 8;

export type FieldKind = 'name' | 'account' | 'id' | 'email' | 'mrn';
const UNIQUE_FIELDS: ReadonlySet<FieldKind> = new Set(['account', 'id', 'email', 'mrn']);

export interface EdmChunk {
  assetId: string;
  title: string;
  category: CategoryId;
  vector: Float32Array;
}

export interface EdmFieldHash {
  hash: string;
  assetId: string;
  title: string;
  category: CategoryId;
  row: number;
  field: FieldKind;
}

export interface EdmIndexData {
  dims: number;
  salt: string;
  chunks: EdmChunk[];
  fieldHashes: EdmFieldHash[];
}

export interface EdmSourceDoc {
  id: string;
  title: string;
  kind: AssetKind;
  category: CategoryId;
  text: string;
}

// ── Field normalisation (identical at index and query time) ─────────────────
export function normalizeField(kind: FieldKind, value: string): string {
  switch (kind) {
    case 'name':
      return value.trim().toLowerCase().replace(/\s+/g, ' ');
    case 'account':
    case 'mrn':
      return value.replace(/\D/g, '');
    case 'id':
      return value.trim().toUpperCase();
    case 'email':
      return value.trim().toLowerCase();
  }
}

async function fieldHash(salt: string, kind: FieldKind, value: string): Promise<string> {
  return (await sha256Hex(`${salt}|${kind}|${normalizeField(kind, value)}`)).slice(0, 16);
}

const COLUMN_KINDS: [RegExp, FieldKind][] = [
  [/^(full_)?name$/i, 'name'],
  [/account(_number)?$/i, 'account'],
  [/^(customer|patient)_id$/i, 'id'],
  [/email/i, 'email'],
  [/^mrn$/i, 'mrn'],
];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (c === '"') q = !q;
      else if (c === ',' && !q) {
        cells.push(cur);
        cur = '';
      } else cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

/** Text windows that get embedded for a document. */
export interface TextChunk {
  text: string;
  start: number;
  end: number;
}

const MIN_CHUNK_WORDS = 12;
const MAX_CHUNK_WORDS = 120;
const CSV_ROW = /^[^\n,]*(?:,[^\n,]*){4,}$/;

/**
 * Paragraph-aligned chunking shared by indexing and querying, so a pasted paragraph or table row
 * lines up with the indexed chunk (a 0.95 cosine threshold does not survive misaligned windows).
 * CSV-like lines become one chunk per row; long paragraphs fall back to 90-word windows.
 */
export function chunkText(text: string): TextChunk[] {
  const out: TextChunk[] = [];
  const paraRe = /[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g;
  for (let m = paraRe.exec(text); m; m = paraRe.exec(text)) {
    const para = m[0];
    const base = m.index;
    const lines = para.split('\n');
    if (lines.filter((l) => CSV_ROW.test(l)).length >= Math.max(1, lines.length / 2)) {
      let off = base;
      for (const line of lines) {
        if (CSV_ROW.test(line)) out.push({ text: line.trim(), start: off, end: off + line.length });
        off += line.length + 1;
      }
      continue;
    }
    const words: { start: number; end: number }[] = [];
    const wr = /\S+/g;
    for (let w = wr.exec(para); w; w = wr.exec(para)) words.push({ start: base + w.index, end: base + w.index + w[0].length });
    if (words.length < MIN_CHUNK_WORDS) continue;
    if (words.length <= MAX_CHUNK_WORDS) {
      out.push({ text: text.slice(words[0]!.start, words.at(-1)!.end), start: words[0]!.start, end: words.at(-1)!.end });
      continue;
    }
    for (let i = 0; i < words.length; i += 70) {
      const last = words[Math.min(words.length, i + 90) - 1]!;
      out.push({ text: text.slice(words[i]!.start, last.end), start: words[i]!.start, end: last.end });
      if (i + 90 >= words.length) break;
    }
  }
  return out;
}

export function chunkDocument(kind: AssetKind, text: string): string[] {
  if (kind === 'table') return text.split(/\r?\n/).slice(1).filter((l) => l.trim());
  if (kind === 'code') {
    // Code has no paragraphs: overlapping 8-line windows (Tier 3 Path A remains the primary code signal).
    const lines = text.split('\n').filter((l) => l.trim());
    const out: string[] = [];
    for (let i = 0; i < lines.length; i += 4) out.push(lines.slice(i, i + 8).join('\n'));
    return out;
  }
  return chunkText(text).map((c) => c.text);
}

export async function buildEdmIndexData(docs: EdmSourceDoc[], embedder: Embedder, salt: string): Promise<EdmIndexData> {
  const chunks: EdmChunk[] = [];
  const fieldHashes: EdmFieldHash[] = [];
  for (const d of docs) {
    const parts = chunkDocument(d.kind, d.text);
    for (let i = 0; i < parts.length; i += 16) {
      const vecs = await embedder.embed(parts.slice(i, i + 16));
      for (const v of vecs) chunks.push({ assetId: d.id, title: d.title, category: d.category, vector: v });
    }
    if (d.kind === 'table') fieldHashes.push(...(await tableFieldHashes(d, salt)));
  }
  return { dims: embedder.dims, salt, chunks, fieldHashes };
}

export async function tableFieldHashes(d: Pick<EdmSourceDoc, 'id' | 'title' | 'category' | 'text'>, salt: string): Promise<EdmFieldHash[]> {
  const rows = parseCsv(d.text);
  const header = rows[0] ?? [];
  const cols = header.map((h) => COLUMN_KINDS.find(([re]) => re.test(h.trim()))?.[1] ?? null);
  const out: EdmFieldHash[] = [];
  for (let r = 1; r < rows.length; r++) {
    for (let c = 0; c < cols.length; c++) {
      const kind = cols[c];
      const value = rows[r]![c];
      if (!kind || !value?.trim()) continue;
      out.push({ hash: await fieldHash(salt, kind, value), assetId: d.id, title: d.title, category: d.category, row: r, field: kind });
    }
  }
  return out;
}

// ── Binary container: u32 header length | JSON header | Float32 vectors ─────
export function encodeEdm(data: EdmIndexData): Uint8Array {
  const header = new TextEncoder().encode(
    JSON.stringify({
      dims: data.dims,
      salt: data.salt,
      chunks: data.chunks.map(({ assetId, title, category }) => ({ assetId, title, category })),
      fieldHashes: data.fieldHashes,
    }),
  );
  const pad = (4 - ((4 + header.length) % 4)) % 4;
  const vecBytes = data.chunks.length * data.dims * 4;
  const out = new Uint8Array(4 + header.length + pad + vecBytes);
  new DataView(out.buffer).setUint32(0, header.length + pad, true);
  out.set(header, 4);
  out.fill(0x20, 4 + header.length, 4 + header.length + pad);
  const vectors = new Float32Array(out.buffer, 4 + header.length + pad, data.chunks.length * data.dims);
  data.chunks.forEach((c, i) => vectors.set(c.vector, i * data.dims));
  return out;
}

export function decodeEdm(buf: ArrayBuffer | Uint8Array): EdmIndexData {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const headerLen = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLen))) as Omit<EdmIndexData, 'chunks'> & {
    chunks: Omit<EdmChunk, 'vector'>[];
  };
  const vecStart = bytes.byteOffset + 4 + headerLen;
  const all = new Float32Array(bytes.buffer.slice(vecStart, vecStart + header.chunks.length * header.dims * 4));
  return {
    ...header,
    chunks: header.chunks.map((c, i) => ({ ...c, vector: all.subarray(i * header.dims, (i + 1) * header.dims) })),
  };
}

// ── Runtime detector ─────────────────────────────────────────────────────────
interface Candidate {
  kind: FieldKind;
  value: string;
  start: number;
  end: number;
}

const CAND_PATTERNS: [FieldKind, RegExp][] = [
  ['email', /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g],
  ['id', /\b[A-Z]{2,4}-\d{3,6}\b/g],
  ['account', /\b\d(?:[ -]?\d){5,11}\b/g],
  ['name', /\b[A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){1,2}\b/g],
];

export function extractCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const [kind, re] of CAND_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      out.push({ kind, value: m[0], start: m.index, end: m.index + m[0].length });
      // An 8-digit run may be an MRN as well as an account number.
      if (kind === 'account') out.push({ kind: 'mrn', value: m[0], start: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}

export interface EdmDetector {
  scan(text: string, source: FindingSource): Promise<Finding[]>;
  addDocument(doc: EdmSourceDoc): Promise<void>;
  readonly vectorCount: number;
  readonly fieldCount: number;
}

export async function createEdmDetector(data: EdmIndexData, embedder: Embedder): Promise<EdmDetector> {
  const db: AnyOrama = create({
    schema: { assetId: 'string', title: 'string', category: 'number', embedding: `vector[${data.dims}]` } as const,
  });
  let vectorCount = 0;
  const insertChunks = async (chunks: EdmChunk[]) => {
    await insertMultiple(
      db,
      chunks.map((c) => ({ assetId: c.assetId, title: c.title, category: c.category, embedding: Array.from(c.vector) })),
    );
    vectorCount += chunks.length;
  };
  await insertChunks(data.chunks);

  const fieldIndex = new Map<string, EdmFieldHash[]>();
  const indexFields = (hashes: EdmFieldHash[]) => {
    for (const h of hashes) {
      const list = fieldIndex.get(h.hash);
      if (list) list.push(h);
      else fieldIndex.set(h.hash, [h]);
    }
  };
  indexFields(data.fieldHashes);

  return {
    get vectorCount() {
      return vectorCount;
    },
    get fieldCount() {
      return data.fieldHashes.length;
    },
    async addDocument(doc) {
      const parts = chunkDocument(doc.kind, doc.text);
      const vecs = await embedder.embed(parts);
      await insertChunks(vecs.map((v) => ({ assetId: doc.id, title: doc.title, category: doc.category, vector: v })));
      if (doc.kind === 'table') {
        const hashes = await tableFieldHashes(doc, data.salt);
        data.fieldHashes.push(...hashes);
        indexFields(hashes);
      }
    },
    async scan(text, source) {
      const findings: Finding[] = [];

      // 1) Exact structured-field match.
      const rows = new Map<string, { meta: EdmFieldHash; fields: Set<FieldKind>; start: number; end: number }>();
      for (const c of extractCandidates(text)) {
        const norm = normalizeField(c.kind, c.value);
        if (!norm || (c.kind !== 'name' && norm.length < 5)) continue;
        const hits = fieldIndex.get(await fieldHash(data.salt, c.kind, c.value));
        for (const h of hits ?? []) {
          if (h.field !== c.kind) continue;
          const key = `${h.assetId}#${h.row}`;
          const row = rows.get(key) ?? { meta: h, fields: new Set<FieldKind>(), start: c.start, end: c.end };
          row.fields.add(h.field);
          row.start = Math.min(row.start, c.start);
          row.end = Math.max(row.end, c.end);
          rows.set(key, row);
        }
      }
      for (const r of rows.values()) {
        const unique = [...r.fields].some((f) => UNIQUE_FIELDS.has(f));
        if (r.fields.size < 2 && !unique) continue;
        findings.push({
          id: `EDM_ROW:${r.start}`,
          category: r.meta.category,
          type: r.meta.category === 9 ? 'PATIENT_RECORD' : 'CUSTOMER_RECORD',
          label: `Exact match with “${r.meta.title}” row`,
          tier: 'tier3',
          path: 'edm',
          rawStart: r.start,
          rawEnd: r.end,
          confidence: 0.99,
          evidence: `salted hash match on ${[...r.fields].join(' + ')}`,
          source,
        });
      }

      // 2) Vector similarity against vault chunks.
      const wins = vectorCount > 0 ? chunkText(text).sort((a, b) => b.text.length - a.text.length).slice(0, MAX_QUERY_WINDOWS) : [];
      if (wins.length) {
        const vecs = await embedder.embed(wins.map((w) => w.text));
        for (let i = 0; i < wins.length; i++) {
          const res = await search(db, {
            mode: 'vector',
            vector: { value: Array.from(vecs[i]!), property: 'embedding' },
            similarity: EDM_SIMILARITY,
            limit: 1,
            includeVectors: false,
          });
          const hit = res.hits[0];
          if (!hit) continue;
          const doc = hit.document as unknown as { title: string; category: number };
          findings.push({
            id: `EDM_VEC:${wins[i]!.start}`,
            category: doc.category as CategoryId,
            type: 'CONFIDENTIAL_DOCUMENT',
            label: `Semantic exact match with “${doc.title}”`,
            tier: 'tier3',
            path: 'edm',
            rawStart: wins[i]!.start,
            rawEnd: wins[i]!.end,
            confidence: hit.score,
            evidence: `MiniLM cosine ${hit.score.toFixed(3)} > ${EDM_SIMILARITY}`,
            source,
          });
        }
      }
      return findings;
    },
  };
}

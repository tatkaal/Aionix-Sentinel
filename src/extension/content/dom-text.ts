// Maps the text of a contenteditable/textarea composer to DOM positions so raw finding offsets
// can be turned into Ranges for redaction and selection.

export interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

export interface EditableText {
  text: string;
  segments: TextSegment[];
}

const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'TABLE']);

export function isTextField(el: Element): el is HTMLTextAreaElement | HTMLInputElement {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
}

export function readEditable(el: HTMLElement): EditableText {
  if (isTextField(el)) return { text: el.value, segments: [] };
  let text = '';
  const segments: TextSegment[] = [];
  const walk = (node: Node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = (child as Text).data;
        if (t.length) {
          segments.push({ node: child as Text, start: text.length, end: text.length + t.length });
          text += t;
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child as Element).tagName;
        if (tag === 'BR') {
          text += '\n';
          continue;
        }
        const block = BLOCK.has(tag);
        if (block && text.length && !text.endsWith('\n')) text += '\n';
        walk(child);
        if (block && text.length && !text.endsWith('\n')) text += '\n';
      }
    }
  };
  walk(el);
  return { text: text.replace(/\n+$/, ''), segments };
}

function locate(segments: TextSegment[], offset: number, preferEnd: boolean): { node: Text; offset: number } | null {
  for (const s of segments) {
    if (offset < s.end || (preferEnd && offset === s.end)) {
      if (offset >= s.start) return { node: s.node, offset: offset - s.start };
      return { node: s.node, offset: 0 }; // offset fell on a virtual newline — snap forward
    }
  }
  const last = segments[segments.length - 1];
  return last ? { node: last.node, offset: last.node.data.length } : null;
}

export function rangeFor(map: EditableText, start: number, end: number): Range | null {
  const a = locate(map.segments, start, false);
  const b = locate(map.segments, end, true);
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  return r;
}

/** Selects [start, end) in the composer (used by "Edit manually"). */
export function selectSpan(el: HTMLElement, start: number, end: number): void {
  el.focus();
  if (isTextField(el)) {
    el.setSelectionRange(start, end);
    return;
  }
  const r = rangeFor(readEditable(el), start, end);
  if (!r) return;
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
  (r.startContainer.parentElement ?? el).scrollIntoView({ block: 'nearest' });
}

/**
 * Replaces spans right-to-left through the editor's own input pipeline (execCommand insertText),
 * so ProseMirror / Quill keep their document model in sync with the DOM.
 */
export function replaceSpans(el: HTMLElement, spans: { start: number; end: number; text: string }[]): void {
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  el.focus();
  for (const s of ordered) {
    if (isTextField(el)) {
      el.setRangeText(s.text, s.start, s.end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      continue;
    }
    const r = rangeFor(readEditable(el), s.start, s.end);
    if (!r) continue;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    const ok = document.execCommand('insertText', false, s.text);
    if (!ok) {
      r.deleteContents();
      r.insertNode(document.createTextNode(s.text));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: s.text }));
    }
  }
}

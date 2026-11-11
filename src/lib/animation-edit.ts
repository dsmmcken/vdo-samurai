// Edits an animation script as text: an option's value (duration, end, microphones) or
// an asset, inside its samurai.animation({ ... }) call. Only the declaration's own
// properties are touched; everything else (the draw code, comments, layout)
// stays exactly as written. Knows strings, template literals and comments well
// enough not to be fooled by braces or commas inside them.
import { assetKind } from './animation-api';

export type AssetKind = 'image' | 'audio' | 'font';

interface Prop {
  key: string;
  /** Where the key starts, where its value starts (after the colon), and where it ends (at the comma or closing brace). */
  start: number;
  valueStart: number;
  end: number;
}

/** A placeholder an AI (or anyone) leaves for a file: assets: { logo: 'image' }. */
const PLACEHOLDER = /^(['"`])(image|audio|font)\1$/;

function skipString(code: string, i: number) {
  const q = code[i];
  for (let j = i + 1; j < code.length; j++) {
    if (code[j] === '\\') j++;
    else if (code[j] === q || code[j] === '\n') return j + 1;
  }
  return code.length;
}

function skipTemplate(code: string, i: number): number {
  for (let j = i + 1; j < code.length; j++) {
    if (code[j] === '\\') j++;
    else if (code[j] === '`') return j + 1;
    else if (code[j] === '$' && code[j + 1] === '{') j = skipBalanced(code, j + 1) - 1;
  }
  return code.length;
}

/** At a comment: the index just after it; otherwise null. */
function skipComment(code: string, i: number) {
  if (code[i] !== '/') return null;
  if (code[i + 1] === '/') {
    const n = code.indexOf('\n', i);
    return n < 0 ? code.length : n;
  }
  if (code[i + 1] === '*') {
    const n = code.indexOf('*/', i + 2);
    return n < 0 ? code.length : n + 2;
  }
  return null;
}

/** Strings, templates and comments: the index after; otherwise null. */
function skipOpaque(code: string, i: number) {
  const c = code[i];
  if (c === '"' || c === "'") return skipString(code, i);
  if (c === '`') return skipTemplate(code, i);
  return skipComment(code, i);
}

/** At an opening bracket: the index just after its match. */
function skipBalanced(code: string, i: number): number {
  const close: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];
  for (let j = i; j < code.length; ) {
    const skip = skipOpaque(code, j);
    if (skip !== null) {
      j = skip;
      continue;
    }
    const c = code[j];
    if (close[c]) stack.push(close[c]);
    else if (c === ')' || c === ']' || c === '}') {
      stack.pop();
      if (!stack.length) return j + 1;
    }
    j++;
  }
  return code.length;
}

/** The properties of the object literal whose `{` is at `open`. */
function props(code: string, open: number): { props: Prop[]; close: number } {
  const close = skipBalanced(code, open) - 1;
  const out: Prop[] = [];
  let j = open + 1;
  while (j < close) {
    const skip = skipOpaque(code, j);
    if (skip !== null && code[j] !== '"' && code[j] !== "'") {
      j = skip;
      continue;
    }
    if (/[\s,]/.test(code[j])) {
      j++;
      continue;
    }
    const start = j;
    let key = '';
    if (code[j] === '"' || code[j] === "'") {
      j = skipString(code, j);
      key = code.slice(start + 1, j - 1);
    } else {
      const m = /^(?:async\s+|get\s+|set\s+)?\*?\s*([A-Za-z_$][\w$]*)/.exec(code.slice(j, j + 200));
      if (!m) {
        j++;
        continue;
      }
      key = m[1];
      j += m[0].length;
    }
    while (j < close && /\s/.test(code[j])) j++;
    const valueStart = code[j] === ':' ? j + 1 : start; // a method keeps its whole text as the value
    let k = valueStart;
    while (k < close) {
      const s = skipOpaque(code, k);
      if (s !== null) k = s;
      else if ('([{'.includes(code[k])) k = skipBalanced(code, k);
      else if (code[k] === ',') break;
      else k++;
    }
    out.push({ key, start, valueStart, end: Math.min(k, close) });
    j = k + 1;
  }
  return { props: out, close };
}

/** The samurai.animation({ ... }) object: where its braces are and its properties. */
function declaration(code: string) {
  const re = /samurai\s*\.\s*animation\s*\(\s*\{/g;
  for (let m; (m = re.exec(code)); ) {
    // Not one inside a comment or a string.
    let j = 0;
    let inside = false;
    while (j < m.index) {
      const s = skipOpaque(code, j);
      if (s !== null && s > m.index) {
        inside = true;
        break;
      }
      j = s ?? j + 1;
    }
    if (!inside) {
      const open = m.index + m[0].length - 1;
      return { open, ...props(code, open) };
    }
  }
  return null;
}

const valueText = (code: string, p: Prop) => code.slice(p.valueStart, p.end).trim();

/** Line indentation used for the declaration's properties. */
function indentOf(code: string, p: Prop | undefined, fallback: string) {
  if (!p) return fallback;
  const line = code.lastIndexOf('\n', p.start) + 1;
  return code.slice(line, p.start).match(/^\s*/)?.[0] ?? fallback;
}

/** Replaces a value, keeping the space and line break around it. */
function replaceValue(code: string, p: Prop, src: string) {
  const raw = code.slice(p.valueStart, p.end);
  const lead = raw.match(/^\s*/)![0] || ' ';
  const trail = raw.match(/\s*$/)![0];
  return code.slice(0, p.valueStart) + lead + src + trail + code.slice(p.end);
}

/** Inserts a property after `after` (or first), with a comma where one is needed. */
function insertAfter(code: string, d: { open: number; props: Prop[] }, after: Prop | undefined, text: string, indent: string) {
  if (!after) return code.slice(0, d.open + 1) + `\n${indent}${text},` + code.slice(d.open + 1);
  const at = after.end;
  if (code[at] === ',') return code.slice(0, at + 1) + `\n${indent}${text},` + code.slice(at + 1);
  // The last property, without a trailing comma.
  const raw = code.slice(after.valueStart, at);
  const trimmed = after.valueStart + raw.trimEnd().length;
  return code.slice(0, trimmed) + `,\n${indent}${text}` + code.slice(trimmed);
}

/** Sets an option (duration, end, microphones) to `src` (JavaScript source), adding it if it isn't there. */
export function setOption(code: string, key: 'name' | 'duration' | 'end' | 'microphones', src: string) {
  const d = declaration(code);
  if (!d) throw new Error("Couldn't find samurai.animation({ ... }) in the script.");
  const p = d.props.find((x) => x.key === key);
  if (p) return replaceValue(code, p, src);
  const after = d.props.find((x) => x.key === 'microphones') ?? d.props.find((x) => x.key === 'end') ?? d.props.find((x) => x.key === 'duration') ?? d.props.find((x) => x.key === 'name');
  return insertAfter(code, d, after, `${key}: ${src}`, indentOf(code, after ?? d.props[0], '  '));
}

export interface AssetSlot {
  name: string;
  kind: AssetKind | null;
  /** A placeholder waiting for its file. */
  missing: boolean;
  bytes: number;
}

/** The script's assets: files in it, and placeholders waiting for one. */
export function assetsOf(code: string): AssetSlot[] {
  const d = declaration(code);
  const a = d?.props.find((x) => x.key === 'assets');
  if (!a) return [];
  const v = code.indexOf('{', a.valueStart);
  if (v < 0 || v > a.end) return [];
  return props(code, v).props.map((p) => {
    const text = valueText(code, p);
    const ph = PLACEHOLDER.exec(text);
    if (ph) return { name: p.key, kind: ph[2] as AssetKind, missing: true, bytes: 0 };
    const url = text.slice(1, -1);
    const b64 = url.slice(url.indexOf(',') + 1);
    return { name: p.key, kind: assetKind(url), missing: false, bytes: Math.round((b64.length * 3) / 4) };
  });
}

/** Sets an asset to a data: URL: fills its placeholder or replaces it, or adds it (assets go last). */
export function setAsset(code: string, name: string, dataUrl: string) {
  const d = declaration(code);
  if (!d) throw new Error("Couldn't find samurai.animation({ ... }) in the script.");
  const lit = `'${dataUrl}'`;
  const a = d.props.find((x) => x.key === 'assets');
  const indent = indentOf(code, d.props[0], '  ');
  if (!a) {
    const last = d.props[d.props.length - 1];
    return insertAfter(code, d, last, `assets: {\n${indent}  ${name}: ${lit},\n${indent}}`, indent);
  }
  const v = code.indexOf('{', a.valueStart);
  const inner = { open: v, ...props(code, v) };
  const p = inner.props.find((x) => x.key === name);
  if (p) return replaceValue(code, p, lit);
  const last = inner.props[inner.props.length - 1];
  if (!last) return code.slice(0, v + 1) + `\n${indent}  ${name}: ${lit},\n${indent}` + code.slice(inner.close);
  return insertAfter(code, inner, last, `${name}: ${lit}`, indentOf(code, last, indent + '  '));
}

/** Removes an asset (and its comma). */
export function removeAsset(code: string, name: string) {
  const d = declaration(code);
  const a = d?.props.find((x) => x.key === 'assets');
  if (!a) return code;
  const v = code.indexOf('{', a.valueStart);
  const p = props(code, v).props.find((x) => x.key === name);
  if (!p) return code;
  const lineStart = code.lastIndexOf('\n', p.start);
  const from = /^\s*$/.test(code.slice(lineStart + 1, p.start)) ? lineStart : p.start;
  const to = code[p.end] === ',' ? p.end + 1 : p.end;
  return code.slice(0, from) + code.slice(to);
}

/** A name for an asset from its file name: a plain identifier, not one already used. */
export function assetName(file: string, taken: string[]) {
  const base = file.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : '')).replace(/^[^A-Za-z_$]+/, '') || 'asset';
  const first = base[0].toLowerCase() + base.slice(1);
  let name = first;
  for (let i = 2; taken.includes(name); i++) name = `${first}${i}`;
  return name;
}

/** What kind of asset a file is, from its type (or name). */
export function fileKind(f: File): AssetKind | null {
  if (f.type.startsWith('image/')) return 'image';
  if (f.type.startsWith('audio/')) return 'audio';
  if (f.type.startsWith('font/') || /\.(ttf|otf|woff2?)$/i.test(f.name)) return 'font';
  return null;
}

/** A file as a data: URL with a type the sandbox accepts (fonts often arrive untyped). */
export async function dataUrlOf(f: File, kind: AssetKind) {
  const type = kind === 'font' && !f.type.startsWith('font/') ? `font/${f.name.split('.').pop()!.toLowerCase()}` : f.type === 'audio/x-wav' ? 'audio/wav' : f.type;
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

/**
 * For editing by hand: each embedded file becomes a short marker such as
 * '⟨file 1 · 94 KB⟩', so the script fits on screen. `unpack` puts the files
 * back; a marker someone deleted takes its file with it.
 */
export function pack(code: string): { text: string; files: string[] } {
  const files: string[] = [];
  const text = code.replace(/(['"`])(data:[\w/+.-]+;base64,[A-Za-z0-9+/=\s]{200,})\1/g, (_, q: string, url: string) => {
    files.push(url);
    const b64 = url.slice(url.indexOf(',') + 1);
    const kb = Math.round((b64.length * 3) / 4 / 1024);
    return `${q}⟨file ${files.length} · ${kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`}⟩${q}`;
  });
  return { text, files };
}

export function unpack(text: string, files: string[]) {
  return text.replace(/⟨file (\d+)[^⟩]*⟩/g, (m, n: string) => files[Number(n) - 1] ?? m);
}

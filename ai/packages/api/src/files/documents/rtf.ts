import * as fs from 'fs';

interface RtfGroup {
  skip: boolean;
  fallbackLength: number;
}

interface RtfState {
  group: RtfGroup;
  stack: RtfGroup[];
  codepage: number;
  pendingFallback: number;
  bytes: number[];
  output: string[];
  decoders: Map<number, TextDecoder>;
}

const DEFAULT_CODEPAGE = 1251;

const SKIPPED_DESTINATIONS: ReadonlySet<string> = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'filetbl',
  'listtable',
  'listoverridetable',
  'revtbl',
  'rsidtbl',
  'xmlnstbl',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'generator',
]);

const CONTROL_WORD_TEXT: ReadonlyMap<string, string> = new Map([
  ['par', '\n'],
  ['line', '\n'],
  ['sect', '\n'],
  ['page', '\n'],
  ['row', '\n'],
  ['cell', '\t'],
  ['tab', '\t'],
  ['emdash', '—'],
  ['endash', '–'],
  ['bullet', '•'],
  ['lquote', '‘'],
  ['rquote', '’'],
  ['ldblquote', '“'],
  ['rdblquote', '”'],
  ['emspace', ' '],
  ['enspace', ' '],
  ['qmspace', ' '],
]);

const CONTROL_SYMBOL_TEXT: ReadonlyMap<string, string> = new Map([
  ['\\', '\\'],
  ['{', '{'],
  ['}', '}'],
  ['~', ' '],
  ['_', '-'],
  ['-', ''],
  ['\n', '\n'],
  ['\r', '\n'],
]);

const CODEPAGE_LABELS: ReadonlyMap<number, string> = new Map([
  [866, 'ibm866'],
  [874, 'windows-874'],
  [932, 'shift_jis'],
  [936, 'gbk'],
  [949, 'euc-kr'],
  [950, 'big5'],
  [1250, 'windows-1250'],
  [1251, 'windows-1251'],
  [1252, 'windows-1252'],
  [1253, 'windows-1253'],
  [1254, 'windows-1254'],
  [1255, 'windows-1255'],
  [1256, 'windows-1256'],
  [1257, 'windows-1257'],
  [1258, 'windows-1258'],
  [10000, 'macintosh'],
  [10007, 'x-mac-cyrillic'],
  [20866, 'koi8-r'],
  [21866, 'koi8-u'],
  [65001, 'utf-8'],
]);

function decoderFor(state: RtfState): TextDecoder {
  const cached = state.decoders.get(state.codepage);
  if (cached) {
    return cached;
  }
  const decoder = new TextDecoder(CODEPAGE_LABELS.get(state.codepage) ?? 'windows-1251');
  state.decoders.set(state.codepage, decoder);
  return decoder;
}

function flushBytes(state: RtfState): void {
  if (state.bytes.length === 0) {
    return;
  }
  state.output.push(decoderFor(state).decode(Uint8Array.from(state.bytes)));
  state.bytes = [];
}

function emit(state: RtfState, text: string): void {
  flushBytes(state);
  state.output.push(text);
}

function openGroup(state: RtfState): void {
  flushBytes(state);
  state.stack.push(state.group);
  state.group = { ...state.group };
  state.pendingFallback = 0;
}

function closeGroup(state: RtfState): void {
  flushBytes(state);
  state.group = state.stack.pop() ?? state.group;
  state.pendingFallback = 0;
}

function consumeFallback(state: RtfState): boolean {
  if (state.pendingFallback === 0) {
    return false;
  }
  state.pendingFallback -= 1;
  return true;
}

function readCharacter(state: RtfState, char: string): void {
  if (char === '\r' || char === '\n' || state.group.skip) {
    return;
  }
  if (consumeFallback(state)) {
    return;
  }
  const code = char.charCodeAt(0);
  if (code >= 0x80) {
    state.bytes.push(code);
    return;
  }
  emit(state, char);
}

function applyControlWord(state: RtfState, word: string, parameter: number | undefined): void {
  if (word === 'ansicpg' && parameter !== undefined) {
    flushBytes(state);
    state.codepage = parameter;
    return;
  }
  if (word === 'uc' && parameter !== undefined) {
    state.group.fallbackLength = parameter;
    return;
  }
  if (word === 'u' && parameter !== undefined) {
    emit(state, String.fromCharCode(parameter < 0 ? parameter + 0x10000 : parameter));
    state.pendingFallback = state.group.fallbackLength;
    return;
  }
  const text = CONTROL_WORD_TEXT.get(word);
  if (text !== undefined) {
    emit(state, text);
  }
}

function readControlWord(
  state: RtfState,
  word: string,
  parameter: number | undefined,
  remaining: number,
): number {
  if (word === 'bin') {
    return Math.min(Math.max(parameter ?? 0, 0), remaining);
  }
  if (state.group.skip) {
    return 0;
  }
  if (SKIPPED_DESTINATIONS.has(word)) {
    state.group.skip = true;
    return 0;
  }
  if (!consumeFallback(state)) {
    applyControlWord(state, word, parameter);
  }
  return 0;
}

function readHexByte(state: RtfState, hex: string): void {
  if (state.group.skip) {
    return;
  }
  if (consumeFallback(state)) {
    return;
  }
  const byte = Number.parseInt(hex, 16);
  if (!Number.isNaN(byte)) {
    state.bytes.push(byte);
  }
}

function readControlSymbol(state: RtfState, source: string, index: number): number {
  const symbol = source[index + 1];
  if (symbol === undefined) {
    return index + 1;
  }
  if (symbol === "'") {
    readHexByte(state, source.slice(index + 2, index + 4));
    return index + 4;
  }
  if (state.group.skip) {
    return index + 2;
  }
  if (symbol === '*') {
    state.group.skip = true;
    return index + 2;
  }
  if (consumeFallback(state)) {
    return index + 2;
  }
  const text = CONTROL_SYMBOL_TEXT.get(symbol);
  if (text !== undefined) {
    emit(state, text);
  }
  return index + 2;
}

function normalizeText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractRtfText(buffer: Buffer): string {
  const source = buffer.toString('latin1');
  const controlWord = /\\([a-zA-Z]{1,32})(-?\d{1,10})? ?/y;
  const state: RtfState = {
    group: { skip: false, fallbackLength: 1 },
    stack: [],
    codepage: DEFAULT_CODEPAGE,
    pendingFallback: 0,
    bytes: [],
    output: [],
    decoders: new Map(),
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '{') {
      openGroup(state);
      index += 1;
      continue;
    }
    if (char === '}') {
      closeGroup(state);
      index += 1;
      continue;
    }
    if (char !== '\\') {
      readCharacter(state, char);
      index += 1;
      continue;
    }
    controlWord.lastIndex = index;
    const match = controlWord.exec(source);
    if (match === null) {
      index = readControlSymbol(state, source, index);
      continue;
    }
    const parameter = match[2] === undefined ? undefined : Number(match[2]);
    const next = controlWord.lastIndex;
    index = next + readControlWord(state, match[1], parameter, source.length - next);
  }
  flushBytes(state);
  return normalizeText(state.output.join(''));
}

export async function rtfToText(file: Express.Multer.File): Promise<string> {
  return extractRtfText(await fs.promises.readFile(file.path));
}

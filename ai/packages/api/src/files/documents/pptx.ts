import path from 'path';
import * as fs from 'fs';
import JSZip from 'jszip';
import { assertSafeZipSize } from './zipSafety';

const SLIDE_ENTRY = /^ppt\/slides\/slide(\d+)\.xml$/;
const XML_ENTITY = /&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g;
const NOTES_RELATIONSHIP = '/notesSlide';
const PRESENTATION_DIRECTORY = 'ppt';
const PRESENTATION_ENTRY = 'ppt/presentation.xml';
const PRESENTATION_RELS_ENTRY = 'ppt/_rels/presentation.xml.rels';
const TEXT_CLOSING = '</a:t>';
const WHITESPACE: ReadonlySet<string> = new Set([' ', '\t', '\n', '\r']);
const TAG_DELIMITERS: ReadonlySet<string> = new Set([...WHITESPACE, '>', '/']);
const HIDDEN_VALUES: ReadonlySet<string> = new Set(['0', 'false']);

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['quot', '"'],
  ['apos', "'"],
]);

interface Relationship {
  id: string;
  type: string;
  target: string;
}

interface Slide {
  entry: string;
  xml: string;
}

interface Piece {
  text: string;
  next: number;
}

function isTagAt(xml: string, start: number, name: string): boolean {
  return xml.startsWith(name, start + 1) && TAG_DELIMITERS.has(xml.charAt(start + 1 + name.length));
}

function findTag(xml: string, name: string, from: number): number {
  let start = xml.indexOf(`<${name}`, from);
  while (start !== -1 && !isTagAt(xml, start, name)) {
    start = xml.indexOf(`<${name}`, start + name.length + 1);
  }
  return start;
}

function openingTags(xml: string, name: string): string[] {
  const tags: string[] = [];
  let start = findTag(xml, name, 0);
  while (start !== -1) {
    const end = xml.indexOf('>', start);
    if (end === -1) {
      break;
    }
    tags.push(xml.slice(start, end + 1));
    start = findTag(xml, name, end + 1);
  }
  return tags;
}

function firstTag(xml: string, name: string): string | undefined {
  const start = findTag(xml, name, 0);
  const end = start === -1 ? -1 : xml.indexOf('>', start);
  return end === -1 ? undefined : xml.slice(start, end + 1);
}

function elementBodies(xml: string, name: string): string[] {
  const closing = `</${name}>`;
  const bodies: string[] = [];
  let start = findTag(xml, name, 0);
  while (start !== -1) {
    const tagEnd = xml.indexOf('>', start);
    if (tagEnd === -1) {
      break;
    }
    if (xml.charAt(tagEnd - 1) === '/') {
      start = findTag(xml, name, tagEnd + 1);
      continue;
    }
    const end = xml.indexOf(closing, tagEnd + 1);
    if (end === -1) {
      break;
    }
    bodies.push(xml.slice(tagEnd + 1, end));
    start = findTag(xml, name, end + closing.length);
  }
  return bodies;
}

function attribute(tag: string, name: string): string | undefined {
  const marker = `${name}="`;
  let start = tag.indexOf(marker);
  while (start > 0 && !WHITESPACE.has(tag.charAt(start - 1))) {
    start = tag.indexOf(marker, start + marker.length);
  }
  if (start <= 0) {
    return undefined;
  }
  const valueStart = start + marker.length;
  const end = tag.indexOf('"', valueStart);
  return end === -1 ? undefined : tag.slice(valueStart, end);
}

function decodeXml(text: string): string {
  return text.replace(XML_ENTITY, (entity: string, name: string) => {
    if (name.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    }
    return NAMED_ENTITIES.get(name) ?? entity;
  });
}

function pieceAt(paragraph: string, start: number, tagEnd: number): Piece | null {
  if (isTagAt(paragraph, start, 'a:br')) {
    return { text: '\n', next: tagEnd + 1 };
  }
  if (!isTagAt(paragraph, start, 'a:t') || paragraph.charAt(tagEnd - 1) === '/') {
    return { text: '', next: tagEnd + 1 };
  }
  const end = paragraph.indexOf(TEXT_CLOSING, tagEnd + 1);
  if (end === -1) {
    return null;
  }
  return { text: decodeXml(paragraph.slice(tagEnd + 1, end)), next: end + TEXT_CLOSING.length };
}

function paragraphText(paragraph: string): string {
  const parts: string[] = [];
  let start = paragraph.indexOf('<');
  while (start !== -1) {
    const tagEnd = paragraph.indexOf('>', start);
    const piece = tagEnd === -1 ? null : pieceAt(paragraph, start, tagEnd);
    if (piece === null) {
      break;
    }
    parts.push(piece.text);
    start = paragraph.indexOf('<', piece.next);
  }
  return parts.join('');
}

function paragraphsOf(xml: string): string[] {
  return elementBodies(xml, 'a:p')
    .map((body) => paragraphText(body).trim())
    .filter((text) => text.length > 0);
}

function isBodyPlaceholder(shape: string): boolean {
  return openingTags(shape, 'p:ph').some((tag) => attribute(tag, 'type') === 'body');
}

function notesParagraphs(xml: string): string[] {
  return elementBodies(xml, 'p:sp')
    .filter((shape) => isBodyPlaceholder(shape))
    .flatMap((shape) => paragraphsOf(shape));
}

function relationships(relsXml: string): Relationship[] {
  return openingTags(relsXml, 'Relationship').map((tag) => ({
    id: attribute(tag, 'Id') ?? '',
    type: attribute(tag, 'Type') ?? '',
    target: attribute(tag, 'Target') ?? '',
  }));
}

function resolveTarget(directory: string, target: string): string {
  return target.startsWith('/') ? target.slice(1) : path.posix.join(directory, target);
}

function isHidden(slideXml: string): boolean {
  const root = firstTag(slideXml, 'p:sld');
  return root !== undefined && HIDDEN_VALUES.has(attribute(root, 'show') ?? '');
}

function slideNumber(entry: string): number {
  return Number(SLIDE_ENTRY.exec(entry)?.[1] ?? 0);
}

async function readEntry(zip: JSZip, entry: string): Promise<string> {
  const file = zip.file(entry);
  return file === null ? '' : file.async('string');
}

async function presentationOrder(zip: JSZip): Promise<string[]> {
  const [presentationXml, relsXml] = await Promise.all([
    readEntry(zip, PRESENTATION_ENTRY),
    readEntry(zip, PRESENTATION_RELS_ENTRY),
  ]);
  const targets = new Map(
    relationships(relsXml).map((relationship): [string, string] => [
      relationship.id,
      resolveTarget(PRESENTATION_DIRECTORY, relationship.target),
    ]),
  );
  const slideList = elementBodies(presentationXml, 'p:sldIdLst')[0] ?? '';
  const entries = openingTags(slideList, 'p:sldId')
    .map((tag) => targets.get(attribute(tag, 'r:id') ?? ''))
    .filter((entry): entry is string => entry !== undefined && zip.file(entry) !== null);
  return [...new Set(entries)];
}

async function slideEntries(zip: JSZip): Promise<string[]> {
  const ordered = await presentationOrder(zip);
  if (ordered.length > 0) {
    return ordered;
  }
  return Object.keys(zip.files)
    .filter((entry) => SLIDE_ENTRY.test(entry))
    .sort((left, right) => slideNumber(left) - slideNumber(right));
}

async function slideNotes(zip: JSZip, entry: string): Promise<string[]> {
  const directory = path.posix.dirname(entry);
  const relsXml = await readEntry(zip, `${directory}/_rels/${path.posix.basename(entry)}.rels`);
  const notes = relationships(relsXml).find((relationship) =>
    relationship.type.endsWith(NOTES_RELATIONSHIP),
  );
  if (notes === undefined || notes.target === '') {
    return [];
  }
  return notesParagraphs(await readEntry(zip, resolveTarget(directory, notes.target)));
}

async function slideBlock(zip: JSZip, slide: Slide, position: number): Promise<string> {
  const notes = await slideNotes(zip, slide.entry);
  const text = paragraphsOf(slide.xml);
  if (text.length === 0 && notes.length === 0) {
    return '';
  }
  const noteLines = notes.length > 0 ? [`Заметки: ${notes.join('\n')}`] : [];
  return [`Слайд ${position}`, ...text, ...noteLines].join('\n');
}

export async function extractPptxText(buffer: Buffer, name: string): Promise<string> {
  await assertSafeZipSize(buffer, { name });
  const zip = await JSZip.loadAsync(buffer);
  const entries = await slideEntries(zip);
  const slides = await Promise.all(
    entries.map(async (entry): Promise<Slide> => ({ entry, xml: await readEntry(zip, entry) })),
  );
  const shown = slides.filter((slide) => !isHidden(slide.xml));
  const blocks = await Promise.all(shown.map((slide, index) => slideBlock(zip, slide, index + 1)));
  return blocks.filter((block) => block.length > 0).join('\n\n');
}

export async function pptxToText(file: Express.Multer.File): Promise<string> {
  const buffer = await fs.promises.readFile(file.path);
  return extractPptxText(buffer, file.originalname ?? 'pptx');
}

import fs from 'fs';
import path from 'path';
import pdfMake from 'pdfmake';
import { openSync } from 'fontkit';
import type {
  TDocumentDefinitions,
  StyleDictionary,
  TableCell,
  Content,
  Size,
} from 'pdfmake/interfaces';
import type { Font } from 'fontkit';
import type { DocumentBlock, InlineRun } from './types';
import { ExportFileError } from './types';

type GlyphCheck = (codePoint: number) => boolean;

const FONT_FAMILY = 'PTSans';
const FONT_FILES = {
  normal: 'PT_Sans-Web-Regular.ttf',
  bold: 'PT_Sans-Web-Bold.ttf',
  italics: 'PT_Sans-Web-Italic.ttf',
  bolditalics: 'PT_Sans-Web-BoldItalic.ttf',
} as const;
const FONTS_SUBDIRECTORY = path.join('assets', 'fonts');
const MAX_FONT_SEARCH_DEPTH = 6;
const ASCII_LIMIT = 0x80;
const WHITESPACE = /\s/u;

const SYMBOL_REPLACEMENTS: ReadonlyMap<string, string> = new Map([
  ['→', '->'],
  ['←', '<-'],
  ['↑', '^'],
  ['↓', 'v'],
  ['⇒', '=>'],
  ['⇐', '<='],
  ['↔', '<->'],
  ['✓', '+'],
  ['✔', '+'],
  ['☑', '+'],
  ['✗', 'x'],
  ['✘', 'x'],
  ['☒', 'x'],
]);

const glyphChecks = new Map<string, GlyphCheck>();

const STYLES: StyleDictionary = {
  title: { fontSize: 20, bold: true, margin: [0, 0, 0, 12] },
  h1: { fontSize: 17, bold: true, margin: [0, 12, 0, 6] },
  h2: { fontSize: 14, bold: true, margin: [0, 10, 0, 4] },
  h3: { fontSize: 12, bold: true, margin: [0, 8, 0, 4] },
  block: { margin: [0, 0, 0, 6] },
  code: { fontSize: 9, preserveLeadingSpaces: true, background: '#f2f2f2', margin: [0, 0, 0, 6] },
};

export function resolveFontsDir(startDir: string = __dirname): string | undefined {
  let current = startDir;
  for (let depth = 0; depth < MAX_FONT_SEARCH_DEPTH; depth++) {
    const candidate = path.join(current, FONTS_SUBDIRECTORY);
    if (fs.existsSync(path.join(candidate, FONT_FILES.normal))) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
  return undefined;
}

function glyphCheckFor(fontsDir: string): GlyphCheck {
  const cached = glyphChecks.get(fontsDir);
  if (cached) {
    return cached;
  }
  const fonts: Font[] = Object.values(FONT_FILES).map((file) =>
    openSync(path.join(fontsDir, file)),
  );
  const known = new Map<number, boolean>();
  const check: GlyphCheck = (codePoint) => {
    const seen = known.get(codePoint);
    if (seen !== undefined) {
      return seen;
    }
    const covered = fonts.every((font) => font.hasGlyphForCodePoint(codePoint));
    known.set(codePoint, covered);
    return covered;
  };
  glyphChecks.set(fontsDir, check);
  return check;
}

function printableChar(char: string, hasGlyph: GlyphCheck): string {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint < ASCII_LIMIT) {
    return char;
  }
  const replacement = SYMBOL_REPLACEMENTS.get(char);
  if (replacement !== undefined) {
    return replacement;
  }
  if (hasGlyph(codePoint)) {
    return char;
  }
  return WHITESPACE.test(char) ? ' ' : '';
}

function printable(text: string, hasGlyph: GlyphCheck): string {
  return Array.from(text, (char) => printableChar(char, hasGlyph)).join('');
}

function printableRuns(runs: InlineRun[], hasGlyph: GlyphCheck): InlineRun[] {
  return runs.map((run) => ({ ...run, text: printable(run.text, hasGlyph) }));
}

function printableBlock(block: DocumentBlock, hasGlyph: GlyphCheck): DocumentBlock {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return { ...block, runs: printableRuns(block.runs, hasGlyph) };
    case 'list':
      return { ...block, items: block.items.map((item) => printableRuns(item, hasGlyph)) };
    case 'table':
      return {
        ...block,
        header: block.header.map((cell) => printableRuns(cell, hasGlyph)),
        rows: block.rows.map((row) => row.map((cell) => printableRuns(cell, hasGlyph))),
      };
    case 'code':
      return { ...block, text: printable(block.text, hasGlyph) };
  }
}

function inline(runs: InlineRun[]): Content {
  if (runs.length === 0) {
    return '';
  }
  return runs.map((run) => ({ text: run.text, bold: run.bold, italics: run.italic }));
}

function emphasize(runs: InlineRun[]): InlineRun[] {
  return runs.map((run) => ({ ...run, bold: true }));
}

function tableRow(cells: InlineRun[][], width: number, bold: boolean): TableCell[] {
  return Array.from({ length: width }, (_, index) => {
    const runs = cells[index] ?? [];
    return { text: inline(bold ? emphasize(runs) : runs) };
  });
}

function tableContent(header: InlineRun[][], rows: InlineRun[][][]): Content {
  const width = rows.reduce((max, row) => Math.max(max, row.length), Math.max(header.length, 1));
  const widths: Size[] = Array.from({ length: width }, () => '*');
  return {
    table: {
      headerRows: 1,
      widths,
      body: [tableRow(header, width, true), ...rows.map((row) => tableRow(row, width, false))],
    },
    layout: 'lightHorizontalLines',
    style: 'block',
  };
}

function blockContent(block: DocumentBlock): Content {
  switch (block.kind) {
    case 'heading':
      return { text: inline(block.runs), style: `h${block.level}` };
    case 'paragraph':
      return { text: inline(block.runs), style: 'block' };
    case 'list': {
      const items = block.items.map((item) => ({ text: inline(item) }));
      return block.ordered ? { ol: items, style: 'block' } : { ul: items, style: 'block' };
    }
    case 'table':
      return tableContent(block.header, block.rows);
    case 'code':
      return { text: block.text, style: 'code' };
  }
}

export async function renderPdf(blocks: DocumentBlock[], title?: string): Promise<Buffer> {
  const fontsDir = resolveFontsDir();
  if (!fontsDir) {
    throw new ExportFileError(
      'На сервере не найден шрифт для PDF — предложи сотруднику выгрузить документ в Word (docx).',
    );
  }
  pdfMake.setUrlAccessPolicy(() => false);
  pdfMake.setLocalAccessPolicy((filePath) => filePath.startsWith(fontsDir));
  pdfMake.setFonts({
    [FONT_FAMILY]: {
      normal: path.join(fontsDir, FONT_FILES.normal),
      bold: path.join(fontsDir, FONT_FILES.bold),
      italics: path.join(fontsDir, FONT_FILES.italics),
      bolditalics: path.join(fontsDir, FONT_FILES.bolditalics),
    },
  });
  const hasGlyph = glyphCheckFor(fontsDir);
  const body = blocks.map((block) => blockContent(printableBlock(block, hasGlyph)));
  const heading = title ? printable(title, hasGlyph) : '';
  const content: Content[] = heading ? [{ text: heading, style: 'title' }, ...body] : body;
  const definition: TDocumentDefinitions = {
    info: title ? { title } : undefined,
    pageSize: 'A4',
    pageMargins: [56, 56, 56, 56],
    defaultStyle: { font: FONT_FAMILY, fontSize: 11, lineHeight: 1.2 },
    styles: STYLES,
    content,
  };
  return pdfMake.createPdf(definition).getBuffer();
}

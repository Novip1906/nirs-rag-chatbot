import PptxGenJS from 'pptxgenjs';
import type { ExportSlide, SlideCell } from './types';
import { ExportFileError } from './types';
import { formatDecimal } from './sheet';

const FONT_FACE = 'Arial';
const CONTENT_X = 0.5;
const CONTENT_WIDTH = 9;
const HEADER_FILL = 'EDEDED';
const BORDER_COLOR = 'BFBFBF';

function cellText(cell: SlideCell | undefined): string {
  if (cell == null) {
    return '';
  }
  return typeof cell === 'number' ? formatDecimal(cell) : cell;
}

function tableRows(columns: string[], rows: SlideCell[][]): PptxGenJS.TableRow[] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), columns.length);
  const header = Array.from({ length: width }, (_, index) => ({
    text: columns[index] ?? '',
    options: { bold: true, fill: { color: HEADER_FILL } },
  }));
  const body = rows.map((row) =>
    Array.from({ length: width }, (_, index) => ({ text: cellText(row[index]) })),
  );
  return [header, ...body];
}

function addTitleSlide(pptx: PptxGenJS, title: string): void {
  pptx.addSlide().addText(title, {
    x: CONTENT_X,
    y: 2,
    w: CONTENT_WIDTH,
    h: 1.5,
    fontFace: FONT_FACE,
    fontSize: 36,
    bold: true,
    align: 'center',
    valign: 'middle',
  });
}

function addContentSlide(pptx: PptxGenJS, slide: ExportSlide): void {
  const page = pptx.addSlide();
  page.addText(slide.title, {
    x: CONTENT_X,
    y: 0.3,
    w: CONTENT_WIDTH,
    h: 0.9,
    fontFace: FONT_FACE,
    fontSize: 28,
    bold: true,
    valign: 'middle',
  });
  if (slide.table) {
    page.addTable(tableRows(slide.table.columns, slide.table.rows), {
      x: CONTENT_X,
      y: 1.4,
      w: CONTENT_WIDTH,
      fontFace: FONT_FACE,
      fontSize: 12,
      border: { type: 'solid', pt: 0.5, color: BORDER_COLOR },
      autoPage: true,
      autoPageRepeatHeader: true,
    });
  } else if (slide.bullets?.length) {
    page.addText(
      slide.bullets.map((text) => ({ text, options: { bullet: true } })),
      {
        x: CONTENT_X,
        y: 1.4,
        w: CONTENT_WIDTH,
        h: 3.9,
        fontFace: FONT_FACE,
        fontSize: 18,
        valign: 'top',
        paraSpaceAfter: 6,
      },
    );
  }
  if (slide.notes) {
    page.addNotes(slide.notes);
  }
}

export async function renderPptx(slides: ExportSlide[], title?: string): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  if (title) {
    pptx.title = title;
    addTitleSlide(pptx, title);
  }
  slides.forEach((slide) => addContentSlide(pptx, slide));
  const output = await pptx.write({ outputType: 'nodebuffer' });
  if (!(output instanceof Uint8Array)) {
    throw new ExportFileError('Библиотека презентаций вернула не двоичные данные');
  }
  return Buffer.from(output.buffer, output.byteOffset, output.byteLength);
}

import {
  Table,
  Packer,
  TextRun,
  Document,
  TableRow,
  Paragraph,
  TableCell,
  WidthType,
  LevelFormat,
  HeadingLevel,
  AlignmentType,
} from 'docx';
import type { DocumentBlock, InlineRun } from './types';

const ORDERED_LIST_REFERENCE = 'export-ordered-list';
const MONOSPACE_FONT = 'Courier New';
const HEADING_LEVELS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
} as const;

function textRuns(runs: InlineRun[]): TextRun[] {
  return runs.flatMap((run) =>
    run.text.split('\n').map(
      (part, index) =>
        new TextRun({
          text: part,
          bold: run.bold,
          italics: run.italic,
          break: index > 0 ? 1 : undefined,
        }),
    ),
  );
}

function codeRuns(text: string): TextRun[] {
  return text
    .split('\n')
    .map(
      (line, index) =>
        new TextRun({ text: line, font: MONOSPACE_FONT, break: index > 0 ? 1 : undefined }),
    );
}

function tableCell(runs: InlineRun[] | undefined, bold: boolean): TableCell {
  const styled = (runs ?? []).map((run) => (bold ? { ...run, bold: true } : run));
  return new TableCell({ children: [new Paragraph({ children: textRuns(styled) })] });
}

function tableRow(cells: InlineRun[][], width: number, isHeader: boolean): TableRow {
  return new TableRow({
    tableHeader: isHeader,
    children: Array.from({ length: width }, (_, index) => tableCell(cells[index], isHeader)),
  });
}

function renderTable(header: InlineRun[][], rows: InlineRun[][][]): Table {
  const width = rows.reduce((max, row) => Math.max(max, row.length), Math.max(header.length, 1));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [tableRow(header, width, true), ...rows.map((row) => tableRow(row, width, false))],
  });
}

function listParagraph(item: InlineRun[], ordered: boolean, instance: number): Paragraph {
  if (ordered) {
    return new Paragraph({
      children: textRuns(item),
      numbering: { reference: ORDERED_LIST_REFERENCE, level: 0, instance },
    });
  }
  return new Paragraph({ children: textRuns(item), bullet: { level: 0 } });
}

function renderBlock(block: DocumentBlock, orderedInstance: number): (Paragraph | Table)[] {
  switch (block.kind) {
    case 'heading':
      return [new Paragraph({ heading: HEADING_LEVELS[block.level], children: textRuns(block.runs) })];
    case 'paragraph':
      return [new Paragraph({ children: textRuns(block.runs) })];
    case 'list':
      return block.items.map((item) => listParagraph(item, block.ordered, orderedInstance));
    case 'table':
      return [renderTable(block.header, block.rows)];
    case 'code':
      return [new Paragraph({ children: codeRuns(block.text) })];
  }
}

export async function renderDocx(blocks: DocumentBlock[], title?: string): Promise<Buffer> {
  let orderedLists = 0;
  const children: (Paragraph | Table)[] = title
    ? [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] })]
    : [];
  for (const block of blocks) {
    if (block.kind === 'list' && block.ordered) {
      orderedLists += 1;
    }
    children.push(...renderBlock(block, orderedLists));
  }
  const doc = new Document({
    title,
    numbering: {
      config: [
        {
          reference: ORDERED_LIST_REFERENCE,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

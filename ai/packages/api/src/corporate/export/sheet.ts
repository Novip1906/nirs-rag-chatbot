import { utils, write } from 'xlsx';
import type { ColInfo } from 'xlsx';
import type { ExportSheet, SheetCell } from './types';

const SHEET_NAME_LIMIT = 31;
const FORBIDDEN_SHEET_CHARACTERS = /[[\]:*?/\\]/g;
const EDGE_APOSTROPHES = /^'+|'+$/g;
const MIN_COLUMN_WIDTH = 8;
const MAX_COLUMN_WIDTH = 60;
const CSV_DELIMITER = ';';
const CSV_NEWLINE = '\r\n';
const CSV_BOM = '\ufeff';
const CSV_NEEDS_QUOTES = /[;"\r\n]/;
const CSV_FORMULA_START = /^[=@\t\r]/;
const CSV_SIGNED_START = /^[+-]/;
const CSV_SIGNED_VALUE = /^[+-][\d\s().,%-]*$/;

export function formatDecimal(value: number): string {
  return String(value).replace('.', ',');
}

export function sanitizeSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, index) => {
    const base =
      raw
        .replace(FORBIDDEN_SHEET_CHARACTERS, ' ')
        .replace(EDGE_APOSTROPHES, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, SHEET_NAME_LIMIT)
        .trim() || `Лист ${index + 1}`;
    let name = base;
    for (let suffix = 2; used.has(name.toLowerCase()); suffix++) {
      const tail = ` (${suffix})`;
      name = `${base.slice(0, SHEET_NAME_LIMIT - tail.length)}${tail}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

function sheetRows(sheet: ExportSheet): SheetCell[][] {
  return sheet.columns?.length ? [sheet.columns, ...sheet.rows] : sheet.rows;
}

function cellLength(cell: SheetCell): number {
  return cell == null ? 0 : String(cell).length;
}

function columnWidths(rows: SheetCell[][]): ColInfo[] {
  const widths: number[] = [];
  for (const row of rows) {
    for (let index = 0; index < row.length; index++) {
      widths[index] = Math.max(widths[index] ?? 0, cellLength(row[index]));
    }
  }
  return Array.from(widths, (width) => ({
    wch: Math.min(Math.max((width ?? 0) + 2, MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH),
  }));
}

export function renderXlsx(sheets: ExportSheet[]): Buffer {
  const workbook = utils.book_new();
  const names = sanitizeSheetNames(sheets.map((sheet) => sheet.name));
  sheets.forEach((sheet, index) => {
    const rows = sheetRows(sheet);
    const worksheet = utils.aoa_to_sheet(rows);
    worksheet['!cols'] = columnWidths(rows);
    utils.book_append_sheet(workbook, worksheet, names[index]);
  });
  const output: Buffer = write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
  return output;
}

function neutralizeFormula(value: string): string {
  if (CSV_FORMULA_START.test(value)) {
    return `'${value}`;
  }
  if (CSV_SIGNED_START.test(value) && !CSV_SIGNED_VALUE.test(value)) {
    return `'${value}`;
  }
  return value;
}

function csvField(cell: SheetCell): string {
  if (cell == null) {
    return '';
  }
  if (typeof cell === 'number') {
    return formatDecimal(cell);
  }
  if (typeof cell === 'boolean') {
    return cell ? 'ИСТИНА' : 'ЛОЖЬ';
  }
  const text = neutralizeFormula(cell);
  return CSV_NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function renderCsv(sheet: ExportSheet): Buffer {
  const lines = sheetRows(sheet).map((row) => row.map(csvField).join(CSV_DELIMITER));
  return Buffer.from(`${CSV_BOM}${lines.join(CSV_NEWLINE)}${CSV_NEWLINE}`, 'utf8');
}

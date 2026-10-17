import { z } from 'zod';
import type { ExportSlide, ExportSheet, ExportFormat, ExportFileInput } from './types';
import { ExportFileError, EXPORT_FORMATS } from './types';

export const MAX_EXPORT_ROWS: number = 100_000;

export const MAX_FILENAME_LENGTH: number = 120;

const DEFAULT_FILENAME = 'Документ';
const FILENAME_FORBIDDEN = /[\\/:*?"<>|\p{Cc}]/gu;
const FORMAT_CONTROLS = /\p{Cf}/gu;
const TRAILING_EXTENSION = /\.(?:docx|doc|pdf|xlsx|xls|csv|pptx|ppt|txt|rtf|md|odt|ods)$/i;
const EDGE_DOTS = /^[.\s]+|[.\s]+$/g;

const sheetCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()], {
  errorMap: () => ({ message: 'ячейка должна быть строкой, числом, true/false или null' }),
});

const slideCellSchema = z.union([z.string(), z.number(), z.null()], {
  errorMap: () => ({ message: 'ячейка должна быть строкой, числом или null' }),
});

const columnsSchema = z.array(
  z.string({ invalid_type_error: 'заголовок столбца должен быть строкой' }),
  { required_error: 'у таблицы нет столбцов', invalid_type_error: 'должен быть массивом строк' },
);

const sheetRowsSchema = z.array(
  z.array(sheetCellSchema, { invalid_type_error: 'строка таблицы должна быть массивом ячеек' }),
  { required_error: 'нет строк таблицы', invalid_type_error: 'должен быть массивом строк таблицы' },
);

const slideRowsSchema = z.array(
  z.array(slideCellSchema, { invalid_type_error: 'строка таблицы должна быть массивом ячеек' }),
  { required_error: 'нет строк таблицы', invalid_type_error: 'должен быть массивом строк таблицы' },
);

const sheetSchema = z.object(
  {
    name: z.string({
      required_error: 'у листа нет имени',
      invalid_type_error: 'должно быть строкой',
    }),
    columns: columnsSchema.nullish(),
    rows: sheetRowsSchema,
  },
  { invalid_type_error: 'лист должен быть объектом с name и rows' },
);

const slideSchema = z.object(
  {
    title: z
      .string({
        required_error: 'у слайда нет заголовка',
        invalid_type_error: 'должен быть строкой',
      })
      .trim()
      .min(1, 'пустой заголовок слайда'),
    bullets: z
      .array(z.string({ invalid_type_error: 'пункт должен быть строкой' }), {
        invalid_type_error: 'должен быть массивом строк',
      })
      .nullish(),
    table: z
      .object(
        { columns: columnsSchema.min(1, 'у таблицы нет столбцов'), rows: slideRowsSchema },
        { invalid_type_error: 'должна быть объектом с columns и rows' },
      )
      .nullish(),
    notes: z.string({ invalid_type_error: 'должны быть строкой' }).nullish(),
  },
  { invalid_type_error: 'слайд должен быть объектом с title' },
);

const baseSchema = z.object(
  {
    format: z.enum(EXPORT_FORMATS, {
      errorMap: () => ({ message: `должен быть одним из: ${EXPORT_FORMATS.join(', ')}` }),
    }),
    filename: z
      .string({ required_error: 'не указано имя файла', invalid_type_error: 'должно быть строкой' })
      .trim()
      .min(1, 'пустое имя файла'),
    title: z.string({ invalid_type_error: 'должен быть строкой' }).nullish(),
    markdown: z.string({ invalid_type_error: 'должен быть строкой' }).nullish(),
    sheets: z.array(sheetSchema, { invalid_type_error: 'должен быть массивом листов' }).nullish(),
    slides: z.array(slideSchema, { invalid_type_error: 'должен быть массивом слайдов' }).nullish(),
  },
  { required_error: 'аргументы не переданы', invalid_type_error: 'аргументы должны быть объектом' },
);

type ParsedArgs = z.infer<typeof baseSchema>;
type ParsedSheet = NonNullable<ParsedArgs['sheets']>[number];
type ParsedSlide = NonNullable<ParsedArgs['slides']>[number];

function checkDocument(args: ParsedArgs, ctx: z.RefinementCtx): void {
  if (args.markdown?.trim()) {
    return;
  }
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['markdown'],
    message: `для формата ${args.format} нужен markdown с содержимым документа`,
  });
}

function checkSheets(args: ParsedArgs, ctx: z.RefinementCtx): void {
  const sheets = args.sheets ?? [];
  if (sheets.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sheets'],
      message:
        args.format === 'csv'
          ? 'для формата csv нужен sheets — таблица берётся из первого листа'
          : 'для формата xlsx нужен sheets — хотя бы один лист',
    });
    return;
  }
  sheets.forEach((sheet, index) => {
    if (sheet.rows.length > 0 || (sheet.columns?.length ?? 0) > 0) {
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sheets', index, 'rows'],
      message: 'лист пустой — нужны строки (rows) или заголовки (columns)',
    });
  });
  const totalRows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
  if (totalRows > MAX_EXPORT_ROWS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sheets'],
      message: `в таблицах ${totalRows} строк, можно не больше ${MAX_EXPORT_ROWS} — сократи данные или раздели их на несколько файлов`,
    });
  }
}

function checkSlides(args: ParsedArgs, ctx: z.RefinementCtx): void {
  const slides = args.slides ?? [];
  if (slides.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['slides'],
      message: 'для формата pptx нужен slides — хотя бы один слайд',
    });
    return;
  }
  slides.forEach((slide, index) => {
    if (!slide.table || !slide.bullets?.length) {
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['slides', index],
      message: 'на слайде либо bullets, либо table — вынеси таблицу на отдельный слайд',
    });
  });
}

function checkContent(args: ParsedArgs, ctx: z.RefinementCtx): void {
  if (args.format === 'docx' || args.format === 'pdf' || args.format === 'md') {
    checkDocument(args, ctx);
    return;
  }
  if (args.format === 'pptx') {
    checkSlides(args, ctx);
    return;
  }
  checkSheets(args, ctx);
}

const argsSchema = baseSchema.superRefine(checkContent);

function formatPath(path: (string | number)[]): string {
  return path.reduce<string>((acc, part) => {
    if (typeof part === 'number') {
      return `${acc}[${part}]`;
    }
    return acc ? `${acc}.${part}` : part;
  }, '');
}

function describeIssues(issues: z.ZodIssue[]): string {
  const details = issues.map((issue) => {
    const where = formatPath(issue.path);
    return where ? `${where}: ${issue.message}` : issue.message;
  });
  return `Аргументы export_file не прошли проверку: ${details.join('; ')}. Исправь аргументы и вызови инструмент снова.`;
}

function toSheet(sheet: ParsedSheet): ExportSheet {
  if (sheet.columns?.length) {
    return { name: sheet.name, columns: sheet.columns, rows: sheet.rows };
  }
  return { name: sheet.name, rows: sheet.rows };
}

function toSlide(slide: ParsedSlide): ExportSlide {
  return {
    title: slide.title,
    ...(slide.bullets?.length ? { bullets: slide.bullets } : {}),
    ...(slide.table ? { table: slide.table } : {}),
    ...(slide.notes?.trim() ? { notes: slide.notes } : {}),
  };
}

export function sanitizeExportFilename(raw: string, format: ExportFormat): string {
  let base = raw
    .replace(FORMAT_CONTROLS, '')
    .replace(FILENAME_FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  while (TRAILING_EXTENSION.test(base)) {
    base = base.replace(TRAILING_EXTENSION, '').trim();
  }
  const name = Array.from(base.replace(EDGE_DOTS, ''))
    .slice(0, MAX_FILENAME_LENGTH)
    .join('')
    .replace(EDGE_DOTS, '');
  return `${name || DEFAULT_FILENAME}.${format}`;
}

export function parseExportFileArgs(input: unknown): ExportFileInput {
  const result = argsSchema.safeParse(input);
  if (!result.success) {
    throw new ExportFileError(describeIssues(result.error.issues));
  }
  const args = result.data;
  const filename = sanitizeExportFilename(args.filename, args.format);
  const title = args.title?.trim() || undefined;
  const base = title ? { filename, title } : { filename };
  switch (args.format) {
    case 'docx':
    case 'pdf':
    case 'md':
      return { ...base, format: args.format, markdown: args.markdown ?? '' };
    case 'xlsx':
    case 'csv':
      return { ...base, format: args.format, sheets: (args.sheets ?? []).map(toSheet) };
    case 'pptx':
      return { ...base, format: 'pptx', slides: (args.slides ?? []).map(toSlide) };
  }
}

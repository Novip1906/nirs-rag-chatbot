import type { ExtendedJsonSchema } from '~/tools/registry/schema';
import { EXPORT_FORMATS } from './types';

const SHEET_CELL_SCHEMA: ExtendedJsonSchema = {
  anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
};

const SLIDE_CELL_SCHEMA: ExtendedJsonSchema = {
  anyOf: [{ type: 'string' }, { type: 'number' }],
};

export const EXPORT_FILE_DESCRIPTION: string =
  'Создаёт файл для скачивания: Word (docx), PDF, Excel (xlsx), CSV, PowerPoint (pptx) или ' +
  'Markdown (md). Вызывай, только когда сотрудник просит файл, документ, таблицу или презентацию ' +
  'для скачивания («сделай таблицу в Excel», «оформи в Word», «выгрузи в CSV», «сделай ' +
  'презентацию», «сохрани в Markdown»). Формат выбирай по просьбе сотрудника. Всё содержимое ' +
  'передавай в аргументах целиком: для docx, pdf и md — markdown, для xlsx и csv — sheets, для ' +
  'pptx — slides. После вызова коротко ответь, что файл приложен, и не повторяй его содержимое в ответе.';

export const exportFileSchema: ExtendedJsonSchema = {
  type: 'object',
  properties: {
    format: {
      type: 'string',
      enum: [...EXPORT_FORMATS],
      description:
        'Формат файла: docx — Word, pdf — PDF, xlsx — Excel, csv — CSV, pptx — PowerPoint, md — Markdown.',
    },
    filename: {
      type: 'string',
      description: 'Имя файла без расширения, до 120 символов, например «Отчёт за сентябрь».',
    },
    title: {
      type: 'string',
      description: 'Заголовок документа или титульного слайда. Необязателен.',
    },
    markdown: {
      type: 'string',
      description:
        'Для docx, pdf и md: полное содержимое документа в Markdown — заголовки (#, ##, ###), ' +
        'абзацы, **жирный**, *курсив*, списки, таблицы.',
    },
    sheets: {
      type: 'array',
      description: 'Для xlsx и csv: листы таблицы; для csv берётся только первый лист.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Имя листа.' },
          columns: { type: 'array', items: { type: 'string' }, description: 'Заголовки столбцов.' },
          rows: {
            type: 'array',
            description: 'Строки таблицы. Числа передавай числами, пустую ячейку — пустой строкой.',
            items: { type: 'array', items: SHEET_CELL_SCHEMA },
          },
        },
        required: ['name', 'rows'],
      },
    },
    slides: {
      type: 'array',
      description: 'Для pptx: слайды презентации.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Заголовок слайда.' },
          bullets: { type: 'array', items: { type: 'string' }, description: 'Пункты слайда.' },
          table: {
            type: 'object',
            description: 'Таблица на слайде вместо пунктов.',
            properties: {
              columns: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array', items: { type: 'array', items: SLIDE_CELL_SCHEMA } },
            },
            required: ['columns', 'rows'],
          },
          notes: { type: 'string', description: 'Заметки докладчика.' },
        },
        required: ['title'],
      },
    },
  },
  required: ['format', 'filename'],
};

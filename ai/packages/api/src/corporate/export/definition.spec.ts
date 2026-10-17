import { EXPORT_FILE_DESCRIPTION, exportFileSchema } from './definition';
import { EXPORT_FORMATS } from './types';

describe('exportFileSchema', () => {
  it('перечисляет форматы format в порядке EXPORT_FORMATS', () => {
    expect(exportFileSchema.properties?.format?.enum).toEqual([...EXPORT_FORMATS]);
  });

  it('описание поля markdown начинается с «Для docx, pdf и md»', () => {
    expect(
      exportFileSchema.properties?.markdown?.description?.startsWith('Для docx, pdf и md'),
    ).toBe(true);
  });
});

describe('EXPORT_FILE_DESCRIPTION', () => {
  it('упоминает Markdown (md)', () => {
    expect(EXPORT_FILE_DESCRIPTION).toContain('Markdown (md)');
  });

  it('перечисляет содержимое для docx, pdf и md', () => {
    expect(EXPORT_FILE_DESCRIPTION).toContain('для docx, pdf и md — markdown');
  });
});

import { EXPORT_FORMAT_DESCRIPTORS, resolveExportFormat } from '../formats';

describe('resolveExportFormat', () => {
  it.each([
    ['Отчёт.pdf', 'pdf'],
    ['ОТЧЁТ.DOCX', 'docx'],
    ['План.v2.pptx', 'pptx'],
    ['Продажи.xlsx', 'xlsx'],
    ['Выгрузка.csv', 'csv'],
    ['Заметки.md', 'md'],
  ])('resolves %s to %s by extension, case-insensitively, from the last dot', (filename, key) => {
    const format = resolveExportFormat({ filename, type: '' });

    expect(format?.key).toBe(key);
  });

  it('falls back to MIME type when the filename has no extension', () => {
    const format = resolveExportFormat({
      filename: 'Заметки',
      type: 'text/markdown; charset=utf-8',
    });

    expect(format?.key).toBe('md');
  });

  it('returns null for a filename with no dot and no matching MIME', () => {
    const format = resolveExportFormat({ filename: 'md', type: '' });

    expect(format).toBeNull();
  });

  it('returns null for an unrelated extension and MIME type', () => {
    const format = resolveExportFormat({ filename: 'архив.zip', type: 'application/zip' });

    expect(format).toBeNull();
  });

  it('does not resolve prototype-chain property names as extensions', () => {
    const format = resolveExportFormat({ filename: 'x.constructor', type: '' });

    expect(format).toBeNull();
  });
});

describe('EXPORT_FORMAT_DESCRIPTORS', () => {
  const descriptors = Object.values(EXPORT_FORMAT_DESCRIPTORS);

  it('gives every format a distinct icon, tone class and label key', () => {
    expect(new Set(descriptors.map((d) => d.Icon)).size).toBe(descriptors.length);
    expect(new Set(descriptors.map((d) => d.toneClassName)).size).toBe(descriptors.length);
    expect(new Set(descriptors.map((d) => d.labelKey)).size).toBe(descriptors.length);
  });

  it('uses a series tone class between 1 and 7 for every format', () => {
    for (const descriptor of descriptors) {
      expect(descriptor.toneClassName).toMatch(/^bg-series-[1-7]$/);
    }
  });
});

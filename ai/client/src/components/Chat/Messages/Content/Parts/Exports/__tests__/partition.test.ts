import { FileContext } from 'librechat-data-provider';
import type { TAttachment } from 'librechat-data-provider';
import { partitionExportedFiles } from '../partition';

const attachment = (overrides: Partial<TAttachment> = {}): TAttachment =>
  ({
    file_id: 'file-1',
    filename: 'file.txt',
    filepath: '/files/file.txt',
    ...overrides,
  }) as TAttachment;

describe('partitionExportedFiles', () => {
  it('separates export_file attachments from the rest, preserving order in each bucket', () => {
    const code = attachment({
      file_id: 'code',
      filename: 'script.py',
      context: FileContext.execute_code,
    });
    const report = attachment({
      file_id: 'report',
      filename: 'Отчёт.pdf',
      context: FileContext.export_file,
    });
    const memory = attachment({ file_id: 'memory', filename: 'note.txt' });
    const slides = attachment({
      file_id: 'slides',
      filename: 'Слайды.pptx',
      context: FileContext.export_file,
    });

    const result = partitionExportedFiles([code, report, memory, slides]);

    expect(result.attachments).toEqual([code, memory]);
    expect(result.exportedFiles).toEqual([report, slides]);
  });

  it('keeps a repeated file_id at its first position but uses the latest record', () => {
    const first = attachment({
      file_id: 'dup',
      filename: 'v1.pdf',
      filepath: '/files/v1.pdf',
      context: FileContext.export_file,
    });
    const other = attachment({
      file_id: 'other',
      filename: 'other.pdf',
      context: FileContext.export_file,
    });
    const updated = attachment({
      file_id: 'dup',
      filename: 'v2.pdf',
      filepath: '/files/v2.pdf',
      context: FileContext.export_file,
    });

    const result = partitionExportedFiles([first, other, updated]);

    expect(result.exportedFiles).toEqual([updated, other]);
  });

  it('drops an exported file with an empty filepath entirely', () => {
    const noPath = attachment({
      file_id: 'empty',
      filename: 'empty.pdf',
      filepath: '',
      context: FileContext.export_file,
    });

    const result = partitionExportedFiles([noPath]);

    expect(result.attachments).toEqual([]);
    expect(result.exportedFiles).toEqual([]);
  });

  it('is idempotent: partitioning the remaining attachments finds nothing new', () => {
    const code = attachment({
      file_id: 'code',
      filename: 'script.py',
      context: FileContext.execute_code,
    });
    const report = attachment({
      file_id: 'report',
      filename: 'Отчёт.pdf',
      context: FileContext.export_file,
    });

    const first = partitionExportedFiles([code, report]);
    const second = partitionExportedFiles(first.attachments);

    expect(second.exportedFiles).toEqual([]);
    expect(second.attachments).toEqual(first.attachments);
  });

  it('returns two empty arrays for undefined', () => {
    const result = partitionExportedFiles(undefined);

    expect(result).toEqual({ attachments: [], exportedFiles: [] });
  });
});

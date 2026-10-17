import { logger } from '@librechat/data-schemas';
import { AttachmentErrorCodes } from 'librechat-data-provider';
import { resolveDocumentBudget } from '../../files/documents/fit';
import { inspectPdfSize, inspectPdfUpload } from './pdf';

const warnTokens = 8000;
const budget = resolveDocumentBudget(1000000);

describe('inspectPdfSize', () => {
  it('пропускает короткий PDF', async () => {
    const result = await inspectPdfSize(
      { filePath: '/fake/two-pages.pdf', filename: 'two-pages.pdf', warnTokens, budget },
      async () => 2,
    );

    expect(result.verdict).toBe('ok');
    expect(result.tokenCount).toBe(516);
    expect(result.pageCount).toBe(2);
  });

  it('отклоняет PDF, который не помещается в контекст модели', async () => {
    const result = await inspectPdfSize(
      { filePath: '/fake/big.pdf', filename: 'big.pdf', warnTokens, budget },
      async () => 5000,
    );

    expect(result.verdict).toBe('too_large');
    expect(result.pageCount).toBe(5000);
    expect(result.errorCode).toBe(AttachmentErrorCodes.context_overflow);
    expect(result.params).toEqual({
      filename: 'big.pdf',
      pageCount: 5000,
      tokens: 1290000,
      contextTokens: 1000000,
      requiredContextTokens: Math.ceil(((1290000 + 8000) * 100) / 95),
    });
  });

  it('не отклоняет PDF без бюджета модели', async () => {
    const result = await inspectPdfSize(
      { filePath: '/fake/big.pdf', filename: 'big.pdf', warnTokens },
      async () => 5000,
    );

    expect(result.verdict).toBe('large');
    expect(result.rejection).toBeNull();
  });

  it('не мешает загрузке, когда страницы посчитать не удалось', async () => {
    const result = await inspectPdfSize(
      { filePath: '/fake/missing.pdf', filename: 'missing.pdf', warnTokens, budget },
      async () => 0,
    );

    expect(result.verdict).toBe('ok');
    expect(result.tokenCount).toBe(0);
    expect(result.pageCount).toBeNull();
  });
});

describe('inspectPdfUpload', () => {
  it('не трогает файлы, которые не являются PDF', async () => {
    const countPages = jest.fn();

    const result = await inspectPdfUpload(
      {
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filePath: '/tmp/regulation.docx',
        filename: 'regulation.docx',
        warnTokens,
        budget,
      },
      countPages,
    );

    expect(result).toBeNull();
    expect(countPages).not.toHaveBeenCalled();
  });

  it('измеряет PDF и отдаёт вердикт', async () => {
    const result = await inspectPdfUpload(
      {
        mimetype: 'application/pdf',
        filePath: '/tmp/big.pdf',
        filename: 'big.pdf',
        warnTokens,
        budget,
      },
      async () => 5000,
    );

    expect(result?.verdict).toBe('too_large');
    expect(result?.pageCount).toBe(5000);
  });

  it('отдельно сообщает в лог, что считать нечего, когда файла нет на диске', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    const countPages = jest.fn();

    const result = await inspectPdfUpload(
      { mimetype: 'application/pdf', filePath: undefined, filename: 'big.pdf', warnTokens, budget },
      countPages,
    );

    expect(result).toBeNull();
    expect(countPages).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('was not written to disk'));

    warn.mockRestore();
  });
});

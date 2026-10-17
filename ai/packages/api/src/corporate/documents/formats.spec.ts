import { EToolResources } from 'librechat-data-provider';
import { createUnsupportedFormatError, inspectParserUpload } from './formats';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PARSER_LIMIT = 50 * 1024 * 1024;

describe('inspectParserUpload', () => {
  it('отклоняет презентацию больше 50 МБ, приложенную ради текста', () => {
    expect(
      inspectParserUpload({
        toolResource: EToolResources.context,
        mimetype: PPTX_MIME,
        size: PARSER_LIMIT + 1,
        filename: 'Отчёт.pptx',
      }),
    ).toEqual({
      message: '"Отчёт.pptx" exceeds the 50 MB size limit.',
      errorCode: 'too_large',
      params: { filename: 'Отчёт.pptx', limitMb: 50 },
    });
  });

  it('пропускает файл ровно на пределе разборщика', () => {
    expect(
      inspectParserUpload({
        toolResource: EToolResources.context,
        mimetype: PPTX_MIME,
        size: PARSER_LIMIT,
        filename: 'Отчёт.pptx',
      }),
    ).toBeNull();
  });

  it('применяет предел к PDF, из которого извлекается текст', () => {
    expect(
      inspectParserUpload({
        toolResource: EToolResources.context,
        mimetype: 'application/pdf',
        size: PARSER_LIMIT + 1,
        filename: 'scan.pdf',
      }),
    ).toMatchObject({ errorCode: 'too_large' });
  });

  it('не трогает PDF, который уходит модели как есть', () => {
    expect(
      inspectParserUpload({
        mimetype: 'application/pdf',
        size: 40 * 1024 * 1024,
        filename: 'scan.pdf',
      }),
    ).toBeNull();
  });

  it('не трогает текстовые форматы — их читает не встроенный разборщик', () => {
    expect(
      inspectParserUpload({
        toolResource: EToolResources.context,
        mimetype: 'text/plain',
        size: PARSER_LIMIT + 1,
        filename: 'log.txt',
      }),
    ).toBeNull();
  });
});

describe('createUnsupportedFormatError', () => {
  it('builds a 415 error whose body carries the unsupported_format code', () => {
    const error = createUnsupportedFormatError('archive.exe');

    expect(error.statusCode).toBe(415);
    expect(error.body).toEqual({
      message: '"archive.exe" is not a supported file format.',
      errorCode: 'unsupported_format',
      params: { filename: 'archive.exe' },
    });
  });

  it('falls back to a filename-less message when none is given', () => {
    const error = createUnsupportedFormatError();

    expect(error.statusCode).toBe(415);
    expect(error.body).toEqual({
      message: 'The file is not a supported file format.',
      errorCode: 'unsupported_format',
      params: {},
    });
  });
});

import {
  AttachmentErrorCodes,
  EToolResources,
  listAcceptedFormats,
  supportedMimeTypes,
} from 'librechat-data-provider';
import type {
  AttachmentErrorBody,
  AttachmentErrorParams,
  TStartupConfig,
  TModelSpec,
} from 'librechat-data-provider';
import {
  describeAcceptedFormats,
  describeAttachmentError,
  describeUploadError,
  getAttachmentStage,
  pickModelSuggestion,
  resolveCurrentModelLabel,
  toUploadErrorEntry,
} from '../attachments';
import i18n from '~/locales/i18n';

const localize = (key: string) =>
  key === 'com_ui_attachment_text_and_code' ? 'text and code' : key;

const numberText = (value: number) => value.toLocaleString(i18n.language);

function buildBody(
  errorCode: AttachmentErrorBody['errorCode'],
  params: AttachmentErrorParams = {},
): AttachmentErrorBody {
  return { message: '', errorCode, params };
}

function makeSpec(name: string, label: string, order?: number): TModelSpec {
  return { name, label, order, preset: {} as TModelSpec['preset'] };
}

describe('describeAcceptedFormats', () => {
  it('lists documents, spreadsheets, presentations and images, collapsing text and code', () => {
    const formats = listAcceptedFormats(supportedMimeTypes);
    const result = describeAcceptedFormats(formats, localize);

    for (const extension of ['.pdf', '.docx', '.doc', '.rtf', '.odt']) {
      expect(result).toContain(extension);
    }
    for (const extension of ['.xlsx', '.xls', '.ods']) {
      expect(result).toContain(extension);
    }
    expect(result).toContain('.pptx');
    for (const extension of ['.jpg', '.png', '.webp', '.gif', '.heic', '.heif']) {
      expect(result).toContain(extension);
    }
    expect(result).toContain('text and code (.txt, .md, .csv, .json…)');
    expect(result).not.toContain('.sql');
  });
});

describe('describeAttachmentError', () => {
  it('describes a corrupted file with its name', () => {
    expect(
      describeAttachmentError(buildBody(AttachmentErrorCodes.corrupted, { filename: 'a.pdf' })),
    ).toEqual({
      key: 'com_error_attachment_corrupted',
      params: { 0: 'a.pdf' },
    });
  });

  it('describes an encrypted file with its name', () => {
    expect(
      describeAttachmentError(
        buildBody(AttachmentErrorCodes.encrypted, { filename: 'secret.docx' }),
      ),
    ).toEqual({
      key: 'com_error_attachment_encrypted',
      params: { 0: 'secret.docx' },
    });
  });

  it('describes a file with no extractable text', () => {
    expect(
      describeAttachmentError(buildBody(AttachmentErrorCodes.no_text, { filename: 'scan.pdf' })),
    ).toEqual({
      key: 'com_error_attachment_no_text',
      params: { 0: 'scan.pdf' },
    });
  });

  it('describes a parse timeout with its duration', () => {
    expect(
      describeAttachmentError(
        buildBody(AttachmentErrorCodes.parse_timeout, { filename: 'big.pdf', seconds: 120 }),
      ),
    ).toEqual({
      key: 'com_error_attachment_parse_timeout',
      params: { 0: 'big.pdf', 1: numberText(120) },
    });
  });

  it('describes an oversized file with its limit', () => {
    expect(
      describeAttachmentError(
        buildBody(AttachmentErrorCodes.too_large, { filename: 'huge.pdf', limitMb: 50 }),
      ),
    ).toEqual({
      key: 'com_error_attachment_too_large',
      params: { 0: 'huge.pdf', 1: numberText(50) },
    });
  });

  it('describes an archive too large once unpacked', () => {
    expect(
      describeAttachmentError(
        buildBody(AttachmentErrorCodes.unpacked_too_large, { filename: 'archive.docx' }),
      ),
    ).toEqual({
      key: 'com_error_attachment_unpacked_too_large',
      params: { 0: 'archive.docx' },
    });
  });

  it('describes an unsupported format without naming the file', () => {
    expect(
      describeAttachmentError(
        buildBody(AttachmentErrorCodes.unsupported_format, { filename: 'a.exe' }),
      ),
    ).toEqual({
      key: 'com_error_files_unsupported_format',
      params: { 0: '' },
    });
  });

  it('names the suggested model on a context overflow', () => {
    const suggestion = makeSpec('luna', 'Luna 6');
    expect(
      describeAttachmentError(
        buildBody(AttachmentErrorCodes.context_overflow, {
          filename: 'regulation.docx',
          tokens: 942000,
          contextTokens: 1000000,
          requiredContextTokens: 1023158,
        }),
        suggestion,
      ),
    ).toEqual({
      key: 'com_error_attachment_context_overflow_unknown_model',
      params: { 0: 'regulation.docx', 1: numberText(942000), 2: numberText(1000000), 3: 'Luna 6' },
    });
  });

  it('names the current model when its label is known', () => {
    const suggestion = makeSpec('luna', 'Luna 6');
    expect(
      describeAttachmentError(
        buildBody(AttachmentErrorCodes.context_overflow, {
          filename: 'regulation.docx',
          tokens: 942000,
          contextTokens: 200000,
          modelLabel: 'Sonnet 5',
        }),
        suggestion,
      ),
    ).toEqual({
      key: 'com_error_attachment_context_overflow',
      params: {
        0: 'regulation.docx',
        1: 'Sonnet 5',
        2: numberText(942000),
        3: numberText(200000),
        4: 'Luna 6',
      },
    });
  });

  it('says no available model can handle the document when there is no suggestion', () => {
    expect(
      describeAttachmentError(
        buildBody(AttachmentErrorCodes.context_overflow, {
          filename: 'huge.docx',
          tokens: 3000000,
        }),
        null,
      ),
    ).toEqual({
      key: 'com_error_attachment_context_overflow_all',
      params: { 0: 'huge.docx', 1: numberText(3000000) },
    });
  });
});

describe('describeUploadError', () => {
  it('reports a canceled upload', () => {
    expect(describeUploadError({ code: 'ERR_CANCELED', message: 'canceled' }, 'a.pdf')).toEqual({
      key: 'com_error_files_upload_canceled',
    });
  });

  it('delegates a typed server error to describeAttachmentError', () => {
    const error = {
      message: 'rejected',
      response: {
        data: {
          message: 'rejected',
          errorCode: AttachmentErrorCodes.encrypted,
          params: { filename: 'a.docx' },
        },
      },
    };
    expect(describeUploadError(error, 'a.docx')).toEqual({
      key: 'com_error_attachment_encrypted',
      params: { 0: 'a.docx' },
    });
  });

  it('feeds the resolved current-model label into a context overflow lacking one from the server', () => {
    const error = {
      message: 'rejected',
      response: {
        status: 422,
        data: {
          message: 'rejected',
          errorCode: AttachmentErrorCodes.context_overflow,
          params: { filename: 'a.docx', tokens: 900000, contextTokens: 200000 },
        },
      },
    };
    const suggestion = makeSpec('luna', 'Luna 6');
    expect(describeUploadError(error, 'a.docx', suggestion, 'Sonnet 5')).toEqual({
      key: 'com_error_attachment_context_overflow',
      params: {
        0: 'a.docx',
        1: 'Sonnet 5',
        2: numberText(900000),
        3: numberText(200000),
        4: 'Luna 6',
      },
    });
  });

  it('reports a 413 as too large to upload', () => {
    const error = { message: 'too large', response: { status: 413 } };
    expect(describeUploadError(error, 'huge.pdf')).toEqual({
      key: 'com_error_attachment_upload_too_large',
      params: { 0: 'huge.pdf' },
    });
  });

  it('returns a legacy server message as-is for a 4xx response', () => {
    const error = {
      message: 'failed',
      response: { status: 422, data: { message: 'Server says no.' } },
    };
    expect(describeUploadError(error, 'a.pdf')).toEqual({ key: null, text: 'Server says no.' });
  });

  it('falls back to the generic message for a 5xx response, even with a message', () => {
    const error = {
      message: 'failed',
      response: { status: 500, data: { message: 'internal stack trace leaked here' } },
    };
    expect(describeUploadError(error, 'a.pdf')).toEqual({ key: 'com_error_files_upload' });
  });

  it('falls back to the generic message for a network error with no response', () => {
    const error = { message: 'Network Error' };
    expect(describeUploadError(error, 'a.pdf')).toEqual({ key: 'com_error_files_upload' });
  });

  it('falls back to the generic message for an empty error', () => {
    expect(describeUploadError(undefined, 'a.pdf')).toEqual({ key: 'com_error_files_upload' });
  });
});

describe('resolveCurrentModelLabel', () => {
  const startupConfig = {
    modelSpecs: {
      list: [{ name: 'current-spec', label: 'GPT Classic', preset: {} }],
    },
  } as unknown as TStartupConfig;

  it('uses the label of the spec named by the conversation', () => {
    expect(resolveCurrentModelLabel('current-spec', 'gpt-4', startupConfig)).toBe('GPT Classic');
  });

  it('falls back to the conversation model name when no spec resolves', () => {
    expect(resolveCurrentModelLabel('missing-spec', 'gpt-4-raw', startupConfig)).toBe('gpt-4-raw');
  });

  it('is undefined when neither a spec label nor a model name is known', () => {
    expect(resolveCurrentModelLabel(undefined, undefined, startupConfig)).toBeUndefined();
  });
});

describe('getAttachmentStage', () => {
  it('is null once the file has finished uploading and processing', () => {
    expect(
      getAttachmentStage({
        progress: 1,
        stage: 'processing',
        tool_resource: EToolResources.context,
      }),
    ).toBeNull();
  });

  it('is uploading while the stage has not reached processing yet', () => {
    expect(getAttachmentStage({ progress: 0.4, stage: 'uploading' })).toBe('uploading');
  });

  it('is extracting once processing starts for a context attachment', () => {
    expect(
      getAttachmentStage({
        progress: 0.9,
        stage: 'processing',
        tool_resource: EToolResources.context,
      }),
    ).toBe('extracting');
  });

  it('is processing once processing starts for a non-context attachment', () => {
    expect(getAttachmentStage({ progress: 0.9, stage: 'processing' })).toBe('processing');
  });
});

describe('toUploadErrorEntry', () => {
  it('pairs a filename with its localized message', () => {
    expect(toUploadErrorEntry('a.pdf', { key: 'com_error_files_upload' })).toEqual({
      filename: 'a.pdf',
      message: { key: 'com_error_files_upload' },
    });
  });
});

describe('pickModelSuggestion', () => {
  const specA = makeSpec('a', 'A', 2);
  const specB = makeSpec('b', 'B', 1);
  const specC = makeSpec('c', 'C', 3);

  const contextOf = (contexts: Record<string, number | undefined>) => (spec: TModelSpec) =>
    contexts[spec.name];

  it('suggests the smallest sufficient context', () => {
    const contexts = { a: 200000, b: 1000000, c: 1050000 };
    const result = pickModelSuggestion([specA, specB, specC], 'a', 900000, contextOf(contexts));
    expect(result?.name).toBe('b');
  });

  it('suggests the next tier up when the smaller one is not enough', () => {
    const contexts = { a: 200000, b: 1000000, c: 1050000 };
    const result = pickModelSuggestion([specA, specB, specC], 'a', 1040000, contextOf(contexts));
    expect(result?.name).toBe('c');
  });

  it('returns null when no spec has enough context', () => {
    const contexts = { a: 200000, b: 1000000, c: 1050000 };
    const result = pickModelSuggestion([specA, specB, specC], 'a', 2000000, contextOf(contexts));
    expect(result).toBeNull();
  });

  it('does not suggest a spec with unknown context', () => {
    const contexts = { a: 200000, b: undefined, c: 1050000 };
    const result = pickModelSuggestion([specA, specB, specC], 'a', 900000, contextOf(contexts));
    expect(result?.name).toBe('c');
  });

  it('never suggests the current spec, even with enough context', () => {
    const contexts = { a: 200000, b: 1000000, c: 1050000 };
    const result = pickModelSuggestion([specA, specB, specC], 'c', 1000000, contextOf(contexts));
    expect(result?.name).toBe('b');
  });

  it('breaks a tie between equal contexts by order', () => {
    const lowOrder = makeSpec('low-order', 'Z Low Order', 1);
    const highOrder = makeSpec('high-order', 'A High Order', 5);
    const contexts = { a: 200000, 'low-order': 1000000, 'high-order': 1000000 };
    const result = pickModelSuggestion(
      [specA, lowOrder, highOrder],
      'a',
      900000,
      contextOf(contexts),
    );
    expect(result?.name).toBe('low-order');
  });

  it('breaks a tie between equal contexts and order by label', () => {
    const specZ = makeSpec('z', 'Z Model', 1);
    const specM = makeSpec('m', 'M Model', 1);
    const contexts = { a: 200000, z: 1000000, m: 1000000 };
    const result = pickModelSuggestion([specA, specZ, specM], 'a', 900000, contextOf(contexts));
    expect(result?.name).toBe('m');
  });
});

import { AttachmentErrorCodes } from 'librechat-data-provider';
import { resolveDocumentBudget } from '../../files/documents/fit';
import { inspectDocumentSize } from './upload';

const warnTokens = 100;
const countTokens = (text: string) => Promise.resolve(text.length);

describe('inspectDocumentSize', () => {
  it('пропускает небольшой документ без замечаний', async () => {
    const result = await inspectDocumentSize({
      text: 'x'.repeat(50),
      filename: 'note.txt',
      warnTokens,
      budget: resolveDocumentBudget(1000000),
      countTokens,
    });

    expect(result).toEqual({
      tokenCount: 50,
      pageCount: null,
      verdict: 'ok',
      rejection: null,
      errorCode: null,
      params: null,
    });
  });

  it('помечает большой документ, но не отклоняет его', async () => {
    const result = await inspectDocumentSize({
      text: 'x'.repeat(500),
      filename: 'regulation.docx',
      warnTokens,
      budget: resolveDocumentBudget(1000000),
      countTokens,
    });

    expect(result.verdict).toBe('large');
    expect(result.rejection).toBeNull();
  });

  it('отклоняет документ больше бюджета модели кодом context_overflow', async () => {
    const result = await inspectDocumentSize({
      text: 'x'.repeat(200000),
      filename: 'Договор.pdf',
      warnTokens,
      budget: resolveDocumentBudget(100000),
      countTokens,
    });

    expect(result.verdict).toBe('too_large');
    expect(result.errorCode).toBe(AttachmentErrorCodes.context_overflow);
    expect(result.rejection).toContain('Договор.pdf');
    expect(result.params).toEqual({
      filename: 'Договор.pdf',
      tokens: 200000,
      contextTokens: 100000,
      requiredContextTokens: Math.ceil(((200000 + 8000) * 100) / 95),
    });
  });

  it('принимает документ больше 100000 токенов, если он помещается в модель', async () => {
    const result = await inspectDocumentSize({
      text: 'x'.repeat(150000),
      filename: 'regulation.docx',
      warnTokens,
      budget: resolveDocumentBudget(1000000),
      countTokens,
    });

    expect(result.verdict).toBe('large');
    expect(result.tokenCount).toBe(150000);
    expect(result.rejection).toBeNull();
  });

  it('не отклоняет документ, когда бюджет модели неизвестен', async () => {
    const result = await inspectDocumentSize({
      text: 'x'.repeat(2_000_000),
      filename: 'huge.txt',
      warnTokens,
      countTokens,
    });

    expect(result.verdict).toBe('large');
    expect(result.rejection).toBeNull();
  });

  it('считает пустой текст обычным документом', async () => {
    const result = await inspectDocumentSize({
      text: '',
      filename: 'empty.txt',
      warnTokens,
      budget: resolveDocumentBudget(1000000),
      countTokens,
    });

    expect(result).toEqual({
      tokenCount: 0,
      pageCount: null,
      verdict: 'ok',
      rejection: null,
      errorCode: null,
      params: null,
    });
  });
});

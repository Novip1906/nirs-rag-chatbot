import { classifyDocumentSize } from 'librechat-data-provider';
import type {
  DocumentSizeVerdict,
  AttachmentErrorBody,
  AttachmentErrorCode,
  AttachmentErrorParams,
} from 'librechat-data-provider';
import type { DocumentBudget } from '../../files/documents/fit';
import { assessDocumentFit } from '../../files/documents/fit';

export interface InspectDocumentSizeInput {
  text: string;
  filename: string;
  warnTokens: number;
  budget?: DocumentBudget;
  countTokens: (text: string) => Promise<number>;
}

export interface DocumentSizeInspection {
  tokenCount: number;
  /**
   * Настоящее число страниц — заполнено только там, где его удалось посчитать
   * (PDF). У текста страниц нет, есть оценка по объёму, и хранить оценку рядом
   * с фактом нельзя: клиент не отличит одно от другого.
   */
  pageCount: number | null;
  verdict: DocumentSizeVerdict;
  /** Сообщение об отказе, заполнено только при `verdict === 'too_large'`. */
  rejection: string | null;
  errorCode: AttachmentErrorCode | null;
  params: AttachmentErrorParams | null;
}

export interface SizeInspectionInput {
  tokenCount: number;
  pageCount: number | null;
  warnTokens: number;
  rejection: AttachmentErrorBody | null;
}

export function toSizeInspection({
  tokenCount,
  pageCount,
  warnTokens,
  rejection,
}: SizeInspectionInput): DocumentSizeInspection {
  if (rejection) {
    return {
      tokenCount,
      pageCount,
      verdict: 'too_large',
      rejection: rejection.message,
      errorCode: rejection.errorCode,
      params: rejection.params,
    };
  }
  return {
    tokenCount,
    pageCount,
    verdict: classifyDocumentSize(tokenCount, { warnTokens, maxTokens: Number.POSITIVE_INFINITY }),
    rejection: null,
    errorCode: null,
    params: null,
  };
}

export async function inspectDocumentSize(
  input: InspectDocumentSizeInput,
): Promise<DocumentSizeInspection> {
  const { text, filename, warnTokens, budget, countTokens } = input;
  if (!budget) {
    const tokenCount = text ? await countTokens(text) : 0;
    return toSizeInspection({ tokenCount, pageCount: null, warnTokens, rejection: null });
  }

  const fit = await assessDocumentFit({ text, filename, budget, countTokens });
  return toSizeInspection({
    tokenCount: fit.tokenCount,
    pageCount: null,
    warnTokens,
    rejection: fit.rejection,
  });
}

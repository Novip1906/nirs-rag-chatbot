import axios from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import type { TDlpConfig } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import { logAxiosError } from '~/utils';
import { maskText, MarkerTable } from '~/dlp';

export interface RagChunk {
  fileId: string;
  content: string;
  distance: number;
  page: number | null;
}

export interface RagRequestBase {
  baseUrl: string;
  token: string;
}

interface RagChunkTuple {
  page_content: string;
  metadata: {
    file_id: string;
    page?: number | null;
  };
}

function toRagChunk([doc, distance]: [RagChunkTuple, number]): RagChunk {
  return {
    fileId: doc.metadata.file_id,
    content: doc.page_content,
    distance,
    page: doc.metadata.page ?? null,
  };
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function isNotFoundError(error: unknown): boolean {
  return (error as { response?: { status?: number } }).response?.status === 404;
}

export function buildEmbedForm(input: {
  fileId: string;
  entityId: string;
}): Record<string, string> {
  return { file_id: input.fileId, entity_id: input.entityId };
}

/**
 * `rag_api` подставляет id вызывающего пользователя, если `entity_id` не передан явно.
 * Документы стали бы приватными для загрузившего админа, а база знаний — пустой для
 * всех остальных. Поэтому пустой `entityId` — исключение, а не молчаливая отправка без него.
 */
function requireEntityId(entityId: string): void {
  if (!entityId) {
    throw new Error(
      'entity_id обязателен: без него rag_api привяжет документ к вызывающему пользователю',
    );
  }
}

export async function extractText(
  input: RagRequestBase & {
    fileId: string;
    filePath: string;
    filename: string;
    mimetype: string;
  },
): Promise<string> {
  const form = new FormData();
  form.append('file_id', input.fileId);
  form.append('file', createReadStream(input.filePath), {
    filename: input.filename,
    contentType: input.mimetype,
  });

  const response = await axios.post<{ text?: string }>(`${input.baseUrl}/text`, form, {
    headers: { ...authHeaders(input.token), ...form.getHeaders() },
  });

  if (typeof response.data.text !== 'string') {
    throw new Error('rag_api не вернул текст документа');
  }
  return response.data.text;
}

/**
 * Когда есть уже извлечённый `text`, в модель эмбеддингов уходит он, а не файл с диска —
 * иначе `dlp.maskEmbeddings` нечего было бы маскировать. Без `text` поведение не меняется:
 * файл стримится как раньше, для внутренних моделей это сохраняет исходное форматирование.
 */
function buildEmbedFileContent(input: {
  filePath: string;
  text?: string;
  dlp?: TDlpConfig;
}): NodeJS.ReadableStream | Buffer {
  if (input.text == null) {
    return createReadStream(input.filePath);
  }
  const text =
    input.dlp?.enabled && input.dlp.maskEmbeddings
      ? maskText(input.text, new MarkerTable(), { modes: input.dlp.categories }).text
      : input.text;
  return Buffer.from(text, 'utf8');
}

export async function embedDocument(
  input: RagRequestBase & {
    fileId: string;
    entityId: string;
    filePath: string;
    filename: string;
    mimetype: string;
    text?: string;
    dlp?: TDlpConfig;
  },
): Promise<{ embedded: boolean }> {
  requireEntityId(input.entityId);

  const fields = buildEmbedForm({ fileId: input.fileId, entityId: input.entityId });
  const form = new FormData();
  form.append('file_id', fields.file_id);
  form.append('entity_id', fields.entity_id);
  /**
   * Когда отправляется уже извлечённый текст, имя и тип обязаны стать текстовыми:
   * `rag_api` выбирает загрузчик по расширению и на буфере с именем `lec2.pdf`
   * попытается разобрать его как PDF.
   */
  const sendsText = input.text != null;
  form.append('file', buildEmbedFileContent(input), {
    filename: sendsText ? `${input.fileId}.txt` : input.filename,
    contentType: sendsText ? 'text/plain' : input.mimetype,
  });

  const response = await axios.post<{ status?: boolean }>(`${input.baseUrl}/embed`, form, {
    headers: { ...authHeaders(input.token), ...form.getHeaders() },
  });

  return { embedded: Boolean(response.data.status) };
}

export async function queryMultiple(
  input: RagRequestBase & { query: string; fileIds: string[]; entityId: string; k: number },
): Promise<RagChunk[]> {
  if (input.fileIds.length === 0) {
    return [];
  }
  try {
    const response = await axios.post<Array<[RagChunkTuple, number]>>(
      `${input.baseUrl}/query_multiple`,
      { query: input.query, file_ids: input.fileIds, k: input.k, entity_id: input.entityId },
      { headers: authHeaders(input.token) },
    );
    return response.data.map(toRagChunk);
  } catch (error) {
    if (isNotFoundError(error)) {
      logger.debug('[knowledge] /query_multiple: rag_api не нашёл документов по запросу');
      return [];
    }
    logAxiosError({ message: '[knowledge] Ошибка запроса /query_multiple к rag_api', error });
    return [];
  }
}

export async function querySingle(
  input: RagRequestBase & { query: string; fileId: string; entityId: string; k: number },
): Promise<RagChunk[]> {
  try {
    const response = await axios.post<Array<[RagChunkTuple, number]>>(
      `${input.baseUrl}/query`,
      { query: input.query, file_id: input.fileId, k: input.k, entity_id: input.entityId },
      { headers: authHeaders(input.token) },
    );
    return response.data.map(toRagChunk);
  } catch (error) {
    if (isNotFoundError(error)) {
      logger.debug('[knowledge] /query: rag_api не нашёл документов по запросу');
      return [];
    }
    logAxiosError({ message: '[knowledge] Ошибка запроса /query к rag_api', error });
    return [];
  }
}

/**
 * `entity_id` обязателен в query-параметре: `rag_api` требует его для документов,
 * проиндексированных под сущностью, иначе `DELETE /documents` отвечает 404
 * `"One or more IDs not found"`, даже когда документы существуют. Без него удаление
 * молча "не находит" ничего, векторы остаются в pgvector навсегда, а `file_id` для их
 * удаления к этому моменту уже потерян записью в Mongo.
 */
export async function deleteDocuments(
  input: RagRequestBase & { fileIds: string[]; entityId: string },
): Promise<void> {
  if (input.fileIds.length === 0) {
    return;
  }
  requireEntityId(input.entityId);

  try {
    await axios.delete(`${input.baseUrl}/documents`, {
      headers: {
        ...authHeaders(input.token),
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      params: { entity_id: input.entityId },
      data: input.fileIds,
    });
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    logAxiosError({ message: '[knowledge] Ошибка удаления документов из rag_api', error });
    throw error;
  }
}

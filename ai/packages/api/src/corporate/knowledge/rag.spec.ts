jest.mock('fs', () => ({
  createReadStream: jest.fn(),
}));

jest.mock('form-data', () => {
  return jest.fn().mockImplementation(() => ({
    append: jest.fn(),
    getHeaders: jest.fn().mockReturnValue({ 'content-type': 'multipart/form-data' }),
  }));
});

jest.mock('axios', () => ({
  post: jest.fn(),
  delete: jest.fn(),
  isAxiosError: jest.fn().mockReturnValue(false),
}));

jest.mock('~/utils', () => ({
  logAxiosError: jest.fn(),
  logger: { debug: jest.fn(), error: jest.fn() },
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), error: jest.fn() },
}));

import axios from 'axios';
import FormData from 'form-data';
import { DEFAULT_DLP_CONFIG } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import { logAxiosError } from '~/utils';
import {
  buildEmbedForm,
  embedDocument,
  extractText,
  queryMultiple,
  querySingle,
  deleteDocuments,
} from './rag';

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFormData = FormData as unknown as jest.Mock;
const mockedLogAxiosError = logAxiosError as jest.MockedFunction<typeof logAxiosError>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

function lastFormAppendCalls(): unknown[][] {
  const results = mockedFormData.mock.results;
  const instance = results[results.length - 1].value as { append: jest.Mock };
  return instance.append.mock.calls;
}

function notFoundError(): Error {
  return Object.assign(new Error('Not Found'), {
    response: { status: 404, data: { detail: 'No documents found for the given query' } },
  });
}

const base = { baseUrl: 'http://rag', token: 't' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildEmbedForm', () => {
  it('в /embed всегда уходит entity_id пространства', () => {
    expect(buildEmbedForm({ fileId: 'f1', entityId: 'space-1' })).toEqual({
      file_id: 'f1',
      entity_id: 'space-1',
    });
  });
});

describe('embedDocument', () => {
  it('отказывается работать без entityId', async () => {
    await expect(
      embedDocument({
        ...base,
        fileId: 'f',
        entityId: '',
        filePath: '/tmp/a',
        filename: 'a.pdf',
        mimetype: 'application/pdf',
      }),
    ).rejects.toThrow(/entity/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('шлёт entity_id и разбирает статус эмбеддинга', async () => {
    mockedAxios.post.mockResolvedValue({ data: { status: true, known_type: true } });
    const result = await embedDocument({
      ...base,
      fileId: 'f',
      entityId: 'space-1',
      filePath: '/tmp/a',
      filename: 'a.pdf',
      mimetype: 'application/pdf',
    });
    expect(result).toEqual({ embedded: true });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://rag/embed',
      expect.anything(),
      expect.anything(),
    );
  });

  it('rag_api ответил 200, но не подтвердил запись фрагментов — embedded остаётся false', async () => {
    mockedAxios.post.mockResolvedValue({ data: { status: false } });
    const result = await embedDocument({
      ...base,
      fileId: 'f',
      entityId: 'space-1',
      filePath: '/tmp/a',
      filename: 'a.pdf',
      mimetype: 'application/pdf',
    });
    expect(result).toEqual({ embedded: false });
  });

  it('маскирует текст документа перед отправкой в модель эмбеддингов', async () => {
    mockedAxios.post.mockResolvedValue({ data: { status: true } });
    await embedDocument({
      ...base,
      fileId: 'f',
      entityId: 'space-1',
      filePath: '/tmp/a.txt',
      filename: 'a.txt',
      mimetype: 'text/plain',
      text: 'договор, карта 4111111111111111',
      dlp: { ...DEFAULT_DLP_CONFIG, enabled: true, maskEmbeddings: true },
    });
    const fileCall = lastFormAppendCalls().find((call) => call[0] === 'file');
    const sentContent = String(fileCall?.[1]);
    expect(sentContent).toContain('CARD_1');
    expect(sentContent).not.toContain('4111111111111111');
  });

  it('не маскирует, когда модель эмбеддингов локальная', async () => {
    mockedAxios.post.mockResolvedValue({ data: { status: true } });
    await embedDocument({
      ...base,
      fileId: 'f',
      entityId: 'space-1',
      filePath: '/tmp/a.txt',
      filename: 'a.txt',
      mimetype: 'text/plain',
      text: 'договор, карта 4111111111111111',
      dlp: { ...DEFAULT_DLP_CONFIG, enabled: true, maskEmbeddings: false },
    });
    const fileCall = lastFormAppendCalls().find((call) => call[0] === 'file');
    const sentContent = String(fileCall?.[1]);
    expect(sentContent).toContain('4111111111111111');
  });

  it('без text и dlp по-прежнему стримит файл как раньше', async () => {
    mockedAxios.post.mockResolvedValue({ data: { status: true } });
    await embedDocument({
      ...base,
      fileId: 'f',
      entityId: 'space-1',
      filePath: '/tmp/a.pdf',
      filename: 'a.pdf',
      mimetype: 'application/pdf',
    });
    const fileCall = lastFormAppendCalls().find((call) => call[0] === 'file');
    expect(fileCall?.[1]).toBeUndefined();
  });
});

describe('extractText', () => {
  it('отправляет файл на /text и возвращает извлечённый текст', async () => {
    mockedAxios.post.mockResolvedValue({ data: { text: 'привет' } });
    const text = await extractText({
      ...base,
      fileId: 'f',
      filePath: '/tmp/a',
      filename: 'a.pdf',
      mimetype: 'application/pdf',
    });
    expect(text).toBe('привет');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://rag/text',
      expect.anything(),
      expect.anything(),
    );
  });

  it('бросает, если rag_api не вернул текст', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} });
    await expect(
      extractText({
        ...base,
        fileId: 'f',
        filePath: '/tmp/a',
        filename: 'a.pdf',
        mimetype: 'application/pdf',
      }),
    ).rejects.toThrow(/текст/i);
  });
});

describe('queryMultiple', () => {
  it('отправляет file_ids и entity_id и разбирает ответ', async () => {
    mockedAxios.post.mockResolvedValue({
      data: [
        [{ page_content: 'текст', metadata: { file_id: 'a', page: 3 } }, 0.2],
        [{ page_content: 'ещё', metadata: { file_id: 'b' } }, 0.5],
      ],
    });
    const chunks = await queryMultiple({
      ...base,
      query: 'q',
      fileIds: ['a', 'b'],
      entityId: 's1',
      k: 5,
    });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://rag/query_multiple',
      { query: 'q', file_ids: ['a', 'b'], k: 5, entity_id: 's1' },
      expect.anything(),
    );
    expect(chunks).toEqual([
      { fileId: 'a', content: 'текст', distance: 0.2, page: 3 },
      { fileId: 'b', content: 'ещё', distance: 0.5, page: null },
    ]);
  });

  it('по пустому списку файлов не ходит в сеть', async () => {
    const chunks = await queryMultiple({
      ...base,
      query: 'q',
      fileIds: [],
      entityId: 's1',
      k: 5,
    });
    expect(chunks).toEqual([]);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('при ошибке сети возвращает пусто, а не бросает', async () => {
    mockedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      queryMultiple({ ...base, query: 'q', fileIds: ['a'], entityId: 's1', k: 5 }),
    ).resolves.toEqual([]);
  });

  it('404 — штатное «ничего не найдено», без logger.error', async () => {
    mockedAxios.post.mockRejectedValue(notFoundError());
    await expect(
      queryMultiple({ ...base, query: 'q', fileIds: ['a'], entityId: 's1', k: 5 }),
    ).resolves.toEqual([]);
    expect(mockedLogAxiosError).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  it('500 — реальный сбой, logger.error вызывается', async () => {
    mockedAxios.post.mockRejectedValue(
      Object.assign(new Error('rag down'), { response: { status: 500 } }),
    );
    await expect(
      queryMultiple({ ...base, query: 'q', fileIds: ['a'], entityId: 's1', k: 5 }),
    ).resolves.toEqual([]);
    expect(mockedLogAxiosError).toHaveBeenCalled();
  });
});

describe('querySingle', () => {
  it('отправляет file_id и entity_id и разбирает ответ', async () => {
    mockedAxios.post.mockResolvedValue({
      data: [[{ page_content: 'текст', metadata: { file_id: 'a', page: 1 } }, 0.1]],
    });
    const chunks = await querySingle({
      ...base,
      query: 'q',
      fileId: 'a',
      entityId: 's1',
      k: 5,
    });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://rag/query',
      { query: 'q', file_id: 'a', k: 5, entity_id: 's1' },
      expect.anything(),
    );
    expect(chunks).toEqual([{ fileId: 'a', content: 'текст', distance: 0.1, page: 1 }]);
  });

  it('при ошибке сети возвращает пусто, а не бросает', async () => {
    mockedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      querySingle({ ...base, query: 'q', fileId: 'a', entityId: 's1', k: 5 }),
    ).resolves.toEqual([]);
  });

  it('404 — штатное «ничего не найдено», без logger.error', async () => {
    mockedAxios.post.mockRejectedValue(notFoundError());
    await expect(
      querySingle({ ...base, query: 'q', fileId: 'a', entityId: 's1', k: 5 }),
    ).resolves.toEqual([]);
    expect(mockedLogAxiosError).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  it('500 — реальный сбой, logger.error вызывается', async () => {
    mockedAxios.post.mockRejectedValue(
      Object.assign(new Error('rag down'), { response: { status: 500 } }),
    );
    await expect(
      querySingle({ ...base, query: 'q', fileId: 'a', entityId: 's1', k: 5 }),
    ).resolves.toEqual([]);
    expect(mockedLogAxiosError).toHaveBeenCalled();
  });
});

describe('deleteDocuments', () => {
  it('удаляет по списку file_ids с entity_id в query-параметре', async () => {
    mockedAxios.delete.mockResolvedValue({ status: 200 });
    await deleteDocuments({ ...base, fileIds: ['a', 'b'], entityId: 's1' });
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      'http://rag/documents',
      expect.objectContaining({
        data: ['a', 'b'],
        params: { entity_id: 's1' },
      }),
    );
  });

  it('по пустому списку не ходит в сеть', async () => {
    await deleteDocuments({ ...base, fileIds: [], entityId: 's1' });
    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  it('отказывается работать без entityId', async () => {
    await expect(deleteDocuments({ ...base, fileIds: ['a'], entityId: '' })).rejects.toThrow(
      /entity/i,
    );
    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  it('404 при переданном entity_id считается успехом — векторов и так нет', async () => {
    const error = Object.assign(new Error('not found'), { response: { status: 404 } });
    mockedAxios.delete.mockRejectedValue(error);
    await expect(
      deleteDocuments({ ...base, fileIds: ['a'], entityId: 's1' }),
    ).resolves.toBeUndefined();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  it('прочие ошибки пробрасываются', async () => {
    const error = Object.assign(new Error('rag down'), { response: { status: 500 } });
    mockedAxios.delete.mockRejectedValue(error);
    await expect(deleteDocuments({ ...base, fileIds: ['a'], entityId: 's1' })).rejects.toThrow(
      'rag down',
    );
  });
});

import http from 'http';
import { logger } from '@librechat/data-schemas';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import {
  SpeechError,
  transcribeSpeech,
  SPEECH_FAILED_MESSAGE,
  SPEECH_FORMAT_MESSAGE,
  buildSpeechInstruction,
  MAX_SPEECH_AUDIO_BYTES,
  SPEECH_LANGUAGE_MESSAGE,
  SPEECH_TOO_LARGE_MESSAGE,
} from './transcribe';

interface CapturedRequest {
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

interface TestServer {
  baseUrl: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

type Responder = (req: IncomingMessage, res: ServerResponse) => void;

const MODEL = 'google/gemini-3.7-flash';
const PROXY_ENV_KEYS = [
  'PROXY',
  'proxy',
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
];
const savedEnv = new Map<string, string | undefined>();
const servers: TestServer[] = [];

async function startServer(respond: Responder): Promise<TestServer> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      respond(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const testServer: TestServer = {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  servers.push(testServer);
  return testServer;
}

function allowed(server: TestServer): string[] {
  return [new URL(server.baseUrl).host];
}

function wav(payload = 'audio'): Buffer {
  return Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.alloc(4),
    Buffer.from('WAVE'),
    Buffer.from(payload),
  ]);
}

function replyJson(status: number, payload: object): Responder {
  return (_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
}

function completion(content: string | null, usage: object): object {
  return { choices: [{ message: { role: 'assistant', content } }], usage };
}

async function captureSpeechError(promise: Promise<unknown>): Promise<SpeechError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SpeechError) {
      return error;
    }
    throw error;
  }
  throw new Error('ожидалась ошибка SpeechError');
}

beforeEach(() => {
  for (const key of PROXY_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  delete process.env.SPEECH_TEST_KEY;
  delete process.env.SPEECH_TEST_BASE_URL;
  jest.restoreAllMocks();
});

describe('transcribeSpeech', () => {
  it('шлёт WAV модели с инструкцией и возвращает расшифровку со стоимостью', async () => {
    const server = await startServer(
      replyJson(
        200,
        completion('  Привет, мир.  ', {
          prompt_tokens: 160,
          completion_tokens: 12,
          cost: 0.000123,
        }),
      ),
    );
    const audio = wav('test-audio');

    const result = await transcribeSpeech({
      audio,
      config: { model: MODEL, apiKey: 'sk-or-test', baseURL: `${server.baseUrl}/api/v1/` },
      allowedAddresses: allowed(server),
    });

    expect(result).toEqual({
      text: 'Привет, мир.',
      costUsd: 0.000123,
      model: MODEL,
      promptTokens: 160,
      completionTokens: 12,
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].url).toBe('/api/v1/chat/completions');
    expect(server.requests[0].headers.authorization).toBe('Bearer sk-or-test');
    expect(JSON.parse(server.requests[0].body)).toEqual({
      model: MODEL,
      temperature: 0,
      reasoning: { effort: 'minimal' },
      usage: { include: true },
      messages: [
        { role: 'system', content: buildSpeechInstruction('ru') },
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: { data: audio.toString('base64'), format: 'wav' },
            },
          ],
        },
      ],
    });
  });

  it('подсказывает английский язык, когда выбран en-GB', async () => {
    const server = await startServer(replyJson(200, completion('ок', { cost: 0.0001 })));

    await transcribeSpeech({
      audio: wav(),
      config: { model: MODEL, apiKey: 'k', baseURL: server.baseUrl },
      allowedAddresses: allowed(server),
      language: 'en-GB',
    });

    const body = JSON.parse(server.requests[0].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: buildSpeechInstruction('en') });
  });

  it('отклоняет неизвестный язык диктовки с кодом 400, не обращаясь к провайдеру', async () => {
    const server = await startServer(replyJson(200, completion('не должно дойти', {})));

    const error = await captureSpeechError(
      transcribeSpeech({
        audio: wav(),
        config: { model: MODEL, apiKey: 'k', baseURL: server.baseUrl },
        allowedAddresses: allowed(server),
        language: 'de',
      }),
    );

    expect(error.status).toBe(400);
    expect(error.message).toBe(SPEECH_LANGUAGE_MESSAGE);
    expect(server.requests).toHaveLength(0);
  });

  it('отклоняет повторённое поле формы языка с кодом 400, не обращаясь к провайдеру', async () => {
    const server = await startServer(replyJson(200, completion('не должно дойти', {})));

    const error = await captureSpeechError(
      transcribeSpeech({
        audio: wav(),
        config: { model: MODEL, apiKey: 'k', baseURL: server.baseUrl },
        allowedAddresses: allowed(server),
        language: ['ru', 'en'],
      }),
    );

    expect(error.status).toBe(400);
    expect(error.message).toBe(SPEECH_LANGUAGE_MESSAGE);
    expect(server.requests).toHaveLength(0);
  });

  it('берёт ключ и адрес из переменных окружения, как остальной конфиг', async () => {
    const server = await startServer(replyJson(200, completion('ок', { cost: 0.0001 })));
    process.env.SPEECH_TEST_KEY = 'sk-from-env';
    process.env.SPEECH_TEST_BASE_URL = `${server.baseUrl}/v1`;

    await transcribeSpeech({
      audio: wav(),
      config: { model: MODEL, apiKey: '${SPEECH_TEST_KEY}', baseURL: '${SPEECH_TEST_BASE_URL}' },
      allowedAddresses: allowed(server),
    });

    expect(server.requests[0].url).toBe('/v1/chat/completions');
    expect(server.requests[0].headers.authorization).toBe('Bearer sk-from-env');
  });

  it('отдаёт costUsd: null, когда провайдер не прислал стоимость', async () => {
    const server = await startServer(replyJson(200, completion('ок', {})));

    const result = await transcribeSpeech({
      audio: wav(),
      config: { model: MODEL, apiKey: 'k', baseURL: server.baseUrl },
      allowedAddresses: allowed(server),
    });

    expect(result.costUsd).toBeNull();
    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
  });

  it('возвращает пустую строку, когда речи в записи нет', async () => {
    const server = await startServer(replyJson(200, completion(null, { cost: 0.00005 })));

    const result = await transcribeSpeech({
      audio: wav(),
      config: { model: MODEL, apiKey: 'k', baseURL: server.baseUrl },
      allowedAddresses: allowed(server),
    });

    expect(result.text).toBe('');
    expect(result.costUsd).toBe(0.00005);
  });

  it('отклоняет запись больше 15 МБ, не обращаясь к провайдеру', async () => {
    const server = await startServer(replyJson(200, completion('не должно дойти', {})));

    const error = await captureSpeechError(
      transcribeSpeech({
        audio: Buffer.alloc(MAX_SPEECH_AUDIO_BYTES + 1),
        config: { model: MODEL, apiKey: 'k', baseURL: server.baseUrl },
        allowedAddresses: allowed(server),
      }),
    );

    expect(error.status).toBe(413);
    expect(error.message).toBe(SPEECH_TOO_LARGE_MESSAGE);
    expect(server.requests).toHaveLength(0);
  });

  it('отклоняет запись не в WAV с кодом 415, не обращаясь к провайдеру', async () => {
    const server = await startServer(replyJson(200, completion('не должно дойти', {})));

    const error = await captureSpeechError(
      transcribeSpeech({
        audio: Buffer.from('\x1aE\xdf\xa3webm-recording', 'latin1'),
        config: { model: MODEL, apiKey: 'k', baseURL: server.baseUrl },
        allowedAddresses: allowed(server),
      }),
    );

    expect(error.status).toBe(415);
    expect(error.message).toBe(SPEECH_FORMAT_MESSAGE);
    expect(server.requests).toHaveLength(0);
  });

  it('не обращается к внутреннему адресу, которого нет в allowedAddresses', async () => {
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const server = await startServer(replyJson(200, completion('не должно дойти', {})));

    const error = await captureSpeechError(
      transcribeSpeech({
        audio: wav(),
        config: { model: MODEL, apiKey: 'k', baseURL: server.baseUrl },
      }),
    );

    expect(error.status).toBe(502);
    expect(error.message).toBe(SPEECH_FAILED_MESSAGE);
    expect(server.requests).toHaveLength(0);
  });

  it('переводит ошибку провайдера в сообщение для сотрудника и не пишет ответ провайдера в лог', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const server = await startServer(
      replyJson(500, { error: { message: 'upstream PRIVATE detail' } }),
    );

    const error = await captureSpeechError(
      transcribeSpeech({
        audio: wav(),
        config: { model: MODEL, apiKey: 'k', baseURL: server.baseUrl },
        allowedAddresses: allowed(server),
      }),
    );

    expect(error.status).toBe(502);
    expect(error.message).toBe(SPEECH_FAILED_MESSAGE);
    expect(server.requests).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('upstream PRIVATE detail');
  });

  it('отклоняет ответ без choices', async () => {
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const server = await startServer(replyJson(200, { error: { message: 'no choices' } }));

    const error = await captureSpeechError(
      transcribeSpeech({
        audio: wav(),
        config: { model: MODEL, apiKey: 'k', baseURL: server.baseUrl },
        allowedAddresses: allowed(server),
      }),
    );

    expect(error.status).toBe(502);
    expect(error.message).toBe(SPEECH_FAILED_MESSAGE);
  });

  it('обрывает запрос по таймауту', async () => {
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const server = await startServer(() => undefined);

    const error = await captureSpeechError(
      transcribeSpeech({
        audio: wav(),
        config: { model: MODEL, apiKey: 'k', baseURL: server.baseUrl },
        allowedAddresses: allowed(server),
        timeoutMs: 100,
      }),
    );

    expect(error.status).toBe(502);
    expect(error.message).toBe(SPEECH_FAILED_MESSAGE);
    expect(server.requests).toHaveLength(1);
  });

  it('идёт через прокси из окружения, как запросы чата', async () => {
    const proxy = await startServer(replyJson(200, completion('через прокси', { cost: 0.0002 })));
    process.env.HTTP_PROXY = proxy.baseUrl;

    const result = await transcribeSpeech({
      audio: wav(),
      config: { model: MODEL, apiKey: 'k', baseURL: 'http://openrouter.test/api/v1' },
    });

    expect(result.text).toBe('через прокси');
    expect(proxy.requests).toHaveLength(1);
    expect(proxy.requests[0].url).toBe('http://openrouter.test/api/v1/chat/completions');
  });
});

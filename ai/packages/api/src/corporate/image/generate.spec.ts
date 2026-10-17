import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import type { TImageGenerationConfig } from 'librechat-data-provider';
import type { AddressInfo } from 'net';
import {
  generateImage,
  IMAGE_FAILED_MESSAGE,
  IMAGE_REFUSED_MESSAGE,
  IMAGE_TIMEOUT_MESSAGE,
} from './generate';
import { ImageToolError } from './validate';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

interface TestServer {
  baseUrl: string;
  bodies: Array<Record<string, unknown>>;
  paths: string[];
  close: () => Promise<void>;
}

type Responder = (req: IncomingMessage, res: ServerResponse) => void;

const PROXY_ENV_KEYS = ['PROXY', 'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'];
const savedEnv = new Map<string, string | undefined>();
const servers: TestServer[] = [];

async function startServer(respond: Responder): Promise<TestServer> {
  const bodies: Array<Record<string, unknown>> = [];
  const paths: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      paths.push(req.url ?? '');
      bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      respond(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const testServer: TestServer = {
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    bodies,
    paths,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  servers.push(testServer);
  return testServer;
}

function replyJson(status: number, payload: object): Responder {
  return (_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
}

function config(server: TestServer, extra: Partial<TImageGenerationConfig> = {}) {
  return {
    model: 'openai/gpt-5.4-image-2',
    apiKey: 'test-key',
    baseURL: server.baseUrl,
    ...extra,
  };
}

function allowed(server: TestServer): string[] {
  return [new URL(server.baseUrl).host];
}

async function captureError(promise: Promise<unknown>): Promise<ImageToolError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ImageToolError) {
      return error;
    }
    throw error;
  }
  throw new Error('ожидалась ошибка ImageToolError');
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
});

describe('generateImage', () => {
  it('шлёт запрос в /images и возвращает картинку с ценой', async () => {
    const server = await startServer(
      replyJson(200, {
        data: [{ b64_json: 'aW1n', media_type: 'image/jpeg' }],
        usage: { cost: 0.042, prompt_tokens: 30, completion_tokens: 1290 },
      }),
    );

    const image = await generateImage({
      prompt: 'Кот',
      aspectRatio: '16:9',
      inputImages: ['data:image/png;base64,c3Jj'],
      config: config(server, { resolution: '2K', quality: 'medium', outputFormat: 'jpeg' }),
      allowedAddresses: allowed(server),
    });

    expect(server.paths).toEqual(['/api/v1/images']);
    expect(server.bodies[0]).toEqual({
      model: 'openai/gpt-5.4-image-2',
      prompt: 'Кот',
      n: 1,
      aspect_ratio: '16:9',
      resolution: '2K',
      quality: 'medium',
      output_format: 'jpeg',
      input_references: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,c3Jj' } }],
    });
    expect(image).toEqual({
      base64: 'aW1n',
      mediaType: 'image/jpeg',
      costUsd: 0.042,
      model: 'openai/gpt-5.4-image-2',
      promptTokens: 30,
      completionTokens: 1290,
    });
  });

  it('без цены от провайдера возвращает null, а тип берёт из настроек', async () => {
    const server = await startServer(replyJson(200, { data: [{ b64_json: 'aW1n' }] }));

    const image = await generateImage({
      prompt: 'Кот',
      aspectRatio: '1:1',
      inputImages: [],
      config: config(server, { outputFormat: 'webp' }),
      allowedAddresses: allowed(server),
    });

    expect(server.bodies[0]).not.toHaveProperty('input_references');
    expect(image.costUsd).toBeNull();
    expect(image.mediaType).toBe('image/webp');
  });

  it('отказ модерации (403) объясняет модели как отказ провайдера', async () => {
    const server = await startServer(replyJson(403, { error: { message: 'Input was flagged' } }));
    const error = await captureError(
      generateImage({
        prompt: 'Кот',
        aspectRatio: '1:1',
        inputImages: [],
        config: config(server),
        allowedAddresses: allowed(server),
      }),
    );
    expect(error.message).toBe(IMAGE_REFUSED_MESSAGE);
  });

  it('400 с текстом про правила тоже считает отказом модерации', async () => {
    const server = await startServer(
      replyJson(400, { error: { message: 'Request rejected by safety system' } }),
    );
    const error = await captureError(
      generateImage({
        prompt: 'Кот',
        aspectRatio: '1:1',
        inputImages: [],
        config: config(server),
        allowedAddresses: allowed(server),
      }),
    );
    expect(error.message).toBe(IMAGE_REFUSED_MESSAGE);
  });

  it('сбой провайдера отдаёт модели общий текст без повтора', async () => {
    const server = await startServer(replyJson(502, { error: { message: 'upstream' } }));
    const error = await captureError(
      generateImage({
        prompt: 'Кот',
        aspectRatio: '1:1',
        inputImages: [],
        config: config(server),
        allowedAddresses: allowed(server),
      }),
    );
    expect(error.message).toBe(IMAGE_FAILED_MESSAGE);
    expect(server.bodies).toHaveLength(1);
  });

  it('ответ без картинки считает отказом и передаёт списанную цену', async () => {
    const server = await startServer(replyJson(200, { data: [], usage: { cost: 0.02 } }));
    const error = await captureError(
      generateImage({
        prompt: 'Кот',
        aspectRatio: '1:1',
        inputImages: [],
        config: config(server),
        allowedAddresses: allowed(server),
      }),
    );
    expect(error.message).toBe(IMAGE_REFUSED_MESSAGE);
    expect(error.charge).toMatchObject({ costUsd: 0.02, model: 'openai/gpt-5.4-image-2' });
  });

  it('по таймауту отдаёт отдельный текст', async () => {
    const server = await startServer(() => undefined);
    const error = await captureError(
      generateImage({
        prompt: 'Кот',
        aspectRatio: '1:1',
        inputImages: [],
        config: config(server, { timeoutMs: 100 }),
        allowedAddresses: allowed(server),
      }),
    );
    expect(error.message).toBe(IMAGE_TIMEOUT_MESSAGE);
  });
});

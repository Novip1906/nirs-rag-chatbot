import { Tools } from 'librechat-data-provider';
import type { ToolMessage } from '@langchain/core/messages';
import type { RecordUsageInput } from '@librechat/data-schemas';
import type { ImageDbDeps, ImageToolArtifact, ImageToolDeps } from './tool';
import type { GeneratedImage } from './generate';
import type { InputImageFile } from './inputs';
import { IMAGE_USAGE_SCENARIO } from './definition';
import { createImageGenerationTool } from './tool';
import { ImageToolError } from './validate';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const USER_ID = '6512f0a1b2c3d4e5f6a7b8c9';

function image(overrides: Partial<GeneratedImage> = {}): GeneratedImage {
  return {
    base64: 'aW1n',
    mediaType: 'image/jpeg',
    costUsd: 0.04,
    model: 'openai/gpt-5.4-image-2',
    promptTokens: 20,
    completionTokens: 1000,
    ...overrides,
  };
}

function db(
  used = 0,
  dailyCostUsd: number | null = 1,
): ImageDbDeps & { records: RecordUsageInput[] } {
  const records: RecordUsageInput[] = [];
  return {
    records,
    getGlobalSettings: jest.fn().mockResolvedValue({
      systemPrompt: '',
      allowedModels: [],
      defaultModel: null,
      defaultLimits: { dailyCostUsd },
    }),
    getUserPolicy: jest.fn().mockResolvedValue(null),
    getDepartmentById: jest.fn().mockResolvedValue(null),
    getUsageTotals: jest.fn().mockResolvedValue({ costUsd: used, requests: 0 }),
    recordUsage: jest.fn(async (input: RecordUsageInput) => {
      records.push(input);
    }),
  };
}

function file(id: string): InputImageFile {
  return { file_id: id, type: 'image/png', filepath: `/images/${id}.png`, filename: `${id}.png` };
}

function deps(overrides: Partial<ImageToolDeps> = {}): ImageToolDeps {
  return {
    userId: USER_ID,
    config: { model: 'openai/gpt-5.4-image-2', apiKey: 'key', estimatedCostUsd: 0.05 },
    db: db(),
    inputs: {
      requestFiles: [],
      findUserImages: jest.fn().mockResolvedValue([]),
      readFile: jest.fn(async (input: InputImageFile) => Buffer.from(input.file_id)),
    },
    generate: jest.fn().mockResolvedValue(image()),
    ...overrides,
  };
}

const RUN_CONFIG = {
  configurable: { thread_id: 'conv-1', requestBody: { messageId: 'answer-1' } },
};

async function invoke(toolDeps: ImageToolDeps, args: Record<string, unknown>) {
  return (await createImageGenerationTool(toolDeps).invoke(
    { name: Tools.generate_image, id: 'call-1', type: 'tool_call', args },
    RUN_CONFIG,
  )) as ToolMessage;
}

describe('createImageGenerationTool', () => {
  it('рисует картинку, кладёт её в артефакт и пишет расход с запросом', async () => {
    const toolDeps = deps();
    const message = await invoke(toolDeps, { prompt: 'Кот', aspect_ratio: '16:9' });

    const artifact = (message.artifact as ImageToolArtifact)[Tools.generate_image];
    expect(artifact.dataUrl).toBe('data:image/jpeg;base64,aW1n');
    expect(message.artifact).not.toHaveProperty('content');
    expect(String(message.content)).toContain(artifact.fileId);
    expect(String(message.content)).not.toContain('aW1n');

    const records = (toolDeps.db as ReturnType<typeof db>).records;
    expect(records).toEqual([
      expect.objectContaining({
        userId: USER_ID,
        model: 'openai/gpt-5.4-image-2',
        conversationId: 'conv-1',
        messageId: 'answer-1',
        costUsd: 0.04,
        costSource: 'provider',
        scenario: IMAGE_USAGE_SCENARIO,
        imagePrompt: 'Кот',
        imageFileId: artifact.fileId,
      }),
    ]);
    expect(toolDeps.generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Кот', aspectRatio: '16:9', inputImages: [] }),
    );
  });

  it('без цены от провайдера пишет оценку из настроек', async () => {
    const toolDeps = deps({ generate: jest.fn().mockResolvedValue(image({ costUsd: null })) });
    await invoke(toolDeps, { prompt: 'Кот' });
    expect((toolDeps.db as ReturnType<typeof db>).records[0]).toMatchObject({
      costUsd: 0.05,
      costSource: 'estimate',
    });
  });

  it('пишет оплаченный расход, даже если провайдер не вернул картинку', async () => {
    const toolDeps = deps({
      generate: jest.fn().mockRejectedValue(
        new ImageToolError('отказ', {
          costUsd: 0.03,
          model: 'openai/gpt-5.4-image-2',
          promptTokens: 10,
          completionTokens: 0,
        }),
      ),
    });
    await expect(invoke(toolDeps, { prompt: 'Кот' })).rejects.toThrow('отказ');
    const records = (toolDeps.db as ReturnType<typeof db>).records;
    expect(records).toEqual([
      expect.objectContaining({ costUsd: 0.03, costSource: 'provider', imagePrompt: 'Кот' }),
    ]);
    expect(records[0]).not.toHaveProperty('imageFileId');
  });

  it('отдаёт картинку, даже если расход записать не удалось', async () => {
    const failing = db();
    failing.recordUsage = jest.fn().mockRejectedValue(new Error('mongo down'));
    const message = await invoke(deps({ db: failing }), { prompt: 'Кот' });
    expect((message.artifact as ImageToolArtifact)[Tools.generate_image].dataUrl).toContain(
      'base64',
    );
  });

  it('не пишет расход за неудачную генерацию без цены', async () => {
    const toolDeps = deps({ generate: jest.fn().mockRejectedValue(new ImageToolError('сбой')) });
    await expect(invoke(toolDeps, { prompt: 'Кот' })).rejects.toThrow('сбой');
    expect((toolDeps.db as ReturnType<typeof db>).records).toEqual([]);
  });

  it('прячет внутренние ошибки чтения исходной картинки', async () => {
    const toolDeps = deps({
      inputs: {
        requestFiles: [file('new')],
        findUserImages: jest.fn().mockResolvedValue([]),
        readFile: jest.fn().mockRejectedValue(new Error('ENOENT /images/secret/path')),
      },
    });
    const invocation = invoke(toolDeps, { prompt: 'Измени', image_ids: ['new'] });
    await expect(invocation).rejects.toThrow('Не удалось прочитать исходную картинку');
    await expect(invoke(toolDeps, { prompt: 'Измени', image_ids: ['new'] })).rejects.not.toThrow(
      'ENOENT',
    );
  });

  it('не читает исходную картинку, если она заведомо больше допустимого', async () => {
    const readFile = jest.fn();
    const toolDeps = deps({
      inputs: {
        requestFiles: [{ ...file('big'), bytes: 50 * 1024 * 1024 }],
        findUserImages: jest.fn().mockResolvedValue([]),
        readFile,
      },
    });
    await expect(invoke(toolDeps, { prompt: 'Измени', image_ids: ['big'] })).rejects.toThrow(
      'слишком большая',
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  it('при исчерпанном лимите не идёт к провайдеру', async () => {
    const toolDeps = deps({ db: db(0.98) });
    await expect(invoke(toolDeps, { prompt: 'Кот' })).rejects.toThrow(ImageToolError);
    expect(toolDeps.generate).not.toHaveBeenCalled();
    expect((toolDeps.db as ReturnType<typeof db>).records).toEqual([]);
  });

  it('берёт исходные картинки из сообщения и из прошлых файлов сотрудника', async () => {
    const findUserImages = jest.fn().mockResolvedValue([file('old')]);
    const toolDeps = deps({
      inputs: {
        requestFiles: [file('new')],
        findUserImages,
        readFile: jest.fn(async (input: InputImageFile) => Buffer.from(input.file_id)),
      },
    });

    await invoke(toolDeps, { prompt: 'Совмести', image_ids: ['new', 'old'] });

    expect(findUserImages).toHaveBeenCalledWith(['old']);
    expect(toolDeps.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        inputImages: [
          `data:image/png;base64,${Buffer.from('new').toString('base64')}`,
          `data:image/png;base64,${Buffer.from('old').toString('base64')}`,
        ],
      }),
    );
  });

  it('просит прикрепить заново картинку, которой нет у сотрудника', async () => {
    const toolDeps = deps();
    await expect(invoke(toolDeps, { prompt: 'Измени', image_ids: ['chuzhaya'] })).rejects.toThrow(
      'прикрепить исходную',
    );
    expect(toolDeps.generate).not.toHaveBeenCalled();
  });
});

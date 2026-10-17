import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createConversationModel } from '../models/convo';
import { createMessageModel } from '../models/message';
import { createUsageRecordModel } from '../models/usageRecord';
import { createTranscriptMethods, extractMessageText } from './transcript';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([
    createMessageModel(mongoose).init(),
    createConversationModel(mongoose).init(),
    createUsageRecordModel(mongoose).init(),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    mongoose.models.Message.deleteMany({}),
    mongoose.models.Conversation.deleteMany({}),
    mongoose.models.UsageRecord.deleteMany({}),
  ]);
});

const user = new mongoose.Types.ObjectId();

async function seedExchange(answerOverrides: Record<string, unknown> = {}) {
  await mongoose.models.Conversation.create({
    conversationId: 'conv-1',
    user: user.toString(),
    title: 'Тарифы на эквайринг',
    endpoint: 'Corporate AI',
  });
  await mongoose.models.Message.create([
    {
      messageId: 'question-1',
      conversationId: 'conv-1',
      user: user.toString(),
      isCreatedByUser: true,
      text: 'Какая ставка для маркетплейсов?',
    },
    {
      messageId: 'answer-1',
      conversationId: 'conv-1',
      parentMessageId: 'question-1',
      user: user.toString(),
      isCreatedByUser: false,
      model: 'google/gemini-3.5-flash',
      text: '',
      content: [{ type: 'text', text: 'Ставка 2,9 %, выплата Т+3.' }],
      ...answerOverrides,
    },
  ]);
}

describe('extractMessageText', () => {
  /**
   * На стенде у 116 ответов из 120 поле `text` пустое — ответ лежит в частях `content`.
   * Читать только `text` означало бы показывать администратору пустой ответ.
   */
  it('собирает ответ из частей content, когда text пуст', () => {
    expect(
      extractMessageText({
        text: '',
        content: [
          { type: 'text', text: 'Первая часть. ' },
          { type: 'text', text: 'Вторая часть.' },
        ],
      }),
    ).toBe('Первая часть. Вторая часть.');
  });

  it('пропускает рассуждения и вызовы инструментов', () => {
    expect(
      extractMessageText({
        text: '',
        content: [
          { type: 'think', think: 'внутренние рассуждения' },
          { type: 'tool_call', tool_call: { name: 'knowledge_search' } },
          { type: 'text', text: 'Ответ.' },
        ],
      }),
    ).toBe('Ответ.');
  });

  it('предпочитает непустой text частям', () => {
    expect(
      extractMessageText({ text: 'Готовый текст', content: [{ type: 'text', text: 'другое' }] }),
    ).toBe('Готовый текст');
  });

  /**
   * В чате из якоря рисуется плашка источника, а в тексте он остаётся мусором
   * посреди предложения — администратор читает ответ как обычный текст.
   */
  it('убирает якоря цитирования базы знаний', () => {
    expect(
      extractMessageText({
        text: '',
        content: [
          { type: 'text', text: 'Ставка 2,9 %.\\ue202turn0file0 Выплата Т+3.\\ue202turn0file1' },
        ],
      }),
    ).toBe('Ставка 2,9 %. Выплата Т+3.');
  });

  it('убирает якоря, записанные самим символом, а не escape-последовательностью', () => {
    expect(extractMessageText({ text: 'Ответ.\ue202turn0file0', content: [] })).toBe('Ответ.');
  });

  it('убирает одиночные маркеры разметки без якоря', () => {
    expect(extractMessageText({ text: '\ue203Цитата.\ue204 Продолжение.', content: [] })).toBe(
      'Цитата. Продолжение.',
    );
  });

  it('возвращает пустую строку, когда сказать нечего', () => {
    expect(extractMessageText({ text: '', content: [] })).toBe('');
    expect(extractMessageText({ text: undefined, content: undefined })).toBe('');
  });
});

describe('getRequestTranscript', () => {
  it('отдаёт вопрос сотрудника и ответ модели по messageId ответа', async () => {
    const methods = createTranscriptMethods(mongoose);
    await seedExchange();

    const transcript = await methods.getRequestTranscript('answer-1');

    expect(transcript).toMatchObject({
      messageId: 'answer-1',
      userId: user.toString(),
      conversationId: 'conv-1',
      conversationTitle: 'Тарифы на эквайринг',
      question: 'Какая ставка для маркетплейсов?',
      answer: 'Ставка 2,9 %, выплата Т+3.',
      model: 'google/gemini-3.5-flash',
    });
  });

  it('отдаёт отдел из снимка usage-записи на момент запроса, а не текущий отдел автора', async () => {
    const methods = createTranscriptMethods(mongoose);
    await seedExchange();
    const departmentId = new mongoose.Types.ObjectId();
    await mongoose.models.UsageRecord.create({
      userId: user,
      departmentId,
      model: 'google/gemini-3.5-flash',
      messageId: 'answer-1',
      scenario: 'message',
    });

    const transcript = await methods.getRequestTranscript('answer-1');

    expect(transcript?.departmentId).toBe(departmentId.toString());
  });

  it('отдаёт null отделом, если для сообщения нет usage-записи со снимком', async () => {
    const methods = createTranscriptMethods(mongoose);
    await seedExchange();

    const transcript = await methods.getRequestTranscript('answer-1');

    expect(transcript?.departmentId).toBeNull();
  });

  it('возвращает null, когда переписку удалили', async () => {
    const methods = createTranscriptMethods(mongoose);

    expect(await methods.getRequestTranscript('answer-1')).toBeNull();
  });

  /** Первое сообщение в чате родителя не имеет — это не повод прятать ответ. */
  it('отдаёт ответ с пустым вопросом, если родителя нет', async () => {
    const methods = createTranscriptMethods(mongoose);
    await seedExchange({ parentMessageId: null });

    const transcript = await methods.getRequestTranscript('answer-1');

    expect(transcript?.question).toBe('');
    expect(transcript?.answer).toBe('Ставка 2,9 %, выплата Т+3.');
  });
});

describe('картинки в расшифровке', () => {
  async function seedImage(departmentId: mongoose.Types.ObjectId | null = null) {
    await mongoose.models.UsageRecord.create([
      {
        userId: user,
        departmentId,
        model: 'google/gemini-3.5-flash',
        messageId: 'answer-1',
        scenario: 'message',
      },
      {
        userId: user,
        departmentId,
        model: 'openai/gpt-5.4-image-2',
        messageId: 'answer-1',
        scenario: 'image_gen',
        costUsd: 0.04,
        costSource: 'provider',
        imagePrompt: 'Рыжий кот на подоконнике',
        imageFileId: 'file-1',
      },
    ]);
  }

  it('отдаёт запросы и файлы сгенерированных картинок ответа', async () => {
    const methods = createTranscriptMethods(mongoose);
    await seedExchange();
    await seedImage();

    const transcript = await methods.getRequestTranscript('answer-1');

    expect(transcript?.images).toEqual([
      expect.objectContaining({
        fileId: 'file-1',
        prompt: 'Рыжий кот на подоконнике',
        model: 'openai/gpt-5.4-image-2',
      }),
    ]);
  });

  it('без картинок отдаёт пустой список', async () => {
    const methods = createTranscriptMethods(mongoose);
    await seedExchange();

    expect((await methods.getRequestTranscript('answer-1'))?.images).toEqual([]);
  });

  it('находит картинку только внутри своего запроса и отдаёт отдел из снимка', async () => {
    const methods = createTranscriptMethods(mongoose);
    const departmentId = new mongoose.Types.ObjectId();
    await seedImage(departmentId);

    expect(await methods.getRequestImage('answer-1', 'file-1')).toEqual({
      fileId: 'file-1',
      departmentId: departmentId.toString(),
    });
    expect(await methods.getRequestImage('answer-2', 'file-1')).toBeNull();
    expect(await methods.getRequestImage('answer-1', 'file-2')).toBeNull();
  });
});

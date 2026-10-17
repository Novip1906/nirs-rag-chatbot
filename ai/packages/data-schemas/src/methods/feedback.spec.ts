import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMessageModel } from '../models/message';
import { createUserModel } from '../models/user';
import { createFeedbackMethods } from './feedback';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([createMessageModel(mongoose).init(), createUserModel(mongoose).init()]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([mongoose.models.Message.deleteMany({}), mongoose.models.User.deleteMany({})]);
});

const DAY = 24 * 60 * 60 * 1000;

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    messageId: `msg-${new mongoose.Types.ObjectId().toString()}`,
    conversationId: `conv-${new mongoose.Types.ObjectId().toString()}`,
    user: new mongoose.Types.ObjectId().toString(),
    isCreatedByUser: false,
    ...overrides,
  };
}

describe('getFeedbackSummary', () => {
  it('возвращает нули на пустой базе', async () => {
    const methods = createFeedbackMethods(mongoose);

    const counts = await methods.getFeedbackSummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
    });

    expect(counts).toEqual({ thumbsUp: 0, thumbsDown: 0 });
  });

  it('считает лайки и дизлайки по рейтингу', async () => {
    const methods = createFeedbackMethods(mongoose);

    await mongoose.models.Message.create([
      makeMessage({ feedback: { rating: 'thumbsUp' } }),
      makeMessage({ feedback: { rating: 'thumbsUp' } }),
      makeMessage({ feedback: { rating: 'thumbsDown' } }),
    ]);

    const counts = await methods.getFeedbackSummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
    });

    expect(counts).toEqual({ thumbsUp: 2, thumbsDown: 1 });
  });

  it('фильтрует по updatedAt, а не по createdAt', async () => {
    const methods = createFeedbackMethods(mongoose);
    const message = await mongoose.models.Message.create(
      makeMessage({ feedback: { rating: 'thumbsUp' } }),
    );
    await mongoose.models.Message.collection.updateOne(
      { _id: message._id },
      {
        $set: {
          createdAt: new Date(Date.now() - 30 * DAY),
          updatedAt: new Date(),
        },
      },
    );

    const countsInsideWindow = await methods.getFeedbackSummary({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
    });
    const countsOutsideWindow = await methods.getFeedbackSummary({
      from: new Date(Date.now() - 60 * DAY),
      to: new Date(Date.now() - 40 * DAY),
    });

    expect(countsInsideWindow.thumbsUp).toBe(1);
    expect(countsOutsideWindow.thumbsUp).toBe(0);
  });
});

describe('listFeedback', () => {
  it('листает записи с пагинацией и общим количеством', async () => {
    const methods = createFeedbackMethods(mongoose);

    await mongoose.models.Message.create(
      Array.from({ length: 5 }, () => makeMessage({ feedback: { rating: 'thumbsUp' } })),
    );

    const page = await methods.listFeedback({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      limit: 2,
      skip: 0,
    });

    expect(page.total).toBe(5);
    expect(page.rows).toHaveLength(2);

    const secondPage = await methods.listFeedback({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      limit: 2,
      skip: 4,
    });
    expect(secondPage.rows).toHaveLength(1);
  });

  it('сортирует по updatedAt по убыванию', async () => {
    const methods = createFeedbackMethods(mongoose);
    const older = await mongoose.models.Message.create(
      makeMessage({ feedback: { rating: 'thumbsUp' } }),
    );
    const newer = await mongoose.models.Message.create(
      makeMessage({ feedback: { rating: 'thumbsUp' } }),
    );
    await mongoose.models.Message.collection.updateOne(
      { _id: older._id },
      { $set: { updatedAt: new Date(Date.now() - DAY) } },
    );
    await mongoose.models.Message.collection.updateOne(
      { _id: newer._id },
      { $set: { updatedAt: new Date() } },
    );

    const page = await methods.listFeedback({
      from: new Date(Date.now() - 2 * DAY),
      to: new Date(Date.now() + DAY),
      limit: 10,
      skip: 0,
    });

    expect(page.rows[0].messageId).toBe(newer.messageId);
    expect(page.rows[1].messageId).toBe(older.messageId);
  });

  it('фильтрует по рейтингу', async () => {
    const methods = createFeedbackMethods(mongoose);

    await mongoose.models.Message.create([
      makeMessage({ feedback: { rating: 'thumbsUp' } }),
      makeMessage({ feedback: { rating: 'thumbsDown' } }),
    ]);

    const page = await methods.listFeedback({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      rating: 'thumbsDown',
      limit: 10,
      skip: 0,
    });

    expect(page.total).toBe(1);
    expect(page.rows[0].rating).toBe('thumbsDown');
  });

  it('резолвит имя пользователя через users', async () => {
    const methods = createFeedbackMethods(mongoose);
    const user = await mongoose.models.User.create({
      name: 'Иван Иванов',
      username: 'ivan',
      email: 'ivan@example.com',
    });

    await mongoose.models.Message.create(
      makeMessage({ user: user._id.toString(), feedback: { rating: 'thumbsUp' } }),
    );

    const page = await methods.listFeedback({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      limit: 10,
      skip: 0,
    });

    expect(page.rows[0].userId).toBe(user._id.toString());
    expect(page.rows[0].userName).toBe('Иван Иванов');
  });

  it('не роняет запрос при несуществующем пользователе или невалидном ObjectId', async () => {
    const methods = createFeedbackMethods(mongoose);
    const missingUserId = new mongoose.Types.ObjectId().toString();

    await mongoose.models.Message.create([
      makeMessage({ user: missingUserId, feedback: { rating: 'thumbsUp' } }),
      makeMessage({ user: 'not-an-object-id', feedback: { rating: 'thumbsUp' } }),
    ]);

    const page = await methods.listFeedback({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      limit: 10,
      skip: 0,
    });

    expect(page.total).toBe(2);
    const missingUserRow = page.rows.find((row) => row.userId === missingUserId);
    const invalidIdRow = page.rows.find((row) => row.userId === 'not-an-object-id');
    expect(missingUserRow?.userName).toBe(missingUserId);
    expect(invalidIdRow?.userName).toBe('not-an-object-id');
  });

  it('приводит нестроковый tag к пустой строке и заполняет отсутствующие поля', async () => {
    const methods = createFeedbackMethods(mongoose);

    await mongoose.models.Message.create(
      makeMessage({ feedback: { rating: 'thumbsUp', tag: { key: 'too_long' } } }),
    );

    const page = await methods.listFeedback({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      limit: 10,
      skip: 0,
    });

    expect(page.rows[0].tag).toBe('');
    expect(page.rows[0].text).toBe('');
    expect(page.rows[0].model).toBe('');
  });

  it('сохраняет строковый tag и текст отзыва', async () => {
    const methods = createFeedbackMethods(mongoose);

    await mongoose.models.Message.create(
      makeMessage({
        model: 'anthropic/claude-haiku-4.5',
        feedback: { rating: 'thumbsDown', tag: 'too_long', text: 'Слишком длинный ответ' },
      }),
    );

    const page = await methods.listFeedback({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      limit: 10,
      skip: 0,
    });

    expect(page.rows[0].tag).toBe('too_long');
    expect(page.rows[0].text).toBe('Слишком длинный ответ');
    expect(page.rows[0].model).toBe('anthropic/claude-haiku-4.5');
  });

  it('фильтрует по updatedAt, а не по createdAt', async () => {
    const methods = createFeedbackMethods(mongoose);
    const message = await mongoose.models.Message.create(
      makeMessage({ feedback: { rating: 'thumbsUp' } }),
    );
    await mongoose.models.Message.collection.updateOne(
      { _id: message._id },
      {
        $set: {
          createdAt: new Date(Date.now() - 30 * DAY),
          updatedAt: new Date(),
        },
      },
    );

    const page = await methods.listFeedback({
      from: new Date(Date.now() - DAY),
      to: new Date(Date.now() + DAY),
      limit: 10,
      skip: 0,
    });

    expect(page.total).toBe(1);
  });
});

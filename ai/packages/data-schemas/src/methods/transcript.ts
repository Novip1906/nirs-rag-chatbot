import type { Model } from 'mongoose';
import type { IConversation, IMessage, IUsageRecord } from '~/types';

/**
 * What the employee asked and what came back, for one answer. Read by the admin
 * spend journal, so it is deliberately not scoped to the caller's own messages.
 */
export interface RequestTranscript {
  messageId: string;
  /** Author of the answer — used by the admin layer to scope a department head to their own department. */
  userId: string;
  /**
   * Отдел на момент запроса — тот же снимок (`UsageRecord.departmentId`), по которому
   * фильтрует журнал расходов (`listSpendRequests`), а не текущий отдел автора. Если
   * сотрудник сменил отдел, строка журнала и её расшифровка обязаны отвечать на один и
   * тот же вопрос «чей это был запрос», иначе глава прежнего отдела видела бы строку в
   * журнале, но получала бы 404 при попытке её открыть.
   */
  departmentId: string | null;
  conversationId?: string;
  conversationTitle?: string;
  question: string;
  answer: string;
  model?: string;
  askedAt?: Date;
  answeredAt?: Date;
  images: RequestTranscriptImage[];
}

export interface RequestTranscriptImage {
  fileId: string;
  prompt: string;
  model: string;
  createdAt?: Date;
}

export interface RequestImageRef {
  fileId: string;
  departmentId: string | null;
}

export interface TranscriptMethods {
  getRequestTranscript: (messageId: string) => Promise<RequestTranscript | null>;
  getRequestImage: (messageId: string, fileId: string) => Promise<RequestImageRef | null>;
}

type UsageRecordSnapshot = Pick<
  IUsageRecord,
  'departmentId' | 'model' | 'imagePrompt' | 'imageFileId' | 'createdAt'
>;

function toTranscriptImages(records: UsageRecordSnapshot[]): RequestTranscriptImage[] {
  return records
    .filter((record) => typeof record.imageFileId === 'string' && record.imageFileId !== '')
    .map((record) => ({
      fileId: record.imageFileId as string,
      prompt: record.imagePrompt ?? '',
      model: record.model,
      createdAt: record.createdAt,
    }));
}

function departmentOf(records: UsageRecordSnapshot[]): string | null {
  const withDepartment = records.find((record) => record.departmentId != null);
  return withDepartment?.departmentId ? withDepartment.departmentId.toString() : null;
}

const TEXT_PART = 'text';

/**
 * Якоря цитирования и служебные символы разметки. В чате клиент рисует из них
 * плашку источника (`client/src/utils/citations.ts`), а в обычном тексте они
 * остаются мусором вида `\ue202turn0file0` посреди предложения. Админ читает
 * ответ как текст, поэтому здесь они убираются — сначала целые якоря, потом
 * одиночные маркеры без якоря.
 */
const CITATION_ANCHOR = /\s*(?:\\ue202|\ue202)turn\d+(?:search|news|image|video|ref|file)\d+/g;
const CITATION_MARKER =
  /\\ue200|\\ue201|\\ue202|\\ue203|\\ue204|\\ue206|\ue200|\ue201|\ue202|\ue203|\ue204|\ue206/g;

function stripCitationMarkers(text: string): string {
  return text.replace(CITATION_ANCHOR, '').replace(CITATION_MARKER, '');
}

function isTextPart(part: unknown): part is { type: string; text?: string } {
  return typeof part === 'object' && part !== null && 'type' in part;
}

/**
 * Answers arrive as content parts and leave `text` empty — on this stand 116 of 120
 * stored answers had nothing in `text`. Reasoning and tool-call parts are skipped:
 * the journal shows what the employee was shown.
 */
export function extractMessageText(message: Pick<IMessage, 'text' | 'content'>): string {
  const direct = message.text?.trim() ?? '';
  if (direct !== '') {
    return stripCitationMarkers(direct).trim();
  }
  if (!Array.isArray(message.content)) {
    return '';
  }
  const parts = message.content
    .filter(isTextPart)
    .filter((part) => part.type === TEXT_PART)
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('');
  return stripCitationMarkers(parts).trim();
}

export function createTranscriptMethods(mongoose: typeof import('mongoose')): TranscriptMethods {
  const messageModel = () => mongoose.models.Message as Model<IMessage>;
  const conversationModel = () => mongoose.models.Conversation as Model<IConversation>;
  const usageRecordModel = () => mongoose.models.UsageRecord as Model<IUsageRecord>;

  async function getRequestTranscript(messageId: string): Promise<RequestTranscript | null> {
    const answer = await messageModel()
      .findOne({ messageId })
      .select('messageId conversationId parentMessageId text content model createdAt user')
      .lean<IMessage | null>();
    if (!answer) {
      return null;
    }

    const [question, conversation, usageRecords] = await Promise.all([
      answer.parentMessageId
        ? messageModel()
            .findOne({ messageId: answer.parentMessageId })
            .select('text content createdAt')
            .lean<IMessage | null>()
        : null,
      answer.conversationId
        ? conversationModel()
            .findOne({ conversationId: answer.conversationId })
            .select('title')
            .lean<IConversation | null>()
        : null,
      usageRecordModel()
        .find({ messageId })
        .sort({ createdAt: 1 })
        .select('departmentId model imagePrompt imageFileId createdAt')
        .lean<UsageRecordSnapshot[]>(),
    ]);

    return {
      messageId: answer.messageId,
      userId: answer.user,
      departmentId: departmentOf(usageRecords),
      conversationId: answer.conversationId,
      conversationTitle: conversation?.title,
      question: question ? extractMessageText(question) : '',
      answer: extractMessageText(answer),
      model: answer.model,
      askedAt: question?.createdAt,
      answeredAt: answer.createdAt,
      images: toTranscriptImages(usageRecords),
    };
  }

  async function getRequestImage(
    messageId: string,
    fileId: string,
  ): Promise<RequestImageRef | null> {
    const record = await usageRecordModel()
      .findOne({ messageId, imageFileId: fileId })
      .select('departmentId imageFileId')
      .lean<Pick<IUsageRecord, 'departmentId' | 'imageFileId'> | null>();
    if (!record?.imageFileId) {
      return null;
    }
    return {
      fileId: record.imageFileId,
      departmentId: record.departmentId ? record.departmentId.toString() : null,
    };
  }

  return { getRequestTranscript, getRequestImage };
}

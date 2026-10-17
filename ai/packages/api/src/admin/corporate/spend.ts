import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type {
  IDepartment,
  IUser,
  ListSpendRequestsResult,
  RequestImageRef,
  RequestTranscript,
  SpendRequestCall,
  SpendRequestRow,
} from '@librechat/data-schemas';
import type {
  AdminSpendCall,
  AdminSpendRequest,
  AdminSpendTranscript,
} from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { CallerDepartment } from './departmentScope';
import { resolveDateRange, DATE_RANGE_ERROR } from './dateRange';
import { parseLimit, parseSkip } from './pagination';
import { resolveRequestDepartmentScope } from './departmentScope';
import { requestUserId } from './context';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const NO_DEPARTMENT_LABEL = 'Без отдела';
/**
 * Records written before `scenario` existed store `''` — indistinguishable from an
 * ordinary message, so that's what an empty value is treated as.
 */
const DEFAULT_SCENARIO = 'message';

export interface SpendQueryInput {
  from: Date;
  to: Date;
  userId?: string;
  departmentId?: string;
  model?: string;
  limit: number;
  skip: number;
}

/**
 * `findUsers` returns `.lean()` documents: plain objects with `_id` only, no
 * Mongoose `id` virtual — typing the dep this way turns a `.id` read into a
 * compile error instead of a silent `undefined`.
 */
type LeanUser = Omit<IUser, 'id'>;

export interface CorporateSpendDeps {
  listSpendRequests: (query: SpendQueryInput) => Promise<ListSpendRequestsResult>;
  getRequestTranscript: (messageId: string) => Promise<RequestTranscript | null>;
  getRequestImage: (messageId: string, fileId: string) => Promise<RequestImageRef | null>;
  sendImage: (req: ServerRequest, res: Response, fileId: string) => Promise<boolean>;
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<LeanUser[]>;
  listDepartments: () => Promise<IDepartment[]>;
  getUserPolicy: (userId: string) => Promise<CallerDepartment | null>;
}

async function buildUserNameMap(
  findUsers: CorporateSpendDeps['findUsers'],
  userIds: string[],
): Promise<Map<string, { name: string; email: string }>> {
  const uniqueIds = Array.from(new Set(userIds));
  if (uniqueIds.length === 0) {
    return new Map();
  }
  const users = await findUsers({ _id: { $in: uniqueIds } }, 'name email');
  return new Map(
    users.map((user) => [user._id.toString(), { name: user.name ?? '', email: user.email }]),
  );
}

function buildDepartmentNameMap(departments: IDepartment[]): Map<string, string> {
  return new Map(departments.map((department) => [department._id.toString(), department.name]));
}

function scenarioOf(call: SpendRequestCall): string {
  return call.scenario || DEFAULT_SCENARIO;
}

/**
 * The call the employee actually waited on. Title generation and tool round trips share
 * the request, but naming the row after `gemini-flash-lite` because it wrote the chat
 * title would misreport which model the person chose. Falls back to the costliest call
 * for requests that carry no `message` row at all, such as knowledge-base indexing.
 */
function primaryCall(calls: SpendRequestCall[]): SpendRequestCall | undefined {
  const main = calls.find((call) => scenarioOf(call) === DEFAULT_SCENARIO);
  if (main) {
    return main;
  }
  return calls.reduce<SpendRequestCall | undefined>(
    (best, call) => (best === undefined || call.costUsd > best.costUsd ? call : best),
    undefined,
  );
}

function toAdminSpendCall(call: SpendRequestCall): AdminSpendCall {
  return {
    model: call.model,
    scenario: scenarioOf(call),
    promptTokens: call.promptTokens,
    completionTokens: call.completionTokens,
    costUsd: call.costUsd,
    costSource: call.costSource,
    createdAt: call.createdAt?.toISOString() ?? new Date(0).toISOString(),
  };
}

function toAdminSpendRequest(
  row: SpendRequestRow,
  userInfo: { name: string; email: string } | undefined,
  departmentNames: Map<string, string>,
): AdminSpendRequest {
  const departmentId = row.departmentId ? row.departmentId.toString() : null;
  const calls = [...row.calls].sort(
    (left, right) => (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0),
  );
  const main = primaryCall(calls);
  return {
    id: row.requestKey,
    userId: row.userId.toString(),
    userName: userInfo?.name ?? '',
    userEmail: userInfo?.email ?? '',
    departmentId,
    departmentName: departmentId
      ? (departmentNames.get(departmentId) ?? null)
      : NO_DEPARTMENT_LABEL,
    model: main?.model ?? '',
    models: [...row.models].sort(),
    conversationId: row.conversationId,
    messageId: row.messageId,
    calls: calls.map(toAdminSpendCall),
    callCount: row.callCount,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    costUsd: row.costUsd,
    unknownCostCalls: row.unknownCostCalls,
    scenario: main ? scenarioOf(main) : DEFAULT_SCENARIO,
    createdAt: row.createdAt?.toISOString() ?? new Date(0).toISOString(),
  };
}

function toAdminSpendTranscript(transcript: RequestTranscript): AdminSpendTranscript {
  return {
    messageId: transcript.messageId,
    conversationId: transcript.conversationId,
    conversationTitle: transcript.conversationTitle,
    question: transcript.question,
    answer: transcript.answer,
    model: transcript.model,
    askedAt: transcript.askedAt?.toISOString(),
    answeredAt: transcript.answeredAt?.toISOString(),
    images: (transcript.images ?? []).map((image) => ({
      fileId: image.fileId,
      prompt: image.prompt,
      model: image.model,
      createdAt: image.createdAt?.toISOString(),
    })),
  };
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

export function createCorporateSpendHandlers(deps: CorporateSpendDeps): {
  listSpend: (req: ServerRequest, res: Response) => Promise<Response>;
  getTranscript: (req: ServerRequest, res: Response) => Promise<Response>;
  getImage: (req: ServerRequest, res: Response) => Promise<Response | void>;
} {
  async function listSpendHandler(req: ServerRequest, res: Response) {
    try {
      const scope = await resolveRequestDepartmentScope(
        deps,
        req.user?.role ?? '',
        requestUserId(req),
      );
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const range = resolveDateRange(req.query);
      if (!range) {
        return res.status(400).json({ error: DATE_RANGE_ERROR });
      }

      const userId = parseOptionalString(req.query.userId);
      let departmentId = parseOptionalString(req.query.departmentId);
      const model = parseOptionalString(req.query.model);

      if (userId !== undefined && !isValidObjectIdString(userId)) {
        return res.status(400).json({ error: 'Invalid userId format' });
      }
      if (departmentId !== undefined && !isValidObjectIdString(departmentId)) {
        return res.status(400).json({ error: 'Invalid departmentId format' });
      }

      /** Глава видит только свой отдел: параметр запроса не может его расширить. */
      if (scope.departmentId != null) {
        departmentId = scope.departmentId;
      }

      const { rows, total } = await deps.listSpendRequests({
        ...range,
        userId,
        departmentId,
        model,
        limit: parseLimit(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT),
        skip: parseSkip(req.query.skip),
      });

      const [nameMap, departments] = await Promise.all([
        buildUserNameMap(
          deps.findUsers,
          rows.map((row) => row.userId.toString()),
        ),
        deps.listDepartments(),
      ]);
      const departmentNames = buildDepartmentNameMap(departments);

      return res.status(200).json({
        rows: rows.map((row) =>
          toAdminSpendRequest(row, nameMap.get(row.userId.toString()), departmentNames),
        ),
        total,
      });
    } catch (error) {
      logger.error('[corporateSpend] listSpend error:', error);
      return res.status(500).json({ error: 'Failed to load spend journal' });
    }
  }

  async function getTranscriptHandler(req: ServerRequest, res: Response) {
    const { messageId } = req.params as { messageId: string };
    if (!messageId) {
      return res.status(400).json({ error: 'Message ID is required' });
    }
    try {
      const scope = await resolveRequestDepartmentScope(
        deps,
        req.user?.role ?? '',
        requestUserId(req),
      );
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const transcript = await deps.getRequestTranscript(messageId);

      /**
       * Расшифровка — самое чувствительное, что есть в системе: переписка сотрудника
       * с моделью. Для главы «сообщение не существует» и «существует, но в чужом
       * отделе» обязаны выглядеть одинаково — иначе сам код ответа (404 против
       * «пусто с 200») подсказывал бы, что где-то в другом отделе такое сообщение
       * есть. Для админ-уровневых ролей поведение не меняется.
       *
       * Сверяется отдел из того же снимка (`transcript.departmentId`), что фильтрует
       * список в `listSpendHandler`, а не текущая политика автора: сотрудник мог
       * сменить отдел уже после запроса, и тогда строка в журнале и её расшифровка
       * обязаны отвечать на один и тот же вопрос «чей был этот запрос», а не на два
       * разных — иначе видимая в журнале строка была бы недоступна по 404.
       */
      if (scope.departmentId != null) {
        if (!transcript || transcript.departmentId !== scope.departmentId) {
          return res.status(404).json({ error: 'Transcript not found' });
        }
        return res.status(200).json({ transcript: toAdminSpendTranscript(transcript) });
      }

      return res
        .status(200)
        .json({ transcript: transcript ? toAdminSpendTranscript(transcript) : null });
    } catch (error) {
      logger.error('[corporateSpend] getTranscript error:', error);
      return res.status(500).json({ error: 'Failed to load request transcript' });
    }
  }

  async function getImageHandler(req: ServerRequest, res: Response) {
    const { messageId, fileId } = req.params as { messageId: string; fileId: string };
    if (!messageId || !fileId) {
      return res.status(400).json({ error: 'Message ID and file ID are required' });
    }
    try {
      const scope = await resolveRequestDepartmentScope(
        deps,
        req.user?.role ?? '',
        requestUserId(req),
      );
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }
      const image = await deps.getRequestImage(messageId, fileId);
      if (!image || (scope.departmentId != null && image.departmentId !== scope.departmentId)) {
        return res.status(404).json({ error: 'Image not found' });
      }
      const sent = await deps.sendImage(req, res, image.fileId);
      if (!sent) {
        return res.status(404).json({ error: 'Image not found' });
      }
    } catch (error) {
      logger.error('[corporateSpend] getImage error:', error);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Failed to load image' });
      }
    }
  }

  return {
    listSpend: listSpendHandler,
    getTranscript: getTranscriptHandler,
    getImage: getImageHandler,
  };
}

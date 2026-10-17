const { tool } = require('@librechat/agents/langchain/tools');
const { Tools, SystemRoles } = require('librechat-data-provider');
const {
  resolvePolicy,
  toResolvePolicyDeps,
  resolveAllowedSpaces,
  getKnowledgeRagUrl,
  knowledgeSearch,
  knowledgeList,
  queryMultiple,
  querySingle,
  knowledgeAnchor,
  DocumentCitationIndex,
  generateShortLivedToken,
  guardToolArguments,
} = require('@librechat/api');
const db = require('~/models');

const knowledgeSearchJsonSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description:
        'Ключевые слова для поиска, а не целиком фраза пользователя (например: "отпуск дни регламент", а не "сколько дней отпуска мне положено").',
    },
  },
  required: ['query'],
};

/**
 * Свойство `reason` инструменту не нужно — оно нужно схеме. На схеме без единого
 * свойства Gemini присылает `args: ""` вместо `{}`: пустая строка не разбирается
 * как аргументы, вывод инструмента до модели не доходит, и ход заканчивается без
 * ответа сотруднику (проверено на google/gemini-3.5-flash и flash-lite; Claude на
 * той же схеме присылает корректный `{}`). Одно необязательное поле возвращает
 * схему к виду, который провайдеры заполняют одинаково.
 */
const knowledgeListJsonSchema = {
  type: 'object',
  properties: {
    reason: {
      type: 'string',
      description: 'Зачем понадобился список документов. Необязательно.',
    },
  },
};

/**
 * `IKnowledgeDocument` несёт `text` (полный текст документа под лексический
 * индекс) и `storagePath` (путь к оригиналу на диске) — оба поля внутренние
 * и не должны утечь в контекст модели. Адаптер собирает объект по ключам,
 * перечисляя только то, что действительно нужно модели и карточке источника.
 */
function toKnowledgeDocumentSource(doc, spaceName) {
  return {
    fileId: doc.file_id,
    documentId: doc._id.toString(),
    spaceId: doc.spaceId.toString(),
    spaceName,
    title: doc.title,
    description: doc.description ?? '',
    filename: doc.filename,
    version: doc.version,
    effectiveDate: doc.effectiveDate ? new Date(doc.effectiveDate).toISOString() : null,
    owner: doc.owner,
  };
}

/**
 * Кеширует результат первого вызова: список пространств и документов не
 * должен пересчитываться на каждый вызов инструмента в пределах одного
 * сообщения — права пользователя за это время не меняются.
 */
function memoizeAsync(fn) {
  let cached;
  return (...args) => {
    if (!cached) {
      cached = fn(...args);
    }
    return cached;
  };
}

/**
 * Собирает зависимости гибридного поиска и карты базы знаний из реального
 * стека: Mongo-методы (`~/models`), права (`resolvePolicy`) и HTTP-клиент
 * `rag_api`. Один вызов на запрос — общий для `knowledge_search` и
 * `knowledge_list`, чтобы оба инструмента видели один и тот же список
 * разрешённых пространств и документов.
 */
function buildKnowledgeDeps({ userId }) {
  const policyDeps = toResolvePolicyDeps(db);

  const resolveAllowedSpacesOnce = memoizeAsync(() =>
    resolveAllowedSpaces(
      {
        resolvePolicy: async (id) => {
          const [policy, user] = await Promise.all([
            resolvePolicy(policyDeps, id),
            db.findUser({ _id: id }, 'role'),
          ]);
          return {
            departmentId: policy.departmentId,
            blocked: policy.blocked,
            role: user?.role ?? SystemRoles.USER,
          };
        },
        listSpaces: () =>
          db.listSpaces().then((spaces) =>
            spaces.map((space) => ({
              id: space._id.toString(),
              name: space.name,
              allowedDepartments: (space.allowedDepartments ?? []).map((id) => id.toString()),
              enabled: space.enabled,
            })),
          ),
        getSpaceOverrides: (id) =>
          db.getUserPolicy(id).then((policy) => ({
            allowedSpaces: (policy?.allowedSpaces ?? []).map((id) => id.toString()),
            deniedSpaces: (policy?.deniedSpaces ?? []).map((id) => id.toString()),
          })),
      },
      userId,
    ),
  );

  const findActiveDocumentsOnce = memoizeAsync(async (spaceIds) => {
    const [docs, spaces] = await Promise.all([
      db.findActiveDocuments(spaceIds),
      resolveAllowedSpacesOnce(),
    ]);
    const spaceNameById = new Map(spaces.map((space) => [space.id, space.name]));
    return docs.map((doc) =>
      toKnowledgeDocumentSource(doc, spaceNameById.get(doc.spaceId.toString()) ?? ''),
    );
  });

  const jwtToken = generateShortLivedToken(userId);
  const baseUrl = getKnowledgeRagUrl();

  return {
    resolveAllowedSpaces: resolveAllowedSpacesOnce,
    findActiveDocuments: findActiveDocumentsOnce,
    lexicalSearch: (input) => db.lexicalSearch(input),
    denseSearch: (input) => queryMultiple({ baseUrl, token: jwtToken, ...input }),
    denseSearchOne: (input) => querySingle({ baseUrl, token: jwtToken, ...input }),
  };
}

function buildKnowledgeSearch({ userId, deps }) {
  const knowledgeDeps = deps ?? buildKnowledgeDeps({ userId });
  return (query) => knowledgeSearch(knowledgeDeps, { userId, query });
}

function buildKnowledgeList({ userId, deps }) {
  const knowledgeDeps = deps ?? buildKnowledgeDeps({ userId });
  return () => knowledgeList(knowledgeDeps, userId);
}

function formatEffectiveDate(effectiveDate) {
  return effectiveDate ? effectiveDate : 'не указана';
}

/**
 * @param {Object} options
 * @param {string} options.userId
 * @param {(query: string) => Promise<import('@librechat/api').KnowledgeSearchHit[]>} options.search
 */
const createKnowledgeSearchTool = async ({ userId: _userId, search }) => {
  /**
   * Живёт столько же, сколько инструмент, то есть один ответ сотруднику.
   * Модель вызывает поиск по несколько раз, выдачи пересекаются, и документ
   * обязан получить один и тот же номер во всех вызовах — иначе якорь из
   * второго вызова указал бы на документ из первого.
   */
  const citationIndex = new DocumentCitationIndex();

  const searchTool = tool(
    async ({ query }) => {
      const hits = await search(query);

      if (hits.length === 0) {
        return [
          'По вашему запросу нет доступных документов в базе знаний. Проверьте формулировку или используйте knowledge_list, чтобы увидеть, какие документы вообще доступны.',
          { [Tools.file_search]: { sources: [], fileCitations: true } },
        ];
      }

      /**
       * Версия, дата актуальности и пространство сюда намеренно не входят.
       * Снять требование называть их в тексте оказалось недостаточно: модель
       * охотно переписывает то, что стоит прямо перед ней в карточке
       * фрагмента (живой пример: «...Регламенту (версия 2.0)...» при том,
       * что инструкция это не требовала). Раз данные не нужны — их не
       * должно быть в поле зрения модели вообще; эти реквизиты уже есть в
       * артефакте `sources` и на их основе клиент строит блок «Источники».
       * Название документа остаётся: оно нужно, чтобы разделить
       * утверждения, когда ответ собран из нескольких документов.
       */
      const formattedString = hits
        .map((hit) => {
          const doc = hit.document;
          return (
            `Документ: ${doc.title}\n` +
            `Якорь: ${knowledgeAnchor(citationIndex.indexFor(hit.fileId))}\n` +
            `Релевантность: ${hit.relevance.toFixed(4)}\n` +
            `Содержание: ${hit.content}`
          );
        })
        .join('\n---\n');

      /**
       * Без этого явного указания слабые модели (проверено на Claude Haiku 4.5)
       * иногда воспринимают вызов инструмента как выполненную задачу и отвечают
       * сотруднику отпиской вроде «Я нашёл нужную информацию», не пересказывая
       * найденное. Инструкция стоит рядом с самим содержанием, а не только в
       * описании инструмента — так она гарантированно попадает в контекст
       * именно тогда, когда модель формирует ответ.
       */
      const answerInstruction =
        'Ответь сотруднику по существу найденного выше: перескажи содержание и приведи ' +
        'конкретные факты и цифры из фрагментов, называя документ, откуда они взяты, а не только ' +
        'сообщи, что поиск выполнен.';

      const responseText = `${formattedString}\n\n${answerInstruction}`;

      const sources = hits.map((hit) => ({
        type: 'file',
        citationIndex: citationIndex.indexFor(hit.fileId),
        fileId: hit.fileId,
        fileName: hit.document.filename,
        content: hit.content,
        relevance: hit.relevance,
        pages: hit.page != null ? [hit.page] : [],
        docTitle: hit.document.title,
        spaceName: hit.document.spaceName,
        version: hit.document.version,
        effectiveDate: hit.document.effectiveDate,
        owner: hit.document.owner,
      }));

      return [responseText, { [Tools.file_search]: { sources, fileCitations: true } }];
    },
    {
      name: Tools.knowledge_search,
      responseFormat: 'content_and_artifact',
      description:
        'Поиск по внутренней базе знаний компании: регламенты, положения, приказы, структура ' +
        'компании, зоны ответственности, должностные инструкции, стандарты оформления документов, ' +
        'контакты. Вызывай при любом вопросе о внутренних правилах и порядках компании — не отвечай ' +
        'по памяти. Запрос формулируй ключевыми словами, а не целиком фразой пользователя. ' +
        'Результат — не готовый ответ: перескажи найденное содержание сотруднику своими словами, ' +
        'с фактами и цифрами, называя документ в тексте (без версии и места хранения — это ' +
        'показывается отдельно в источниках).\n\n' +
        '**Цитирование:** якоря `\\ue202turn0fileN` ставь сразу после фактов из документа, назвав ' +
        'документ перед якорем.',
      schema: knowledgeSearchJsonSchema,
    },
  );

  return guardToolArguments(searchTool, ['query']);
};

/**
 * @param {Object} options
 * @param {string} options.userId
 * @param {() => Promise<import('@librechat/api').KnowledgeListResult>} options.list
 */
const createKnowledgeListTool = async ({ userId: _userId, list }) => {
  const listTool = tool(
    async () => {
      const result = await list();

      if (result.mode === 'documents') {
        if (result.documents.length === 0) {
          return 'В базе знаний нет ни одного документа, доступного вам.';
        }
        const lines = result.documents.map(
          (doc) =>
            `- ${doc.title} (пространство: ${doc.spaceName}, версия: ${doc.version || 'не указана'}, ` +
            `дата актуальности: ${formatEffectiveDate(doc.effectiveDate)})`,
        );
        return `Доступные вам документы базы знаний:\n${lines.join('\n')}`;
      }

      const lines = result.spaces.map((space) => `- ${space.name}: ${space.count} документ(ов)`);
      return (
        `Документов слишком много для полного списка. Доступные вам пространства:\n${lines.join('\n')}\n` +
        'Уточните запрос через knowledge_search.'
      );
    },
    {
      name: Tools.knowledge_list,
      responseFormat: 'content',
      description:
        'Список документов, доступных сотруднику в базе знаний. Вызывай, когда поиск ничего не ' +
        'нашёл — чтобы честно сказать, чего в базе нет, — или когда спрашивают, какие документы ' +
        'вообще есть.',
      schema: knowledgeListJsonSchema,
    },
  );

  return guardToolArguments(listTool);
};

module.exports = {
  createKnowledgeSearchTool,
  createKnowledgeListTool,
  buildKnowledgeDeps,
  buildKnowledgeSearch,
  buildKnowledgeList,
  toKnowledgeDocumentSource,
  knowledgeSearchJsonSchema,
  knowledgeListJsonSchema,
};

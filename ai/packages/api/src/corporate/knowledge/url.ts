/**
 * У базы знаний и у разбора обычных вложений чата исторически один адрес rag_api.
 * Собственная переменная позволяет развести их, не трогая поведение чата: пока она
 * не задана, всё работает по-прежнему.
 */
export function getKnowledgeRagUrl(): string {
  const dedicated = process.env.KNOWLEDGE_RAG_API_URL?.trim();
  if (dedicated) {
    return dedicated;
  }
  return process.env.RAG_API_URL?.trim() ?? '';
}

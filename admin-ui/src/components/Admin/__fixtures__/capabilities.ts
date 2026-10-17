/**
 * Общие наборы capability для тестов представления главы отдела в админке.
 * Значения — точная копия серверного сидинга ролей в `ai/`:
 * `HEAD` не получает `read:insights` (сводки активности не фильтруются по отделу) и не
 * получает `manage:configs` (отделы, отзывы — админский слой).
 */
export const HEAD_CAPABILITIES: string[] = [
  'access:admin',
  'read:users',
  'read:usage',
  'manage:knowledge_documents',
  'manage:department_members',
  'manage:limit_requests',
];

export const ALL_CAPABILITIES: string[] = [
  'access:admin',
  'read:users',
  'read:usage',
  'read:insights',
  'manage:users',
  'manage:configs',
  'manage:limit_requests',
  'manage:prompts',
  'manage:knowledge_documents',
  'manage:department_members',
];

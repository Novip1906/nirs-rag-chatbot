export const MIN_PARAGRAPH_LENGTH = 400;

/**
 * `rag_api` режет текст рекурсивным сплиттером: сначала по пустым строкам, и только
 * потом по размеру. Презентационные PDF после извлечения состоят из коротких строк,
 * разделённых пустыми, поэтому каждая строка становится отдельным фрагментом и
 * `CHUNK_SIZE` в 1500 символов ни на что не влияет.
 *
 * Измерено на проде: два файла лекций дали 115 фрагментов из 143 во всём индексе,
 * средней длиной 85 и 124 символа, 72 из них короче ста. Вектор такого обрывка
 * примерно одинаково непохож на любой запрос, поэтому все они садятся в узкую полосу
 * около 0.40, где релевантное от нерелевантного уже не отличить, и всплывают в
 * ответе на любой вопрос.
 *
 * Склейка идёт до `MIN_PARAGRAPH_LENGTH`, а не до `CHUNK_SIZE`: задача не набить
 * фрагмент под завязку, а не дать сплиттеру разорвать текст там, где смысла нет.
 * Пустая строка завершает абзац только когда накоплено достаточно — иначе она
 * такой же артефакт извлечения, как и перенос внутри предложения.
 */
export function normalizeForIndexing(text: string): string {
  const paragraphs: string[] = [];
  let current = '';

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      paragraphs.push(trimmed);
    }
    current = '';
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/[ \t   ]+/g, ' ').trim();
    if (line.length === 0) {
      if (current.trim().length >= MIN_PARAGRAPH_LENGTH) {
        flush();
      }
      continue;
    }
    current = current.length === 0 ? line : `${current} ${line}`;
  }
  flush();

  return paragraphs.join('\n\n');
}

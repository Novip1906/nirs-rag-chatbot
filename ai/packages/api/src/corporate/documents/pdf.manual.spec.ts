/**
 * `jest.config.mjs` исключает `*.manual.spec.ts` из обычного прогона
 * (`testPathIgnorePatterns`), поэтому тот же паттерн нужно временно снять,
 * чтобы явно запустить этот файл:
 *
 *   NODE_OPTIONS=--experimental-vm-modules npx jest \
 *     src/corporate/documents/pdf.manual.spec.ts --testPathIgnorePatterns="/node_modules/|/dist/"
 *
 * `pdfjs-dist` поставляется только как ESM (нет CJS-сборки), а обычный
 * `npx jest` в этом workspace грузит зависимости через CommonJS-обёртку —
 * без флага она падает на `import.meta` внутри `pdf.mjs`. Вся ветвящаяся
 * логика (`inspectPdfSize`) покрыта в `pdf.spec.ts` через внедряемый
 * `countPages` и в этом флаге не нуждается; здесь проверяется только
 * реальный разбор PDF через `countPdfPages`.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { countPdfPages } from './pdf';

/** Минимальный валидный PDF на две страницы — без внешних файлов в репозитории. */
const TWO_PAGE_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>`;

let pdfPath: string;

beforeAll(async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-size-'));
  pdfPath = path.join(dir, 'two-pages.pdf');
  await fs.promises.writeFile(pdfPath, TWO_PAGE_PDF, 'latin1');
});

describe('countPdfPages', () => {
  it('считает страницы документа', async () => {
    expect(await countPdfPages(pdfPath)).toBe(2);
  });

  /** Битый PDF не должен ронять загрузку — файл просто уйдёт без проверки объёма. */
  it('возвращает ноль для нечитаемого файла', async () => {
    expect(await countPdfPages('/nope/missing.pdf')).toBe(0);
  });
});

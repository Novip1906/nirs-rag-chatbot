import os from 'os';
import path from 'path';
import * as fs from 'fs';
import JSZip from 'jszip';
import { extractPptxText } from './pptx';
import { parseDocument } from './crud';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const NAMESPACES =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEAVY_BYTES = 400 * 1024;
const LINEAR_BUDGET_MS = 1000;

function slideXml(paragraphs: string[], rootAttributes = ''): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NAMESPACES}${rootAttributes}>` +
    `<p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/>${paragraphs.join('')}</p:txBody></p:sp>` +
    '</p:spTree></p:cSld></p:sld>'
  );
}

function paragraph(...runs: string[]): string {
  const body = runs.map((run) => `<a:r><a:rPr lang="ru-RU"/><a:t>${run}</a:t></a:r>`).join('');
  return `<a:p><a:pPr lvl="0"/>${body}</a:p>`;
}

function notesXml(text: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><p:notes ${NAMESPACES}><p:cSld><p:spTree>` +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr/>' +
    '<p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr/>' +
    '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
    `<p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>` +
    '<p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number"/><p:cNvSpPr/>' +
    '<p:nvPr><p:ph type="sldNum" idx="5"/></p:nvPr></p:nvSpPr>' +
    '<p:txBody><a:bodyPr/><a:p><a:fld id="{1}" type="slidenum"><a:t>1</a:t></a:fld></a:p>' +
    '</p:txBody></p:sp></p:spTree></p:cSld></p:notes>'
  );
}

function slideRels(notesTarget: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${RELATIONSHIPS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
    `<Relationship Id="rId2" Type="${RELATIONSHIPS}/notesSlide" Target="${notesTarget}"/>` +
    '</Relationships>'
  );
}

function presentationXml(relationshipIds: string[]): string {
  const slideIds = relationshipIds
    .map((id, index) => `<p:sldId id="${256 + index}" r:id="${id}"/>`)
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NAMESPACES} xmlns:r="${RELATIONSHIPS}">` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    `<p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
  );
}

function presentationRels(targets: Record<string, string>): string {
  const slides = Object.entries(targets)
    .map(
      ([id, target]) =>
        `<Relationship Id="${id}" Type="${RELATIONSHIPS}/slide" Target="${target}"/>`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${RELATIONSHIPS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
    `${slides}</Relationships>`
  );
}

function heavy(unit: string): string {
  return unit.repeat(Math.ceil(HEAVY_BYTES / unit.length));
}

async function buildDeck(parts: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  Object.entries(parts).forEach(([name, content]) => zip.file(name, content));
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('extractPptxText', () => {
  it('собирает текст слайда по абзацам и добавляет заметки докладчика', async () => {
    const deck = await buildDeck({
      'ppt/slides/slide1.xml': slideXml([
        paragraph('Квартальный ', 'отчёт'),
        '<a:p><a:r><a:t>Выручка &amp; расходы</a:t></a:r><a:br><a:rPr lang="ru-RU"/></a:br>' +
          '<a:r><a:t>вторая строка &#1071;&#x44F;</a:t></a:r></a:p>',
        '<a:p><a:endParaRPr lang="ru-RU"/></a:p>',
      ]),
      'ppt/slides/_rels/slide1.xml.rels': slideRels('../notesSlides/notesSlide3.xml'),
      'ppt/notesSlides/notesSlide3.xml': notesXml('Напомнить про сроки'),
    });

    await expect(extractPptxText(deck, 'deck.pptx')).resolves.toBe(
      'Слайд 1\nКвартальный отчёт\nВыручка & расходы\nвторая строка Яя\nЗаметки: Напомнить про сроки',
    );
  });

  it('идёт по слайдам в числовом порядке, а не по алфавиту', async () => {
    const parts: Record<string, string> = {};
    for (let n = 1; n <= 10; n++) {
      parts[`ppt/slides/slide${n}.xml`] = slideXml([paragraph(`Текст слайда ${n}`)]);
    }

    const text = await extractPptxText(await buildDeck(parts), 'deck.pptx');

    expect(text.indexOf('Текст слайда 2')).toBeLessThan(text.indexOf('Текст слайда 10'));
    expect(text).toContain('Слайд 10\nТекст слайда 10');
  });

  it('пропускает слайд без текста и заметок, не сдвигая номера остальных', async () => {
    const deck = await buildDeck({
      'ppt/slides/slide1.xml': slideXml([paragraph('Первый')]),
      'ppt/slides/slide2.xml': slideXml([]),
      'ppt/slides/slide3.xml': slideXml([paragraph('Третий')]),
    });

    await expect(extractPptxText(deck, 'deck.pptx')).resolves.toBe(
      'Слайд 1\nПервый\n\nСлайд 3\nТретий',
    );
  });

  it('идёт по слайдам в порядке показа из презентации, а не по номерам файлов', async () => {
    const deck = await buildDeck({
      'ppt/presentation.xml': presentationXml(['rId4', 'rId2', 'rId3']),
      'ppt/_rels/presentation.xml.rels': presentationRels({
        rId2: 'slides/slide1.xml',
        rId3: '/ppt/slides/slide2.xml',
        rId4: 'slides/slide3.xml',
      }),
      'ppt/slides/slide1.xml': slideXml([paragraph('Файл один')]),
      'ppt/slides/slide2.xml': slideXml([paragraph('Файл два')]),
      'ppt/slides/slide3.xml': slideXml([paragraph('Файл три')]),
    });

    await expect(extractPptxText(deck, 'deck.pptx')).resolves.toBe(
      'Слайд 1\nФайл три\n\nСлайд 2\nФайл один\n\nСлайд 3\nФайл два',
    );
  });

  it('пропускает скрытые слайды и не считает их при нумерации', async () => {
    const deck = await buildDeck({
      'ppt/presentation.xml': presentationXml(['rId3', 'rId2', 'rId4']),
      'ppt/_rels/presentation.xml.rels': presentationRels({
        rId2: 'slides/slide1.xml',
        rId3: 'slides/slide2.xml',
        rId4: 'slides/slide3.xml',
      }),
      'ppt/slides/slide1.xml': slideXml([paragraph('Скрытый')], ' show="0"'),
      'ppt/slides/slide2.xml': slideXml([paragraph('Открытый')]),
      'ppt/slides/slide3.xml': slideXml([paragraph('Последний')]),
    });

    await expect(extractPptxText(deck, 'deck.pptx')).resolves.toBe(
      'Слайд 1\nОткрытый\n\nСлайд 2\nПоследний',
    );
  });

  it('пропускает скрытый слайд и в презентации без списка слайдов', async () => {
    const deck = await buildDeck({
      'ppt/slides/slide1.xml': slideXml([paragraph('Скрытый')], ' show="0"'),
      'ppt/slides/slide2.xml': slideXml([paragraph('Открытый')]),
    });

    await expect(extractPptxText(deck, 'deck.pptx')).resolves.toBe('Слайд 1\nОткрытый');
  });

  it('берёт слайд, указанный в списке дважды, один раз', async () => {
    const deck = await buildDeck({
      'ppt/presentation.xml': presentationXml(['rId2', 'rId2', 'rId3']),
      'ppt/_rels/presentation.xml.rels': presentationRels({
        rId2: 'slides/slide1.xml',
        rId3: 'slides/slide2.xml',
      }),
      'ppt/slides/slide1.xml': slideXml([paragraph('Первый')]),
      'ppt/slides/slide2.xml': slideXml([paragraph('Второй')]),
    });

    await expect(extractPptxText(deck, 'deck.pptx')).resolves.toBe(
      'Слайд 1\nПервый\n\nСлайд 2\nВторой',
    );
  });

  it('отдаёт пустую строку, если в презентации одни картинки', async () => {
    const deck = await buildDeck({ 'ppt/slides/slide1.xml': slideXml([]) });

    await expect(extractPptxText(deck, 'deck.pptx')).resolves.toBe('');
  });

  it('отклоняет zip-бомбу до разбора', async () => {
    const deck = await buildDeck({ 'ppt/slides/slide1.xml': 'x'.repeat(26 * 1024 * 1024) });

    await expect(extractPptxText(deck, 'bomb.pptx')).rejects.toThrow(
      /per-entry decompressed cap/,
    );
  });

  it.each([
    ['незакрытые абзацы', { 'ppt/slides/slide1.xml': heavy('<a:p>') }],
    ['незакрытые куски текста', { 'ppt/slides/slide1.xml': `<a:p>${heavy('<a:t>')}</a:p>` }],
    ['незакрытые фигуры в заметках', { 'ppt/notesSlides/notesSlide1.xml': heavy('<p:sp>') }],
    [
      'заполнитель заметок без конца тега',
      { 'ppt/notesSlides/notesSlide1.xml': `<p:sp>${heavy('<p:ph ')}</p:sp>` },
    ],
    [
      'связи слайда без конца тега',
      { 'ppt/slides/_rels/slide1.xml.rels': heavy('<Relationship ') },
    ],
    [
      'список слайдов без конца тега',
      { 'ppt/presentation.xml': `<p:sldIdLst>${heavy('<p:sldId ')}</p:sldIdLst>` },
    ],
  ])('разбирает %s за линейное время', async (_case, parts) => {
    const deck = await buildDeck({
      'ppt/slides/slide1.xml': slideXml([paragraph('Текст')]),
      'ppt/slides/_rels/slide1.xml.rels': slideRels('../notesSlides/notesSlide1.xml'),
      'ppt/notesSlides/notesSlide1.xml': notesXml('Заметка'),
      ...parts,
    });

    const started = Date.now();
    await extractPptxText(deck, 'deck.pptx');

    expect(Date.now() - started).toBeLessThan(LINEAR_BUDGET_MS);
  });
});

describe('parseDocument для PPTX', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pptx-'));
  });

  afterAll(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('разбирает презентацию встроенным разборщиком', async () => {
    const filePath = path.join(tempDir, 'deck.pptx');
    await fs.promises.writeFile(
      filePath,
      await buildDeck({ 'ppt/slides/slide1.xml': slideXml([paragraph('Итоги года')]) }),
    );
    const file = { originalname: 'deck.pptx', path: filePath, mimetype: PPTX_MIME } as Express.Multer.File;

    const document = await parseDocument({ file });

    expect(document.filepath).toBe('document_parser');
    expect(document.text).toBe('Слайд 1\nИтоги года');
  });

  it('сообщает об отсутствии текста в презентации из картинок', async () => {
    const filePath = path.join(tempDir, 'pictures.pptx');
    await fs.promises.writeFile(filePath, await buildDeck({ 'ppt/slides/slide1.xml': slideXml([]) }));
    const file = {
      originalname: 'pictures.pptx',
      path: filePath,
      mimetype: PPTX_MIME,
    } as Express.Multer.File;

    await expect(parseDocument({ file })).rejects.toThrow('No text found in document');
  });
});

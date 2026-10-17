import JSZip from 'jszip';
import { renderPptx } from './slides';

async function slideXml(buffer: Buffer, entry: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(entry);
  if (!file) {
    throw new Error(`В презентации нет ${entry}`);
  }
  return file.async('string');
}

describe('renderPptx', () => {
  it('собирает презентацию 16:9 с титулом, пунктами, таблицей и заметками', async () => {
    const buffer = await renderPptx(
      [
        {
          title: 'Итоги квартала',
          bullets: ['Выручка выросла', 'Расходы снизились'],
          notes: 'Сказать про сезонность',
        },
        {
          title: 'Цифры',
          table: {
            columns: ['Показатель', 'Значение'],
            rows: [
              ['Выручка', 1234.5],
              ['Расходы', null],
            ],
          },
        },
      ],
      'Отчёт для руководителя',
    );
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    expect(await slideXml(buffer, 'ppt/presentation.xml')).toContain(
      '<p:sldSz cx="9144000" cy="5143500"',
    );
    expect(await slideXml(buffer, 'ppt/slides/slide1.xml')).toContain('Отчёт для руководителя');
    const bullets = await slideXml(buffer, 'ppt/slides/slide2.xml');
    expect(bullets).toContain('Итоги квартала');
    expect(bullets).toContain('Выручка выросла');
    expect(bullets).toContain('typeface="Arial"');
    const table = await slideXml(buffer, 'ppt/slides/slide3.xml');
    expect(table).toContain('Показатель');
    expect(table).toContain('1234,5');
    expect(await slideXml(buffer, 'ppt/notesSlides/notesSlide2.xml')).toContain(
      'Сказать про сезонность',
    );
  });

  it('обходится без титульного слайда, если заголовок не задан', async () => {
    const buffer = await renderPptx([{ title: 'Единственный слайд', bullets: ['Пункт'] }]);
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file('ppt/slides/slide2.xml')).toBeNull();
    expect(await slideXml(buffer, 'ppt/slides/slide1.xml')).toContain('Единственный слайд');
  });
});

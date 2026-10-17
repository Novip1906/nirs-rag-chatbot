import { ImageToolError, parseGenerateImageArgs } from './validate';
import { MAX_IMAGE_PROMPT_CHARS, MAX_INPUT_IMAGES } from './definition';

describe('parseGenerateImageArgs', () => {
  it('берёт описание, формат и исходные картинки', () => {
    expect(
      parseGenerateImageArgs({
        prompt: '  Кот на подоконнике  ',
        aspect_ratio: '16:9',
        image_ids: ['a', 'b', 'a', ''],
      }),
    ).toEqual({ prompt: 'Кот на подоконнике', aspectRatio: '16:9', imageIds: ['a', 'b'] });
  });

  it('по умолчанию рисует квадрат без исходных картинок', () => {
    expect(parseGenerateImageArgs({ prompt: 'Кот' })).toEqual({
      prompt: 'Кот',
      aspectRatio: '1:1',
      imageIds: [],
    });
  });

  it('отклоняет пустое описание', () => {
    expect(() => parseGenerateImageArgs({ prompt: '   ' })).toThrow(ImageToolError);
  });

  it('отклоняет слишком длинное описание', () => {
    expect(() =>
      parseGenerateImageArgs({ prompt: 'а'.repeat(MAX_IMAGE_PROMPT_CHARS + 1) }),
    ).toThrow(`длиннее ${MAX_IMAGE_PROMPT_CHARS}`);
  });

  it('отклоняет неизвестный формат', () => {
    expect(() => parseGenerateImageArgs({ prompt: 'Кот', aspect_ratio: '5:1' })).toThrow(
      'Неизвестный формат',
    );
  });

  it('не берёт больше допустимого числа исходных картинок', () => {
    const ids = Array.from({ length: MAX_INPUT_IMAGES + 1 }, (_, index) => `id-${index}`);
    expect(() => parseGenerateImageArgs({ prompt: 'Кот', image_ids: ids })).toThrow(
      `не больше ${MAX_INPUT_IMAGES}`,
    );
  });
});

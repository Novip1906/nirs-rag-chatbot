import type { ExtendedJsonSchema } from '~/tools/registry/schema';

export const IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const;

export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

export const DEFAULT_IMAGE_ASPECT_RATIO: ImageAspectRatio = '1:1';

export const MAX_IMAGE_PROMPT_CHARS = 4000;

export const MAX_INPUT_IMAGES = 4;

export const IMAGE_USAGE_SCENARIO = 'image_gen' as const;

export const GENERATE_IMAGE_DESCRIPTION: string =
  'Рисует картинку по описанию или меняет присланные картинки. Вызывай, только когда сотрудник ' +
  'прямо просит нарисовать, сгенерировать или изменить картинку, иллюстрацию, баннер, логотип или ' +
  'фото; сам картинку не предлагай. Перед генерацией сотрудник подтвердит её кнопкой и выберет ' +
  'формат, поэтому не спрашивай разрешения в тексте и не пересказывай prompt. prompt пиши подробно: ' +
  'что изображено, стиль, композиция, цвета; текст, который должен быть на картинке, приводи ' +
  'дословно в кавычках. Чтобы изменить картинку, передай её идентификатор в image_ids. Один вызов — ' +
  'одна картинка. Если сотрудник отменил генерацию, не вызывай инструмент снова без новой просьбы.';

export const generateImageSchema: ExtendedJsonSchema = {
  type: 'object',
  properties: {
    prompt: {
      type: 'string',
      description: `Описание картинки, до ${MAX_IMAGE_PROMPT_CHARS} символов.`,
    },
    aspect_ratio: {
      type: 'string',
      enum: [...IMAGE_ASPECT_RATIOS],
      description:
        'Формат: 1:1 — квадрат, 16:9 — горизонтальный (слайд, баннер), 9:16 — вертикальный ' +
        '(сторис), 4:3, 3:4, 3:2, 2:3. Выбирай по просьбе сотрудника, по умолчанию 1:1.',
    },
    image_ids: {
      type: 'array',
      items: { type: 'string' },
      maxItems: MAX_INPUT_IMAGES,
      description:
        'Идентификаторы исходных картинок для правки: присланных сотрудником или сгенерированных ' +
        `раньше в этой беседе. Не больше ${MAX_INPUT_IMAGES}. Для новой картинки не передавай.`,
    },
  },
  required: ['prompt'],
};

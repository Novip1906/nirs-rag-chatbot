import type { ImageAspectRatio } from './definition';
import {
  MAX_INPUT_IMAGES,
  IMAGE_ASPECT_RATIOS,
  MAX_IMAGE_PROMPT_CHARS,
  DEFAULT_IMAGE_ASPECT_RATIO,
} from './definition';

export interface ImageCharge {
  costUsd: number | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export class ImageToolError extends Error {
  readonly charge?: ImageCharge;

  constructor(message: string, charge?: ImageCharge) {
    super(message);
    this.name = 'ImageToolError';
    this.charge = charge;
  }
}

export interface GenerateImageArgs {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  imageIds: string[];
}

const ASPECT_RATIOS: ReadonlySet<string> = new Set(IMAGE_ASPECT_RATIOS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePrompt(raw: unknown): string {
  const prompt = typeof raw === 'string' ? raw.trim() : '';
  if (prompt === '') {
    throw new ImageToolError('Не передано описание картинки (prompt).');
  }
  if (prompt.length > MAX_IMAGE_PROMPT_CHARS) {
    throw new ImageToolError(
      `Описание картинки длиннее ${MAX_IMAGE_PROMPT_CHARS} символов — сократи его.`,
    );
  }
  return prompt;
}

function parseAspectRatio(raw: unknown): ImageAspectRatio {
  if (raw == null || raw === '') {
    return DEFAULT_IMAGE_ASPECT_RATIO;
  }
  if (typeof raw === 'string' && ASPECT_RATIOS.has(raw)) {
    return raw as ImageAspectRatio;
  }
  throw new ImageToolError(
    `Неизвестный формат картинки «${String(raw)}». Допустимо: ${IMAGE_ASPECT_RATIOS.join(', ')}.`,
  );
}

function parseImageIds(raw: unknown): string[] {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new ImageToolError('image_ids должен быть списком идентификаторов.');
  }
  const ids = Array.from(
    new Set(raw.filter((id): id is string => typeof id === 'string' && id.trim() !== '')),
  ).map((id) => id.trim());
  if (ids.length > MAX_INPUT_IMAGES) {
    throw new ImageToolError(`Исходных картинок можно передать не больше ${MAX_INPUT_IMAGES}.`);
  }
  return ids;
}

export function parseGenerateImageArgs(input: unknown): GenerateImageArgs {
  if (!isRecord(input)) {
    throw new ImageToolError('Аргументы инструмента должны быть объектом.');
  }
  return {
    prompt: parsePrompt(input.prompt),
    aspectRatio: parseAspectRatio(input.aspect_ratio),
    imageIds: parseImageIds(input.image_ids),
  };
}

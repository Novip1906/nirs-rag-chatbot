import axios from 'axios';
import { logger } from '@librechat/data-schemas';
import { extractEnvVariable } from 'librechat-data-provider';
import type { TImageGenerationConfig } from 'librechat-data-provider';
import type { AxiosRequestConfig } from 'axios';
import type { ImageAspectRatio } from './definition';
import { applySSRFSafeAgentIfDirect } from '~/auth/agent';
import { applyAxiosProxyConfig } from '~/utils/proxy';
import { resolveConfigSecret } from '~/admin/secrets';
import { extractCostUsd } from '~/agents/costCapture';
import { getSafeErrorMetadata } from '~/utils/errors';
import { AI_PROVIDERS } from '~/corporate/provider';
import type { ImageCharge } from './validate';
import { ImageToolError } from './validate';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export const DEFAULT_IMAGE_TIMEOUT_MS: number = 180_000;

export const IMAGE_REFUSED_MESSAGE: string =
  'Провайдер отказался рисовать эту картинку по своим правилам модерации. Объясни сотруднику, ' +
  'что запрос отклонён правилами сервиса генерации, и предложи переформулировать его.';

export const IMAGE_FAILED_MESSAGE: string =
  'Сервис генерации картинок сейчас не ответил. Скажи сотруднику, что картинку сделать не ' +
  'удалось, и предложи попробовать ещё раз позже. Сам повторно не вызывай.';

export const IMAGE_TIMEOUT_MESSAGE: string =
  'Сервис генерации картинок не успел ответить. Скажи сотруднику, что картинку сделать не ' +
  'удалось, и предложи попробовать ещё раз. Сам повторно не вызывай.';

export interface GenerateImageInput {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  inputImages: string[];
  config: TImageGenerationConfig;
  signal?: AbortSignal;
  allowedAddresses?: string[] | null;
}

export interface GeneratedImage extends ImageCharge {
  base64: string;
  mediaType: string;
}

interface ImagesRequest {
  model: string;
  prompt: string;
  n: 1;
  aspect_ratio: ImageAspectRatio;
  resolution?: string;
  quality?: string;
  output_format?: string;
  input_references?: Array<{ type: 'image_url'; image_url: { url: string } }>;
}

interface ImagesResponse {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
}

interface ProviderErrorBody {
  error?: { message?: string; code?: number | string };
}

const MODERATION_PATTERN = /moderat|safety|flagged|policy|content_filter|prohibited|violat/i;

function resolveBaseUrl(configured: string | undefined): string {
  const resolved = configured ? extractEnvVariable(configured) : '';
  return (resolved || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function buildRequest(input: GenerateImageInput): ImagesRequest {
  const { config } = input;
  const request: ImagesRequest = {
    model: config.model,
    prompt: input.prompt,
    n: 1,
    aspect_ratio: input.aspectRatio,
  };
  if (config.resolution) {
    request.resolution = config.resolution;
  }
  if (config.quality) {
    request.quality = config.quality;
  }
  if (config.outputFormat) {
    request.output_format = config.outputFormat;
  }
  if (input.inputImages.length > 0) {
    request.input_references = input.inputImages.map((url) => ({
      type: 'image_url',
      image_url: { url },
    }));
  }
  return request;
}

function buildOptions(url: string, input: GenerateImageInput): AxiosRequestConfig {
  const timeout = AbortSignal.timeout(input.config.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS);
  const options: AxiosRequestConfig = {
    headers: { Authorization: `Bearer ${resolveConfigSecret(input.config.apiKey) ?? ''}` },
    signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  };
  applyAxiosProxyConfig(options, url);
  try {
    return applySSRFSafeAgentIfDirect(options, url, input.allowedAddresses);
  } catch (error) {
    logger.error('[image] Адрес генерации отклонён защитой от SSRF', getSafeErrorMetadata(error));
    throw new ImageToolError(IMAGE_FAILED_MESSAGE);
  }
}

function providerMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return '';
  }
  const body = error.response?.data as ProviderErrorBody | undefined;
  return typeof body?.error?.message === 'string' ? body.error.message : '';
}

export function classifyImageError(error: unknown): ImageToolError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const message = providerMessage(error);
    if (status === 403 || (status != null && status < 500 && MODERATION_PATTERN.test(message))) {
      return new ImageToolError(IMAGE_REFUSED_MESSAGE);
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ERR_CANCELED' || status === 408) {
      return new ImageToolError(IMAGE_TIMEOUT_MESSAGE);
    }
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new ImageToolError(IMAGE_TIMEOUT_MESSAGE);
  }
  return new ImageToolError(IMAGE_FAILED_MESSAGE);
}

function mediaTypeOf(item: { media_type?: string }, config: TImageGenerationConfig): string {
  if (typeof item.media_type === 'string' && item.media_type.startsWith('image/')) {
    return item.media_type;
  }
  return `image/${config.outputFormat ?? 'png'}`;
}

export async function generateImage(input: GenerateImageInput): Promise<GeneratedImage> {
  const url = `${resolveBaseUrl(input.config.baseURL)}/images`;
  const options = buildOptions(url, input);

  let data: ImagesResponse;
  try {
    const response = await axios.post<ImagesResponse>(url, buildRequest(input), options);
    data = response.data;
  } catch (error) {
    logger.error('[image] Запрос генерации не прошёл', {
      ...getSafeErrorMetadata(error),
      providerMessage: providerMessage(error),
    });
    throw classifyImageError(error);
  }

  const charge: ImageCharge = {
    costUsd: extractCostUsd(data?.usage, AI_PROVIDERS.openrouter) ?? null,
    model: input.config.model,
    promptTokens: data?.usage?.prompt_tokens ?? 0,
    completionTokens: data?.usage?.completion_tokens ?? 0,
  };
  const item = data?.data?.find((entry) => typeof entry?.b64_json === 'string' && entry.b64_json);
  if (!item?.b64_json) {
    logger.error('[image] В ответе генерации нет картинки');
    throw new ImageToolError(IMAGE_REFUSED_MESSAGE, charge);
  }

  return { ...charge, base64: item.b64_json, mediaType: mediaTypeOf(item, input.config) };
}

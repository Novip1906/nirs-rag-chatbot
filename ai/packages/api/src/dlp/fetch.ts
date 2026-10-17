import { logger } from '@librechat/data-schemas';
import type { TDlpConfig } from 'librechat-data-provider';
import type { DlpCategory, DlpDetectOptions } from './types';
import type { DlpAudit } from './audit';
import { unmaskText, MarkerStreamDecoder } from './unmask';
import { collectPayloadTexts } from './payload';
import { MarkerTable } from './markers';
import { maskText } from './mask';

export interface DlpFetchContext {
  readonly config: TDlpConfig;
  readonly userId: string;
  readonly userName: string;
  readonly conversationId?: string;
  readonly audit: DlpAudit;
}

export class DlpFailureError extends Error {
  constructor(cause: unknown) {
    super('DLP module failed; request was not sent');
    this.name = 'DlpFailureError';
    this.cause = cause;
  }
}

function markerInstruction(markers: readonly string[]): string {
  return (
    `В запросе есть заглушки скрытых данных: ${markers.join(', ')}. ` +
    'Переноси их в ответ дословно: не переводи, не меняй регистр, не расшифровывай, ' +
    'не пытайся угадать содержимое и не придумывай заглушек, которых здесь нет.'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface MaskedFinding {
  readonly category: DlpCategory;
  readonly count: number;
  readonly valueHashes: readonly string[];
}

function maskPayload(
  payload: unknown,
  table: MarkerTable,
  options: DlpDetectOptions,
): readonly MaskedFinding[] {
  const counts = new Map<DlpCategory, number>();
  const hashes = new Map<DlpCategory, Set<string>>();

  for (const field of collectPayloadTexts(payload)) {
    const result = maskText(field.get(), table, options);
    field.set(result.text);
    for (const finding of result.findings) {
      counts.set(finding.category, (counts.get(finding.category) ?? 0) + finding.count);
      let bucket = hashes.get(finding.category);
      if (bucket == null) {
        bucket = new Set<string>();
        hashes.set(finding.category, bucket);
      }
      for (const hash of finding.valueHashes) {
        bucket.add(hash);
      }
    }
  }

  return [...counts].map(([category, count]) => ({
    category,
    count,
    valueHashes: [...(hashes.get(category) ?? [])],
  }));
}

function appendMarkerInstruction(payload: unknown, markers: readonly string[]): void {
  if (markers.length === 0) {
    return;
  }
  if (!isRecord(payload) || !Array.isArray(payload.messages)) {
    return;
  }
  const instruction = markerInstruction(markers);
  const messages = payload.messages as unknown[];
  const systemMessage = messages.find((message) => isRecord(message) && message.role === 'system');
  if (!isRecord(systemMessage)) {
    messages.unshift({ role: 'system', content: instruction });
    return;
  }
  if (typeof systemMessage.content === 'string') {
    systemMessage.content = `${systemMessage.content}\n\n${instruction}`;
    return;
  }
  if (Array.isArray(systemMessage.content)) {
    systemMessage.content.push({ type: 'text', text: instruction });
  }
}

function warnUnresolved(count: number, conversationId?: string): void {
  if (count === 0) {
    return;
  }
  logger.warn(
    `[dlp] ${count} маркер(ов) в ответе модели не удалось развернуть — сотрудник увидел ` +
      `заглушку вместо значения (беседа ${conversationId ?? 'без идентификатора'}).`,
  );
}

async function unmaskResponse(
  response: Response,
  table: MarkerTable,
  conversationId?: string,
): Promise<Response> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream') && response.body != null) {
    const decoder = new MarkerStreamDecoder(table);
    const textDecoder = new TextDecoder();
    const textEncoder = new TextEncoder();
    const stream = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          const decoded = decoder.push(textDecoder.decode(chunk, { stream: true }));
          if (decoded.length > 0) {
            controller.enqueue(textEncoder.encode(decoded));
          }
        },
        flush(controller) {
          const tail = textDecoder.decode();
          const decoded = tail.length > 0 ? decoder.push(tail) : '';
          const rest = decoded + decoder.flush();
          if (rest.length > 0) {
            controller.enqueue(textEncoder.encode(rest));
          }
          warnUnresolved(decoder.unresolved, conversationId);
        },
      }),
    );
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const text = await response.text();
  const unmasked = unmaskText(text, table);
  warnUnresolved(unmasked.unresolved, conversationId);
  return new Response(unmasked.text, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function createDlpFetch(context: DlpFetchContext, baseFetch: typeof fetch): typeof fetch {
  const dlpFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!context.config.enabled) {
      return baseFetch(input, init);
    }

    const request = new Request(input, init);
    let payload: unknown;
    try {
      const bodyText = await request.clone().text();
      if (bodyText.length === 0) {
        return baseFetch(input, init);
      }
      payload = JSON.parse(bodyText);
    } catch {
      return baseFetch(input, init);
    }

    const table = new MarkerTable();

    try {
      const options: DlpDetectOptions = { modes: context.config.categories };
      const findings = maskPayload(payload, table, options);
      appendMarkerInstruction(payload, table.markers);

      const response = await baseFetch(request.url, {
        ...init,
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(payload),
      });

      await context.audit.recordFindings({
        userId: context.userId,
        userName: context.userName,
        conversationId: context.conversationId,
        mode: 'mask',
        findings,
      });

      return await unmaskResponse(response, table, context.conversationId);
    } catch (error) {
      await context.audit.recordFailure({
        userId: context.userId,
        userName: context.userName,
        reason: error instanceof Error ? error.message : 'unknown error',
      });
      throw new DlpFailureError(error);
    }
  };

  return dlpFetch as typeof fetch;
}

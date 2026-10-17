import { logger } from '@librechat/data-schemas';
import type { AiProvider } from '~/corporate/provider';
import { convertToUsd } from '~/corporate/provider';

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface StreamOptions {
  include_usage?: boolean;
}

interface ChatCompletionRequestBody {
  stream?: boolean;
  stream_options?: StreamOptions;
}

interface ChatCompletionUsage {
  cost?: number;
  cost_rub?: number;
}

interface ChatCompletionChunk {
  id?: string;
  usage?: ChatCompletionUsage;
}

/**
 * How long a captured `{id, cost_usd}` pair waits in {@link capturedCosts} for
 * `ModelEndHandler` to claim it by the final message id. Sized to the upper
 * bound of a single model response (tool loops resolve well under this), not
 * to the whole conversation turn — each provider call gets its own entry and
 * its own deadline. An entry that outlives this was never claimed (the graph
 * errored, the client disconnected mid-stream) and is swept as unrecoverable
 * rather than held indefinitely.
 */
const CAPTURED_COST_TTL_MS = 5 * 60 * 1000;

interface CapturedCostEntry {
  costUsd: number;
  expiresAt: number;
}

const capturedCosts = new Map<string, CapturedCostEntry>();

/**
 * Entries are always (re-)inserted at the end of {@link capturedCosts} (see
 * {@link recordCapturedCost}), so iteration order matches insertion recency
 * and `expiresAt` — a constant TTL added to `Date.now()` — grows
 * monotonically along with it *as long as the wall clock does*. Sweeping can
 * therefore stop at the first unexpired entry instead of scanning the whole
 * map on every call. `Date.now()` is wall-clock, not monotonic — a backward
 * clock step could leave a handful of already-expired entries past the break
 * point unswept until the next insertion restores the ordering; harmless
 * given the short TTL and that `takeCapturedCost` still finds and removes
 * them correctly on read regardless of sweep state.
 */
function sweepExpiredCosts(now: number): void {
  for (const [id, entry] of capturedCosts) {
    if (entry.expiresAt > now) {
      break;
    }
    capturedCosts.delete(id);
  }
}

/**
 * Belt-and-suspenders cleanup: `takeCapturedCost` already removes entries on
 * successful read, so this only matters for costs that are never claimed
 * (aborted/errored generations). Unref'd so it never keeps the process — or a
 * test runner — alive.
 */
const sweepTimer = setInterval(() => sweepExpiredCosts(Date.now()), CAPTURED_COST_TTL_MS);
sweepTimer.unref?.();

export function recordCapturedCost(id: string, costUsd: number): void {
  const now = Date.now();
  /** Re-insertion (not an in-place update) so a re-captured id — a provider
   *  re-emitting `usage` on a later chunk of the same response — moves back
   *  to the end of the map, preserving the insertion-order invariant
   *  {@link sweepExpiredCosts} relies on. */
  capturedCosts.delete(id);
  sweepExpiredCosts(now);
  capturedCosts.set(id, { costUsd, expiresAt: now + CAPTURED_COST_TTL_MS });
}

export function takeCapturedCost(id: string | null | undefined): number | undefined {
  if (!id) {
    return undefined;
  }
  const entry = capturedCosts.get(id);
  capturedCosts.delete(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    return undefined;
  }
  return entry.costUsd;
}

/**
 * Reads a provider's raw cost fields in preference order and converts to USD. Exported so
 * callers outside the fetch-wrapper capture path (e.g. `titleConvo` in `client.js`, whose
 * usage comes straight off the LLM response rather than through {@link wrapFetchWithCostCapture})
 * apply the same currency conversion instead of reading `cost_rub`/`cost` directly — reading
 * either raw would record polza's rubles as if they were already dollars.
 */
export function extractCostUsd(
  usage: ChatCompletionUsage | undefined,
  provider: AiProvider,
): number | undefined {
  if (usage == null) {
    return undefined;
  }
  for (const field of provider.usageCostFields) {
    const raw = usage[field];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return convertToUsd(raw, provider.currency);
    }
  }
  return undefined;
}

function withStreamUsage(body: string): string {
  let parsed: ChatCompletionRequestBody;
  try {
    parsed = JSON.parse(body) as ChatCompletionRequestBody;
  } catch {
    return body;
  }
  if (parsed.stream !== true) {
    return body;
  }
  return JSON.stringify({
    ...parsed,
    stream_options: { ...parsed.stream_options, include_usage: true },
  });
}

function isEventStream(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('text/event-stream');
}

/**
 * Only `/chat/completions` accepts `stream_options` — the Responses API
 * (`/responses`, reachable here via `useResponsesApi`) also streams but
 * rejects the field with a 400. Matched by suffix so a reverse proxy segment
 * ahead of the path (`/v1/chat/completions`, `/gateway/x/chat/completions`)
 * still matches.
 */
function isChatCompletionsUrl(input: string | URL | Request): boolean {
  if (typeof input === 'string') {
    return input.endsWith('/chat/completions');
  }
  const url = input instanceof URL ? input.href : input.url;
  return url.endsWith('/chat/completions');
}

async function captureFromJsonResponse(response: Response, provider: AiProvider): Promise<void> {
  try {
    const data = (await response.json()) as ChatCompletionChunk;
    const costUsd = extractCostUsd(data.usage, provider);
    if (data.id && costUsd !== undefined) {
      recordCapturedCost(data.id, costUsd);
    }
  } catch (err) {
    logger.warn('[costCapture] Не удалось разобрать нестриминговый ответ провайдера', err);
  }
}

function captureLine(line: string, provider: AiProvider): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) {
    return;
  }
  const payload = trimmed.slice('data:'.length).trim();
  if (payload === '' || payload === '[DONE]' || !payload.includes('"usage"')) {
    return;
  }
  let parsed: ChatCompletionChunk;
  try {
    parsed = JSON.parse(payload) as ChatCompletionChunk;
  } catch {
    return;
  }
  const costUsd = extractCostUsd(parsed.usage, provider);
  /** Recorded as soon as a usage-bearing chunk is parsed, not after the loop
   *  exits — the real caller only reads up to `data: [DONE]` and does not
   *  wait for the underlying connection to actually close, so a slow close
   *  (keep-alive, HTTP/2, load) can leave this branch still awaiting `read()`
   *  well after the caller has moved on. `recordCapturedCost` overwrites on
   *  every call, so a later chunk (if any) still wins. */
  if (parsed.id && costUsd !== undefined) {
    recordCapturedCost(parsed.id, costUsd);
  }
}

/**
 * Reads the tee'd clone of an SSE response line by line and never buffers the
 * whole body — the original response's stream is consumed independently and
 * untouched by the real caller. Each line carrying a non-empty `usage` is
 * captured immediately (see {@link captureLine}); a provider that emits
 * `usage` more than once naturally ends up with the last one, since captures
 * overwrite in the order they're parsed.
 */
async function captureFromSseResponse(response: Response, provider: AiProvider): Promise<void> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        captureLine(line, provider);
      }
    }
    /** A final line with no trailing newline (provider closed the stream
     *  without one) would otherwise sit unparsed in `buffer` forever. */
    if (buffer.length > 0) {
      captureLine(buffer, provider);
    }
  } catch (err) {
    logger.warn('[costCapture] Не удалось прочитать стриминговый ответ провайдера', err);
  }
}

/**
 * Wraps a custom-endpoint fetch so the cost the provider reports in `usage`
 * gets captured by response id — normalized to dollars from
 * `provider.currency`, since the spend journal is kept in dollars and polza
 * bills in rubles. Capture is independent of `@langchain/core`'s chunk
 * merging: reading `response_metadata.usage.cost` off the SDK's streamed
 * message double-counts it (chunk concat sums numeric fields, and
 * `@langchain/openai` emits the usage object on two consecutive chunks).
 *
 * Reads a tee'd clone of the response body (`response.clone()`) so the real
 * caller's stream is untouched and unbuffered; forces
 * `stream_options.include_usage` on outgoing `/chat/completions` requests
 * since LibreChat disables `llmConfig.streamUsage` for custom endpoints.
 *
 * Skips capture entirely — no clone, no read — when the response body isn't
 * a WHATWG `ReadableStream` (`typeof body.getReader !== 'function'`). This
 * matters for `directEndpoint: true`, whose base fetch is `node-fetch`
 * 2.x: its `body` is a Node `Readable`, and its `clone()` fans a single
 * `data` pump out to two `PassThrough`s. Reading only the original and never
 * draining the clone stalls BOTH once the undrained side's internal buffer
 * fills — i.e. wrapping would silently hang the real response.
 */
export function wrapFetchWithCostCapture(
  baseFetch: FetchFn | undefined,
  provider: AiProvider,
): FetchFn {
  const fetchImpl = baseFetch ?? (globalThis.fetch as FetchFn);
  return async function costCaptureFetch(input, init) {
    const shouldForceStreamUsage = typeof init?.body === 'string' && isChatCompletionsUrl(input);
    const body = shouldForceStreamUsage ? withStreamUsage(init.body as string) : init?.body;
    const response = await fetchImpl(input, body === init?.body ? init : { ...init, body });
    if (!response.ok || !response.body || typeof response.body.getReader !== 'function') {
      return response;
    }
    const clone = response.clone();
    const capture = isEventStream(clone)
      ? captureFromSseResponse(clone, provider)
      : captureFromJsonResponse(clone, provider);
    capture.catch((err) => {
      logger.warn('[costCapture] Перехват стоимости завершился с ошибкой', err);
    });
    return response;
  };
}

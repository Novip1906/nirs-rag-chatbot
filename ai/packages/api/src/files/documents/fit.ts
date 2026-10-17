import {
  ErrorTypes,
  FileSources,
  EModelEndpoint,
  AttachmentErrorCodes,
  createAttachmentErrorBody,
} from 'librechat-data-provider';
import type {
  AgentParameterValue,
  AttachmentErrorBody,
  AttachmentErrorParams,
} from 'librechat-data-provider';
import type { AppConfig, IMongoFile } from '@librechat/data-schemas';
import type { InitializedAgent } from '~/agents/initialize';
import type { EndpointTokenConfig } from '~/types';
import { maxTokensMap, getModelMaxTokens, getModelMaxOutputTokens } from '../../utils/tokens';

export const DOCUMENT_CONTEXT_RESERVE_TOKENS = 8000;
export const MAX_OBSERVED_CHARS_PER_TOKEN = 5.85;

const CONTEXT_SAFETY_PERCENT = 95;

export interface DocumentBudget {
  contextTokens: number;
  budget: number;
  requiredContextTokens: (documentTokens: number) => number;
}

export interface ModelContextInput {
  spec?: string | null;
  endpoint?: string | null;
  model?: string | null;
  maxContextTokens?: number | null;
  appConfig?: AppConfig;
  tokenConfig?: EndpointTokenConfig;
}

export interface DocumentModelTarget {
  endpoint?: string;
  model?: string;
  maxContextTokens?: number;
}

export interface ContextOverflowInput {
  filename: string;
  tokens: number;
  budget?: DocumentBudget;
  pageCount?: number;
}

export interface DocumentFitInput {
  filename: string;
  budget: DocumentBudget;
  text?: string;
  tokenCount?: number;
  pageCount?: number;
  countTokens?: (text: string) => Promise<number>;
}

export interface DocumentFit {
  tokenCount: number;
  rejection: AttachmentErrorBody | null;
}

export type ContextAttachment = Pick<IMongoFile, 'filename' | 'source' | 'text' | 'tokenCount'>;

export type AgentDocumentSource = Partial<
  Pick<
    InitializedAgent,
    'endpoint' | 'provider' | 'model' | 'endpointTokenConfig' | 'baseContextTokens'
  >
> & {
  model_parameters?: Partial<InitializedAgent['model_parameters']>;
};

export function resolveDocumentBudget(
  contextLimit: number,
  maxOutputTokens?: number,
): DocumentBudget {
  const fixedTokens = (maxOutputTokens ?? 0) + DOCUMENT_CONTEXT_RESERVE_TOKENS;
  return {
    contextTokens: contextLimit,
    budget: Math.floor((contextLimit * CONTEXT_SAFETY_PERCENT) / 100) - fixedTokens,
    requiredContextTokens: (documentTokens) =>
      Math.ceil(((documentTokens + fixedTokens) * 100) / CONTEXT_SAFETY_PERCENT),
  };
}

export function estimateMinimumTokens(text: string): number {
  return Math.ceil(text.length / MAX_OBSERVED_CHARS_PER_TOKEN);
}

export function buildContextOverflowBody({
  filename,
  tokens,
  budget,
  pageCount,
}: ContextOverflowInput): AttachmentErrorBody {
  const requiredContextTokens = (budget ?? resolveDocumentBudget(0)).requiredContextTokens(tokens);
  const params: AttachmentErrorParams = {
    filename,
    ...(pageCount != null ? { pageCount } : {}),
    tokens,
    ...(budget ? { contextTokens: budget.contextTokens } : {}),
    requiredContextTokens,
  };
  return createAttachmentErrorBody(AttachmentErrorCodes.context_overflow, params);
}

async function measureDocumentTokens({
  text,
  tokenCount,
  budget,
  countTokens,
}: DocumentFitInput): Promise<number> {
  if (tokenCount != null) {
    return tokenCount;
  }
  if (!text) {
    return 0;
  }
  const estimate = estimateMinimumTokens(text);
  if (estimate > budget.budget || !countTokens) {
    return estimate;
  }
  return await countTokens(text);
}

export async function assessDocumentFit(input: DocumentFitInput): Promise<DocumentFit> {
  const tokenCount = await measureDocumentTokens(input);
  if (tokenCount <= input.budget.budget) {
    return { tokenCount, rejection: null };
  }
  return {
    tokenCount,
    rejection: buildContextOverflowBody({
      filename: input.filename,
      tokens: tokenCount,
      budget: input.budget,
      pageCount: input.pageCount,
    }),
  };
}

function positiveTokens(value?: number | null): number | undefined {
  return value != null && value > 0 ? value : undefined;
}

function numericTokens(value?: AgentParameterValue): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function toTokenEndpoint(endpoint?: string): EModelEndpoint {
  if (!endpoint) {
    return EModelEndpoint.openAI;
  }
  const known = Object.values(EModelEndpoint).find(
    (value) => value === endpoint && maxTokensMap[value] != null,
  );
  return known ?? EModelEndpoint.custom;
}

export function resolveDocumentModelTarget({
  spec,
  endpoint,
  model,
  maxContextTokens,
  appConfig,
}: ModelContextInput): DocumentModelTarget {
  const preset = spec
    ? appConfig?.modelSpecs?.list?.find((item) => item?.name === spec)?.preset
    : undefined;
  return {
    endpoint: preset?.endpoint ?? endpoint ?? undefined,
    model: preset?.model ?? model ?? undefined,
    maxContextTokens: positiveTokens(maxContextTokens) ?? positiveTokens(preset?.maxContextTokens),
  };
}

function limitForTarget(
  target: DocumentModelTarget,
  tokenConfig?: EndpointTokenConfig,
): number | undefined {
  if (target.maxContextTokens != null) {
    return target.maxContextTokens;
  }
  if (!target.model) {
    return undefined;
  }
  return getModelMaxTokens(target.model, toTokenEndpoint(target.endpoint), tokenConfig);
}

export function resolveModelContextLimit(input: ModelContextInput): number | undefined {
  return limitForTarget(resolveDocumentModelTarget(input), input.tokenConfig);
}

export function resolveUploadBudget(input: ModelContextInput): DocumentBudget | undefined {
  const target = resolveDocumentModelTarget(input);
  const contextLimit = limitForTarget(target, input.tokenConfig);
  if (contextLimit == null) {
    return undefined;
  }
  const maxOutputTokens = target.model
    ? getModelMaxOutputTokens(target.model, toTokenEndpoint(target.endpoint), input.tokenConfig)
    : undefined;
  return resolveDocumentBudget(contextLimit, maxOutputTokens);
}

function isInlineTextAttachment(
  attachment: ContextAttachment | null | undefined,
): attachment is ContextAttachment {
  return (attachment?.source ?? FileSources.local) === FileSources.text && !!attachment?.text;
}

export function resolveAgentDocumentBudget(
  agent?: AgentDocumentSource | null,
  fallbackTokenConfig?: EndpointTokenConfig,
): DocumentBudget | undefined {
  if (!agent) {
    return undefined;
  }
  const budget = resolveUploadBudget({
    endpoint: agent.endpoint ?? agent.provider,
    model: agent.model_parameters?.model ?? agent.model,
    maxContextTokens: numericTokens(agent.model_parameters?.maxContextTokens),
    tokenConfig: agent.endpointTokenConfig ?? fallbackTokenConfig,
  });
  if (budget) {
    return budget;
  }
  const baseContextTokens = positiveTokens(agent.baseContextTokens);
  return baseContextTokens != null ? resolveDocumentBudget(baseContextTokens) : undefined;
}

export function assertAttachmentsFitContext(
  attachments: Array<ContextAttachment | null | undefined>,
  budget?: DocumentBudget,
): void {
  if (!budget) {
    return;
  }

  let tokens = 0;
  const filenames: string[] = [];
  for (const attachment of attachments) {
    if (!isInlineTextAttachment(attachment)) {
      continue;
    }
    tokens += attachment.tokenCount ?? estimateMinimumTokens(attachment.text ?? '');
    filenames.push(attachment.filename);
  }

  if (filenames.length === 0 || tokens <= budget.budget) {
    return;
  }

  const body = buildContextOverflowBody({ filename: filenames.join(', '), tokens, budget });
  throw new Error(JSON.stringify({ type: ErrorTypes.DOCUMENT_CONTEXT_OVERFLOW, ...body }));
}

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { logger } from '@librechat/data-schemas';
import { Tools } from 'librechat-data-provider';
import { tool } from '@librechat/agents/langchain/tools';
import type { StructuredToolInterface } from '@librechat/agents/langchain/tools';
import type { TImageGenerationConfig } from 'librechat-data-provider';
import type { RecordUsageInput } from '@librechat/data-schemas';
import type { CorporatePolicyMethods } from '~/corporate/deps';
import type { AssertLimitsDeps } from '~/corporate/limits';
import type { ImageBudgetDeps } from './budget';
import type { GeneratedImage } from './generate';
import type { InputImageDeps } from './inputs';
import type { ImageCharge } from './validate';
import { resolveDepartmentId, toResolvePolicyDeps } from '~/corporate/deps';
import { GENERATE_IMAGE_DESCRIPTION, IMAGE_USAGE_SCENARIO } from './definition';
import { ImageToolError, parseGenerateImageArgs } from './validate';
import { buildUsageInput } from '~/corporate/record';
import { resolvePolicy } from '~/corporate/policy';
import { checkImageBudget } from './budget';
import { loadInputImages } from './inputs';
import { generateImage } from './generate';

export interface ImageDbDeps extends CorporatePolicyMethods {
  getUsageTotals: AssertLimitsDeps['getUsageTotals'];
  recordUsage: (input: RecordUsageInput) => Promise<void>;
}

export interface ImageToolDeps {
  userId: string;
  config: TImageGenerationConfig;
  db: ImageDbDeps;
  inputs: InputImageDeps;
  generate?: typeof generateImage;
}

export interface GeneratedImageArtifact {
  dataUrl: string;
  fileId: string;
}

export type ImageToolArtifact = Record<Tools.generate_image, GeneratedImageArtifact>;

interface ImageRunConfig {
  signal?: AbortSignal;
  configurable?: {
    thread_id?: string;
    requestBody?: { messageId?: string; conversationId?: string };
  };
}

interface ImageUsageParams {
  prompt: string;
  charge: ImageCharge;
  fileId?: string;
  conversationId?: string;
  messageId?: string;
}

const passthroughSchema = z.object({}).passthrough();

export function toImageBudgetDeps(db: ImageDbDeps): ImageBudgetDeps {
  const policyDeps = toResolvePolicyDeps(db);
  return {
    getUsageTotals: db.getUsageTotals,
    resolvePolicy: (userId) => resolvePolicy(policyDeps, userId),
  };
}

function imageReadyMessage(fileId: string): string {
  return (
    `Картинка готова и уже показана сотруднику, её идентификатор: ${fileId}. Не описывай её ` +
    'подробно, не давай ссылок и не говори о скачивании. Если сотрудник попросит её изменить, ' +
    'передай этот идентификатор в image_ids.'
  );
}

async function recordImageUsage(deps: ImageToolDeps, params: ImageUsageParams): Promise<void> {
  try {
    const departmentId = await resolveDepartmentId(deps.db, deps.userId);
    const usage = buildUsageInput({
      userId: deps.userId,
      departmentId,
      model: params.charge.model,
      conversationId: params.conversationId,
      messageId: params.messageId,
      promptTokens: params.charge.promptTokens,
      completionTokens: params.charge.completionTokens,
      providerUsage: { cost_usd: params.charge.costUsd ?? undefined },
      scenario: IMAGE_USAGE_SCENARIO,
    });
    const estimate = deps.config.estimatedCostUsd;
    const priced =
      usage.costSource === 'unknown' && estimate != null && params.fileId != null
        ? { ...usage, costUsd: estimate, costSource: 'estimate' as const }
        : usage;
    await deps.db.recordUsage({
      ...priced,
      imagePrompt: params.prompt,
      ...(params.fileId != null && { imageFileId: params.fileId }),
    });
  } catch (error) {
    logger.error('[image] Не удалось записать расход на картинку', error);
  }
}

export function createImageGenerationTool(deps: ImageToolDeps): StructuredToolInterface {
  const generate = deps.generate ?? generateImage;
  return tool(
    async (input, runConfig?: ImageRunConfig) => {
      const args = parseGenerateImageArgs(input);
      const budget = await checkImageBudget(
        toImageBudgetDeps(deps.db),
        deps.userId,
        deps.config.estimatedCostUsd,
      );
      if (!budget.allowed) {
        throw new ImageToolError(budget.reason);
      }
      const inputImages = await loadInputImages(deps.inputs, args.imageIds);
      const configurable = runConfig?.configurable;
      const usageTarget = {
        prompt: args.prompt,
        conversationId: configurable?.thread_id ?? configurable?.requestBody?.conversationId,
        messageId: configurable?.requestBody?.messageId,
      };
      let image: GeneratedImage;
      try {
        image = await generate({
          prompt: args.prompt,
          aspectRatio: args.aspectRatio,
          inputImages,
          config: deps.config,
          signal: runConfig?.signal,
          allowedAddresses: deps.config.allowedAddresses,
        });
      } catch (error) {
        if (error instanceof ImageToolError && error.charge?.costUsd != null) {
          await recordImageUsage(deps, { ...usageTarget, charge: error.charge });
        }
        throw error;
      }
      const fileId = randomUUID();
      await recordImageUsage(deps, { ...usageTarget, charge: image, fileId });
      const artifact: ImageToolArtifact = {
        [Tools.generate_image]: {
          dataUrl: `data:${image.mediaType};base64,${image.base64}`,
          fileId,
        },
      };
      return [imageReadyMessage(fileId), artifact];
    },
    {
      name: Tools.generate_image,
      description: GENERATE_IMAGE_DESCRIPTION,
      schema: passthroughSchema,
      responseFormat: 'content_and_artifact',
    },
  );
}

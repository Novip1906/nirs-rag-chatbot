import { logger } from '@librechat/data-schemas';
import { Tools, EModelEndpoint } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { ToolApprovalHookFactory } from '~/agents/hitl/hooks';
import type { ImageDbDeps } from './tool';
import { registerToolApprovalHook } from '~/agents/hitl/hooks';
import { isHITLEnabled } from '~/agents/hitl/policy';
import { checkImageBudget } from './budget';
import { toImageBudgetDeps } from './tool';

export const IMAGE_APPROVAL_DECISIONS: Array<'approve' | 'edit' | 'reject'> = [
  'approve',
  'edit',
  'reject',
];

export const IMAGE_NO_USER_REASON: string =
  'Не удалось определить сотрудника, картинку сделать нельзя.';

export function isImageApprovalAvailable(
  appConfig: AppConfig | undefined,
  hitlCapable: boolean,
): boolean {
  return hitlCapable && isHITLEnabled(appConfig?.endpoints?.[EModelEndpoint.agents]?.toolApproval);
}

export function createImageApprovalHookFactory(db: ImageDbDeps): ToolApprovalHookFactory {
  const budgetDeps = toImageBudgetDeps(db);
  return ({ userId, appConfig }) => {
    const estimate = appConfig?.config?.imageGeneration?.estimatedCostUsd;
    return async () => {
      if (!userId) {
        return { decision: 'deny', reason: IMAGE_NO_USER_REASON };
      }
      try {
        const verdict = await checkImageBudget(budgetDeps, userId, estimate);
        if (!verdict.allowed) {
          return { decision: 'deny', reason: verdict.reason };
        }
      } catch (error) {
        logger.error('[image] Не удалось проверить лимит перед подтверждением', error);
      }
      return { decision: 'ask', allowedDecisions: IMAGE_APPROVAL_DECISIONS };
    };
  };
}

export function registerImageApprovalHook(db: ImageDbDeps): () => void {
  return registerToolApprovalHook(createImageApprovalHookFactory(db), {
    matcher: `^${Tools.generate_image}$`,
  });
}

import { createHash } from 'node:crypto';
import type { DlpCategory } from './types';

export interface DlpAuditDeps {
  recordAuditEntry: (entry: Record<string, unknown>) => Promise<unknown>;
}

export interface DlpAuditInput {
  readonly userId: string;
  readonly userName: string;
  readonly conversationId?: string;
  readonly findings: readonly {
    category: DlpCategory;
    count: number;
    valueHashes: readonly string[];
  }[];
  readonly mode: 'mask' | 'shadow';
}

export interface DlpAudit {
  recordFindings: (input: DlpAuditInput) => Promise<void>;
  recordFailure: (input: { userId: string; userName: string; reason: string }) => Promise<void>;
}

export function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function createDlpAudit(deps: DlpAuditDeps): DlpAudit {
  async function recordFindings(input: DlpAuditInput): Promise<void> {
    for (const finding of input.findings) {
      await deps.recordAuditEntry({
        category: 'dlp',
        action: 'dlp.masked',
        outcome: 'success',
        severity: finding.category === 'secrets' ? 'critical' : 'warning',
        actor: { type: 'user', id: input.userId, name: input.userName || input.userId },
        target: { type: 'conversation', id: input.conversationId ?? 'unknown' },
        metadata: {
          dlpCategory: finding.category,
          matchCount: finding.count,
          valueHashes: finding.valueHashes,
          mode: input.mode,
        },
      });
    }
  }

  async function recordFailure(input: { userId: string; reason: string }): Promise<void> {
    await deps.recordAuditEntry({
      category: 'dlp',
      action: 'dlp.failed',
      outcome: 'failure',
      severity: 'critical',
      actor: { type: 'user', id: input.userId, name: input.userId },
      target: { type: 'system', id: 'dlp' },
      metadata: { reason: input.reason },
    });
  }

  return { recordFindings, recordFailure };
}

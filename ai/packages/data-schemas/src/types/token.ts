import { Document, Types } from 'mongoose';

export interface IToken extends Document {
  userId: Types.ObjectId;
  email?: string;
  type?: string;
  identifier?: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
  metadata?: Map<string, unknown>;
  tenantId?: string;
}

export interface TokenCreateData {
  userId: Types.ObjectId | string;
  email?: string;
  type?: string;
  identifier?: string;
  token: string;
  expiresIn: number;
  metadata?: Record<string, unknown> | Map<string, unknown>;
}

export interface TokenQuery {
  userId?: Types.ObjectId | string;
  token?: string;
  email?: string | null;
  type?: string | null;
  identifier?: string | RegExp | null;
  /** Internal optimistic-concurrency selector for OAuth token record generations. */
  metadataCredentialSetId?: string | null;
  /**
   * Selects specific documents by `_id`, for a caller that already knows exactly which
   * rows to act on (e.g. deleting the tokens superseded by a just-created one, by their
   * pre-fetched ids) — narrower than an `email`/`type` match, which would also catch a
   * row created after the caller's own read.
   */
  ids?: Array<Types.ObjectId | string>;
}

export interface TokenUpdateData {
  email?: string;
  type?: string;
  identifier?: string;
  token?: string;
  expiresAt?: Date;
  expiresIn?: number;
  metadata?: Record<string, unknown> | Map<string, unknown>;
}

export interface TokenDeleteResult {
  deletedCount?: number;
}

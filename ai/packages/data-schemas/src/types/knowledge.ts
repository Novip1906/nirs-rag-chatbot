import type { Document, Types } from 'mongoose';

export type KnowledgeStatus = 'active' | 'archived' | 'draft';

export interface IKnowledgeSpace extends Document {
  _id: Types.ObjectId;
  name: string;
  description: string;
  allowedDepartments: Types.ObjectId[];
  embeddingModel: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IKnowledgeDocument extends Document {
  _id: Types.ObjectId;
  spaceId: Types.ObjectId;
  file_id: string;
  title: string;
  description: string;
  filename: string;
  source: string;
  owner: string;
  version: string;
  effectiveDate: Date | null;
  status: KnowledgeStatus;
  supersedesId: Types.ObjectId | null;
  embeddingModel: string;
  storagePath: string;
  text: string;
  bytes: number;
  mimetype: string;
  embedded: boolean;
  uploadedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

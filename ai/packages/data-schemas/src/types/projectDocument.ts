import type { Types } from 'mongoose';

export interface IProjectDocument {
  _id?: Types.ObjectId;
  owner: string;
  projectId: Types.ObjectId;
  entityId: string;
  file_id: string;
  title: string;
  filename: string;
  mimetype: string;
  bytes: number;
  text: string;
  tokenCount: number;
  embedded: boolean;
  storagePath: string;
  status: 'active' | 'deleted';
  createdAt?: Date;
  updatedAt?: Date;
}

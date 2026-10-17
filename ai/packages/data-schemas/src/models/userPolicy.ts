import { Model } from 'mongoose';
import type * as t from '~/types';
import userPolicySchema from '~/schema/userPolicy';

export function createUserPolicyModel(mongoose: typeof import('mongoose')): Model<t.IUserPolicy> {
  return (
    mongoose.models.UserPolicy || mongoose.model<t.IUserPolicy>('UserPolicy', userPolicySchema)
  );
}

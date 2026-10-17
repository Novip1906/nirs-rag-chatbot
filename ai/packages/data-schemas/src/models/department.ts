import { Model } from 'mongoose';
import type * as t from '~/types';
import departmentSchema from '~/schema/department';

export function createDepartmentModel(mongoose: typeof import('mongoose')): Model<t.IDepartment> {
  return (
    mongoose.models.Department || mongoose.model<t.IDepartment>('Department', departmentSchema)
  );
}

import { Model } from 'mongoose';
import type * as t from '~/types';
import corporateSettingsSchema from '~/schema/corporateSettings';

export function createCorporateSettingsModel(
  mongoose: typeof import('mongoose'),
): Model<t.ICorporateSettings> {
  return (
    mongoose.models.CorporateSettings ||
    mongoose.model<t.ICorporateSettings>('CorporateSettings', corporateSettingsSchema)
  );
}

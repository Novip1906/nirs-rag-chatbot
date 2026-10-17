import type { AdminLimits } from '~/api';
import { buildUpdateUserPayload } from '../buildUpdateUserPayload';

const LIMITS: AdminLimits = {
  dailyCostUsd: 300,
};

const baseInput = {
  modelsTouched: false,
  modelsOverrideEnabled: false,
  selectedModels: [] as string[],
  selectedDefaultModel: null as string | null,
  limitsTouched: false,
  limitsOverrideEnabled: false,
  limits: LIMITS,
  spacesTouched: false,
  allowedSpaces: [] as string[],
  deniedSpaces: [] as string[],
  uploadTouched: false,
  canUploadKnowledge: false,
};

describe('buildUpdateUserPayload', () => {
  it('never sends departmentId or blocked', () => {
    const payload = buildUpdateUserPayload({
      ...baseInput,
      modelsTouched: true,
      modelsOverrideEnabled: true,
      selectedModels: ['gpt-4o'],
      limitsTouched: true,
      limitsOverrideEnabled: true,
      spacesTouched: true,
      uploadTouched: true,
      canUploadKnowledge: true,
    });
    expect(payload).not.toHaveProperty('departmentId');
    expect(payload).not.toHaveProperty('blocked');
  });

  it('sends nothing when no section was touched', () => {
    expect(buildUpdateUserPayload(baseInput)).toEqual({});
  });

  /**
   * The screen shows resolved (effective) limits/models, not the raw personal override —
   * the admin can't tell from the list alone whether a value is inherited or personally
   * set. Omitting untouched keys is what keeps "just changed the department" from silently
   * freezing whatever was showing into a brand-new personal override, or clearing an
   * existing one the admin never meant to touch.
   */
  it('omits allowedModels entirely when the models section was never touched', () => {
    const payload = buildUpdateUserPayload({
      ...baseInput,
      modelsTouched: false,
      modelsOverrideEnabled: true,
      selectedModels: ['gpt-4o'],
    });
    expect(payload).not.toHaveProperty('allowedModels');
  });

  it('omits limits entirely when the limits section was never touched', () => {
    const payload = buildUpdateUserPayload({
      ...baseInput,
      limitsTouched: false,
      limitsOverrideEnabled: true,
    });
    expect(payload).not.toHaveProperty('limits');
  });

  it('sends the selected model list once the override switch is on and touched', () => {
    const payload = buildUpdateUserPayload({
      ...baseInput,
      modelsTouched: true,
      modelsOverrideEnabled: true,
      selectedModels: ['gpt-4o', 'claude-opus'],
    });
    expect(payload.allowedModels).toEqual(['gpt-4o', 'claude-opus']);
  });

  it('sends null to clear a personal model override once touched and switched off', () => {
    const payload = buildUpdateUserPayload({
      ...baseInput,
      modelsTouched: true,
      modelsOverrideEnabled: false,
      selectedModels: ['gpt-4o'],
    });
    expect(payload.allowedModels).toBeNull();
  });

  it('sends the edited limits object once the override switch is on and touched', () => {
    const payload = buildUpdateUserPayload({
      ...baseInput,
      limitsTouched: true,
      limitsOverrideEnabled: true,
    });
    expect(payload.limits).toEqual(LIMITS);
  });

  it('sends null to clear a personal limits override once touched and switched off', () => {
    const payload = buildUpdateUserPayload({
      ...baseInput,
      limitsTouched: true,
      limitsOverrideEnabled: false,
    });
    expect(payload.limits).toBeNull();
  });

  /**
   * Same reasoning as allowedModels/limits: the screen shows the department's spaces
   * merged with the personal override, not the raw override alone — sending it
   * unconditionally on every save (e.g. just flipping the upload switch) would freeze whatever
   * was showing as a brand-new personal grant/denial.
   */
  it('omits allowedSpaces/deniedSpaces entirely when that section was never touched', () => {
    const payload = buildUpdateUserPayload({
      ...baseInput,
      spacesTouched: false,
      allowedSpaces: ['space-a'],
      deniedSpaces: ['space-b'],
    });
    expect(payload).not.toHaveProperty('allowedSpaces');
    expect(payload).not.toHaveProperty('deniedSpaces');
  });

  it('sends allowedSpaces/deniedSpaces once the section was touched, even as empty arrays', () => {
    const payload = buildUpdateUserPayload({
      ...baseInput,
      spacesTouched: true,
      allowedSpaces: [],
      deniedSpaces: [],
    });
    expect(payload.allowedSpaces).toEqual([]);
    expect(payload.deniedSpaces).toEqual([]);
  });

  it('sends the edited space lists once touched', () => {
    const payload = buildUpdateUserPayload({
      ...baseInput,
      spacesTouched: true,
      allowedSpaces: ['space-a'],
      deniedSpaces: ['space-b', 'space-c'],
    });
    expect(payload.allowedSpaces).toEqual(['space-a']);
    expect(payload.deniedSpaces).toEqual(['space-b', 'space-c']);
  });
});

describe('buildUpdateUserPayload defaultModel', () => {
  it('шлёт список и дефолт вместе при включённом override', () => {
    const payload = buildUpdateUserPayload({
      ...baseInput,
      modelsTouched: true,
      modelsOverrideEnabled: true,
      selectedModels: ['a', 'b'],
      selectedDefaultModel: 'b',
    });

    expect(payload.allowedModels).toEqual(['a', 'b']);
    expect(payload.defaultModel).toBe('b');
  });

  it('сбрасывает обе настройки при выключенном override', () => {
    const payload = buildUpdateUserPayload({
      ...baseInput,
      modelsTouched: true,
      modelsOverrideEnabled: false,
      selectedModels: ['a'],
      selectedDefaultModel: 'a',
    });

    expect(payload.allowedModels).toBeNull();
    expect(payload.defaultModel).toBeNull();
  });

  it('не шлёт ни списка, ни дефолта, пока секцию не трогали', () => {
    const payload = buildUpdateUserPayload({
      ...baseInput,
      selectedModels: ['a'],
      selectedDefaultModel: 'a',
    });

    expect(payload).not.toHaveProperty('allowedModels');
    expect(payload).not.toHaveProperty('defaultModel');
  });
});

describe('право загрузки в базу знаний', () => {
  it('уходит в запрос, только если галочку трогали', () => {
    const payload = buildUpdateUserPayload({ ...baseInput, uploadTouched: false });
    expect(payload).not.toHaveProperty('canUploadKnowledge');
  });

  it('уходит в запрос после изменения', () => {
    const payload = buildUpdateUserPayload({
      ...baseInput,
      uploadTouched: true,
      canUploadKnowledge: true,
    });
    expect(payload.canUploadKnowledge).toBe(true);
  });
});

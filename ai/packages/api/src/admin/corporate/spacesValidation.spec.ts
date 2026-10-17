import { resolveHeadSpaceDepartments, validateSpaceOverrides } from './spacesValidation';

describe('validateSpaceOverrides', () => {
  const spaceA = '507f1f77bcf86cd799439011';
  const spaceB = '507f1f77bcf86cd799439012';
  const known = new Set([spaceA, spaceB]);

  it('passes through when neither field is present', () => {
    expect(validateSpaceOverrides({}, known)).toEqual({ ok: true, fields: {} });
  });

  it('accepts a known space id in allowedSpaces', () => {
    const result = validateSpaceOverrides({ allowedSpaces: [spaceA] }, known);
    expect(result).toEqual({ ok: true, fields: { allowedSpaces: [spaceA] } });
  });

  it('accepts a known space id in deniedSpaces', () => {
    const result = validateSpaceOverrides({ deniedSpaces: [spaceB] }, known);
    expect(result).toEqual({ ok: true, fields: { deniedSpaces: [spaceB] } });
  });

  it('accepts an empty array for either field (clears the override)', () => {
    expect(validateSpaceOverrides({ allowedSpaces: [] }, known)).toEqual({
      ok: true,
      fields: { allowedSpaces: [] },
    });
    expect(validateSpaceOverrides({ deniedSpaces: [] }, known)).toEqual({
      ok: true,
      fields: { deniedSpaces: [] },
    });
  });

  it('rejects an unknown space id in allowedSpaces instead of silently saving it', () => {
    const result = validateSpaceOverrides({ allowedSpaces: ['not-a-real-space'] }, known);
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown space id in deniedSpaces', () => {
    const result = validateSpaceOverrides({ deniedSpaces: [spaceA, 'ghost-id'] }, known);
    expect(result.ok).toBe(false);
  });

  it('rejects a value that is not an array of strings', () => {
    expect(validateSpaceOverrides({ allowedSpaces: 'nope' as unknown as string[] }, known).ok).toBe(
      false,
    );
    expect(validateSpaceOverrides({ allowedSpaces: [42] as unknown as string[] }, known).ok).toBe(
      false,
    );
  });

  it('validates both fields independently in a single call', () => {
    const result = validateSpaceOverrides(
      { allowedSpaces: [spaceA], deniedSpaces: [spaceB] },
      known,
    );
    expect(result).toEqual({
      ok: true,
      fields: { allowedSpaces: [spaceA], deniedSpaces: [spaceB] },
    });
  });

  it('rejects when allowedSpaces is valid but deniedSpaces references an unknown space', () => {
    const result = validateSpaceOverrides(
      { allowedSpaces: [spaceA], deniedSpaces: ['ghost-id'] },
      known,
    );
    expect(result.ok).toBe(false);
  });
});

describe('resolveHeadSpaceDepartments', () => {
  const headDepartmentId = '507f1f77bcf86cd799439021';
  const otherDepartmentId = '507f1f77bcf86cd799439022';

  it('defaults an omitted allowedDepartments to the head own department', () => {
    expect(resolveHeadSpaceDepartments(undefined, headDepartmentId)).toEqual({
      ok: true,
      allowedDepartments: [headDepartmentId],
    });
  });

  it('accepts allowedDepartments that is exactly the head own department', () => {
    expect(resolveHeadSpaceDepartments([headDepartmentId], headDepartmentId)).toEqual({
      ok: true,
      allowedDepartments: [headDepartmentId],
    });
  });

  it('rejects an empty allowedDepartments (would make the space visible to everyone)', () => {
    expect(resolveHeadSpaceDepartments([], headDepartmentId).ok).toBe(false);
  });

  it('rejects a different department than the head own', () => {
    expect(resolveHeadSpaceDepartments([otherDepartmentId], headDepartmentId).ok).toBe(false);
  });

  it('rejects the head own department plus another one (no widening allowed)', () => {
    expect(
      resolveHeadSpaceDepartments([headDepartmentId, otherDepartmentId], headDepartmentId).ok,
    ).toBe(false);
  });
});

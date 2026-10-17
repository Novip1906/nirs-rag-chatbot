import { ADMIN_TABS, getActiveTab } from '../adminNav.config';

describe('getActiveTab', () => {
  it('groups the service-backed users and departments under the general tab', () => {
    expect(getActiveTab('/admin/users').id).toBe('general');
    expect(getActiveTab('/admin/users/new').id).toBe('general');
    expect(getActiveTab('/admin/users/user-1').id).toBe('general');
    expect(getActiveTab('/admin/departments').id).toBe('general');
    expect(getActiveTab('/admin/departments/dept-1').id).toBe('general');
  });

  it('groups ai users, ai departments and the remaining sections under the AI tab', () => {
    expect(getActiveTab('/admin/ai/users').id).toBe('ai');
    expect(getActiveTab('/admin/ai/users/employee-1').id).toBe('ai');
    expect(getActiveTab('/admin/ai/departments').id).toBe('ai');
    expect(getActiveTab('/admin/ai/departments/dept-1').id).toBe('ai');
    expect(getActiveTab('/admin/requests').id).toBe('ai');
    expect(getActiveTab('/admin/prompts').id).toBe('ai');
    expect(getActiveTab('/admin/knowledge').id).toBe('ai');
    expect(getActiveTab('/admin/knowledge/space-1/edit').id).toBe('ai');
    expect(getActiveTab('/admin/spend').id).toBe('ai');
    expect(getActiveTab('/admin/analytics').id).toBe('ai');
    expect(getActiveTab('/admin/feedback').id).toBe('ai');
    expect(getActiveTab('/admin/memory').id).toBe('ai');
  });

  it('has exactly the general and ai tabs, and only the general one is admin-only', () => {
    expect(ADMIN_TABS.map((tab) => tab.id)).toEqual(['general', 'ai']);
    expect(ADMIN_TABS.find((tab) => tab.id === 'general')?.adminOnly).toBe(true);
    expect(ADMIN_TABS.find((tab) => tab.id === 'ai')?.adminOnly).not.toBe(true);
  });

  it('puts the ai user and department sections first in the AI tab', () => {
    const ai = ADMIN_TABS.find((tab) => tab.id === 'ai');

    expect(ai?.sections.slice(0, 2).map((section) => [section.to, section.capability])).toEqual([
      ['/admin/ai/users', 'read:users'],
      ['/admin/ai/departments', 'manage:configs'],
    ]);
  });

  it('falls back to the first tab for an unknown path', () => {
    expect(getActiveTab('/admin/unknown-section').id).toBe(ADMIN_TABS[0].id);
  });

  it('every tab default lands on a real destination', () => {
    for (const tab of ADMIN_TABS) {
      expect(tab.defaultTo.startsWith('/admin/')).toBe(true);
      if (tab.sections.length > 0) {
        expect(tab.sections[0].to).toBe(tab.defaultTo);
      }
    }
  });
});

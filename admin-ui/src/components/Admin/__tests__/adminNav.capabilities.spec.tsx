import { visibleTabs } from '../adminNav.config';
import { ALL_CAPABILITIES, HEAD_CAPABILITIES } from '../__fixtures__/capabilities';

const admin = { isAdmin: true, aiCapabilities: new Set(ALL_CAPABILITIES), aiError: false };
const head = { isAdmin: false, aiCapabilities: new Set(HEAD_CAPABILITIES), aiError: false };

const paths = (tabs: ReturnType<typeof visibleTabs>) =>
  tabs.flatMap((tab) => tab.sections.map((section) => section.to));

describe('видимость разделов', () => {
  it('админу показывает обе вкладки и все разделы', () => {
    const tabs = visibleTabs(admin);

    expect(tabs.map((tab) => tab.id)).toEqual(['general', 'ai']);
    expect(paths(tabs)).toEqual(
      expect.arrayContaining([
        '/admin/users',
        '/admin/departments',
        '/admin/ai/users',
        '/admin/ai/departments',
        '/admin/feedback',
      ]),
    );
  });

  it('главе показывает только вкладку AI без общих разделов и отделов', () => {
    const tabs = visibleTabs(head);

    expect(tabs.map((tab) => tab.id)).toEqual(['ai']);
    expect(paths(tabs)).toEqual(
      expect.arrayContaining([
        '/admin/ai/users',
        '/admin/requests',
        '/admin/knowledge',
        '/admin/spend',
      ]),
    );
    expect(paths(tabs)).not.toContain('/admin/users');
    expect(paths(tabs)).not.toContain('/admin/ai/departments');
    expect(paths(tabs)).not.toContain('/admin/analytics');
    expect(paths(tabs)).not.toContain('/admin/feedback');
    expect(paths(tabs)).not.toContain('/admin/prompts');
  });

  it('общая вкладка не зависит от полномочий AI', () => {
    const tabs = visibleTabs({ isAdmin: true, aiCapabilities: new Set(), aiError: false });

    expect(tabs.map((tab) => tab.id)).toEqual(['general']);
    expect(paths(tabs)).toEqual(['/admin/users', '/admin/departments']);
  });

  it('вкладка AI остаётся у админа без разделов, если бэкенд AI недоступен', () => {
    const tabs = visibleTabs({ isAdmin: true, aiCapabilities: new Set(), aiError: true });

    expect(tabs.map((tab) => tab.id)).toEqual(['general', 'ai']);
    expect(tabs[1].sections).toEqual([]);
  });

  it('скрывает вкладку целиком, если ни один из её разделов не доступен', () => {
    const tabs = visibleTabs({
      isAdmin: false,
      aiCapabilities: new Set(['read:usage']),
      aiError: false,
    });

    expect(tabs.map((tab) => tab.id)).toEqual(['ai']);
    expect(paths(tabs)).toEqual(['/admin/spend']);
  });

  it('без прав и без админского флага не показывает ни одной вкладки', () => {
    expect(visibleTabs({ isAdmin: false, aiCapabilities: new Set(), aiError: false })).toEqual([]);
  });
});

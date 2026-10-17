import type { TChatProject } from 'librechat-data-provider';
import { formatActivity } from '../ProjectsView';

const baseProject: TChatProject = {
  _id: 'p1',
  name: 'Project',
  conversationCount: 0,
  createdAt: new Date(2026, 0, 15, 10, 0).toISOString(),
  updatedAt: new Date(2026, 0, 15, 10, 0).toISOString(),
};

describe('formatActivity', () => {
  it('formats the most recent activity date for the ru interface language', () => {
    expect(formatActivity(baseProject, 'ru')).toBe('15 янв. 2026 г.');
  });

  it('formats the most recent activity date for the en interface language', () => {
    expect(formatActivity(baseProject, 'en')).toBe('Jan 15, 2026');
  });

  it('returns null when the project has no activity timestamps', () => {
    expect(
      formatActivity(
        { ...baseProject, createdAt: '', updatedAt: '', lastConversationAt: null },
        'en',
      ),
    ).toBeNull();
  });

  it('returns null for an unparseable activity value', () => {
    expect(
      formatActivity({ ...baseProject, createdAt: 'not a date', updatedAt: 'not a date' }, 'en'),
    ).toBeNull();
  });
});

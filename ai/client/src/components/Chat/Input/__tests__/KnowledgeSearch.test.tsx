import React from 'react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import KnowledgeSearch from '../KnowledgeSearch';

const mockDebouncedChange = jest.fn();

let mockHasKnowledgeBase = false;
let mockKnowledgeSearchToggleState = false;
let mockIsPinned = true;

jest.mock('~/Providers', () => ({
  useBadgeRowContext: () => ({
    knowledgeSearch: {
      toggleState: mockKnowledgeSearchToggleState,
      debouncedChange: mockDebouncedChange,
      isPinned: mockIsPinned,
    },
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useKnowledgeBaseSpec: () => mockHasKnowledgeBase,
}));

describe('KnowledgeSearch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasKnowledgeBase = false;
    mockKnowledgeSearchToggleState = false;
    mockIsPinned = true;
  });

  it('does not render when the active model spec has no knowledge base', () => {
    mockHasKnowledgeBase = false;

    render(<KnowledgeSearch />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('renders the toggle when the active model spec has a knowledge base', () => {
    mockHasKnowledgeBase = true;

    render(<KnowledgeSearch />);

    expect(
      screen.getByRole('checkbox', { name: 'com_ui_knowledge_search_toggle' }),
    ).toBeInTheDocument();
  });

  it('toggles the knowledge search state on click', async () => {
    mockHasKnowledgeBase = true;
    mockKnowledgeSearchToggleState = false;
    const user = userEvent.setup();

    render(<KnowledgeSearch />);

    await user.click(screen.getByRole('checkbox', { name: 'com_ui_knowledge_search_toggle' }));

    expect(mockDebouncedChange).toHaveBeenCalledWith(expect.objectContaining({ value: true }));
  });

  it('stays out of the badge row once unpinned', () => {
    mockHasKnowledgeBase = true;
    mockIsPinned = false;

    render(<KnowledgeSearch />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('still shows while switched on, so an active search never hides from the employee', () => {
    mockHasKnowledgeBase = true;
    mockIsPinned = false;
    mockKnowledgeSearchToggleState = true;

    render(<KnowledgeSearch />);

    expect(
      screen.getByRole('checkbox', { name: 'com_ui_knowledge_search_toggle' }),
    ).toBeInTheDocument();
  });
});

/**
 * Coverage for hiding the raw input/output panel on `knowledge_search` and
 * `knowledge_list` tool calls (see `TOOLS_HIDING_DETAILS` in
 * `~/utils/toolLabels`). Deliberately does NOT mock `../ProgressText` or
 * `lucide-react` like `ToolCall.test.tsx` does — that mock ignores
 * `hasInput`/`isExpanded` and always renders a clickable div, so it cannot
 * see whether the real disclosure chevron and the disabled/non-interactive
 * button actually disappear. These tests render the real `ProgressText` (and
 * the real `ChevronDown` icon) to check the DOM contract the user actually
 * sees; the chevron is located by the class name lucide-react gives it
 * (`lucide-chevron-down`), since it renders no text.
 */
import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen, fireEvent } from '@testing-library/react';
import ToolCall from '../ToolCall';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: any) => {
    const translations: Record<string, string> = {
      com_assistants_completed_function: `Completed ${values?.[0]}`,
      com_assistants_running_var: `Running ${values?.[0]}`,
      com_assistants_running_action: 'Running action',
      com_ui_via_server: `via ${values?.[0]}`,
      com_ui_tool_failed: 'failed',
      com_ui_failed: 'Failed',
      com_ui_cancelled: 'Cancelled',
      com_ui_tool_name_knowledge_search: 'document search',
      com_ui_tool_name_knowledge_list: 'document list',
      com_ui_tool_name_web_search: 'web search',
    };
    return translations[key] || key;
  },
  useProgress: (initialProgress: number) => (initialProgress >= 1 ? 1 : initialProgress),
  useExpandCollapse: (isExpanded: boolean) => ({
    style: {
      display: 'grid',
      gridTemplateRows: isExpanded ? '1fr' : '0fr',
      opacity: isExpanded ? 1 : 0,
    },
    ref: { current: null },
  }),
  useLazyCollapseBody: jest.requireActual('~/hooks/Messages/useLazyCollapseBody').default,
}));

jest.mock('~/hooks/MCP', () => {
  const mcpServerNames: string[] = [];
  return {
    useMCPIconMap: () => new Map(),
    useMCPServerNames: () => mcpServerNames,
  };
});

jest.mock('../ToolCallInfo', () => ({
  __esModule: true,
  default: () => <div data-testid="tool-call-info" />,
}));

jest.mock('../Parts', () => ({
  AttachmentGroup: () => null,
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

jest.mock('~/utils', () => ({
  logger: { error: jest.fn() },
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
  getRunStepDurationLabels: jest.fn(),
}));

function renderToolCall(props: Partial<React.ComponentProps<typeof ToolCall>> = {}) {
  const defaults: React.ComponentProps<typeof ToolCall> = {
    initialProgress: 1,
    isSubmitting: false,
    name: 'web_search',
    args: '{"q":"test"}',
    output: 'raw tool output',
  };
  return render(
    <RecoilRoot>
      <ToolCall {...defaults} {...props} />
    </RecoilRoot>,
  );
}

function hasChevron(container: HTMLElement): boolean {
  return container.querySelector('svg.lucide-chevron-down') != null;
}

describe('ToolCall — hides raw details for knowledge base tools', () => {
  it('renders knowledge_search as a single non-expandable line: no chevron, no panel', () => {
    const { container } = renderToolCall({
      name: 'knowledge_search',
      output:
        'Документ: Электроника\nЯкорь: \\ue202turn0file0\nРелевантность: 0.5007\nСодержание: МГТУ им. Н.Э. Баумана',
    });

    expect(screen.getAllByText('Completed document search').length).toBeGreaterThan(0);
    expect(hasChevron(container)).toBe(false);

    const toggle = screen.getByRole('button', { name: /Completed document search/ });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('tabindex', '-1');
    expect(toggle).not.toHaveAttribute('aria-expanded');

    fireEvent.click(toggle);
    expect(screen.queryByTestId('tool-call-info')).not.toBeInTheDocument();
  });

  it('renders knowledge_list the same way', () => {
    const { container } = renderToolCall({
      name: 'knowledge_list',
      output: '- Some internal document listing',
    });

    expect(screen.getAllByText('Completed document list').length).toBeGreaterThan(0);
    expect(hasChevron(container)).toBe(false);
    expect(screen.getByRole('button', { name: /Completed document list/ })).toBeDisabled();
  });

  it('keeps a normal tool (web_search) fully expandable, as before', () => {
    const { container } = renderToolCall({ name: 'web_search', output: 'some search results' });

    expect(screen.getAllByText('Completed web search').length).toBeGreaterThan(0);
    expect(hasChevron(container)).toBe(true);

    const toggle = screen.getByRole('button', { name: /Completed web search/ });
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveAttribute('tabindex', '0');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(screen.getByTestId('tool-call-info')).toBeInTheDocument();
  });

  it('still shows the failure suffix for a failed knowledge_search, without a panel', () => {
    const { container } = renderToolCall({
      name: 'knowledge_search',
      runStepStatus: 'failed',
      output: 'raw error trace the user should not see',
    });

    // The one-line summary must still say it failed.
    expect(screen.getAllByText(/Failed/).length).toBeGreaterThan(0);
    expect(screen.getByText(/failed/)).toBeInTheDocument(); // the "· failed" suffix

    const toggle = screen.getByRole('button');
    expect(toggle).toBeDisabled();
    expect(hasChevron(container)).toBe(false);

    fireEvent.click(toggle);
    expect(screen.queryByTestId('tool-call-info')).not.toBeInTheDocument();
    // The failure text must still be there after the no-op click.
    expect(screen.getAllByText(/Failed/).length).toBeGreaterThan(0);
  });
});

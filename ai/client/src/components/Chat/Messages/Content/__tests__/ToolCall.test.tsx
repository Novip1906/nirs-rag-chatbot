import React from 'react';
import { RecoilRoot } from 'recoil';
import { Tools, Constants } from 'librechat-data-provider';
import { render, screen, fireEvent } from '@testing-library/react';
import ToolCall from '../ToolCall';

// Mock dependencies
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: any) => {
    const translations: Record<string, string> = {
      com_assistants_function_use: `Used ${values?.[0]}`,
      com_assistants_completed_function: `Completed ${values?.[0]}`,
      com_assistants_completed_action: `Completed action on ${values?.[0]}`,
      com_assistants_running_var: `Running ${values?.[0]}`,
      com_assistants_running_action: 'Running action',
      com_ui_sign_in_to_domain: `Sign in to ${values?.[0]}`,
      com_ui_cancelled: 'Cancelled',
      com_ui_requires_auth: 'Requires authentication',
      com_assistants_allow_sites_you_trust: 'Only allow sites you trust',
      com_ui_via_server: `via ${values?.[0]}`,
      com_ui_tool_failed: 'failed',
      com_ui_tool_name_knowledge_search: 'document search',
      com_ui_tool_name_knowledge_list: 'document list',
      com_ui_tool_name_set_memory: 'memory update',
      com_ui_tool_name_delete_memory: 'memory deletion',
      com_ui_memory_unchanged: 'Memory unchanged',
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

jest.mock('~/components/Chat/Messages/Content/MessageContent', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div data-testid="message-content">{content}</div>,
}));

jest.mock('../ToolCallInfo', () => ({
  __esModule: true,
  default: ({ attachments, ...props }: any) => (
    <div data-testid="tool-call-info" data-attachments={JSON.stringify(attachments)}>
      {JSON.stringify(props)}
    </div>
  ),
}));

jest.mock('../ProgressText', () => ({
  __esModule: true,
  default: ({
    onClick,
    inProgressText,
    finishedText,
    subtitle,
  }: {
    onClick?: () => void;
    inProgressText?: string;
    finishedText?: string;
    subtitle?: string;
  }) => (
    <div data-testid="progress-text" onClick={onClick}>
      {finishedText || inProgressText}
      {subtitle && <span data-testid="subtitle">{subtitle}</span>}
    </div>
  ),
}));

jest.mock('../Parts', () => ({
  AttachmentGroup: ({ attachments }: any) => (
    <div data-testid="attachment-group">{JSON.stringify(attachments)}</div>
  ),
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

jest.mock('lucide-react', () => ({
  ChevronDown: () => <span>{'ChevronDown'}</span>,
  ChevronUp: () => <span>{'ChevronUp'}</span>,
  TriangleAlert: () => <span>{'TriangleAlert'}</span>,
}));

jest.mock('~/utils', () => ({
  logger: {
    error: jest.fn(),
  },
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

describe('ToolCall', () => {
  const mockProps = {
    args: '{"test": "input"}',
    name: 'testFunction',
    output: 'Test output',
    initialProgress: 1,
    isSubmitting: false,
  };

  const renderWithRecoil = (component: React.ReactElement) => {
    return render(<RecoilRoot>{component}</RecoilRoot>);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('intent label', () => {
    it('renders a streaming intent as the live label before args are complete', () => {
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          args={'{"intent":"Searching for OAuth handling in the callbac'}
          output={null}
          initialProgress={0.5}
          isSubmitting={true}
        />,
      );
      expect(
        screen.getAllByText(/Searching for OAuth handling in the callbac/).length,
      ).toBeGreaterThan(0);
      /** The aria-live region keeps its STABLE generic value while the intent
       *  streams — an atomic polite region would otherwise re-announce the
       *  whole growing sentence on every delta. */
      expect(screen.getByText('Running testFunction')).toBeInTheDocument();
    });

    it('keeps the intent as the settled label instead of the generic completion text', () => {
      renderWithRecoil(
        <ToolCall {...mockProps} args={'{"intent":"Looking up the customer record","q":"acme"}'} />,
      );
      expect(screen.getAllByText('Looking up the customer record').length).toBeGreaterThan(0);
      expect(screen.queryByText('Completed testFunction')).not.toBeInTheDocument();
    });

    it('falls back to the generic labels when args carry no intent', () => {
      renderWithRecoil(<ToolCall {...mockProps} />);
      expect(screen.getAllByText('Completed testFunction').length).toBeGreaterThan(0);
    });
  });

  describe('human-readable tool display names', () => {
    it('shows the mapped display name for a known tool once completed', () => {
      renderWithRecoil(<ToolCall {...mockProps} name="knowledge_search" />);

      expect(screen.getAllByText('Completed document search').length).toBeGreaterThan(0);
      expect(screen.queryByText(/knowledge_search/)).not.toBeInTheDocument();
    });

    it('shows the mapped display name for a known tool while running', () => {
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name="knowledge_search"
          output={null}
          initialProgress={0.5}
          isSubmitting={true}
        />,
      );

      expect(screen.getByText('Running document search')).toBeInTheDocument();
    });

    it('keeps the raw tool id for a tool that is not in the display-name map', () => {
      renderWithRecoil(<ToolCall {...mockProps} name="some_unmapped_tool" />);

      expect(screen.getAllByText('Completed some_unmapped_tool').length).toBeGreaterThan(0);
    });

    const memoryAttachment = (type: 'update' | 'delete', key = 'job_role', title?: string) => ({
      messageId: 'm1',
      toolCallId: 't1',
      conversationId: 'c1',
      [Tools.memory]: { key, type, ...(title ? { title } : {}) },
    });

    it('shows the human-readable name for set_memory once completed', () => {
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name="set_memory"
          args='{"key":"job_role"}'
          attachments={[memoryAttachment('update')]}
        />,
      );

      expect(screen.getAllByText('Completed memory update').length).toBeGreaterThan(0);
      expect(screen.queryByText(/set_memory/)).not.toBeInTheDocument();
    });

    it('shows the human-readable name for delete_memory once completed', () => {
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name="delete_memory"
          args='{"key":"job_role"}'
          attachments={[memoryAttachment('delete')]}
        />,
      );

      expect(screen.getAllByText('Completed memory deletion').length).toBeGreaterThan(0);
      expect(screen.queryByText(/delete_memory/)).not.toBeInTheDocument();
    });

    it('shows the deleted memory title from its artifact instead of the key', () => {
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name="delete_memory"
          args='{"key":"employee_id"}'
          attachments={[
            {
              messageId: 'm1',
              toolCallId: 't1',
              conversationId: 'c1',
              [Tools.memory]: { key: 'employee_id', type: 'delete', title: 'Табельный номер' },
            },
          ]}
        />,
      );

      expect(screen.getByTestId('subtitle').textContent).toBe('Табельный номер');
      expect(screen.getByTestId('progress-text').textContent).not.toMatch(/employee_id/);
    });

    it('says the memory is unchanged when a finished memory call saved nothing', () => {
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name="set_memory"
          args='{"key":"delta_contact","title":"Контакт Дельта-Банка"}'
          output="Not saved: the user is asking about past conversations."
        />,
      );

      expect(screen.getByTestId('progress-text').textContent).toBe('Memory unchanged');
      expect(screen.queryByTestId('subtitle')).not.toBeInTheDocument();
    });

    it('keeps a successful write as done even when its card was not saved (after Stop)', () => {
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name="set_memory"
          args='{"key":"delta_contact","title":"Контакт Дельта-Банка"}'
          output="Saved. Do not mention saving to the user."
        />,
      );

      expect(screen.getByTestId('progress-text').textContent).not.toMatch(/Memory unchanged/);
      expect(screen.getByTestId('subtitle').textContent).toBe('Контакт Дельта-Банка');
    });

    it('says the memory is unchanged when a delete was refused', () => {
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name="delete_memory"
          args='{"key":"job_role"}'
          output="Nothing was deleted: memories are deleted only when the user explicitly asks."
        />,
      );

      expect(screen.getByTestId('progress-text').textContent).toBe('Memory unchanged');
    });
  });

  describe('attachments prop passing', () => {
    it('should pass attachments to ToolCallInfo when provided', () => {
      const attachments = [
        {
          type: Tools.ui_resources,
          messageId: 'msg123',
          toolCallId: 'tool456',
          conversationId: 'conv789',
          [Tools.ui_resources]: {
            '0': { type: 'button', label: 'Click me' },
          },
        },
      ];

      renderWithRecoil(<ToolCall {...mockProps} attachments={attachments as any} />);

      fireEvent.click(screen.getByTestId('progress-text'));

      const toolCallInfo = screen.getByTestId('tool-call-info');
      expect(toolCallInfo).toBeInTheDocument();

      const attachmentsData = toolCallInfo.getAttribute('data-attachments');
      expect(attachmentsData).toBe(JSON.stringify(attachments));
    });

    it('should pass empty array when no attachments', () => {
      renderWithRecoil(<ToolCall {...mockProps} />);

      fireEvent.click(screen.getByTestId('progress-text'));

      const toolCallInfo = screen.getByTestId('tool-call-info');
      const attachmentsData = toolCallInfo.getAttribute('data-attachments');
      expect(attachmentsData).toBeNull(); // JSON.stringify(undefined) returns undefined, so attribute is not set
    });

    it('should pass multiple attachments of different types', () => {
      const attachments = [
        {
          type: Tools.ui_resources,
          messageId: 'msg1',
          toolCallId: 'tool1',
          conversationId: 'conv1',
          [Tools.ui_resources]: {
            '0': { type: 'form', fields: [] },
          },
        },
        {
          type: Tools.web_search,
          messageId: 'msg2',
          toolCallId: 'tool2',
          conversationId: 'conv2',
          [Tools.web_search]: {
            results: ['result1', 'result2'],
          },
        },
      ];

      renderWithRecoil(<ToolCall {...mockProps} attachments={attachments as any} />);

      fireEvent.click(screen.getByTestId('progress-text'));

      const toolCallInfo = screen.getByTestId('tool-call-info');
      const attachmentsData = toolCallInfo.getAttribute('data-attachments');
      expect(JSON.parse(attachmentsData!)).toEqual(attachments);
    });
  });

  describe('attachment group rendering', () => {
    it('should render AttachmentGroup when attachments are provided', () => {
      const attachments = [
        {
          type: Tools.ui_resources,
          messageId: 'msg123',
          toolCallId: 'tool456',
          conversationId: 'conv789',
          [Tools.ui_resources]: {
            '0': { type: 'chart', data: [] },
          },
        },
      ];

      renderWithRecoil(<ToolCall {...mockProps} attachments={attachments as any} />);

      const attachmentGroup = screen.getByTestId('attachment-group');
      expect(attachmentGroup).toBeInTheDocument();
      expect(attachmentGroup.textContent).toBe(JSON.stringify(attachments));
    });

    it('should not render AttachmentGroup when no attachments', () => {
      renderWithRecoil(<ToolCall {...mockProps} />);

      expect(screen.queryByTestId('attachment-group')).not.toBeInTheDocument();
    });

    it('should not render AttachmentGroup when attachments is empty array', () => {
      renderWithRecoil(<ToolCall {...mockProps} attachments={[]} />);

      expect(screen.queryByTestId('attachment-group')).not.toBeInTheDocument();
    });

    it('should not render AttachmentGroup when hideAttachments is true (grouped path)', () => {
      const attachments = [
        {
          type: Tools.ui_resources,
          messageId: 'msg-hide',
          toolCallId: 'tool-hide',
          conversationId: 'conv-hide',
          [Tools.ui_resources]: { '0': { type: 'chart', data: [] } },
        },
      ];

      renderWithRecoil(
        <ToolCall {...mockProps} attachments={attachments as any} hideAttachments />,
      );

      expect(screen.queryByTestId('attachment-group')).not.toBeInTheDocument();
    });

    it('should render AttachmentGroup when hideAttachments is false explicitly', () => {
      const attachments = [
        {
          type: Tools.ui_resources,
          messageId: 'msg-show',
          toolCallId: 'tool-show',
          conversationId: 'conv-show',
          [Tools.ui_resources]: { '0': { type: 'chart', data: [] } },
        },
      ];

      renderWithRecoil(
        <ToolCall {...mockProps} attachments={attachments as any} hideAttachments={false} />,
      );

      expect(screen.getByTestId('attachment-group')).toBeInTheDocument();
    });
  });

  describe('tool call info visibility', () => {
    it('should mount tool call info only after expanding via the header', () => {
      renderWithRecoil(<ToolCall {...mockProps} />);

      // Collapsed info stays unmounted until the first expansion
      expect(screen.queryByTestId('tool-call-info')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('progress-text'));
      expect(screen.getByTestId('tool-call-info')).toBeInTheDocument();
    });

    it('should pass input and output props to ToolCallInfo', () => {
      renderWithRecoil(<ToolCall {...mockProps} />);
      fireEvent.click(screen.getByTestId('progress-text'));

      const toolCallInfo = screen.getByTestId('tool-call-info');
      const props = JSON.parse(toolCallInfo.textContent!);

      expect(props.input).toBe('{"test": "input"}');
      expect(props.output).toBe('Test output');
    });
  });

  describe('authentication flow', () => {
    it('should show sign-in button when auth URL is provided', () => {
      const originalOpen = window.open;
      window.open = jest.fn();

      renderWithRecoil(
        <ToolCall
          {...mockProps}
          initialProgress={0.5} // Less than 1 so it's not complete
          auth="https://auth.example.com"
          isSubmitting={true} // Should be submitting for auth to show
        />,
      );

      const signInButton = screen.getByText('Sign in to auth.example.com');
      expect(signInButton).toBeInTheDocument();

      fireEvent.click(signInButton);
      expect(window.open).toHaveBeenCalledWith(
        'https://auth.example.com',
        '_blank',
        'noopener,noreferrer',
      );

      window.open = originalOpen;
    });

    it('should not show auth section when cancelled', () => {
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          auth="https://auth.example.com"
          initialProgress={0.5}
          isSubmitting={false} // Not submitting + progress < 1 = cancelled
        />,
      );

      expect(screen.queryByText('Sign in to auth.example.com')).not.toBeInTheDocument();
    });

    it('should not show auth section when progress is complete', () => {
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          auth="https://auth.example.com"
          initialProgress={1}
          isSubmitting={false}
        />,
      );

      expect(screen.queryByText('Sign in to auth.example.com')).not.toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('should handle undefined args', () => {
      renderWithRecoil(<ToolCall {...mockProps} args={undefined as any} />);
      fireEvent.click(screen.getByTestId('progress-text'));

      const toolCallInfo = screen.getByTestId('tool-call-info');
      const props = JSON.parse(toolCallInfo.textContent!);
      expect(props.input).toBe('');
    });

    it('should handle null output', () => {
      renderWithRecoil(<ToolCall {...mockProps} output={null} />);
      fireEvent.click(screen.getByTestId('progress-text'));

      const toolCallInfo = screen.getByTestId('tool-call-info');
      const props = JSON.parse(toolCallInfo.textContent!);
      expect(props.output).toBeNull();
    });

    it('should handle simple function name without domain', () => {
      renderWithRecoil(<ToolCall {...mockProps} name="simpleName" />);
      fireEvent.click(screen.getByTestId('progress-text'));

      expect(screen.getByTestId('tool-call-info')).toBeInTheDocument();
    });

    it('should handle complex nested attachments', () => {
      const complexAttachments = [
        {
          type: Tools.ui_resources,
          messageId: 'msg123',
          toolCallId: 'tool456',
          conversationId: 'conv789',
          [Tools.ui_resources]: {
            '0': {
              type: 'nested',
              data: {
                deep: {
                  value: 'test',
                  array: [1, 2, 3],
                  object: { key: 'value' },
                },
              },
            },
          },
        },
      ];

      renderWithRecoil(<ToolCall {...mockProps} attachments={complexAttachments as any} />);

      fireEvent.click(screen.getByTestId('progress-text'));

      const toolCallInfo = screen.getByTestId('tool-call-info');
      const attachmentsData = toolCallInfo.getAttribute('data-attachments');
      expect(JSON.parse(attachmentsData!)).toEqual(complexAttachments);

      const attachmentGroup = screen.getByTestId('attachment-group');
      expect(JSON.parse(attachmentGroup.textContent!)).toEqual(complexAttachments);
    });
  });

  describe('MCP OAuth detection', () => {
    const d = Constants.mcp_delimiter;

    it('should detect MCP OAuth from delimiter in tool-call name', () => {
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name={`oauth${d}my-server`}
          initialProgress={0.5}
          isSubmitting={true}
          auth="https://auth.example.com"
        />,
      );
      const subtitle = screen.getByTestId('subtitle');
      expect(subtitle.textContent).toBe('via my-server');
    });

    it('should preserve full server name when it contains the delimiter substring', () => {
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name={`oauth${d}foo${d}bar`}
          initialProgress={0.5}
          isSubmitting={true}
          auth="https://auth.example.com"
        />,
      );
      const subtitle = screen.getByTestId('subtitle');
      expect(subtitle.textContent).toBe(`via foo${d}bar`);
    });

    it('should display server name (not "oauth") as function_name for OAuth tool calls', () => {
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name={`oauth${d}my-server`}
          initialProgress={1}
          isSubmitting={false}
          output="done"
          auth="https://auth.example.com"
        />,
      );
      const progressText = screen.getByTestId('progress-text');
      expect(progressText.textContent).toContain('Completed my-server');
      expect(progressText.textContent).not.toContain('Completed oauth');
    });

    it('should display server name even when auth is cleared (post-completion)', () => {
      // After OAuth completes, createOAuthEnd re-emits the toolCall without auth.
      // The display should still show the server name, not literal "oauth".
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name={`oauth${d}my-server`}
          initialProgress={1}
          isSubmitting={false}
          output="done"
        />,
      );
      const progressText = screen.getByTestId('progress-text');
      expect(progressText.textContent).toContain('Completed my-server');
      expect(progressText.textContent).not.toContain('Completed oauth');
    });

    it('should fallback to auth URL redirect_uri when name lacks delimiter', () => {
      const authUrl =
        'https://oauth.example.com/authorize?redirect_uri=' +
        encodeURIComponent('https://app.example.com/api/mcp/my-server/oauth/callback');
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name="bare_name"
          initialProgress={0.5}
          isSubmitting={true}
          auth={authUrl}
        />,
      );
      const subtitle = screen.getByTestId('subtitle');
      expect(subtitle.textContent).toBe('via my-server');
    });

    it('should display server name (not raw tool-call ID) in fallback path finished text', () => {
      const authUrl =
        'https://oauth.example.com/authorize?redirect_uri=' +
        encodeURIComponent('https://app.example.com/api/mcp/my-server/oauth/callback');
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name="bare_name"
          initialProgress={1}
          isSubmitting={false}
          output="done"
          auth={authUrl}
        />,
      );
      const progressText = screen.getByTestId('progress-text');
      expect(progressText.textContent).toContain('Completed my-server');
      expect(progressText.textContent).not.toContain('bare_name');
    });

    it('should show normalized server name when it contains _mcp_ after prefixing', () => {
      // Server named oauth@mcp@server normalizes to oauth_mcp_server,
      // gets prefixed to oauth_mcp_oauth_mcp_server. Client parses:
      // func="oauth", server="oauth_mcp_server". Visually awkward but
      // semantically correct — the normalized name IS oauth_mcp_server.
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name={`oauth${d}oauth${d}server`}
          initialProgress={0.5}
          isSubmitting={true}
          auth="https://auth.example.com"
        />,
      );
      const subtitle = screen.getByTestId('subtitle');
      expect(subtitle.textContent).toBe(`via oauth${d}server`);
    });

    it('should not misidentify non-MCP action auth as MCP via fallback', () => {
      const authUrl =
        'https://oauth.example.com/authorize?redirect_uri=' +
        encodeURIComponent('https://app.example.com/api/actions/xyz/oauth/callback');
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          name="action_name"
          initialProgress={0.5}
          isSubmitting={true}
          auth={authUrl}
        />,
      );
      expect(screen.queryByTestId('subtitle')).not.toBeInTheDocument();
    });
  });

  describe('A11Y-04: screen reader status announcements', () => {
    it('includes sr-only aria-live region for status announcements', () => {
      renderWithRecoil(
        <ToolCall
          {...mockProps}
          initialProgress={1}
          isSubmitting={false}
          name="test_func"
          output="result"
        />,
      );

      const liveRegion = document.querySelector('[aria-live="polite"]');
      expect(liveRegion).not.toBeNull();
      expect(liveRegion!.className).toContain('sr-only');
    });
  });
});

import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EModelEndpoint, mergeFileConfig } from 'librechat-data-provider';
import type { TEndpointsConfig, Agent } from 'librechat-data-provider';
import AttachFileChat from '../AttachFileChat';

const mockEndpointsConfig: TEndpointsConfig = {
  [EModelEndpoint.openAI]: { userProvide: false, order: 0 },
  [EModelEndpoint.agents]: { userProvide: false, order: 1 },
  [EModelEndpoint.assistants]: { userProvide: false, order: 2 },
  Moonshot: { type: EModelEndpoint.custom, userProvide: false, order: 9999 },
};

const defaultFileConfig = mergeFileConfig({
  endpoints: {
    Moonshot: { fileLimit: 5 },
    [EModelEndpoint.agents]: { fileLimit: 20 },
    default: { fileLimit: 10 },
  },
});

let mockFileConfig = defaultFileConfig;

let mockAgentsMap: Record<string, Partial<Agent>> = {};
let mockAgentQueryData: Partial<Agent> | undefined;

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: mockEndpointsConfig }),
  useGetFileConfig: ({ select }: { select?: (data: unknown) => unknown }) => ({
    data: select != null ? select(mockFileConfig) : mockFileConfig,
  }),
  useGetAgentByIdQuery: () => ({ data: mockAgentQueryData }),
}));

jest.mock('~/Providers', () => ({
  useAgentsMapContext: () => mockAgentsMap,
}));

jest.mock('../AttachFileDirect', () => {
  return function MockAttachFileDirect() {
    return <div data-testid="attach-file-direct" />;
  };
});

jest.mock('../AttachFile', () => {
  return function MockAttachFile() {
    return <div data-testid="attach-file" />;
  };
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderComponent(conversation: Record<string, unknown> | null, disableInputs = false) {
  return render(
    <QueryClientProvider client={queryClient}>
      <RecoilRoot>
        <AttachFileChat
          conversation={conversation as never}
          disableInputs={disableInputs}
          files={new Map()}
          setFiles={() => {}}
          setFilesLoading={() => {}}
        />
      </RecoilRoot>
    </QueryClientProvider>,
  );
}

describe('AttachFileChat', () => {
  beforeEach(() => {
    mockFileConfig = defaultFileConfig;
    mockAgentsMap = {};
    mockAgentQueryData = undefined;
  });

  describe('rendering decisions', () => {
    it('renders the direct picker for agents endpoint', () => {
      renderComponent({ endpoint: EModelEndpoint.agents, agent_id: 'agent-1' });
      expect(screen.getByTestId('attach-file-direct')).toBeInTheDocument();
    });

    it('renders the direct picker for custom endpoint with file support', () => {
      renderComponent({ endpoint: 'Moonshot' });
      expect(screen.getByTestId('attach-file-direct')).toBeInTheDocument();
    });

    it('renders the direct picker for openAI endpoint', () => {
      renderComponent({ endpoint: EModelEndpoint.openAI });
      expect(screen.getByTestId('attach-file-direct')).toBeInTheDocument();
    });

    it('renders null for null conversation', () => {
      const { container } = renderComponent(null);
      expect(container.innerHTML).toBe('');
    });

    it('renders AttachFile for assistants endpoint when not disabled', () => {
      renderComponent({ endpoint: EModelEndpoint.assistants });
      expect(screen.getByTestId('attach-file')).toBeInTheDocument();
    });
  });

  /**
   * The resolved endpoint type is no longer handed to the picker as a prop —
   * the picker takes any file and routes it by type — but it still decides
   * whether uploading is possible at all, so it is asserted through what
   * renders rather than through props.
   */
  describe('endpoint type resolution', () => {
    it('resolves an agent provider that is a custom endpoint to a file-capable endpoint', () => {
      mockAgentsMap = {
        'agent-1': { provider: 'Moonshot', model_parameters: {} } as Partial<Agent>,
      };
      renderComponent({ endpoint: EModelEndpoint.agents, agent_id: 'agent-1' });
      expect(screen.getByTestId('attach-file-direct')).toBeInTheDocument();
    });

    it('uses the fetched agent when it is missing from the agents map', () => {
      mockAgentQueryData = { provider: 'Moonshot' } as Partial<Agent>;
      renderComponent({ endpoint: EModelEndpoint.agents, agent_id: 'agent-2' });
      expect(screen.getByTestId('attach-file-direct')).toBeInTheDocument();
    });
  });

  describe('upload disabled rendering', () => {
    it('renders null for agents endpoint when fileConfig.agents.disabled is true', () => {
      mockFileConfig = mergeFileConfig({
        endpoints: {
          [EModelEndpoint.agents]: { disabled: true },
        },
      });
      const { container } = renderComponent({
        endpoint: EModelEndpoint.agents,
        agent_id: 'agent-1',
      });
      expect(container.innerHTML).toBe('');
    });

    it('renders null for agents endpoint when disableInputs is true', () => {
      const { container } = renderComponent(
        { endpoint: EModelEndpoint.agents, agent_id: 'agent-1' },
        true,
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders the picker when provider-specific config overrides agents disabled', () => {
      mockFileConfig = mergeFileConfig({
        endpoints: {
          Moonshot: { disabled: false, fileLimit: 5 },
          [EModelEndpoint.agents]: { disabled: true },
        },
      });
      mockAgentsMap = {
        'agent-1': { provider: 'Moonshot', model_parameters: {} } as Partial<Agent>,
      };
      renderComponent({ endpoint: EModelEndpoint.agents, agent_id: 'agent-1' });
      expect(screen.getByTestId('attach-file-direct')).toBeInTheDocument();
    });

    it('renders null for assistants endpoint when fileConfig.assistants.disabled is true', () => {
      mockFileConfig = mergeFileConfig({
        endpoints: {
          [EModelEndpoint.assistants]: { disabled: true },
        },
      });
      const { container } = renderComponent({
        endpoint: EModelEndpoint.assistants,
      });
      expect(container.innerHTML).toBe('');
    });
  });
});

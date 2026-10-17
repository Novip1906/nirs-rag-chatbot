import { Types } from 'mongoose';
import { Run, Providers, GraphEvents } from '@librechat/agents';
import { AIMessage, HumanMessage } from '@librechat/agents/langchain/messages';
import { Tools, MemoryScope, EModelEndpoint, AgentCapabilities } from 'librechat-data-provider';
import type { FiltersConfig, MemoryArtifact } from 'librechat-data-provider';
import type { ZodObject, ZodDefault, ZodTypeAny, ZodRawShape } from 'zod';
import type { RuntimeProviderName } from '@librechat/agents';
import type { IUser } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { CompactionOutcome } from '~/corporate/memory/compaction';
import type { ServerRequest } from '~/types';
import {
  processMemory,
  memoryScopeGuidance,
  memoryToolUsageGuard,
  createMemoryProcessor,
  createMemoryTool,
  getDefaultInstructions,
  getMemoryAgentId,
  getRequestMemories,
  registerMemoryTools,
  buildInlineMemoryTool,
  createDeleteMemoryTool,
  getMemoryToolDefinitions,
  invalidateRequestMemories,
  agentHasInlineMemoryTools,
  buildInlineMemoryContext,
  isExplicitMemoryRequest,
  isRecallRequest,
} from './memory';
import { GenerationJobManager } from '~/stream/GenerationJobManager';
import Tokenizer from '~/utils/tokenizer';

jest.mock('~/middleware/access', () => ({
  checkAccess: jest.fn().mockResolvedValue(true),
}));
jest.mock('~/stream/GenerationJobManager');

const mockCreateSafeUser = jest.fn((user) => ({
  id: user?.id,
  email: user?.email,
  name: user?.name,
  username: user?.username,
}));

const mockResolveHeaders = jest.fn((opts) => {
  const headers = opts.headers || {};
  const user = opts.user || {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    let resolved = value as string;
    resolved = resolved.replace(/\$\{(\w+)\}/g, (_match, envVar) => process.env[envVar] || '');
    resolved = resolved.replace(/\{\{LIBRECHAT_USER_EMAIL\}\}/g, user.email || '');
    resolved = resolved.replace(/\{\{LIBRECHAT_USER_ID\}\}/g, user.id || '');
    result[key] = resolved;
  }
  return result;
});

type HeaderCarrier = { defaultHeaders?: Record<string, string> };
const mockResolveConfigHeaders = jest.fn(
  (opts: {
    llmConfig?: { configuration?: HeaderCarrier; clientOptions?: HeaderCarrier };
    user?: { id?: string; email?: string };
  }) => {
    const cfg = opts?.llmConfig;
    if (cfg?.configuration?.defaultHeaders != null) {
      cfg.configuration.defaultHeaders = mockResolveHeaders({
        headers: cfg.configuration.defaultHeaders,
        user: opts.user,
      });
    }
    if (cfg?.clientOptions?.defaultHeaders != null) {
      cfg.clientOptions.defaultHeaders = mockResolveHeaders({
        headers: cfg.clientOptions.defaultHeaders,
        user: opts.user,
      });
    }
  },
);

jest.mock('~/utils', () => ({
  Tokenizer: {
    getTokenCount: jest.fn(() => 10),
  },
  createSafeUser: (user: unknown) => mockCreateSafeUser(user),
  getSafeErrorMetadata: (error: unknown) => ({
    type:
      error != null && typeof error === 'object' && (error as { name?: unknown }).name === 'Error'
        ? 'Error'
        : 'Object',
  }),
  resolveConfigHeaders: (opts: unknown) => mockResolveConfigHeaders(opts as never),
}));

const { createSafeUser } = jest.requireMock('~/utils');

beforeEach(() => {
  jest.spyOn(Run, 'create').mockImplementation(
    () =>
      ({
        processStream: jest.fn(() => Promise.resolve('success')),
      }) as never,
  );
});

function createTestUser(overrides: Partial<IUser> = {}): IUser {
  return {
    _id: new Types.ObjectId(),
    id: new Types.ObjectId().toString(),
    username: 'testuser',
    email: 'test@example.com',
    name: 'Test User',
    avatar: 'https://example.com/avatar.png',
    provider: 'email',
    role: 'user',
    createdAt: new Date('2021-01-01'),
    updatedAt: new Date('2021-01-01'),
    emailVerified: true,
    ...overrides,
  } as IUser;
}

describe('Memory attachment generation fencing', () => {
  it('emits artifacts with the generation epoch that started memory processing', async () => {
    const memoryArtifact = {
      type: 'update' as const,
      key: 'response_style',
      value: 'concise',
    };
    const processStream = jest.fn(async () => {
      const runConfig = (Run.create as jest.Mock).mock.calls[0][0];
      runConfig.customHandlers[GraphEvents.TOOL_END].handle(
        GraphEvents.TOOL_END,
        {
          output: {
            tool_call_id: 'memory-call-1',
            artifact: { [Tools.memory]: memoryArtifact },
          },
        },
        {
          run_id: 'response-1',
          thread_id: 'conversation-1',
        },
      );
      return 'success';
    });
    (Run.create as jest.Mock).mockReturnValueOnce({ processStream });

    const [, runMemory] = await createMemoryProcessor({
      res: {
        headersSent: true,
        write: jest.fn(),
      } as unknown as Response,
      userId: 'user-1',
      messageId: 'response-1',
      conversationId: 'conversation-1',
      streamId: 'conversation-1',
      jobCreatedAt: 1234,
      memoryMethods: {
        setMemory: jest.fn(),
        deleteMemory: jest.fn(),
        getUserMemories: jest.fn().mockResolvedValue([]),
        getFormattedMemories: jest.fn().mockResolvedValue({
          withKeys: '',
          withoutKeys: '',
          totalTokens: 0,
        }),
      },
    });

    await runMemory([]);

    expect(GenerationJobManager.emitChunk).toHaveBeenCalledWith(
      'conversation-1',
      {
        event: 'attachment',
        data: {
          type: Tools.memory,
          toolCallId: 'memory-call-1',
          messageId: 'response-1',
          conversationId: 'conversation-1',
          [Tools.memory]: memoryArtifact,
        },
      },
      { expectedCreatedAt: 1234 },
    );
  });
});

describe('Memory Agent Header Resolution', () => {
  let testUser: IUser;
  let mockRes: Response;
  let mockMemoryMethods: {
    setMemory: jest.Mock;
    deleteMemory: jest.Mock;
    getFormattedMemories: jest.Mock;
  };

  beforeEach(() => {
    process.env.CUSTOM_API_KEY = 'sk-custom-test-key';
    process.env.TEST_CUSTOM_API_KEY = 'sk-custom-test-key';

    testUser = createTestUser({
      id: 'user-123',
      email: 'test@example.com',
    });

    mockRes = {
      write: jest.fn(),
      end: jest.fn(),
      headersSent: false,
    } as unknown as Response;

    mockMemoryMethods = {
      setMemory: jest.fn(),
      deleteMemory: jest.fn(),
      getFormattedMemories: jest.fn(() =>
        Promise.resolve({
          withKeys: 'formatted memories',
          withoutKeys: 'memories without keys',
          totalTokens: 100,
        }),
      ),
    };

    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.CUSTOM_API_KEY;
    delete process.env.TEST_CUSTOM_API_KEY;
  });

  it('should resolve environment variables in custom endpoint headers', async () => {
    const llmConfig = {
      provider: 'custom' as RuntimeProviderName,
      model: 'gpt-4o-mini',
      configuration: {
        defaultHeaders: {
          'x-custom-api-key': '${CUSTOM_API_KEY}',
          'api-key': '${TEST_CUSTOM_API_KEY}',
        },
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];
    expect(runConfig.graphConfig.llmConfig.configuration.defaultHeaders).toEqual({
      'x-custom-api-key': 'sk-custom-test-key',
      'api-key': 'sk-custom-test-key',
    });
  });

  it('should resolve user placeholders in custom endpoint headers', async () => {
    const llmConfig = {
      provider: 'custom' as RuntimeProviderName,
      model: 'gpt-4o-mini',
      configuration: {
        defaultHeaders: {
          'X-User-Identifier': '{{LIBRECHAT_USER_EMAIL}}',
          'X-User-ID': '{{LIBRECHAT_USER_ID}}',
        },
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];
    expect(runConfig.graphConfig.llmConfig.configuration.defaultHeaders).toEqual({
      'X-User-Identifier': 'test@example.com',
      'X-User-ID': 'user-123',
    });
  });

  it('should handle mixed environment variables and user placeholders', async () => {
    const llmConfig = {
      provider: 'custom' as RuntimeProviderName,
      model: 'gpt-4o-mini',
      configuration: {
        defaultHeaders: {
          'x-custom-api-key': '${CUSTOM_API_KEY}',
          'X-User-Identifier': '{{LIBRECHAT_USER_EMAIL}}',
          'X-Application-Identifier': 'LibreChat - Test',
        },
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];
    expect(runConfig.graphConfig.llmConfig.configuration.defaultHeaders).toEqual({
      'x-custom-api-key': 'sk-custom-test-key',
      'X-User-Identifier': 'test@example.com',
      'X-Application-Identifier': 'LibreChat - Test',
    });
  });

  it('should resolve env vars when user is undefined', async () => {
    const llmConfig = {
      provider: 'custom' as RuntimeProviderName,
      model: 'gpt-4o-mini',
      configuration: {
        defaultHeaders: {
          'x-custom-api-key': '${CUSTOM_API_KEY}',
        },
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: undefined,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];
    expect(runConfig.graphConfig.llmConfig.configuration.defaultHeaders).toEqual({
      'x-custom-api-key': 'sk-custom-test-key',
    });
  });

  it('should not throw when llmConfig has no configuration', async () => {
    const llmConfig = {
      provider: Providers.OPENAI,
      model: 'gpt-4o-mini',
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];
    expect(runConfig.graphConfig.llmConfig.configuration).toBeUndefined();
  });

  it('should use createSafeUser to sanitize user data', async () => {
    const userWithSensitiveData = createTestUser({
      id: 'user-123',
      email: 'test@example.com',
      password: 'sensitive-password',
      refreshToken: 'sensitive-token',
    } as unknown as Partial<IUser>);

    const llmConfig = {
      provider: Providers.OPENAI,
      model: 'gpt-4o-mini',
      configuration: {
        defaultHeaders: {
          'X-User-ID': '{{LIBRECHAT_USER_ID}}',
        },
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: userWithSensitiveData,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();

    // Verify createSafeUser was used - the user object passed to Run.create should not have sensitive fields
    const safeUser = createSafeUser(userWithSensitiveData);
    expect(safeUser).not.toHaveProperty('password');
    expect(safeUser).not.toHaveProperty('refreshToken');
    expect(safeUser).toHaveProperty('id');
    expect(safeUser).toHaveProperty('email');
  });

  it('should include instructions in user message for Bedrock provider', async () => {
    const llmConfig = {
      provider: Providers.BEDROCK,
      model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    };

    const { HumanMessage } = await import('@librechat/agents/langchain/messages');
    const testMessage = new HumanMessage('test chat content');

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [testMessage],
      memory: 'existing memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];

    // For Bedrock, instructions should NOT be passed to graphConfig
    expect(runConfig.graphConfig.instructions).toBeUndefined();
    expect(runConfig.graphConfig.additional_instructions).toBeUndefined();
  });

  it('should pass instructions to graphConfig for non-Bedrock providers', async () => {
    const llmConfig = {
      provider: Providers.OPENAI,
      model: 'gpt-4o-mini',
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'existing memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];

    // For non-Bedrock providers, instructions should be passed to graphConfig
    expect(runConfig.graphConfig.instructions).toBe('test instructions');
    expect(runConfig.graphConfig.additional_instructions).toBeDefined();
  });

  it('should set temperature to 1 for Bedrock with thinking enabled', async () => {
    const llmConfig = {
      provider: Providers.BEDROCK,
      model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      temperature: 0.7,
      additionalModelRequestFields: {
        thinking: {
          type: 'enabled',
          budget_tokens: 5000,
        },
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'existing memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];

    expect(runConfig.graphConfig.llmConfig.temperature).toBe(1);
  });

  it('should not modify temperature for Bedrock without thinking enabled', async () => {
    const llmConfig = {
      provider: Providers.BEDROCK,
      model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      temperature: 0.7,
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'existing memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];

    expect(runConfig.graphConfig.llmConfig.temperature).toBe(0.7);
  });

  it('should remove temperature for Anthropic with thinking enabled', async () => {
    const llmConfig = {
      provider: Providers.ANTHROPIC,
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      thinking: {
        type: 'enabled',
        budget_tokens: 5000,
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'existing memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];

    expect(runConfig.graphConfig.llmConfig.temperature).toBeUndefined();
    expect(runConfig.graphConfig.llmConfig.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 5000,
    });
  });

  it('should not modify temperature for Anthropic without thinking enabled', async () => {
    const llmConfig = {
      provider: Providers.ANTHROPIC,
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'existing memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];

    expect(runConfig.graphConfig.llmConfig.temperature).toBe(0.7);
  });

  it('should not modify temperature for Anthropic with thinking type not enabled', async () => {
    const llmConfig = {
      provider: Providers.ANTHROPIC,
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      thinking: {
        type: 'disabled',
      },
    };

    await processMemory({
      res: mockRes,
      userId: 'user-123',
      setMemory: mockMemoryMethods.setMemory,
      deleteMemory: mockMemoryMethods.deleteMemory,
      messages: [],
      memory: 'existing memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      validKeys: ['preferences'],
      instructions: 'test instructions',
      llmConfig,
      user: testUser,
    });

    expect(Run.create as jest.Mock).toHaveBeenCalled();
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];

    expect(runConfig.graphConfig.llmConfig.temperature).toBe(0.7);
  });
});

describe('createMemoryTool tokenLimit enforcement', () => {
  it('serializes parallel set_memory calls so they cannot collectively exceed tokenLimit', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    /** ~100 tokens; two of these (≈200) exceed the 150 limit, but each fits alone. */
    const value = 'word '.repeat(100).trim();
    const tool = createMemoryTool({
      userId: 'user-1',
      setMemory,
      tokenLimit: 150,
      totalTokens: 0,
    });

    await Promise.all([
      tool.invoke({ key: 'k1', title: 'Title one', value }),
      tool.invoke({ key: 'k2', title: 'Title two', value }),
    ]);

    /** Only the first write is committed; the second is rejected against the
     *  updated running total instead of the stale construction-time total. */
    expect(setMemory).toHaveBeenCalledTimes(1);
  });

  it('allows sequential writes that each fit within the remaining capacity', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    const value = 'word '.repeat(10).trim();
    const tool = createMemoryTool({
      userId: 'user-1',
      setMemory,
      tokenLimit: 1000,
      totalTokens: 0,
    });

    await tool.invoke({ key: 'k1', title: 'Title one', value });
    await tool.invoke({ key: 'k2', title: 'Title two', value });

    expect(setMemory).toHaveBeenCalledTimes(2);
  });

  it('rejects values longer than charLimit without writing', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    const tool = createMemoryTool({ userId: 'user-1', setMemory, charLimit: 10 });

    await tool.invoke({
      key: 'k1',
      title: 'Long value',
      value: 'this value is far longer than ten characters',
    });

    expect(setMemory).not.toHaveBeenCalled();
  });

  it('treats a repeat write to the same key as a replacement, not an addition', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    /** ~100 tokens; two distinct keys would exceed the 150 limit, but rewriting
     *  the same key only replaces its value and must stay within the cap. */
    const value = 'word '.repeat(100).trim();
    const tool = createMemoryTool({
      userId: 'user-1',
      setMemory,
      tokenLimit: 150,
      totalTokens: 0,
    });

    await tool.invoke({ key: 'k1', title: 'City', value });
    await tool.invoke({ key: 'k1', title: 'City', value });

    expect(setMemory).toHaveBeenCalledTimes(2);
  });

  it('fires onWrite after a successful set, but not when the write fails', async () => {
    const onWrite = jest.fn();
    const okTool = createMemoryTool({
      userId: 'user-1',
      setMemory: jest.fn().mockResolvedValue({ ok: true }),
      onWrite,
    });
    await okTool.invoke({ key: 'k1', title: 'A fact', value: 'a fact' });
    expect(onWrite).toHaveBeenCalledTimes(1);

    onWrite.mockClear();
    const failTool = createMemoryTool({
      userId: 'user-1',
      setMemory: jest.fn().mockResolvedValue({ ok: false }),
      onWrite,
    });
    await failTool.invoke({ key: 'k1', title: 'A fact', value: 'a fact' });
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('fires onWrite after a successful delete', async () => {
    const onWrite = jest.fn();
    const tool = createDeleteMemoryTool({
      userId: 'user-1',
      deleteMemory: jest.fn().mockResolvedValue({ ok: true }),
      onWrite,
    });

    await tool.invoke({ key: 'k1' });

    expect(onWrite).toHaveBeenCalledTimes(1);
  });
});

function asZodObject(tool: { schema: unknown }): ZodObject<ZodRawShape> {
  return tool.schema as ZodObject<ZodRawShape>;
}

/** The runtime tool's schema is a concrete `z.object({...})`, but `DynamicStructuredTool`
 *  types `.schema` generically as `ToolInputSchemaBase`, which doesn't expose `.shape`. */
function schemaShape(tool: { schema: unknown }): ZodRawShape {
  return (tool.schema as ZodObject<ZodRawShape>).shape;
}

describe('createMemoryTool / createDeleteMemoryTool project scope', () => {
  it('does not expose a scope parameter outside a project chat', () => {
    const setTool = createMemoryTool({ userId: 'user-1', setMemory: jest.fn() });
    const deleteTool = createDeleteMemoryTool({ userId: 'user-1', deleteMemory: jest.fn() });

    expect(Object.keys(schemaShape(setTool))).not.toContain('scope');
    expect(Object.keys(schemaShape(deleteTool))).not.toContain('scope');
  });

  it('exposes a scope parameter, defaulting to personal, inside a project chat', () => {
    const setTool = createMemoryTool({
      userId: 'user-1',
      chatProjectId: 'proj-1',
      setMemory: jest.fn(),
    });
    const deleteTool = createDeleteMemoryTool({
      userId: 'user-1',
      chatProjectId: 'proj-1',
      deleteMemory: jest.fn(),
    });

    expect(Object.keys(schemaShape(setTool))).toContain('scope');
    expect(Object.keys(schemaShape(deleteTool))).toContain('scope');
    expect((schemaShape(setTool).scope as ZodDefault<ZodTypeAny>)._def.defaultValue()).toBe(
      'personal',
    );
    expect((schemaShape(deleteTool).scope as ZodDefault<ZodTypeAny>)._def.defaultValue()).toBe(
      'personal',
    );
  });

  it('writes to the project partition only when scope is "project"', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    const tool = createMemoryTool({
      userId: 'user-1',
      chatProjectId: 'proj-1',
      setMemory,
    });

    await tool.invoke({
      key: 'k1',
      title: 'Personal fact',
      value: 'personal fact',
      scope: 'personal',
    });
    await tool.invoke({
      key: 'k2',
      title: 'Project fact',
      value: 'project fact',
      scope: 'project',
    });

    expect(setMemory).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ key: 'k1', chatProjectId: undefined }),
    );
    expect(setMemory).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ key: 'k2', chatProjectId: 'proj-1' }),
    );
  });

  it('defaults set_memory to the personal partition when scope is omitted', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    const tool = createMemoryTool({
      userId: 'user-1',
      chatProjectId: 'proj-1',
      setMemory,
    });

    await tool.invoke({ key: 'k1', title: 'A fact', value: 'a fact' });

    expect(setMemory).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'k1', chatProjectId: undefined }),
    );
  });

  it('addresses delete_memory to the partition named by scope', async () => {
    const deleteMemory = jest.fn().mockResolvedValue({ ok: true });
    const tool = createDeleteMemoryTool({
      userId: 'user-1',
      chatProjectId: 'proj-1',
      deleteMemory,
    });

    await tool.invoke({ key: 'k1', scope: 'project' });
    expect(deleteMemory).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'k1', chatProjectId: 'proj-1' }),
    );

    await tool.invoke({ key: 'k2', scope: 'personal' });
    expect(deleteMemory).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'k2', chatProjectId: undefined }),
    );
  });

  it('enforces validKeys for the personal partition but not for the project partition', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    const tool = createMemoryTool({
      userId: 'user-1',
      chatProjectId: 'proj-1',
      setMemory,
      validKeys: ['preferences'],
    });

    await tool.invoke({ key: 'not_allowed', title: 'Title', value: 'x', scope: 'personal' });
    expect(setMemory).not.toHaveBeenCalled();

    await tool.invoke({ key: 'not_allowed', title: 'Title', value: 'x', scope: 'project' });
    expect(setMemory).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'not_allowed', chatProjectId: 'proj-1' }),
    );
  });

  it('includes chatProjectId in the artifact only for a project-scoped write', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    const tool = createMemoryTool({
      userId: 'user-1',
      chatProjectId: 'proj-1',
      setMemory,
    });

    const [, personalArtifact] = await tool.func({
      key: 'k1',
      title: 'Title',
      value: 'x',
      scope: 'personal',
    });
    expect(
      (personalArtifact as Record<Tools.memory, MemoryArtifact>)[Tools.memory].chatProjectId,
    ).toBeUndefined();

    const [, projectArtifact] = await tool.func({
      key: 'k2',
      title: 'Title',
      value: 'x',
      scope: 'project',
    });
    expect(
      (projectArtifact as Record<Tools.memory, MemoryArtifact>)[Tools.memory].chatProjectId,
    ).toBe('proj-1');
  });

  it('tracks tokenLimit budgets independently per partition', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    /** ~100 tokens; already at the 100-token personal limit, but the project
     *  partition starts empty and has its own 100-token budget. */
    const value = 'word '.repeat(100).trim();
    const tool = createMemoryTool({
      userId: 'user-1',
      chatProjectId: 'proj-1',
      setMemory,
      tokenLimit: 100,
      totalTokens: 100,
      projectTotalTokens: 0,
    });

    const [personalMessage] = await tool.func({
      key: 'k1',
      title: 'Title',
      value,
      scope: 'personal',
    });
    expect(personalMessage).toContain('exceed');
    expect(setMemory).not.toHaveBeenCalled();

    const [projectMessage] = await tool.func({
      key: 'k2',
      title: 'Title',
      value,
      scope: 'project',
    });
    expect(projectMessage).toContain('tokens');
    expect(setMemory).toHaveBeenCalledTimes(1);
  });
});

describe('getMemoryToolDefinitions / registerMemoryTools project scope', () => {
  it('omits the scope parameter from JSON definitions outside a project chat', () => {
    const [setDef, deleteDef] = getMemoryToolDefinitions(undefined, false);
    expect(setDef.parameters!.properties).not.toHaveProperty('scope');
    expect(deleteDef.parameters!.properties).not.toHaveProperty('scope');
  });

  it('adds a scope parameter, defaulting to personal, inside a project chat', () => {
    const [setDef, deleteDef] = getMemoryToolDefinitions(undefined, true);
    expect(setDef.parameters!.properties).toHaveProperty('scope');
    expect(deleteDef.parameters!.properties).toHaveProperty('scope');
    expect(
      (setDef.parameters!.properties as Record<string, { default?: string }>).scope.default,
    ).toBe('personal');
  });

  it('passes hasProject through to the registered tool definitions', () => {
    const { toolDefinitions } = registerMemoryTools({ hasProject: true });
    const setDef = toolDefinitions.find((def) => def.name === 'set_memory');
    expect(setDef?.parameters!.properties).toHaveProperty('scope');
  });
});

describe('buildInlineMemoryTool content filtering', () => {
  it('keeps a legacy-only message filter scoped to ingress messages', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    const req = {
      config: {
        endpoints: {
          [EModelEndpoint.agents]: {
            capabilities: [AgentCapabilities.memory],
          },
        },
        memory: {
          disabled: false,
        },
        messageFilter: {
          pii: {
            customPatterns: [
              {
                id: 'organization-token',
                label: 'secret token',
                regex: 'ORG-[A-Z]+',
              },
            ],
          },
        },
      },
      user: {
        id: 'user-1',
        personalization: {
          memories: true,
        },
      },
    } as ServerRequest;

    const memoryTool = await buildInlineMemoryTool({
      toolName: 'set_memory',
      req,
      agent: {
        tools: [AgentCapabilities.memory],
      },
      userId: 'user-1',
      memoryMethods: {
        setMemory,
        deleteMemory: jest.fn(),
        getFormattedMemories: jest.fn(),
      },
      getRoleByName: jest.fn(),
    });

    expect(memoryTool).not.toBeNull();
    await memoryTool?.func({ key: 'preferences', title: 'Secret', value: 'Keep ORG-SECRET' });

    expect(setMemory).toHaveBeenCalledTimes(1);
    expect(setMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'preferences',
        value: 'Keep ORG-SECRET',
      }),
    );
  });
});

describe('buildInlineMemoryTool project scope wiring', () => {
  const baseReq = {
    config: {
      endpoints: {
        [EModelEndpoint.agents]: {
          capabilities: [AgentCapabilities.memory],
        },
      },
      memory: {
        disabled: false,
      },
    },
    user: {
      id: 'user-1',
      personalization: {
        memories: true,
      },
    },
  };

  it('builds set_memory with a scope parameter when the chat is inside a project', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    const req = { ...baseReq, body: { chatProjectId: 'proj-1' } } as ServerRequest;

    const memoryTool = await buildInlineMemoryTool({
      toolName: 'set_memory',
      req,
      agent: { tools: [AgentCapabilities.memory] },
      userId: 'user-1',
      memoryMethods: {
        setMemory,
        deleteMemory: jest.fn(),
        getFormattedMemories: jest.fn().mockResolvedValue({ withKeys: '', totalTokens: 0 }),
      },
      getRoleByName: jest.fn(),
    });

    expect(memoryTool).not.toBeNull();
    expect(Object.keys(schemaShape(memoryTool!))).toContain('scope');

    await memoryTool?.func({
      key: 'k1',
      title: 'Project fact',
      value: 'a project fact',
      scope: 'project',
    });
    expect(setMemory).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'k1', chatProjectId: 'proj-1' }),
    );
  });

  it('invalidates only the written partition after a scoped write', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    const getFormattedMemories = jest
      .fn()
      .mockResolvedValue({ withKeys: '', withoutKeys: '', totalTokens: 0 });
    const req = { ...baseReq, body: { chatProjectId: 'proj-1' } } as ServerRequest;

    const memoryTool = await buildInlineMemoryTool({
      toolName: 'set_memory',
      req,
      agent: { tools: [AgentCapabilities.memory] },
      userId: 'user-1',
      memoryMethods: { setMemory, deleteMemory: jest.fn(), getFormattedMemories },
      getRoleByName: jest.fn(),
    });

    // Prime both partition caches for this request.
    await getRequestMemories({ req, userId: 'user-1', getFormattedMemories });
    await getRequestMemories({
      req,
      userId: 'user-1',
      chatProjectId: 'proj-1',
      getFormattedMemories,
    });
    expect(getFormattedMemories).toHaveBeenCalledTimes(2);

    await memoryTool?.func({
      key: 'k1',
      title: 'Project fact',
      value: 'a project fact',
      scope: 'project',
    });

    /** Only the project partition cache is dropped: it re-fetches, the personal one doesn't. */
    await getRequestMemories({ req, userId: 'user-1', getFormattedMemories });
    expect(getFormattedMemories).toHaveBeenCalledTimes(2);
    await getRequestMemories({
      req,
      userId: 'user-1',
      chatProjectId: 'proj-1',
      getFormattedMemories,
    });
    expect(getFormattedMemories).toHaveBeenCalledTimes(3);
  });
});

describe('agentHasInlineMemoryTools', () => {
  it('returns false for a nullish agent', () => {
    expect(agentHasInlineMemoryTools(null)).toBe(false);
    expect(agentHasInlineMemoryTools(undefined)).toBe(false);
  });

  it('honors an explicit memoryToolsRegistered flag over the raw marker', () => {
    /** Initialized config whose registration was denied (memoryAvailable false)
     *  but whose raw `memory` marker survived in tools must not be treated as
     *  memory-enabled. */
    expect(agentHasInlineMemoryTools({ memoryToolsRegistered: false, tools: ['memory'] })).toBe(
      false,
    );
    expect(agentHasInlineMemoryTools({ memoryToolsRegistered: true, tools: [] })).toBe(true);
  });

  it('falls back to the raw memory marker when no flag is present', () => {
    expect(agentHasInlineMemoryTools({ tools: ['memory'] })).toBe(true);
    expect(agentHasInlineMemoryTools({ tools: [{ name: 'memory' }] })).toBe(true);
    expect(agentHasInlineMemoryTools({ tools: ['execute_code'] })).toBe(false);
    expect(agentHasInlineMemoryTools({ tools: [] })).toBe(false);
  });
});

describe('buildInlineMemoryContext', () => {
  it('loads keyed memories for an initialized inline-memory agent', async () => {
    const getFormattedMemories = jest.fn().mockResolvedValue({
      withKeys: 'preferred_name: Danny',
      withoutKeys: 'Danny',
      totalTokens: 4,
    });
    const context = await buildInlineMemoryContext({
      agent: {
        id: 'agent_memory',
        memory_scope: MemoryScope.agent,
        memoryToolsRegistered: true,
      },
      req: {} as never,
      userId: 'user-1',
      memoryAvailable: true,
      getFormattedMemories,
    });

    expect(context).toContain('# Existing memory about the user:\npreferred_name: Danny');
    expect(getFormattedMemories).toHaveBeenCalledWith({
      userId: 'user-1',
      agentId: 'agent_memory',
    });
  });

  it('does not load memories when inline tools are unavailable', async () => {
    const getFormattedMemories = jest.fn();
    await expect(
      buildInlineMemoryContext({
        agent: { id: 'agent_without_memory', memoryToolsRegistered: false },
        req: {} as never,
        userId: 'user-1',
        memoryAvailable: true,
        getFormattedMemories,
      }),
    ).resolves.toBe('');
    expect(getFormattedMemories).not.toHaveBeenCalled();
  });

  it('renders both partitions as separate blocks inside a project chat', async () => {
    const getFormattedMemories = jest
      .fn()
      .mockImplementation(({ chatProjectId }) =>
        Promise.resolve(
          chatProjectId
            ? { withKeys: 'project_fact: uses Postgres', withoutKeys: '', totalTokens: 5 }
            : { withKeys: 'preferred_name: Danny', withoutKeys: '', totalTokens: 4 },
        ),
      );

    const context = await buildInlineMemoryContext({
      agent: { id: 'agent_memory', memoryToolsRegistered: true },
      req: { body: { chatProjectId: 'proj-1' } } as never,
      userId: 'user-1',
      memoryAvailable: true,
      getFormattedMemories,
    });

    expect(context).toContain('# Existing memory about the user:\npreferred_name: Danny');
    expect(context).toContain(
      '# Existing memory for the current project:\nproject_fact: uses Postgres',
    );
    expect(context).toContain('takes precedence over the personal memory value');
  });

  it('omits a partition block when that partition has no memories', async () => {
    const getFormattedMemories = jest
      .fn()
      .mockImplementation(({ chatProjectId }) =>
        Promise.resolve(
          chatProjectId
            ? { withKeys: '', withoutKeys: '', totalTokens: 0 }
            : { withKeys: 'preferred_name: Danny', withoutKeys: '', totalTokens: 4 },
        ),
      );

    const context = await buildInlineMemoryContext({
      agent: { id: 'agent_memory', memoryToolsRegistered: true },
      req: { body: { chatProjectId: 'proj-1' } } as never,
      userId: 'user-1',
      memoryAvailable: true,
      getFormattedMemories,
    });

    expect(context).toContain('# Existing memory about the user:\npreferred_name: Danny');
    expect(context).not.toContain('# Existing memory for the current project:');
  });

  it('returns an empty string when both partitions are empty inside a project chat', async () => {
    const getFormattedMemories = jest
      .fn()
      .mockResolvedValue({ withKeys: '', withoutKeys: '', totalTokens: 0 });

    const context = await buildInlineMemoryContext({
      agent: { id: 'agent_memory', memoryToolsRegistered: true },
      req: { body: { chatProjectId: 'proj-1' } } as never,
      userId: 'user-1',
      memoryAvailable: true,
      getFormattedMemories,
    });

    expect(context).toBe('');
  });
});

describe('getRequestMemories caching', () => {
  it('memoizes per request, then re-fetches after invalidation', async () => {
    const getFormattedMemories = jest
      .fn()
      .mockResolvedValue({ withKeys: '', withoutKeys: '', totalTokens: 10 });
    const req = {};

    await getRequestMemories({ req, userId: 'user-1', getFormattedMemories });
    await getRequestMemories({ req, userId: 'user-1', getFormattedMemories });
    /** A second memory-enabled agent in the same run reuses the first fetch. */
    expect(getFormattedMemories).toHaveBeenCalledTimes(1);

    /** A successful inline write invalidates the cache so a later tool round in
     *  the same response re-reads the post-write usage total. */
    invalidateRequestMemories(req);
    await getRequestMemories({ req, userId: 'user-1', getFormattedMemories });
    expect(getFormattedMemories).toHaveBeenCalledTimes(2);
  });

  it('caches and invalidates per partition', async () => {
    const getFormattedMemories = jest
      .fn()
      .mockResolvedValue({ withKeys: '', withoutKeys: '', totalTokens: 10 });
    const req = {};

    await getRequestMemories({ req, userId: 'user-1', getFormattedMemories });
    await getRequestMemories({ req, userId: 'user-1', agentId: 'agent_a', getFormattedMemories });
    await getRequestMemories({ req, userId: 'user-1', agentId: 'agent_a', getFormattedMemories });
    /** Personal pool and agent partition are distinct cache entries. */
    expect(getFormattedMemories).toHaveBeenCalledTimes(2);
    expect(getFormattedMemories).toHaveBeenLastCalledWith({
      userId: 'user-1',
      agentId: 'agent_a',
    });

    /** Invalidating one partition leaves the other cached. */
    invalidateRequestMemories(req, 'agent_a');
    await getRequestMemories({ req, userId: 'user-1', getFormattedMemories });
    expect(getFormattedMemories).toHaveBeenCalledTimes(2);
    await getRequestMemories({ req, userId: 'user-1', agentId: 'agent_a', getFormattedMemories });
    expect(getFormattedMemories).toHaveBeenCalledTimes(3);
  });

  it('does not collide between an agentId partition and a same-named chatProjectId partition', async () => {
    const getFormattedMemories = jest
      .fn()
      .mockResolvedValue({ withKeys: '', withoutKeys: '', totalTokens: 10 });
    const req = {};

    await getRequestMemories({ req, userId: 'user-1', agentId: 'shared-id', getFormattedMemories });
    await getRequestMemories({
      req,
      userId: 'user-1',
      chatProjectId: 'shared-id',
      getFormattedMemories,
    });
    /** An agent partition and a project partition sharing the same id string are
     *  distinct cache entries — the composite key must not collide. */
    expect(getFormattedMemories).toHaveBeenCalledTimes(2);

    await getRequestMemories({ req, userId: 'user-1', agentId: 'shared-id', getFormattedMemories });
    await getRequestMemories({
      req,
      userId: 'user-1',
      chatProjectId: 'shared-id',
      getFormattedMemories,
    });
    expect(getFormattedMemories).toHaveBeenCalledTimes(2);

    /** Invalidating the project partition leaves the agent partition cached. */
    invalidateRequestMemories(req, undefined, 'shared-id');
    await getRequestMemories({ req, userId: 'user-1', agentId: 'shared-id', getFormattedMemories });
    expect(getFormattedMemories).toHaveBeenCalledTimes(2);
    await getRequestMemories({
      req,
      userId: 'user-1',
      chatProjectId: 'shared-id',
      getFormattedMemories,
    });
    expect(getFormattedMemories).toHaveBeenCalledTimes(3);
  });
});

describe('getMemoryAgentId', () => {
  it('resolves the agent partition only for memory_scope "agent"', () => {
    expect(getMemoryAgentId({ id: 'agent_a', memory_scope: MemoryScope.agent })).toBe('agent_a');
    expect(getMemoryAgentId({ id: 'agent_a', memory_scope: MemoryScope.user })).toBeUndefined();
    expect(getMemoryAgentId({ id: 'agent_a' })).toBeUndefined();
    expect(getMemoryAgentId({ memory_scope: MemoryScope.agent })).toBeUndefined();
    expect(getMemoryAgentId(null)).toBeUndefined();
  });

  it('strips runtime id suffixes so added-conversation runs share the persisted partition', () => {
    expect(getMemoryAgentId({ id: 'agent_a____1', memory_scope: MemoryScope.agent })).toBe(
      'agent_a',
    );
  });
});

describe('memory model-bound content preflight', () => {
  const res = {
    write: jest.fn(),
    end: jest.fn(),
    headersSent: false,
  } as unknown as Response;
  const setMemory = jest.fn().mockResolvedValue({ ok: true });
  const deleteMemory = jest.fn().mockResolvedValue({ ok: true });
  const baseArgs = {
    res,
    userId: 'user-1',
    setMemory,
    deleteMemory,
    messages: [],
    memory: '',
    messageId: 'message-1',
    conversationId: 'conversation-1',
    instructions: 'Safe memory instructions',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks a canonical memory key before creating a model run', async () => {
    const rawValue = 'PRIVATE-MEMORY-KEY';

    await processMemory({
      ...baseArgs,
      memory: `1. ["key": "${rawValue}"]. ["value": "safe"]`,
      memoryEntries: [{ key: rawValue, value: 'safe' }],
      filters: {
        memories: {
          pii: {
            fields: ['key'],
            starterPatterns: [],
            customPatterns: [{ id: 'private', label: 'private value', regex: rawValue }],
          },
        },
      },
    });

    expect(Run.create).not.toHaveBeenCalled();
  });

  it('conservatively checks flattened memory for direct callers without canonical rows', async () => {
    const rawValue = 'PRIVATE-FLATTENED-KEY';

    await processMemory({
      ...baseArgs,
      memory: `["key": "${rawValue}"]`,
      filters: {
        memories: {
          pii: {
            fields: ['key'],
            starterPatterns: [],
            customPatterns: [{ id: 'private', label: 'private value', regex: rawValue }],
          },
        },
      },
    });

    expect(Run.create).not.toHaveBeenCalled();
  });

  it('checks human input and agent configuration without classifying model output as submitted', async () => {
    const rawValue = 'PRIVATE-MEMORY-INPUT';
    const filters: FiltersConfig = {
      messages: {
        pii: {
          fields: ['text'],
          starterPatterns: [],
          customPatterns: [{ id: 'private', label: 'private value', regex: rawValue }],
        },
      },
    };

    await processMemory({
      ...baseArgs,
      messages: [new HumanMessage(rawValue)],
      filters,
    });
    expect(Run.create).not.toHaveBeenCalled();

    jest.clearAllMocks();
    await processMemory({
      ...baseArgs,
      messages: [new AIMessage(rawValue)],
      filters,
    });
    expect(Run.create).toHaveBeenCalledTimes(1);
  });

  it('uses role-preserving inspection messages for a flattened memory prompt', async () => {
    const rawValue = 'PRIVATE-MEMORY-MODEL-OUTPUT';
    const filters: FiltersConfig = {
      messages: {
        pii: {
          fields: ['text'],
          starterPatterns: [],
          customPatterns: [{ id: 'private', label: 'private value', regex: rawValue }],
        },
      },
    };

    await processMemory({
      ...baseArgs,
      messages: [new HumanMessage(`# Current Chat:\n\nAI: ${rawValue}`)],
      inspectionMessages: [new HumanMessage('Safe user input'), new AIMessage(rawValue)],
      filters,
    });

    expect(Run.create).toHaveBeenCalledTimes(1);
  });

  it('fails closed when canonical memory rows cannot be loaded under active policy', async () => {
    const getUserMemories = jest.fn().mockRejectedValue(new Error('database unavailable'));

    await expect(
      createMemoryProcessor({
        res,
        userId: 'user-1',
        messageId: 'message-1',
        conversationId: 'conversation-1',
        filters: {
          memories: {
            pii: {
              fields: ['key'],
              starterPatterns: ['sk_prefix'],
            },
          },
        },
        memoryMethods: {
          setMemory,
          deleteMemory,
          getUserMemories,
          getFormattedMemories: jest.fn().mockResolvedValue({
            withKeys: 'formatted memory',
            withoutKeys: 'memory',
            totalTokens: 1,
          }),
        },
      }),
    ).rejects.toThrow('database unavailable');
    expect(getUserMemories).toHaveBeenCalledTimes(1);
    expect(Run.create).not.toHaveBeenCalled();
  });
});

describe('set_memory / delete_memory title requirement', () => {
  it('requires title in both the zod schema and the JSON schema definition', () => {
    const setTool = createMemoryTool({ userId: 'user-1', setMemory: jest.fn() });

    expect(asZodObject(setTool).safeParse({ key: 'k1', value: 'v1' }).success).toBe(false);
    expect(
      asZodObject(setTool).safeParse({ key: 'k1', title: 'A title', value: 'v1' }).success,
    ).toBe(true);

    const [setDef] = getMemoryToolDefinitions();
    expect(setDef.parameters!.required).toEqual(['key', 'title', 'value']);
  });

  it('requires title in the project-scoped schema forms too', () => {
    const setTool = createMemoryTool({
      userId: 'user-1',
      chatProjectId: 'proj-1',
      setMemory: jest.fn(),
    });

    expect(
      asZodObject(setTool).safeParse({ key: 'k1', value: 'v1', scope: 'project' }).success,
    ).toBe(false);

    const [setDef] = getMemoryToolDefinitions(undefined, true);
    expect(setDef.parameters!.required).toEqual(['key', 'title', 'value']);
  });

  it("describes title as a short name in the user's own language, never the key", () => {
    const setTool = createMemoryTool({ userId: 'user-1', setMemory: jest.fn() });
    const titleDescription = (schemaShape(setTool).title as ZodTypeAny).description ?? '';

    expect(titleDescription).toMatch(/language/i);
    expect(titleDescription).toMatch(/2.?6 words|short/i);
    expect(titleDescription).toMatch(/never.*key|not.*key/i);
    expect(titleDescription.toLowerCase()).toContain('snake_case');

    const [setDef] = getMemoryToolDefinitions();
    const titleProperty = (
      setDef.parameters!.properties as Record<string, { description?: string }>
    ).title;
    expect(titleProperty.description).toBe(titleDescription);
  });

  it('describes key as an internal, lowercase identifier never shown to the user', () => {
    const setTool = createMemoryTool({ userId: 'user-1', setMemory: jest.fn() });
    const setKeyDescription = (schemaShape(setTool).key as ZodTypeAny).description ?? '';
    expect(setKeyDescription).toMatch(/internal|lowercase/i);
    expect(setKeyDescription).toMatch(/not shown|never shown/i);

    const deleteTool = createDeleteMemoryTool({ userId: 'user-1', deleteMemory: jest.fn() });
    const deleteKeyDescription = (schemaShape(deleteTool).key as ZodTypeAny).description ?? '';
    expect(deleteKeyDescription).toMatch(/internal|lowercase/i);
    expect(deleteKeyDescription).toMatch(/not shown|never shown/i);
  });

  it('passes a supplied title to storage and to the update artifact', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    const tool = createMemoryTool({ userId: 'user-1', setMemory });

    const [, artifact] = await tool.func({
      key: 'preferred_name',
      title: 'Preferred name',
      value: 'Danny',
    });

    expect(setMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'preferred_name',
        title: 'Preferred name',
        value: 'Danny',
      }),
    );
    expect((artifact as Record<Tools.memory, MemoryArtifact>)[Tools.memory].title).toBe(
      'Preferred name',
    );
  });

  it('names the deleted entry by its saved title in the artifact', async () => {
    const deleteMemory = jest.fn().mockResolvedValue({ ok: true, title: 'Preferred name' });
    const tool = createDeleteMemoryTool({ userId: 'user-1', deleteMemory });

    const [, artifact] = await tool.func({ key: 'preferred_name' });

    expect((artifact as Record<Tools.memory, MemoryArtifact>)[Tools.memory].title).toBe(
      'Preferred name',
    );
  });

  it('omits title from the delete artifact when the deleted entry never had one', async () => {
    const deleteMemory = jest.fn().mockResolvedValue({ ok: true });
    const tool = createDeleteMemoryTool({ userId: 'user-1', deleteMemory });

    const [, artifact] = await tool.func({ key: 'preferred_name' });

    expect((artifact as Record<Tools.memory, MemoryArtifact>)[Tools.memory].title).toBeUndefined();
  });

  it("tells the model, in the default instructions and the usage guard, to write titles in the user's own language", () => {
    expect(memoryToolUsageGuard).toMatch(/title/i);
    expect(memoryToolUsageGuard).toMatch(/user's own language/i);

    const instructions = getDefaultInstructions();
    expect(instructions).toMatch(/title/i);
    expect(instructions).toMatch(/user's own language/i);
  });
});

describe('isExplicitMemoryRequest', () => {
  it.each([
    'Запомни, что я руковожу отделом продаж',
    'ЗАПОМНИТЕ мой телефон',
    'Не забудь про встречу в пятницу',
    'запиши себе: отчёт по понедельникам',
    'Сохрани в памяти мой часовой пояс',
    'Забудь мой старый адрес',
    'Please REMEMBER that I prefer short answers',
    'forget my old email',
    'Запиши: созвон по вторникам',
    'Сохрани мой новый телефон',
    'Не забывай, что я на удалёнке по пятницам',
    'Это можно ЗАБЫТЬ',
    'Удали из памяти мой старый адрес',
    'Учти на будущее: отчёты только в PDF',
    'Имей в виду, что я в отпуске до 10.10',
    'Keep in mind that I report to the CFO',
    'Note that our fiscal year starts in April',
    'Удалите из памяти мой телефон',
    'Убери из памяти старый адрес',
    'Сотри мой старый адрес из памяти',
    'Очисти память',
    'Запомните: созвон по средам',
    'Can you remember that I work remotely on Fridays?',
  ])('распознаёт явную просьбу: %s', (text) => {
    expect(isExplicitMemoryRequest(text)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'Посчитай тариф для ООО «Ромашка»',
    'What is our refund policy?',
    'Ты запомнил мой номер?',
    'Помнишь, что мы обсуждали про Бета-Банк?',
    'Do you remember what we discussed about X?',
    'I remember we agreed on 1,5%',
    'Удали лишний пункт из договора',
  ])(
    'не считает просьбой обычное сообщение: %s',
    (text) => {
      expect(isExplicitMemoryRequest(text)).toBe(false);
    },
  );
});

describe('isRecallRequest', () => {
  it.each([
    'Напомни, что мы недавно обсуждали про договор с Бета-Банком',
    'Напомните детали по Ромашке',
    'Помнишь, какой тариф мы считали?',
    'О чём мы говорили вчера?',
    'Что мы решили по Ромашке?',
    'Remind me what we agreed on',
    'What did we discuss yesterday?',
    'Do you remember the tariff?',
  ])('распознаёт вопрос о прошлых беседах: %s', (text) => {
    expect(isRecallRequest(text)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'Посчитай тариф для ООО «Ромашка»',
    'Мы решили взять 1,5% — составь письмо',
    'Я руковожу отделом продаж',
    'Поставь напоминание на пятницу',
  ])('не считает вопросом о прошлом обычное сообщение: %s', (text) => {
    expect(isRecallRequest(text)).toBe(false);
  });
});

describe('auto-memory guidance', () => {
  it('lets the model save useful facts without being asked, within limits', () => {
    expect(memoryToolUsageGuard).not.toMatch(/only use the `set_memory`/i);
    expect(memoryToolUsageGuard).toMatch(/without being asked|own initiative/i);
    expect(memoryToolUsageGuard).toMatch(/role/i);
    expect(memoryToolUsageGuard).toMatch(/decisions/i);
    expect(memoryToolUsageGuard).toMatch(/deadlines/i);
    expect(memoryToolUsageGuard).toMatch(/secrets/i);
    expect(memoryToolUsageGuard).toMatch(/tool results/i);
    expect(memoryToolUsageGuard).toMatch(/instead of creating a duplicate/i);
    expect(memoryToolUsageGuard).toMatch(/one or two/i);
    expect(memoryToolUsageGuard).toMatch(/do not mention/i);
    expect(memoryToolUsageGuard).toMatch(/remember that/i);
    expect(memoryToolUsageGuard).toMatch(/forget/i);
  });

  it('forbids creating memories from recent-conversation summaries, but not repeated facts or explicit requests', () => {
    expect(memoryToolUsageGuard).toMatch(/do not create memories from the recent-conversation summaries/i);
    expect(memoryToolUsageGuard).toMatch(/states or confirms in the current conversation/i);
    expect(memoryToolUsageGuard).toMatch(/explicitly asks you to remember/i);
    expect(memoryToolUsageGuard).not.toMatch(/existing memory into memory/i);
  });

  it('tells the model that set_memory replaces the whole value of a key', () => {
    expect(memoryToolUsageGuard).toMatch(/replaces the whole value/i);
    expect(memoryToolUsageGuard).toMatch(/complete new value/i);
    expect(memoryToolUsageGuard).toMatch(/still true/i);
  });

  it('sends facts about the person to personal memory and project work to the project', () => {
    expect(memoryScopeGuidance).toMatch(/"personal" for facts about the user themself/i);
    expect(memoryScopeGuidance).toMatch(/"project" for the work of the current project/i);
  });

  it('restricts keys to lowercase Latin letters and underscores in both schemas', () => {
    const setTool = createMemoryTool({ userId: 'user-1', setMemory: jest.fn() });
    const keyDescription = (schemaShape(setTool).key as ZodTypeAny).description ?? '';
    expect(keyDescription).toMatch(/a-z/);
    expect(keyDescription).toMatch(/underscore/i);
    expect(keyDescription).toMatch(/no digits/i);

    const [setDef] = getMemoryToolDefinitions();
    const keyProperty = (setDef.parameters!.properties as Record<string, { description?: string }>)
      .key;
    expect(keyProperty.description).toBe(keyDescription);
  });
});

describe('buildInlineMemoryTool auto-memory wiring', () => {
  const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    jest.spyOn(Tokenizer, 'getTokenCount').mockReturnValue(10);
  });

  afterEach(() => {
    jest.mocked(Tokenizer.getTokenCount).mockRestore();
  });

  const baseReq = {
    config: {
      endpoints: {
        [EModelEndpoint.agents]: {
          capabilities: [AgentCapabilities.memory],
        },
      },
      memory: {
        disabled: false,
        tokenLimit: 100,
      },
    },
    user: {
      id: 'user-1',
      personalization: {
        memories: true,
      },
    },
  };

  function buildTool(
    text: string | undefined,
    options: {
      totalTokens?: number;
      chatProjectId?: string;
      setMemory?: jest.Mock;
      compactMemory?: jest.Mock;
    } = {},
  ) {
    const req = {
      ...baseReq,
      body: { text, ...(options.chatProjectId ? { chatProjectId: options.chatProjectId } : {}) },
    } as ServerRequest;
    const getFormattedMemories = jest
      .fn()
      .mockResolvedValue({ withKeys: '', withoutKeys: '', totalTokens: options.totalTokens ?? 0 });
    return {
      req,
      getFormattedMemories,
      toolPromise: buildInlineMemoryTool({
        toolName: 'set_memory',
        req,
        agent: { tools: [AgentCapabilities.memory] },
        userId: 'user-1',
        memoryMethods: {
          setMemory: options.setMemory ?? jest.fn().mockResolvedValue({ ok: true, previous: null }),
          deleteMemory: jest.fn(),
          getFormattedMemories,
        },
        getRoleByName: jest.fn(),
        compactMemory: options.compactMemory,
      }),
    };
  }

  it('marks a write as automatic unless the user asked to remember', async () => {
    const auto = await buildTool('Посчитай тариф').toolPromise;
    const explicit = await buildTool('Запомни: я руковожу отделом продаж').toolPromise;

    const [, autoArtifact] = await auto!.func({
      key: 'role',
      title: 'Роль',
      value: 'Руководитель',
    });
    const [, explicitArtifact] = await explicit!.func({
      key: 'role',
      title: 'Роль',
      value: 'Руководитель',
    });

    expect((autoArtifact as Record<Tools.memory, MemoryArtifact>)[Tools.memory].auto).toBe(true);
    expect((explicitArtifact as Record<Tools.memory, MemoryArtifact>)[Tools.memory].auto).toBe(
      false,
    );
  });

  it('keeps the red card for an explicit request but stays quiet for an automatic write', async () => {
    const explicit = await buildTool('Запомни мой телефон', { totalTokens: 150 }).toolPromise;
    const auto = await buildTool('Какая погода?', { totalTokens: 150 }).toolPromise;

    const [, explicitArtifact] = await explicit!.func({
      key: 'phone',
      title: 'Телефон',
      value: '1',
    });
    const [autoText, autoArtifact] = await auto!.func({
      key: 'phone',
      title: 'Телефон',
      value: '1',
    });

    expect((explicitArtifact as Record<Tools.memory, MemoryArtifact>)[Tools.memory].type).toBe(
      'error',
    );
    expect(autoArtifact).toBeUndefined();
    expect(autoText).toMatch(/do not retry and do not mention this to the user/i);
  });

  it('starts a background compaction of the written partition without waiting for it', async () => {
    const compactMemory = jest.fn(() => new Promise<never>(() => undefined));
    const setMemory = jest.fn().mockResolvedValue({ ok: true, previous: null });
    const tool = await buildTool('Обсудим договор', {
      totalTokens: 85,
      chatProjectId: 'proj-1',
      setMemory,
      compactMemory,
    }).toolPromise;

    const [text, artifact] = await tool!.func({
      key: 'contract',
      title: 'Договор',
      value: 'Договор до конца года',
      scope: 'project',
    });
    await flushPromises();

    expect(text).toBe('Saved. Do not mention saving to the user.');
    expect(setMemory).toHaveBeenCalledTimes(1);
    expect(compactMemory).toHaveBeenCalledWith({ agentId: undefined, chatProjectId: 'proj-1' });
    expect((artifact as Record<Tools.memory, MemoryArtifact>)[Tools.memory]).not.toHaveProperty(
      'compaction',
    );
  });

  it('refreshes the cached partition total once a background compaction lands', async () => {
    let finish: (outcome: CompactionOutcome) => void = () => undefined;
    const compactMemory = jest.fn(
      () =>
        new Promise<CompactionOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    const { toolPromise, req, getFormattedMemories } = buildTool('Обсудим договор', {
      totalTokens: 85,
      compactMemory,
    });
    const tool = await toolPromise;

    await tool!.func({ key: 'role', title: 'Роль', value: 'Руководитель' });
    await getRequestMemories({ req, userId: 'user-1', getFormattedMemories });
    const callsBeforeCompaction = getFormattedMemories.mock.calls.length;
    finish({
      compacted: true,
      before: 9,
      after: 4,
      beforeTokens: 95,
      afterTokens: 20,
      snapshotId: 'snap-1',
    });
    await flushPromises();
    await getRequestMemories({ req, userId: 'user-1', getFormattedMemories });

    expect(compactMemory).toHaveBeenCalledWith({ agentId: undefined, chatProjectId: undefined });
    expect(getFormattedMemories.mock.calls.length).toBe(callsBeforeCompaction + 1);
  });

  it('does not compact when the write itself was refused for lack of room', async () => {
    const compactMemory = jest.fn();
    const tool = await buildTool('Обсудим договор', {
      totalTokens: 95,
      compactMemory,
    }).toolPromise;

    const [text, artifact] = await tool!.func({
      key: 'role',
      title: 'Роль',
      value: 'Руководитель отдела продаж в компании Corporate с весны 2024 года',
    });
    await flushPromises();

    expect(artifact).toBeUndefined();
    expect(text).toMatch(/Memory is full/);
    expect(compactMemory).not.toHaveBeenCalled();
  });

  it('only logs a failed background compaction', async () => {
    const compactMemory = jest.fn().mockRejectedValue(new Error('model down'));
    const setMemory = jest.fn().mockResolvedValue({ ok: true, previous: null });
    const tool = await buildTool('Обсудим договор', {
      totalTokens: 85,
      setMemory,
      compactMemory,
    }).toolPromise;

    const [text] = await tool!.func({ key: 'role', title: 'Роль', value: 'ok' });
    await flushPromises();

    expect(text).toBe('Saved. Do not mention saving to the user.');
    expect(compactMemory).toHaveBeenCalledTimes(1);
    expect(setMemory).toHaveBeenCalledTimes(1);
  });

  it('makes no automatic writes when the user asks about past conversations, unless asked to remember', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true, previous: null });
    const buildFor = (text: string) =>
      buildInlineMemoryTool({
        toolName: 'set_memory',
        req: { ...baseReq, body: { text } } as ServerRequest,
        agent: { tools: [AgentCapabilities.memory] },
        userId: 'user-1',
        memoryMethods: {
          setMemory,
          deleteMemory: jest.fn(),
          getFormattedMemories: jest.fn().mockResolvedValue({ totalTokens: 0 }),
        },
        getRoleByName: jest.fn(),
      });

    const recallTool = await buildFor('Напомни, что мы обсуждали про Бета-Банк?');
    const [recallText, recallArtifact] = await recallTool!.func({
      key: 'beta_bank_plan',
      title: 'План Бета-Банка',
      value: 'Подписать 9 октября',
    });
    const explicitTool = await buildFor('Напомни, что мы решили, и запомни это');
    await explicitTool!.func({ key: 'decision', title: 'Решение', value: 'Тариф 1,5%' });

    expect(recallText).toMatch(/asking about past conversations/i);
    expect(recallArtifact).toBeUndefined();
    expect(setMemory.mock.calls.map(([p]) => p.key)).toEqual(['decision']);
  });

  it('allows at most two automatic writes per request, explicit requests are not capped', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true, previous: null });
    const buildFor = (req: ServerRequest) =>
      buildInlineMemoryTool({
        toolName: 'set_memory',
        req,
        agent: { tools: [AgentCapabilities.memory] },
        userId: 'user-1',
        memoryMethods: {
          setMemory,
          deleteMemory: jest.fn(),
          getFormattedMemories: jest.fn().mockResolvedValue({ totalTokens: 0 }),
        },
        getRoleByName: jest.fn(),
      });
    const autoReq = { ...baseReq, body: { text: 'Обсудим договор' } } as ServerRequest;
    const explicitReq = { ...baseReq, body: { text: 'Запомни три факта' } } as ServerRequest;

    const autoResults = [];
    for (const key of ['one', 'two', 'three']) {
      const tool = await buildFor(autoReq);
      autoResults.push(await tool!.func({ key, title: 'Факт', value: key }));
    }
    for (const key of ['four', 'five', 'six']) {
      const tool = await buildFor(explicitReq);
      await tool!.func({ key, title: 'Факт', value: key });
    }

    expect(autoResults[2][0]).toMatch(/Not saved/);
    expect(autoResults[2][1]).toBeUndefined();
    expect(setMemory.mock.calls.map(([p]) => p.key)).toEqual(['one', 'two', 'four', 'five', 'six']);
  });

  it('deletes only on an explicit request', async () => {
    const deleteMemory = jest.fn().mockResolvedValue({ ok: true });
    const build = (text: string) =>
      buildInlineMemoryTool({
        toolName: 'delete_memory',
        req: { ...baseReq, body: { text } } as ServerRequest,
        agent: { tools: [AgentCapabilities.memory] },
        userId: 'user-1',
        memoryMethods: { setMemory: jest.fn(), deleteMemory, getFormattedMemories: jest.fn() },
        getRoleByName: jest.fn(),
      });

    const [autoText, autoArtifact] = await (await build('Посчитай тариф'))!.func({ key: 'role' });
    await (await build('Забудь мою роль'))!.func({ key: 'role' });

    expect(autoText).toMatch(/deleted only when the user explicitly asks/i);
    expect(autoArtifact).toBeUndefined();
    expect(deleteMemory).toHaveBeenCalledTimes(1);
  });
});

import { Response } from 'express';
import { Providers } from '@librechat/agents';
import { Tools } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import type { MemoryArtifact } from 'librechat-data-provider';
import { createMemoryTool, processMemory, createDeleteMemoryTool } from '../memory';
import Tokenizer from '~/utils/tokenizer';

// Mock the logger
// `winston.format` must be a callable factory (real winston returns a Format
// constructor) so that `@librechat/data-schemas` dist code can complete its
// module-load — see api/test/__mocks__/logger.js for the canonical shape.
jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  })),
  format: Object.assign(
    jest.fn((fn) => () => ({ transform: fn })),
    {
      combine: jest.fn(),
      colorize: jest.fn(),
      simple: jest.fn(),
      label: jest.fn(),
      timestamp: jest.fn(),
      printf: jest.fn(),
      errors: jest.fn(),
      splat: jest.fn(),
      json: jest.fn(),
    },
  ),
  addColors: jest.fn(),
  transports: {
    Console: jest.fn(),
    DailyRotateFile: jest.fn(),
    File: jest.fn(),
  },
}));

// Mock the Tokenizer
jest.mock('~/utils/tokenizer', () => ({
  __esModule: true,
  default: {
    getTokenCount: jest.fn((text: string) => text.length), // Simple mock: 1 char = 1 token
  },
}));

// Mock the Run module
jest.mock('@librechat/agents', () => ({
  ...jest.requireActual('@librechat/agents'),
  Run: {
    create: jest.fn(),
  },
  Providers: {
    OPENAI: 'openai',
    ANTHROPIC: 'anthropic',
    AZURE: 'azure',
  },
  GraphEvents: {
    TOOL_END: 'tool_end',
  },
}));

describe('createMemoryTool', () => {
  let mockSetMemory: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSetMemory = jest.fn().mockResolvedValue({ ok: true });
  });

  // Memory overflow tests
  describe('overflow handling', () => {
    it('should return error artifact when memory is already overflowing', async () => {
      const tool = createMemoryTool({
        userId: 'test-user',
        setMemory: mockSetMemory,
        tokenLimit: 100,
        totalTokens: 150, // Already over limit
      });

      // Call the underlying function directly since invoke() doesn't handle responseFormat in tests
      const result = await tool.func({ key: 'test', value: 'new memory' });
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('Memory storage exceeded. Cannot save new memories.');

      const artifacts = result[1] as Record<Tools.memory, MemoryArtifact>;
      expect(artifacts[Tools.memory]).toBeDefined();
      expect(artifacts[Tools.memory].type).toBe('error');
      expect(artifacts[Tools.memory].key).toBe('system');

      const errorData = JSON.parse(artifacts[Tools.memory].value as string);
      expect(errorData).toEqual({
        errorType: 'already_exceeded',
        tokenCount: 50,
        totalTokens: 150,
        tokenLimit: 100,
      });

      expect(mockSetMemory).not.toHaveBeenCalled();
    });

    it('should return error artifact when new memory would exceed limit', async () => {
      const tool = createMemoryTool({
        userId: 'test-user',
        setMemory: mockSetMemory,
        tokenLimit: 100,
        totalTokens: 80,
      });

      // This would put us at 101 tokens total, exceeding the limit
      const result = await tool.func({ key: 'test', value: 'This is a 20 char str' });
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('Memory storage would exceed limit. Cannot save this memory.');

      const artifacts = result[1] as Record<Tools.memory, MemoryArtifact>;
      expect(artifacts[Tools.memory]).toBeDefined();
      expect(artifacts[Tools.memory].type).toBe('error');
      expect(artifacts[Tools.memory].key).toBe('system');

      const errorData = JSON.parse(artifacts[Tools.memory].value as string);
      expect(errorData).toEqual({
        errorType: 'would_exceed',
        tokenCount: 1, // Math.abs(-1)
        totalTokens: 101,
        tokenLimit: 100,
      });

      expect(mockSetMemory).not.toHaveBeenCalled();
    });

    it('should successfully save memory when below limit', async () => {
      const tool = createMemoryTool({
        userId: 'test-user',
        setMemory: mockSetMemory,
        tokenLimit: 100,
        totalTokens: 50,
      });

      const result = await tool.func({ key: 'test', value: 'small memory' });
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('Memory set for key "test" (12 tokens)');

      const artifacts = result[1] as Record<Tools.memory, MemoryArtifact>;
      expect(artifacts[Tools.memory]).toBeDefined();
      expect(artifacts[Tools.memory].type).toBe('update');
      expect(artifacts[Tools.memory].key).toBe('test');
      expect(artifacts[Tools.memory].value).toBe('small memory');

      expect(mockSetMemory).toHaveBeenCalledWith({
        userId: 'test-user',
        key: 'test',
        value: 'small memory',
        tokenCount: 12,
      });
    });
  });

  // Basic functionality tests
  describe('basic functionality', () => {
    it('should validate keys when validKeys is provided', async () => {
      const tool = createMemoryTool({
        userId: 'test-user',
        setMemory: mockSetMemory,
        validKeys: ['allowed', 'keys'],
      });

      const result = await tool.func({ key: 'invalid', value: 'some value' });
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('Invalid key "invalid". Must be one of: allowed, keys');
      expect(result[1]).toBeUndefined();
      expect(mockSetMemory).not.toHaveBeenCalled();
    });

    it('filters invalid keys before logging and never logs submitted content', async () => {
      const protectedValue = 'ORG-PRIVATE-KEY';
      const warn = jest.spyOn(logger, 'warn');
      const tool = createMemoryTool({
        userId: 'test-user',
        setMemory: mockSetMemory,
        validKeys: ['allowed'],
        filters: {
          memories: {
            pii: {
              fields: ['key'],
              starterPatterns: [],
              customPatterns: [
                {
                  id: 'organization-token',
                  label: 'secret token',
                  regex: 'ORG-[A-Z-]+',
                },
              ],
            },
          },
        },
      });

      const result = await tool.func({ key: protectedValue, value: 'some value' });

      expect(result).toEqual([
        JSON.stringify({
          error: 'content_filter_block',
          message: 'Submitted content was blocked by content policy.',
          source: 'memory',
          field: 'key',
        }),
        undefined,
      ]);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(protectedValue);
      expect(mockSetMemory).not.toHaveBeenCalled();
    });

    it('should handle setMemory failure', async () => {
      mockSetMemory.mockResolvedValue({ ok: false });
      const tool = createMemoryTool({
        userId: 'test-user',
        setMemory: mockSetMemory,
      });

      const result = await tool.func({ key: 'test', value: 'some value' });
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('Failed to set memory for key "test"');
      expect(result[1]).toBeUndefined();
    });

    it('should handle exceptions', async () => {
      mockSetMemory.mockRejectedValue(new Error('DB error'));
      const tool = createMemoryTool({
        userId: 'test-user',
        setMemory: mockSetMemory,
      });

      const result = await tool.func({ key: 'test', value: 'some value' });
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('Error setting memory for key "test"');
      expect(result[1]).toBeUndefined();
    });

    it('should block configured memory content before tokenization or persistence', async () => {
      const onWrite = jest.fn();
      const tokenCount = jest.mocked(Tokenizer.getTokenCount);
      const tool = createMemoryTool({
        userId: 'test-user',
        setMemory: mockSetMemory,
        onWrite,
        filters: {
          memories: {
            pii: {
              fields: ['value'],
              starterPatterns: [],
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
      });

      tokenCount.mockClear();
      const blocked = await tool.func({ key: 'preferences', value: 'Keep ORG-SECRET' });

      expect(blocked).toEqual([
        JSON.stringify({
          error: 'content_filter_block',
          message: 'Submitted content was blocked by content policy.',
          source: 'memory',
          field: 'value',
        }),
        undefined,
      ]);
      expect(tokenCount).not.toHaveBeenCalled();
      expect(mockSetMemory).not.toHaveBeenCalled();
      expect(onWrite).not.toHaveBeenCalled();

      await tool.func({ key: 'ORG-KEY', value: 'Prefers concise answers' });

      expect(mockSetMemory).toHaveBeenCalledTimes(1);
      expect(mockSetMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'ORG-KEY',
          value: 'Prefers concise answers',
        }),
      );
    });

    it.each([
      ['bearer_header', 'Authorization: Bearer memory-token', 'Bearer token'],
      ['api_key_header', 'api-key: memory-token', 'api-key header'],
    ] as const)(
      'returns a stable %s block result that can be reused safely',
      async (starterPattern, protectedValue, detectorLabel) => {
        const tool = createMemoryTool({
          userId: 'test-user',
          setMemory: mockSetMemory,
          filters: {
            memories: {
              pii: {
                fields: ['value'],
                starterPatterns: [starterPattern],
              },
            },
          },
        });

        const blocked = await tool.func({ key: 'preferences', value: protectedValue });

        expect(JSON.parse(blocked[0])).toEqual({
          error: 'content_filter_block',
          message: 'Submitted content was blocked by content policy.',
          source: 'memory',
          field: 'value',
        });
        expect(blocked[0]).not.toContain(protectedValue);
        expect(blocked[0]).not.toContain(detectorLabel);
        expect(mockSetMemory).not.toHaveBeenCalled();

        await tool.func({ key: 'policy_result', value: blocked[0] });

        expect(mockSetMemory).toHaveBeenCalledTimes(1);
        expect(mockSetMemory).toHaveBeenCalledWith(
          expect.objectContaining({
            key: 'policy_result',
            value: blocked[0],
          }),
        );
      },
    );
  });
});

describe('processMemory - GPT-5+ handling', () => {
  let mockSetMemory: jest.Mock;
  let mockDeleteMemory: jest.Mock;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSetMemory = jest.fn().mockResolvedValue({ ok: true });
    mockDeleteMemory = jest.fn().mockResolvedValue({ ok: true });
    mockRes = {
      headersSent: false,
      write: jest.fn(),
    };

    // Setup the Run.create mock
    const { Run } = jest.requireMock('@librechat/agents');
    (Run.create as jest.Mock).mockResolvedValue({
      processStream: jest.fn().mockResolvedValue('Memory processed'),
    });
  });

  it('should enforce memory filters in the automatic processor without changing deletes', async () => {
    const tokenCount = jest.mocked(Tokenizer.getTokenCount);
    tokenCount.mockClear();

    await processMemory({
      res: mockRes as Response,
      userId: 'test-user',
      setMemory: mockSetMemory,
      deleteMemory: mockDeleteMemory,
      messages: [],
      memory: 'Test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      instructions: 'Test instructions',
      filters: {
        memories: {
          pii: {
            fields: ['value'],
            starterPatterns: [],
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
    });

    const { Run } = jest.requireMock('@librechat/agents');
    const runConfig = (Run.create as jest.Mock).mock.calls[0][0];
    const [setMemoryTool, deleteMemoryTool] = runConfig.graphConfig.tools;

    const blocked = await setMemoryTool.func({
      key: 'preferences',
      value: 'Keep ORG-SECRET',
    });
    expect(blocked).toEqual([
      JSON.stringify({
        error: 'content_filter_block',
        message: 'Submitted content was blocked by content policy.',
        source: 'memory',
        field: 'value',
      }),
      undefined,
    ]);
    expect(tokenCount).not.toHaveBeenCalled();
    expect(mockSetMemory).not.toHaveBeenCalled();

    await deleteMemoryTool.func({ key: 'preferences' });
    expect(mockDeleteMemory).toHaveBeenCalledWith({
      userId: 'test-user',
      key: 'preferences',
      agentId: undefined,
    });
  });

  it('should remove temperature for GPT-5 models', async () => {
    await processMemory({
      res: mockRes as Response,
      userId: 'test-user',
      setMemory: mockSetMemory,
      deleteMemory: mockDeleteMemory,
      messages: [],
      memory: 'Test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      instructions: 'Test instructions',
      llmConfig: {
        provider: Providers.OPENAI,
        model: 'gpt-5',
        temperature: 0.7, // This should be removed
        maxTokens: 1000, // This should be moved to modelKwargs
      },
    });

    const { Run } = jest.requireMock('@librechat/agents');
    expect(Run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        graphConfig: expect.objectContaining({
          llmConfig: expect.objectContaining({
            model: 'gpt-5',
            modelKwargs: {
              max_completion_tokens: 1000,
            },
          }),
        }),
      }),
    );

    // Verify temperature was removed
    const callArgs = (Run.create as jest.Mock).mock.calls[0][0];
    expect(callArgs.graphConfig.llmConfig.temperature).toBeUndefined();
    expect(callArgs.graphConfig.llmConfig.maxTokens).toBeUndefined();
  });

  it('should handle GPT-5+ models with existing modelKwargs', async () => {
    await processMemory({
      res: mockRes as Response,
      userId: 'test-user',
      setMemory: mockSetMemory,
      deleteMemory: mockDeleteMemory,
      messages: [],
      memory: 'Test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      instructions: 'Test instructions',
      llmConfig: {
        provider: Providers.OPENAI,
        model: 'gpt-6',
        temperature: 0.8,
        maxTokens: 2000,
        modelKwargs: {
          customParam: 'value',
        },
      },
    });

    const { Run } = jest.requireMock('@librechat/agents');
    expect(Run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        graphConfig: expect.objectContaining({
          llmConfig: expect.objectContaining({
            model: 'gpt-6',
            modelKwargs: {
              customParam: 'value',
              max_completion_tokens: 2000,
            },
          }),
        }),
      }),
    );

    const callArgs = (Run.create as jest.Mock).mock.calls[0][0];
    expect(callArgs.graphConfig.llmConfig.temperature).toBeUndefined();
    expect(callArgs.graphConfig.llmConfig.maxTokens).toBeUndefined();
  });

  it('should not modify non-GPT-5+ models', async () => {
    await processMemory({
      res: mockRes as Response,
      userId: 'test-user',
      setMemory: mockSetMemory,
      deleteMemory: mockDeleteMemory,
      messages: [],
      memory: 'Test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      instructions: 'Test instructions',
      llmConfig: {
        provider: Providers.OPENAI,
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 1000,
      },
    });

    const { Run } = jest.requireMock('@librechat/agents');
    expect(Run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        graphConfig: expect.objectContaining({
          llmConfig: expect.objectContaining({
            model: 'gpt-4',
            temperature: 0.7,
            maxTokens: 1000,
          }),
        }),
      }),
    );

    // Verify nothing was moved to modelKwargs for GPT-4
    const callArgs = (Run.create as jest.Mock).mock.calls[0][0];
    expect(callArgs.graphConfig.llmConfig.modelKwargs).toBeUndefined();
  });

  it('should handle various GPT-5+ model formats', async () => {
    const testCases = [
      { model: 'gpt-5', shouldTransform: true },
      { model: 'gpt-5-turbo', shouldTransform: true },
      { model: 'gpt-7-preview', shouldTransform: true },
      { model: 'gpt-9', shouldTransform: true },
      { model: 'gpt-4o', shouldTransform: false },
      { model: 'gpt-3.5-turbo', shouldTransform: false },
    ];

    for (const { model, shouldTransform } of testCases) {
      jest.clearAllMocks();
      const { Run } = jest.requireMock('@librechat/agents');
      (Run.create as jest.Mock).mockResolvedValue({
        processStream: jest.fn().mockResolvedValue('Memory processed'),
      });

      await processMemory({
        res: mockRes as Response,
        userId: 'test-user',
        setMemory: mockSetMemory,
        deleteMemory: mockDeleteMemory,
        messages: [],
        memory: 'Test memory',
        messageId: 'msg-123',
        conversationId: 'conv-123',
        instructions: 'Test instructions',
        llmConfig: {
          provider: Providers.OPENAI,
          model,
          temperature: 0.5,
          maxTokens: 1500,
        },
      });

      const callArgs = (Run.create as jest.Mock).mock.calls[0][0];
      const llmConfig = callArgs.graphConfig.llmConfig;

      if (shouldTransform) {
        expect(llmConfig.temperature).toBeUndefined();
        expect(llmConfig.maxTokens).toBeUndefined();
        expect(llmConfig.modelKwargs?.max_completion_tokens).toBe(1500);
      } else {
        expect(llmConfig.temperature).toBe(0.5);
        expect(llmConfig.maxTokens).toBe(1500);
        expect(llmConfig.modelKwargs).toBeUndefined();
      }
    }
  });

  it('should use default model (gpt-4.1-mini) without temperature removal when no llmConfig provided', async () => {
    await processMemory({
      res: mockRes as Response,
      userId: 'test-user',
      setMemory: mockSetMemory,
      deleteMemory: mockDeleteMemory,
      messages: [],
      memory: 'Test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      instructions: 'Test instructions',
      // No llmConfig provided
    });

    const { Run } = jest.requireMock('@librechat/agents');
    expect(Run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        graphConfig: expect.objectContaining({
          llmConfig: expect.objectContaining({
            model: 'gpt-4.1-mini',
            temperature: 0.4, // Default temperature should remain
            maxRetries: 0,
          }),
        }),
      }),
    );
  });

  it('should use max_output_tokens when useResponsesApi is true', async () => {
    await processMemory({
      res: mockRes as Response,
      userId: 'test-user',
      setMemory: mockSetMemory,
      deleteMemory: mockDeleteMemory,
      messages: [],
      memory: 'Test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      instructions: 'Test instructions',
      llmConfig: {
        provider: Providers.OPENAI,
        model: 'gpt-5',
        maxTokens: 1000,
        useResponsesApi: true,
      },
    });

    const { Run } = jest.requireMock('@librechat/agents');
    expect(Run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        graphConfig: expect.objectContaining({
          llmConfig: expect.objectContaining({
            model: 'gpt-5',
            modelKwargs: {
              max_output_tokens: 1000,
            },
          }),
        }),
      }),
    );
  });

  it('should use max_completion_tokens when useResponsesApi is false or undefined', async () => {
    await processMemory({
      res: mockRes as Response,
      userId: 'test-user',
      setMemory: mockSetMemory,
      deleteMemory: mockDeleteMemory,
      messages: [],
      memory: 'Test memory',
      messageId: 'msg-123',
      conversationId: 'conv-123',
      instructions: 'Test instructions',
      llmConfig: {
        provider: Providers.OPENAI,
        model: 'gpt-5',
        maxTokens: 1000,
        useResponsesApi: false,
      },
    });

    const { Run } = jest.requireMock('@librechat/agents');
    expect(Run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        graphConfig: expect.objectContaining({
          llmConfig: expect.objectContaining({
            model: 'gpt-5',
            modelKwargs: {
              max_completion_tokens: 1000,
            },
          }),
        }),
      }),
    );
  });
});

describe('createMemoryTool auto-memory', () => {
  const QUIET_FULL =
    'Memory is full, nothing was saved. Do not retry and do not mention this to the user.';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stays quiet without an artifact when an automatic write finds memory already full', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    const tool = createMemoryTool({
      userId: 'test-user',
      setMemory,
      tokenLimit: 100,
      totalTokens: 150,
      explicitRequest: false,
    });

    const result = await tool.func({ key: 'test', value: 'new memory' });

    expect(result).toEqual([QUIET_FULL, undefined]);
    expect(setMemory).not.toHaveBeenCalled();
  });

  it('stays quiet without an artifact when an automatic write would exceed the limit', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true });
    const tool = createMemoryTool({
      userId: 'test-user',
      setMemory,
      tokenLimit: 100,
      totalTokens: 80,
      explicitRequest: false,
    });

    const result = await tool.func({ key: 'test', value: 'This is a 20 char str' });

    expect(result).toEqual([QUIET_FULL, undefined]);
    expect(setMemory).not.toHaveBeenCalled();
  });

  it('carries the prior state and the automatic flag on the update artifact', async () => {
    const setMemory = jest.fn().mockResolvedValue({
      ok: true,
      created: false,
      previous: { value: 'old value', title: 'Old title', tokenCount: 9 },
    });
    const tool = createMemoryTool({ userId: 'test-user', setMemory, explicitRequest: false });

    const [text, artifact] = await tool.func({
      key: 'test',
      title: 'New title',
      value: 'new value',
    });

    expect(text).toBe('Saved. Do not mention saving to the user.');
    expect((artifact as Record<Tools.memory, MemoryArtifact>)[Tools.memory]).toEqual({
      key: 'test',
      value: 'new value',
      title: 'New title',
      tokenCount: 9,
      type: 'update',
      auto: true,
      previous: { value: 'old value', title: 'Old title' },
    });
  });

  it('marks a created record with previous null and an explicit write as not automatic', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true, created: true, previous: null });
    const tool = createMemoryTool({ userId: 'test-user', setMemory });

    const [text, artifact] = await tool.func({ key: 'test', value: 'new value' });

    expect(text).toBe('Memory set for key "test" (9 tokens)');
    expect((artifact as Record<Tools.memory, MemoryArtifact>)[Tools.memory]).toMatchObject({
      auto: false,
      previous: null,
    });
  });

  it('omits a missing prior title from the artifact', async () => {
    const setMemory = jest.fn().mockResolvedValue({
      ok: true,
      created: false,
      previous: { value: 'old value', tokenCount: 9 },
    });
    const tool = createMemoryTool({ userId: 'test-user', setMemory });

    const [, artifact] = await tool.func({ key: 'test', value: 'new value' });

    expect((artifact as Record<Tools.memory, MemoryArtifact>)[Tools.memory].previous).toEqual({
      value: 'old value',
    });
  });

  it('refuses an automatic write quietly once the per-request allowance is used up', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true, previous: null });
    const reserveAutoWrite = jest.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const tool = createMemoryTool({
      userId: 'test-user',
      setMemory,
      explicitRequest: false,
      reserveAutoWrite,
    });

    await tool.func({ key: 'first', value: 'one' });
    const [text, artifact] = await tool.func({ key: 'second', value: 'two' });

    expect(text).toMatch(/Not saved.*do not mention this to the user/i);
    expect(artifact).toBeUndefined();
    expect(setMemory).toHaveBeenCalledTimes(1);
  });

  it('does not spend the automatic allowance on explicit writes', async () => {
    const reserveAutoWrite = jest.fn().mockReturnValue(false);
    const setMemory = jest.fn().mockResolvedValue({ ok: true, previous: null });
    const tool = createMemoryTool({ userId: 'test-user', setMemory, reserveAutoWrite });

    await tool.func({ key: 'test', value: 'explicit' });

    expect(reserveAutoWrite).not.toHaveBeenCalled();
    expect(setMemory).toHaveBeenCalledTimes(1);
  });

  it('writes first and then signals a partition left above 90% of the limit', async () => {
    const setMemory = jest.fn().mockResolvedValue({ ok: true, previous: null });
    const onNearLimit = jest.fn();
    const tool = createMemoryTool({
      userId: 'test-user',
      setMemory,
      tokenLimit: 100,
      totalTokens: 85,
      onNearLimit,
    });

    const [text, artifact] = await tool.func({ key: 'test', value: 'ten chars!' });

    expect(text).toBe('Memory set for key "test" (10 tokens)');
    expect(onNearLimit).toHaveBeenCalledWith('personal');
    expect(setMemory.mock.invocationCallOrder[0]).toBeLessThan(
      onNearLimit.mock.invocationCallOrder[0],
    );
    expect((artifact as Record<Tools.memory, MemoryArtifact>)[Tools.memory]).not.toHaveProperty(
      'compaction',
    );
  });

  it('does not signal below 90% of the limit, without a limit, or when the write is refused', async () => {
    const onNearLimit = jest.fn();
    const below = createMemoryTool({
      userId: 'test-user',
      setMemory: jest.fn().mockResolvedValue({ ok: true }),
      tokenLimit: 100,
      totalTokens: 70,
      onNearLimit,
    });
    const unlimited = createMemoryTool({
      userId: 'test-user',
      setMemory: jest.fn().mockResolvedValue({ ok: true }),
      totalTokens: 1000,
      onNearLimit,
    });
    const refused = createMemoryTool({
      userId: 'test-user',
      setMemory: jest.fn().mockResolvedValue({ ok: true }),
      tokenLimit: 100,
      totalTokens: 95,
      onNearLimit,
    });

    await below.func({ key: 'test', value: 'ten chars!' });
    await unlimited.func({ key: 'test', value: 'ten chars!' });
    const [refusedText] = await refused.func({ key: 'test', value: 'ten chars!' });

    expect(refusedText).toBe('Memory storage would exceed limit. Cannot save this memory.');
    expect(onNearLimit).not.toHaveBeenCalled();
  });

  it('signals the project partition for a project-scoped write', async () => {
    const onNearLimit = jest.fn();
    const tool = createMemoryTool({
      userId: 'test-user',
      chatProjectId: 'proj-1',
      setMemory: jest.fn().mockResolvedValue({ ok: true }),
      tokenLimit: 100,
      totalTokens: 0,
      projectTotalTokens: 85,
      onNearLimit,
    });

    await tool.func({ key: 'test', value: 'ten chars!', scope: 'project' });

    expect(onNearLimit).toHaveBeenCalledWith('project');
  });
});

describe('createDeleteMemoryTool auto-memory', () => {
  it('refuses to delete without an explicit request', async () => {
    const deleteMemory = jest.fn().mockResolvedValue({ ok: true });
    const tool = createDeleteMemoryTool({
      userId: 'test-user',
      deleteMemory,
      explicitRequest: false,
    });

    const [text, artifact] = await tool.func({ key: 'test' });

    expect(text).toMatch(/delete only on explicit request/i);
    expect(artifact).toBeUndefined();
    expect(deleteMemory).not.toHaveBeenCalled();
  });
});

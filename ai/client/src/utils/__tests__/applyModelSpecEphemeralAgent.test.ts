import { Constants, LocalStorageKeys } from 'librechat-data-provider';
import type { TModelSpec, TEphemeralAgent } from 'librechat-data-provider';
import { applyModelSpecEphemeralAgent, getToolDefaultKey } from '../endpoints';
import { setTimestamp } from '../timestamps';

/**
 * Tests for applyModelSpecEphemeralAgent — the function responsible for
 * constructing the ephemeral agent state when navigating to a spec conversation.
 *
 * Desired behaviors:
 * - New conversations start from the admin's spec configuration, then layer the user's
 *   own remembered overrides for that spec (keyed by spec name), so toggling a tool off
 *   and starting a new chat on the same spec keeps it off — without leaking onto a
 *   different spec's defaults
 * - Existing conversations merge per-conversation localStorage overrides on top of spec
 * - Cleared or expired localStorage falls back to fresh spec config
 */

const createModelSpec = (overrides: Partial<TModelSpec> = {}): TModelSpec =>
  ({
    name: 'test-spec',
    label: 'Test Spec',
    preset: { endpoint: 'agents' },
    mcpServers: ['spec-server1'],
    webSearch: true,
    executeCode: true,
    fileSearch: false,
    artifacts: true,
    ...overrides,
  }) as TModelSpec;

/** Write a value + fresh timestamp to localStorage (simulates a user toggle) */
function writeToolToggle(storagePrefix: string, convoId: string, value: unknown): void {
  const key = `${storagePrefix}${convoId}`;
  localStorage.setItem(key, JSON.stringify(value));
  setTimestamp(key);
}

describe('applyModelSpecEphemeralAgent', () => {
  let updateEphemeralAgent: jest.Mock<void, [string, TEphemeralAgent | null]>;

  beforeEach(() => {
    localStorage.clear();
    updateEphemeralAgent = jest.fn();
  });

  // ─── New Conversations ─────────────────────────────────────────────

  describe('new conversations always get fresh admin spec config', () => {
    it('should apply exactly the admin-configured tools and MCP servers', () => {
      const modelSpec = createModelSpec({
        mcpServers: ['clickhouse', 'github'],
        executeCode: true,
        webSearch: false,
        fileSearch: true,
        artifacts: true,
      });

      applyModelSpecEphemeralAgent({
        convoId: null,
        modelSpec,
        updateEphemeralAgent,
      });

      expect(updateEphemeralAgent).toHaveBeenCalledWith(Constants.NEW_CONVO, {
        mcp: ['clickhouse', 'github'],
        execute_code: true,
        web_search: false,
        file_search: true,
        memory: false,
        knowledge_search: false,
        artifacts: 'default',
      });
    });

    it('should not read from localStorage even if stale values exist', () => {
      // Simulate stale localStorage from a previous session
      writeToolToggle(LocalStorageKeys.LAST_CODE_TOGGLE_, Constants.NEW_CONVO, false);
      writeToolToggle(LocalStorageKeys.LAST_WEB_SEARCH_TOGGLE_, Constants.NEW_CONVO, true);
      localStorage.setItem(
        `${LocalStorageKeys.LAST_MCP_}${Constants.NEW_CONVO}`,
        JSON.stringify(['stale-server']),
      );

      const modelSpec = createModelSpec({ executeCode: true, webSearch: false, mcpServers: [] });

      applyModelSpecEphemeralAgent({
        convoId: null,
        modelSpec,
        updateEphemeralAgent,
      });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      // Should be spec values, NOT localStorage values
      expect(agent.execute_code).toBe(true);
      expect(agent.web_search).toBe(false);
      expect(agent.mcp).toEqual([]);
    });

    it('should handle spec with no MCP servers', () => {
      const modelSpec = createModelSpec({ mcpServers: undefined });

      applyModelSpecEphemeralAgent({ convoId: null, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect(agent.mcp).toEqual([]);
    });

    it('should honor the memory default from the spec', () => {
      const enabled = createModelSpec({ memory: true });
      applyModelSpecEphemeralAgent({ convoId: null, modelSpec: enabled, updateEphemeralAgent });
      expect((updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent).memory).toBe(true);

      updateEphemeralAgent.mockClear();

      const disabled = createModelSpec({ memory: false });
      applyModelSpecEphemeralAgent({ convoId: null, modelSpec: disabled, updateEphemeralAgent });
      expect((updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent).memory).toBe(false);
    });

    /**
     * Regression: `knowledge_search` was missing from the ephemeral agent literal entirely,
     * so it stayed `undefined` for every spec conversation (every conversation has an active
     * spec under `modelSpecs.enforce: true`) and the badge checkbox always rendered off, even
     * for a spec with `knowledgeBase: true` — a brand-new employee saw "Поиск по документам"
     * unchecked and had to know to turn it on themselves.
     */
    it('should honor the knowledgeBase default from the spec', () => {
      const enabled = createModelSpec({ knowledgeBase: true });
      applyModelSpecEphemeralAgent({ convoId: null, modelSpec: enabled, updateEphemeralAgent });
      expect((updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent).knowledge_search).toBe(
        true,
      );

      updateEphemeralAgent.mockClear();

      const disabled = createModelSpec({ knowledgeBase: false });
      applyModelSpecEphemeralAgent({ convoId: null, modelSpec: disabled, updateEphemeralAgent });
      expect((updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent).knowledge_search).toBe(
        false,
      );
    });

    it('should default knowledge_search to false when the spec leaves knowledgeBase unset', () => {
      const modelSpec = createModelSpec();
      applyModelSpecEphemeralAgent({ convoId: null, modelSpec, updateEphemeralAgent });

      expect((updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent).knowledge_search).toBe(
        false,
      );
    });

    it('should map artifacts: true to "default" string', () => {
      const modelSpec = createModelSpec({ artifacts: true });

      applyModelSpecEphemeralAgent({ convoId: null, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect(agent.artifacts).toBe('default');
    });

    it('should pass through artifacts string value directly', () => {
      const modelSpec = createModelSpec({ artifacts: 'custom-renderer' as any });

      applyModelSpecEphemeralAgent({ convoId: null, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect(agent.artifacts).toBe('custom-renderer');
    });

    it('should not copy model spec subagents into client ephemeral agent state', () => {
      const subagents = { enabled: true, allowSelf: true, agent_ids: ['agent_private'] };
      const modelSpec = createModelSpec({ subagents });

      applyModelSpecEphemeralAgent({ convoId: null, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect('subagents' in agent).toBe(false);
    });
  });

  // ─── New Conversations: Per-Spec Persistence ────────────────────────

  describe("new conversations merge the spec's own remembered overrides from localStorage", () => {
    it('запомненный выбор сотрудника переживает новый чат на том же спеке', () => {
      // Сотрудник выключил веб-поиск, начиная новый чат на этом спеке
      localStorage.setItem(getToolDefaultKey('web_search'), JSON.stringify(false));

      const modelSpec = createModelSpec({ name: 'test-spec', webSearch: true });

      applyModelSpecEphemeralAgent({ convoId: null, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect(agent.web_search).toBe(false);
    });

    it('старое переопределение по спеку на тумблеры больше не влияет', () => {
      writeToolToggle(LocalStorageKeys.LAST_WEB_SEARCH_TOGGLE_, 'spec_test-spec', false);

      const modelSpec = createModelSpec({ name: 'test-spec', webSearch: true });

      applyModelSpecEphemeralAgent({ convoId: null, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect(agent.web_search).toBe(true);
    });

    it('should not leak an override stored under a different spec', () => {
      writeToolToggle(LocalStorageKeys.LAST_WEB_SEARCH_TOGGLE_, 'spec_other-spec', false);

      const modelSpec = createModelSpec({ name: 'test-spec', webSearch: true });

      applyModelSpecEphemeralAgent({ convoId: null, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect(agent.web_search).toBe(true); // spec default — no cross-spec leakage
    });

    it('should preserve user-added MCP servers for the next new chat on the same spec', () => {
      localStorage.setItem(
        `${LocalStorageKeys.LAST_MCP_}spec_test-spec`,
        JSON.stringify(['clickhouse', 'github']),
      );

      const modelSpec = createModelSpec({ name: 'test-spec', mcpServers: ['clickhouse'] });

      applyModelSpecEphemeralAgent({ convoId: null, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect(agent.mcp).toEqual(['clickhouse', 'github']);
    });

    it('should fall back to spec values when the per-spec override has expired (>2 days)', () => {
      const expiredTimestamp = (Date.now() - 3 * 24 * 60 * 60 * 1000).toString();
      const codeKey = `${LocalStorageKeys.LAST_CODE_TOGGLE_}spec_test-spec`;
      localStorage.setItem(codeKey, JSON.stringify(false));
      localStorage.setItem(`${codeKey}_TIMESTAMP`, expiredTimestamp);

      const modelSpec = createModelSpec({ name: 'test-spec', executeCode: true });

      applyModelSpecEphemeralAgent({ convoId: null, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect(agent.execute_code).toBe(true);
    });

    it('запомненным считается только тот тумблер, который сотрудник трогал; остальные — как в спеке', () => {
      localStorage.setItem(getToolDefaultKey('artifacts'), JSON.stringify(''));

      const modelSpec = createModelSpec({
        name: 'test-spec',
        executeCode: true,
        webSearch: true,
        artifacts: true,
      });

      applyModelSpecEphemeralAgent({ convoId: null, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect(agent.execute_code).toBe(true); // spec default (not overridden)
      expect(agent.web_search).toBe(true); // spec default (not overridden)
      expect(agent.artifacts).toBe(''); // user override
    });
  });

  // ─── Existing Conversations: Per-Conversation Persistence ──────────

  describe('existing conversations merge user overrides from localStorage', () => {
    const convoId = 'convo-abc-123';

    it('should preserve user tool modifications across navigation', () => {
      // User previously toggled off code execution and enabled file search
      writeToolToggle(LocalStorageKeys.LAST_CODE_TOGGLE_, convoId, false);
      writeToolToggle(LocalStorageKeys.LAST_FILE_SEARCH_TOGGLE_, convoId, true);

      const modelSpec = createModelSpec({
        executeCode: true,
        fileSearch: false,
        webSearch: true,
      });

      applyModelSpecEphemeralAgent({ convoId, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect(agent.execute_code).toBe(false); // user override
      expect(agent.file_search).toBe(true); // user override
      expect(agent.web_search).toBe(true); // not overridden, spec value
    });

    it('should preserve a user knowledge_search override across navigation', () => {
      // User explicitly turned off forced knowledge search for this conversation.
      writeToolToggle(LocalStorageKeys.LAST_KNOWLEDGE_SEARCH_TOGGLE_, convoId, false);

      const modelSpec = createModelSpec({ knowledgeBase: true });

      applyModelSpecEphemeralAgent({ convoId, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect(agent.knowledge_search).toBe(false); // user override, not the spec default
    });

    it('should preserve user-added MCP servers across navigation', () => {
      // Spec has clickhouse, user also added github during the conversation
      localStorage.setItem(
        `${LocalStorageKeys.LAST_MCP_}${convoId}`,
        JSON.stringify(['clickhouse', 'github']),
      );

      const modelSpec = createModelSpec({ mcpServers: ['clickhouse'] });

      applyModelSpecEphemeralAgent({ convoId, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect(agent.mcp).toEqual(['clickhouse', 'github']);
    });

    it('should preserve user-removed MCP servers (empty array) across navigation', () => {
      // User removed all MCP servers during the conversation
      localStorage.setItem(`${LocalStorageKeys.LAST_MCP_}${convoId}`, JSON.stringify([]));

      const modelSpec = createModelSpec({ mcpServers: ['clickhouse', 'github'] });

      applyModelSpecEphemeralAgent({ convoId, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect(agent.mcp).toEqual([]);
    });

    it('should only override keys that exist in localStorage, leaving the rest as spec defaults', () => {
      // User only changed artifacts, nothing else
      writeToolToggle(LocalStorageKeys.LAST_ARTIFACTS_TOGGLE_, convoId, '');

      const modelSpec = createModelSpec({
        executeCode: true,
        webSearch: true,
        fileSearch: false,
        artifacts: true,
        mcpServers: ['server1'],
      });

      applyModelSpecEphemeralAgent({ convoId, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      expect(agent.execute_code).toBe(true); // spec default (not in localStorage)
      expect(agent.web_search).toBe(true); // spec default
      expect(agent.file_search).toBe(false); // spec default
      expect(agent.artifacts).toBe(''); // user override
      expect(agent.mcp).toEqual(['server1']); // spec default (not in localStorage)
    });
  });

  // ─── Existing Conversations: Cleared localStorage ──────────────────

  describe('existing conversations with cleared localStorage get fresh spec config', () => {
    const convoId = 'convo-cleared-456';

    it('should fall back to pure spec values when localStorage is empty', () => {
      // localStorage.clear() was already called in beforeEach

      const modelSpec = createModelSpec({
        executeCode: true,
        webSearch: false,
        fileSearch: true,
        artifacts: true,
        mcpServers: ['server1', 'server2'],
      });

      applyModelSpecEphemeralAgent({ convoId, modelSpec, updateEphemeralAgent });

      expect(updateEphemeralAgent).toHaveBeenCalledWith(convoId, {
        mcp: ['server1', 'server2'],
        execute_code: true,
        web_search: false,
        file_search: true,
        memory: false,
        knowledge_search: false,
        artifacts: 'default',
      });
    });

    it('should fall back to spec values when timestamps have expired (>2 days)', () => {
      // Write values with expired timestamps (3 days old)
      const expiredTimestamp = (Date.now() - 3 * 24 * 60 * 60 * 1000).toString();
      const codeKey = `${LocalStorageKeys.LAST_CODE_TOGGLE_}${convoId}`;
      localStorage.setItem(codeKey, JSON.stringify(false));
      localStorage.setItem(`${codeKey}_TIMESTAMP`, expiredTimestamp);

      const modelSpec = createModelSpec({ executeCode: true });

      applyModelSpecEphemeralAgent({ convoId, modelSpec, updateEphemeralAgent });

      const agent = updateEphemeralAgent.mock.calls[0][1] as TEphemeralAgent;
      // Expired override should be ignored — spec value wins
      expect(agent.execute_code).toBe(true);
    });
  });

  // ─── Постоянный выбор сотрудника ───────────────────────────────────

  describe('постоянный выбор инструмента переживает смену модели', () => {
    it('выключенный инструмент остаётся выключенным на другом спеке', () => {
      localStorage.setItem(getToolDefaultKey('web_search'), JSON.stringify(false));

      applyModelSpecEphemeralAgent({
        convoId: null,
        modelSpec: createModelSpec({ name: 'другой-спек', webSearch: true }),
        updateEphemeralAgent,
      });

      expect(updateEphemeralAgent).toHaveBeenCalledWith(
        Constants.NEW_CONVO,
        expect.objectContaining({ web_search: false }),
      );
    });

    it('переопределение по разговору сильнее постоянного выбора', () => {
      localStorage.setItem(getToolDefaultKey('web_search'), JSON.stringify(false));
      writeToolToggle(LocalStorageKeys.LAST_WEB_SEARCH_TOGGLE_, 'convo-7', true);

      applyModelSpecEphemeralAgent({
        convoId: 'convo-7',
        modelSpec: createModelSpec({ webSearch: true }),
        updateEphemeralAgent,
      });

      expect(updateEphemeralAgent).toHaveBeenCalledWith(
        'convo-7',
        expect.objectContaining({ web_search: true }),
      );
    });

    it('включить инструмент, которого у модели нет, запомненный выбор не может', () => {
      localStorage.setItem(getToolDefaultKey('knowledge_search'), JSON.stringify(true));
      localStorage.setItem(getToolDefaultKey('web_search'), JSON.stringify(true));

      applyModelSpecEphemeralAgent({
        convoId: null,
        modelSpec: createModelSpec({ webSearch: false, knowledgeBase: false }),
        updateEphemeralAgent,
      });

      expect(updateEphemeralAgent).toHaveBeenCalledWith(
        Constants.NEW_CONVO,
        expect.objectContaining({ web_search: false, knowledge_search: false }),
      );
    });

    it('переопределение по разговору тоже не включает недоступный инструмент', () => {
      writeToolToggle(LocalStorageKeys.LAST_KNOWLEDGE_SEARCH_TOGGLE_, 'convo-1', true);

      applyModelSpecEphemeralAgent({
        convoId: 'convo-1',
        modelSpec: createModelSpec({ knowledgeBase: false }),
        updateEphemeralAgent,
      });

      expect(updateEphemeralAgent).toHaveBeenCalledWith(
        'convo-1',
        expect.objectContaining({ knowledge_search: false }),
      );
    });

    it('без запомненного выбора умолчания спека не меняются', () => {
      applyModelSpecEphemeralAgent({
        convoId: null,
        modelSpec: createModelSpec({ webSearch: true, knowledgeBase: true }),
        updateEphemeralAgent,
      });

      expect(updateEphemeralAgent).toHaveBeenCalledWith(
        Constants.NEW_CONVO,
        expect.objectContaining({ web_search: true, knowledge_search: true }),
      );
    });
  });

  // ─── Guard Clauses ─────────────────────────────────────────────────

  describe('guard clauses', () => {
    it('should not call updateEphemeralAgent when modelSpec is undefined', () => {
      applyModelSpecEphemeralAgent({
        convoId: 'convo-1',
        modelSpec: undefined,
        updateEphemeralAgent,
      });

      expect(updateEphemeralAgent).not.toHaveBeenCalled();
    });

    it('should not throw when updateEphemeralAgent is undefined', () => {
      expect(() =>
        applyModelSpecEphemeralAgent({
          convoId: 'convo-1',
          modelSpec: createModelSpec(),
          updateEphemeralAgent: undefined,
        }),
      ).not.toThrow();
    });

    it('should use NEW_CONVO key when convoId is empty string', () => {
      applyModelSpecEphemeralAgent({
        convoId: '',
        modelSpec: createModelSpec(),
        updateEphemeralAgent,
      });

      expect(updateEphemeralAgent).toHaveBeenCalledWith(Constants.NEW_CONVO, expect.any(Object));
    });
  });
});

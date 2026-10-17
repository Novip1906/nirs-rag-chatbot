import { Constants, Tools } from 'librechat-data-provider';
import type { MemoryArtifact, TAttachment } from 'librechat-data-provider';
import {
  parseToolName,
  getToolDisplayLabel,
  TOOL_FRIENDLY_NAME_KEYS,
  TOOLS_HIDING_DETAILS,
  getMemoryToolLine,
} from '../toolLabels';

describe('TOOLS_HIDING_DETAILS', () => {
  it('hides details for the knowledge base tools', () => {
    expect(TOOLS_HIDING_DETAILS.has('knowledge_search')).toBe(true);
    expect(TOOLS_HIDING_DETAILS.has('knowledge_list')).toBe(true);
  });

  it('leaves ordinary tools expandable', () => {
    expect(TOOLS_HIDING_DETAILS.has('web_search')).toBe(false);
    expect(TOOLS_HIDING_DETAILS.has('file_search')).toBe(false);
    expect(TOOLS_HIDING_DETAILS.has('execute_code')).toBe(false);
  });
});

describe('parseToolName', () => {
  it('splits an MCP tool id into server + tool name', () => {
    const parsed = parseToolName('search_code_mcp_github');
    expect(parsed).toEqual({
      raw: 'search_code_mcp_github',
      mcpServer: 'github',
      toolName: 'search_code',
    });
  });

  it('handles an MCP id whose tool-name portion contains underscores', () => {
    const parsed = parseToolName('deeply_nested_sub_tool_mcp_some-server');
    expect(parsed.mcpServer).toBe('some-server');
    expect(parsed.toolName).toBe('deeply_nested_sub_tool');
  });

  it('returns empty mcpServer + friendlyKey for a known native tool', () => {
    const parsed = parseToolName('web_search');
    expect(parsed).toEqual({
      raw: 'web_search',
      mcpServer: '',
      toolName: 'web_search',
      friendlyKey: TOOL_FRIENDLY_NAME_KEYS.web_search,
    });
  });

  it('returns empty mcpServer + no friendlyKey for an unknown native tool', () => {
    const parsed = parseToolName('custom_tool');
    expect(parsed).toEqual({
      raw: 'custom_tool',
      mcpServer: '',
      toolName: 'custom_tool',
    });
  });

  it('handles an MCP id with an empty server segment (pathological)', () => {
    /** `<tool>_mcp_` with nothing after the delimiter — treat as MCP
     *  with an empty server name rather than falling through to the
     *  native-tool path, so the display logic can surface "broken" ids
     *  rather than silently showing the whole thing as a tool name. */
    const parsed = parseToolName('foo_mcp_');
    expect(parsed.mcpServer).toBe('');
    expect(parsed.toolName).toBe('foo');
  });
});

describe('getToolDisplayLabel', () => {
  const identityLocalize = (key: string): string => key;

  it('returns the MCP server name for an MCP tool', () => {
    expect(getToolDisplayLabel('search_code_mcp_github', identityLocalize)).toBe('github');
  });

  it('returns the friendly translation key for a known native tool', () => {
    /** The identity-localize stub returns the translation key itself,
     *  which is what the real `useLocalize` would resolve at render time. */
    expect(getToolDisplayLabel('web_search', identityLocalize)).toBe(
      TOOL_FRIENDLY_NAME_KEYS.web_search,
    );
  });

  it('returns the code translation key for bash PTC tool calls', () => {
    expect(getToolDisplayLabel(Constants.BASH_PROGRAMMATIC_TOOL_CALLING, identityLocalize)).toBe(
      TOOL_FRIENDLY_NAME_KEYS[Constants.BASH_PROGRAMMATIC_TOOL_CALLING],
    );
  });

  it('returns the code translation key for bash_tool calls', () => {
    expect(getToolDisplayLabel('bash_tool', identityLocalize)).toBe(
      TOOL_FRIENDLY_NAME_KEYS.bash_tool,
    );
  });

  it('returns the raw name for an unknown native tool', () => {
    expect(getToolDisplayLabel('custom_tool', identityLocalize)).toBe('custom_tool');
  });
});

describe('export_file', () => {
  it('подписывает выгрузку файла и прячет её аргументы', () => {
    expect(parseToolName('export_file').friendlyKey).toBe('com_ui_tool_name_export_file');
    expect(TOOLS_HIDING_DETAILS.has('export_file')).toBe(true);
  });
});

describe('friendly names for tools visible in production', () => {
  it.each([
    'set_memory',
    'delete_memory',
    'export_file',
    'knowledge_search',
    'knowledge_list',
    'web_search',
    'file_search',
  ])('maps %s to its friendly translation key', (name) => {
    expect(parseToolName(name).friendlyKey).toBe(`com_ui_tool_name_${name}`);
  });
});

describe('memory tools', () => {
  it('hides the raw details of the memory tools', () => {
    expect(TOOLS_HIDING_DETAILS.has('set_memory')).toBe(true);
    expect(TOOLS_HIDING_DETAILS.has('delete_memory')).toBe(true);
  });

  const memoryAttachment = (memory: MemoryArtifact) =>
    ({
      messageId: 'm1',
      toolCallId: 't1',
      conversationId: 'c1',
      [Tools.memory]: memory,
    }) as TAttachment;

  it('takes the memory title from string or object args', () => {
    const args = { key: 'job_role', title: 'Юрист отдела партнёрств', value: 'Юрист' };
    expect(getMemoryToolLine('set_memory', JSON.stringify(args))).toEqual({
      unchanged: false,
      title: 'Юрист отдела партнёрств',
    });
    expect(getMemoryToolLine('set_memory', args)?.title).toBe('Юрист отдела партнёрств');
  });

  it('takes the title from the matching artifact when the args have none, never the raw key', () => {
    const attachments = [
      { messageId: 'm1', toolCallId: 't1', conversationId: 'c1', filename: 'report.pdf' },
      memoryAttachment({ key: 'other_key', type: 'delete', title: 'Чужая запись' }),
      memoryAttachment({ key: 'job_role', type: 'error', title: 'Ошибка' }),
      memoryAttachment({ key: 'job_role', type: 'delete', title: 'Юрист отдела партнёрств' }),
    ] as TAttachment[];
    const output = 'Memory deleted for key "job_role"';
    expect(getMemoryToolLine('delete_memory', '{"key":"job_role"}', output, attachments)).toEqual({
      unchanged: false,
      title: 'Юрист отдела партнёрств',
    });
    expect(getMemoryToolLine('delete_memory', '{"key":"job_role"}', output)).toEqual({
      unchanged: false,
      title: undefined,
    });
  });

  it('marks a finished call that saved nothing as unchanged and drops its title', () => {
    const args = '{"key":"delta_contact","title":"Контакт Дельта-Банка"}';
    for (const output of [
      'Not saved: the user is asking about past conversations.',
      'Memory is full, nothing was saved.',
      'Memory storage would exceed limit. Cannot save this memory.',
      'Failed to set memory for key "delta_contact"',
    ]) {
      expect(getMemoryToolLine('set_memory', args, output)).toEqual({ unchanged: true });
    }
    expect(
      getMemoryToolLine(
        'delete_memory',
        '{"key":"job_role"}',
        'Nothing was deleted: memories are deleted only on request.',
      ),
    ).toEqual({ unchanged: true });
  });

  it('treats a successful output as a change even when the card was not saved (after Stop)', () => {
    const args = '{"key":"delta_contact","title":"Контакт Дельта-Банка"}';
    expect(
      getMemoryToolLine('set_memory', args, 'Saved. Do not mention saving to the user.'),
    ).toEqual({
      unchanged: false,
      title: 'Контакт Дельта-Банка',
    });
    expect(
      getMemoryToolLine('set_memory', args, 'Memory set for key "delta_contact" (12 tokens)'),
    ).toEqual({ unchanged: false, title: 'Контакт Дельта-Банка' });
  });

  it('is not unchanged while the call has no output yet', () => {
    expect(getMemoryToolLine('set_memory', '{"key":"a","title":"A"}', '')).toEqual({
      unchanged: false,
      title: 'A',
    });
  });

  it('ignores other tools and unparsable or streaming args', () => {
    expect(getMemoryToolLine('web_search', '{"title":"x"}')).toBeUndefined();
    expect(getMemoryToolLine('set_memory', '{"key":"job_ro')?.title).toBeUndefined();
    expect(getMemoryToolLine('set_memory', undefined)?.title).toBeUndefined();
  });
});

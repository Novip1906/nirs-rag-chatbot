import { Constants, Tools, splitToolCallName } from 'librechat-data-provider';
import type { MemoryArtifact, TAttachment } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

/**
 * Shared tool-name parsing + friendly-label mapping used by the main
 * tool-call UI and the subagent ticker. Centralized so the MCP
 * delimiter (`<tool>_mcp_<server>`) and native-tool short names read
 * consistently in every surface that renders tool lifecycle.
 */

/** Native tool id → translation key for a user-readable short name. */
export const TOOL_FRIENDLY_NAME_KEYS: Record<string, TranslationKeys> = {
  execute_code: 'com_ui_tool_name_code',
  run_tools_with_code: 'com_ui_tool_name_code',
  run_tools_with_bash: 'com_ui_tool_name_code',
  bash_tool: 'com_ui_tool_name_code',
  web_search: 'com_ui_tool_name_web_search',
  image_gen_oai: 'com_ui_tool_name_image_gen',
  image_edit_oai: 'com_ui_tool_name_image_edit',
  gemini_image_gen: 'com_ui_tool_name_image_gen',
  generate_image: 'com_ui_tool_name_image_gen',
  file_search: 'com_ui_tool_name_file_search',
  code_interpreter: 'com_ui_tool_name_code_analysis',
  retrieval: 'com_ui_tool_name_file_search',
  ask_user_question: 'com_ui_tool_name_ask_user_question',
  knowledge_search: 'com_ui_tool_name_knowledge_search',
  knowledge_list: 'com_ui_tool_name_knowledge_list',
  export_file: 'com_ui_tool_name_export_file',
  set_memory: 'com_ui_tool_name_set_memory',
  delete_memory: 'com_ui_tool_name_delete_memory',
};

/**
 * Native tool ids whose raw input/output is internal plumbing, not
 * something useful to show a user who expands the tool-call card — e.g. the
 * `knowledge_search`/`knowledge_list` prompt text built for the model
 * (document dumps, relevance scores, citation-anchor escape sequences).
 * Anything a user actually needs from these tools already surfaces
 * elsewhere (the "Sources" block under the answer), so the card for them
 * renders as a single non-expandable line — no body, no disclosure chevron.
 * Keyed on the same tool id as {@link TOOL_FRIENDLY_NAME_KEYS} above, and
 * expected to grow alongside it.
 */
export const TOOLS_HIDING_DETAILS: ReadonlySet<string> = new Set([
  'knowledge_search',
  'knowledge_list',
  'export_file',
  'set_memory',
  'delete_memory',
]);

const MEMORY_ARTIFACT_TYPE_BY_TOOL: Readonly<Record<string, MemoryArtifact['type']>> = {
  set_memory: 'update',
  delete_memory: 'delete',
};

function readNonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readMemoryArgs(args?: string | Record<string, unknown>): {
  title?: string;
  key?: string;
} {
  if (args == null) {
    return {};
  }
  let parsed: unknown = args;
  if (typeof args === 'string') {
    try {
      parsed = JSON.parse(args);
    } catch {
      return {};
    }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }
  const { title, key } = parsed as { title?: unknown; key?: unknown };
  return { title: readNonEmpty(title), key: readNonEmpty(key) };
}

const MEMORY_TOOL_SUCCESS_OUTPUT = /^(?:Memory (?:set|deleted) for key|Saved\.)/;

export type MemoryToolLine = {
  title?: string;
  unchanged: boolean;
};

export function getMemoryToolLine(
  toolName: string,
  args?: string | Record<string, unknown>,
  output?: string | null,
  attachments?: TAttachment[],
): MemoryToolLine | undefined {
  const artifactType = MEMORY_ARTIFACT_TYPE_BY_TOOL[toolName];
  if (artifactType == null) {
    return undefined;
  }
  const { title, key } = readMemoryArgs(args);
  const artifact = attachments
    ?.map((attachment) => attachment?.[Tools.memory])
    .find((memory) => memory?.type === artifactType && (key == null || memory.key === key));
  const settledOutput = output?.trim() ?? '';
  const unchanged =
    settledOutput !== '' && artifact == null && !MEMORY_TOOL_SUCCESS_OUTPUT.test(settledOutput);
  if (unchanged) {
    return { unchanged };
  }
  return { unchanged, title: title ?? readNonEmpty(artifact?.title) };
}

export interface ParsedToolName {
  /** Original tool id (unchanged). */
  raw: string;
  /** MCP server name when the tool follows `<tool>_mcp_<server>`, else `''`. */
  mcpServer: string;
  /** Tool-specific name — the `<tool>` half of an MCP id, or the raw
   *  name for native tools. Useful as the "action" label shown in a
   *  code-style badge next to the server name. */
  toolName: string;
  /** Translation key for a user-friendly display name, when the raw
   *  name matches a built-in native tool (web_search, execute_code, …).
   *  Absent for MCP tools and unknown names. */
  friendlyKey?: TranslationKeys;
}

/**
 * Split an incoming tool id into its constituent parts:
 *
 *   - `search_code_mcp_github` → `{ mcpServer: 'github', toolName: 'search_code' }`
 *   - `web_search`             → `{ mcpServer: '', toolName: 'web_search', friendlyKey: 'com_ui_tool_name_web_search' }`
 *   - `some_custom_tool`       → `{ mcpServer: '', toolName: 'some_custom_tool' }`
 */
export function parseToolName(
  rawName: string,
  knownServerNames?: readonly string[],
): ParsedToolName {
  if (rawName.includes(Constants.mcp_delimiter)) {
    const [toolName, mcpServer = ''] = splitToolCallName(rawName, knownServerNames);
    return { raw: rawName, mcpServer, toolName };
  }
  const friendlyKey = TOOL_FRIENDLY_NAME_KEYS[rawName];
  return {
    raw: rawName,
    mcpServer: '',
    toolName: rawName,
    ...(friendlyKey ? { friendlyKey } : {}),
  };
}

/**
 * Resolve a tool id to a single user-facing short label. Pure string —
 * use `parseToolName` directly when you need structured parts (e.g. to
 * render a code-style badge for the tool name next to the server).
 *
 *   - MCP tool  → server name (keeps the header summary short)
 *   - Native   → localized friendly name from {@link TOOL_FRIENDLY_NAME_KEYS}
 *   - Unknown  → raw name
 */
export function getToolDisplayLabel(
  rawName: string,
  localize: (key: TranslationKeys) => string,
  knownServerNames?: readonly string[],
): string {
  const parsed = parseToolName(rawName, knownServerNames);
  if (parsed.mcpServer) return parsed.mcpServer;
  if (parsed.friendlyKey) return localize(parsed.friendlyKey);
  return parsed.toolName;
}

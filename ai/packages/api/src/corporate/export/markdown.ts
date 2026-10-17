import type { MarkedToken, Token, Tokens } from 'marked';
import type { DocumentBlock, InlineRun } from './types';

interface RunStyle {
  bold: boolean;
  italic: boolean;
}

const PLAIN: RunStyle = { bold: false, italic: false };

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

const ENTITY_PATTERN = /&(?:amp|lt|gt|quot|#39|nbsp);/g;

function decodeEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (entity) => ENTITIES[entity] ?? entity);
}

function run(text: string, style: RunStyle): InlineRun {
  return { text, bold: style.bold, italic: style.italic };
}

function mergeRuns(runs: InlineRun[]): InlineRun[] {
  return runs.reduce<InlineRun[]>((merged, current) => {
    if (current.text === '') {
      return merged;
    }
    const last = merged[merged.length - 1];
    if (last && last.bold === current.bold && last.italic === current.italic) {
      merged[merged.length - 1] = { ...last, text: last.text + current.text };
      return merged;
    }
    merged.push(current);
    return merged;
  }, []);
}

function inlineRuns(tokens: Token[], style: RunStyle = PLAIN): InlineRun[] {
  return mergeRuns(tokens.flatMap((token) => tokenRuns(token as MarkedToken, style)));
}

function linkRuns(token: Tokens.Link, style: RunStyle): InlineRun[] {
  const runs = inlineRuns(token.tokens, style);
  const target = token.href.replace(/^mailto:/, '');
  return target && target !== token.text ? [...runs, run(` (${token.href})`, style)] : runs;
}

function tokenRuns(token: MarkedToken, style: RunStyle): InlineRun[] {
  switch (token.type) {
    case 'strong':
      return inlineRuns(token.tokens, { ...style, bold: true });
    case 'em':
      return inlineRuns(token.tokens, { ...style, italic: true });
    case 'del':
      return inlineRuns(token.tokens, style);
    case 'link':
      return linkRuns(token, style);
    case 'image':
      return token.text ? [run(token.text, style)] : [];
    case 'codespan':
      return [run(decodeEntities(token.text), style)];
    case 'br':
      return [run('\n', style)];
    case 'escape':
      return [run(token.text, style)];
    case 'text':
      return token.tokens ? inlineRuns(token.tokens, style) : [run(decodeEntities(token.text), style)];
    default:
      return [];
  }
}

function listItemRuns(item: Tokens.ListItem): InlineRun[][] {
  const parts: InlineRun[][] = [];
  const nested: InlineRun[][] = [];
  for (const child of item.tokens) {
    const token = child as MarkedToken;
    if (token.type === 'list') {
      nested.push(...token.items.flatMap(listItemRuns));
      continue;
    }
    if (token.type === 'text' || token.type === 'paragraph') {
      parts.push(token.tokens ? inlineRuns(token.tokens) : [run(decodeEntities(token.text), PLAIN)]);
    }
  }
  const own = mergeRuns(parts.flatMap((runs, index) => (index === 0 ? runs : [run(' ', PLAIN), ...runs])));
  return [own, ...nested];
}

function headingLevel(depth: number): 1 | 2 | 3 {
  if (depth <= 1) {
    return 1;
  }
  return depth === 2 ? 2 : 3;
}

function tokenBlocks(token: MarkedToken): DocumentBlock[] {
  switch (token.type) {
    case 'heading':
      return [{ kind: 'heading', level: headingLevel(token.depth), runs: inlineRuns(token.tokens) }];
    case 'paragraph':
      return [{ kind: 'paragraph', runs: inlineRuns(token.tokens) }];
    case 'text':
      return [
        {
          kind: 'paragraph',
          runs: token.tokens ? inlineRuns(token.tokens) : [run(decodeEntities(token.text), PLAIN)],
        },
      ];
    case 'list':
      return [{ kind: 'list', ordered: token.ordered, items: token.items.flatMap(listItemRuns) }];
    case 'table':
      return [
        {
          kind: 'table',
          header: token.header.map((cell) => inlineRuns(cell.tokens)),
          rows: token.rows.map((row) => row.map((cell) => inlineRuns(cell.tokens))),
        },
      ];
    case 'code':
      return [{ kind: 'code', text: token.text }];
    case 'blockquote':
      return token.tokens.flatMap((child) => tokenBlocks(child as MarkedToken));
    default:
      return [];
  }
}

export async function parseMarkdownBlocks(markdown: string): Promise<DocumentBlock[]> {
  const { Lexer } = await import('marked');
  return Lexer.lex(markdown, { gfm: true, breaks: true }).flatMap((token) =>
    tokenBlocks(token as MarkedToken),
  );
}

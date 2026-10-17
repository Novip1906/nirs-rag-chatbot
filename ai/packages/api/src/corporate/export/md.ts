const TRAILING_WHITESPACE = /[ \t]+$/gm;
const CRLF_OR_CR = /\r\n|\r/g;
const WHITESPACE_RUN = /\s+/g;

function normalizeNewlines(text: string): string {
  return text.replace(CRLF_OR_CR, '\n');
}

function stripTrailingWhitespace(text: string): string {
  return text.replace(TRAILING_WHITESPACE, '');
}

function normalizeTitle(title: string): string {
  return title.replace(WHITESPACE_RUN, ' ').trim();
}

export function renderMarkdownFile(markdown: string, title?: string): Buffer {
  const body = stripTrailingWhitespace(normalizeNewlines(markdown)).trim();
  const heading = title ? normalizeTitle(title) : '';
  const content = heading ? `# ${heading}\n\n${body}` : body;
  return Buffer.from(`${content}\n`, 'utf8');
}

import { FileSources } from 'librechat-data-provider';
import type { IMongoFile } from '@librechat/data-schemas';
import type { TFile } from 'librechat-data-provider';
import { extractFileContext, getAttachmentTitleText } from './context';
import * as textUtils from '~/utils/text';

const file = (filename?: string): TFile => ({ filename }) as TFile;

const countTokens = (text: string) => Promise.resolve(text.length);

function textFile(overrides: Partial<IMongoFile> = {}): IMongoFile {
  return {
    file_id: 'file-1',
    filename: 'regulation.docx',
    source: FileSources.text,
    text: 'короткий текст',
    ...overrides,
  } as IMongoFile;
}

describe('getAttachmentTitleText', () => {
  it('returns an empty string when there are no files', () => {
    expect(getAttachmentTitleText()).toBe('');
    expect(getAttachmentTitleText(null)).toBe('');
    expect(getAttachmentTitleText([])).toBe('');
  });

  it('lists a single filename', () => {
    expect(getAttachmentTitleText([file('report.pdf')])).toBe('Attached file(s): report.pdf');
  });

  it('lists every filename', () => {
    expect(getAttachmentTitleText([file('a.pdf'), file('b.csv')])).toBe(
      'Attached file(s): a.pdf, b.csv',
    );
  });

  it('skips files that carry no filename', () => {
    expect(getAttachmentTitleText([file(), file('kept.txt')])).toBe('Attached file(s): kept.txt');
  });

  it('returns an empty string when no file has a filename', () => {
    expect(getAttachmentTitleText([file(), file()])).toBe('');
  });
});

describe('extractFileContext', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('отдаёт текст документа без пометок, когда он влез целиком', async () => {
    const context = await extractFileContext({
      attachments: [textFile()],
      req: { body: { fileTokenLimit: 1000 } } as never,
      tokenCountFn: countTokens,
    });

    expect(context).toContain('короткий текст');
    expect(context).not.toContain('обрез');
  });

  it('включает текст целиком, даже если он больше fileTokenLimit', async () => {
    const limitSpy = jest.spyOn(textUtils, 'processTextWithTokenLimit');
    const text = 'x'.repeat(200000);

    const context = await extractFileContext({
      attachments: [textFile({ text })],
      req: { body: { fileTokenLimit: 100000 } } as never,
      tokenCountFn: countTokens,
    });

    expect(context).toContain(text);
    expect(context).not.toMatch(/показан не целиком/i);
    expect(limitSpy).not.toHaveBeenCalled();
  });

  it('включает текст и без fileTokenLimit', async () => {
    const context = await extractFileContext({
      attachments: [textFile()],
      req: { body: { fileTokenLimit: 0 }, config: { fileConfig: { fileTokenLimit: 0 } } } as never,
      tokenCountFn: countTokens,
    });

    expect(context).toContain('короткий текст');
  });
});

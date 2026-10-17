import * as fs from 'fs';
import yauzl from 'yauzl';
import { logger } from '@librechat/data-schemas';
import {
  megabyte,
  FileSources,
  excelMimeTypes,
  AttachmentErrorCodes,
  documentParserSizeLimit,
} from 'librechat-data-provider';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { MistralOCRUploadResult } from '~/types';
import { classifyParseFailure, DocumentParseError, PARSE_TIMEOUT_MESSAGE } from './errors';
import { assertSafeZipSize, ZipBombError } from './zipSafety';
import { withTimeout } from '~/utils/promise';
import { extractDocxText } from './docx';
import { pptxToText } from './pptx';
import { rtfToText } from './rtf';
import { docToText } from './doc';

type FileParseFn = (file: Express.Multer.File) => Promise<string>;

const DOCUMENT_PARSER_MAX_FILE_SIZE = documentParserSizeLimit;
const ODT_MAX_DECOMPRESSED_SIZE = 50 * megabyte;
const DOCUMENT_PARSE_TIMEOUT_MS = 120_000;
const CFB_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const OOXML_ENCRYPTABLE_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/**
 * Parses an uploaded document and extracts its text content and metadata.
 * Handled types must stay in sync with `documentParserMimeTypes` from data-provider.
 *
 * @throws {Error} if `file.mimetype` is not handled, file exceeds size limit, or no text is found.
 */
export async function parseDocument({
  file,
  timeoutMs = DOCUMENT_PARSE_TIMEOUT_MS,
}: {
  file: Express.Multer.File;
  timeoutMs?: number;
}): Promise<MistralOCRUploadResult> {
  const parseFn = getParserForMimeType(file.mimetype);
  if (!parseFn) {
    throw new Error(`Unsupported file type in document parser: ${file.mimetype}`);
  }

  const fileSize = file.size ?? (file.path != null ? (await fs.promises.stat(file.path)).size : 0);
  if (fileSize > DOCUMENT_PARSER_MAX_FILE_SIZE) {
    const limitMb = DOCUMENT_PARSER_MAX_FILE_SIZE / megabyte;
    const sizeMb = Math.ceil(fileSize / megabyte);
    throw new DocumentParseError(
      AttachmentErrorCodes.too_large,
      { filename: file.originalname, limitMb },
      `File "${file.originalname}" exceeds the ${limitMb}MB document parser limit (${sizeMb}MB).`,
    );
  }

  await assertNotEncryptedOoxml(file);

  logger.debug(
    `[parseDocument] Extracting text locally from "${file.originalname}" (${file.mimetype}, ${fileSize} bytes)`,
  );

  let text: string;
  try {
    text = await withTimeout(parseFn(file), timeoutMs, PARSE_TIMEOUT_MESSAGE);
  } catch (error) {
    throw classifyParseFailure(error, { filename: file.originalname, timeoutMs });
  }

  if (!text?.trim()) {
    throw new DocumentParseError(
      AttachmentErrorCodes.no_text,
      { filename: file.originalname },
      'No text found in document',
    );
  }

  const bytes = Buffer.byteLength(text, 'utf8');
  logger.debug(`[parseDocument] Extracted ${bytes} bytes of text from "${file.originalname}"`);

  return {
    filename: file.originalname,
    bytes,
    filepath: FileSources.document_parser,
    text,
    images: [],
  };
}

async function assertNotEncryptedOoxml(file: Express.Multer.File): Promise<void> {
  if (!OOXML_ENCRYPTABLE_MIME_TYPES.has(file.mimetype)) {
    return;
  }
  const signature = await readLeadingBytes(file.path, CFB_SIGNATURE.length);
  if (signature.equals(CFB_SIGNATURE)) {
    throw new DocumentParseError(AttachmentErrorCodes.encrypted, { filename: file.originalname });
  }
}

async function readLeadingBytes(filePath: string, length: number): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Maps a MIME type to its document parser function, or `undefined` if unsupported. */
function getParserForMimeType(mimetype: string): FileParseFn | undefined {
  if (mimetype === 'application/pdf') {
    return pdfToText;
  }
  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return wordDocToText;
  }
  if (
    excelMimeTypes.test(mimetype) ||
    mimetype === 'application/vnd.oasis.opendocument.spreadsheet'
  ) {
    return excelSheetToText;
  }
  if (mimetype === 'application/vnd.oasis.opendocument.text') {
    return odtToText;
  }
  if (mimetype === 'application/rtf' || mimetype === 'text/rtf') {
    return rtfToText;
  }
  if (mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return pptxToText;
  }
  if (mimetype === 'application/msword') {
    return docToText;
  }
  return undefined;
}

/** Parses PDF, returns text inside. */
async function pdfToText(file: Express.Multer.File): Promise<string> {
  // Imported inline so that Jest can test other routes without failing due to loading ESM
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = new Uint8Array(await fs.promises.readFile(file.path));
  const pdf = await getDocument({ data }).promise;

  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter((item): item is TextItem => !('type' in item))
      .map((item) => item.str)
      .join(' ');
    fullText += pageText + '\n';
  }

  return fullText;
}

/** Parses Word document, returns text inside. */
async function wordDocToText(file: Express.Multer.File): Promise<string> {
  return extractDocxText(await fs.promises.readFile(file.path), file.originalname ?? 'docx');
}

/** Parses Excel sheet, returns text inside. */
async function excelSheetToText(file: Express.Multer.File): Promise<string> {
  // xlsx CDN build (0.20.x) does not bind fs internally when dynamically imported;
  // readFile() fails with "Cannot access file". read() takes a pre-loaded Buffer instead.
  const { read, utils } = await import('xlsx');
  const data = await fs.promises.readFile(file.path);
  /* Reject zip-bomb XLSX/ODS before SheetJS's internal extractor runs.
   * `.xls` (BIFF/CFB) is not a ZIP — magic-byte check skips the
   * validator for it (yauzl would reject it as malformed anyway). */
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b) {
    await assertSafeZipSize(data, { name: file.originalname ?? 'spreadsheet' });
  }
  const workbook = read(data, { type: 'buffer' });

  let text = '';
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const worksheetAsCsvString = utils.sheet_to_csv(worksheet);
    text += `${sheetName}:\n${worksheetAsCsvString}\n`;
  }

  return text;
}

/**
 * Parses OpenDocument Text (.odt) by extracting the body text from content.xml.
 * Uses regex-based XML extraction scoped to <office:body>: paragraph/heading
 * boundaries become newlines, tab and spacing elements are preserved, and the
 * five standard XML entities are decoded. Complex elements such as frames,
 * text boxes, and annotations are stripped without replacement.
 */
async function odtToText(file: Express.Multer.File): Promise<string> {
  const xml = await extractOdtContentXml(file.path);
  const bodyMatch = xml.match(/<office:body[^>]*>([\s\S]*?)<\/office:body>/);
  if (!bodyMatch) {
    return '';
  }
  return bodyMatch[1]
    .replace(/<\/text:p>/g, '\n')
    .replace(/<\/text:h>/g, '\n')
    .replace(/<text:line-break\/>/g, '\n')
    .replace(/<text:tab\/>/g, '\t')
    .replace(/<text:s[^>]*\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Streams content.xml out of an ODT ZIP archive using yauzl, counting real
 * decompressed bytes and aborting mid-inflate if the cap is exceeded.
 * Unlike JSZip metadata checks, this cannot be bypassed by falsifying
 * the ZIP central directory's uncompressedSize fields.
 *
 * The zipfile is closed on all exit paths (success, size cap, missing entry,
 * error) to prevent file descriptor leaks.
 */
function extractOdtContentXml(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        return reject(err);
      }
      if (!zipfile) {
        return reject(new Error('Failed to open ODT file'));
      }

      let settled = false;
      const finish = (error: Error | null, result?: string) => {
        if (settled) {
          return;
        }
        settled = true;
        zipfile.close();
        if (error) {
          reject(error);
        } else {
          resolve(result as string);
        }
      };

      let found = false;
      zipfile.readEntry();

      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== 'content.xml') {
          zipfile.readEntry();
          return;
        }
        found = true;
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) {
            return finish(streamErr);
          }
          if (!readStream) {
            return finish(new Error('Failed to open content.xml stream'));
          }

          let totalBytes = 0;
          const chunks: Buffer[] = [];

          readStream.on('data', (chunk: Buffer) => {
            totalBytes += chunk.byteLength;
            if (totalBytes > ODT_MAX_DECOMPRESSED_SIZE) {
              readStream.destroy(
                new ZipBombError(
                  `ODT content.xml exceeds the ${ODT_MAX_DECOMPRESSED_SIZE / megabyte}MB decompressed limit`,
                ),
              );
              return;
            }
            chunks.push(chunk);
          });

          readStream.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
          readStream.on('error', (readErr: Error) => finish(readErr));
        });
      });

      zipfile.on('end', () => {
        if (!found) {
          finish(new Error('ODT file is missing content.xml'));
        }
      });

      zipfile.on('error', (zipErr: Error) => finish(zipErr));
    });
  });
}

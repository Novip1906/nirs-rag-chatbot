import * as fs from 'fs';
import WordExtractor from 'word-extractor';
import { extractDocxText } from './docx';
import { extractRtfText } from './rtf';

const RTF_SIGNATURE = '{\\rtf';
const ZIP_SIGNATURE = 'PK';

function startsWith(buffer: Buffer, signature: string): boolean {
  return buffer.subarray(0, signature.length).toString('latin1') === signature;
}

export async function extractDocText(buffer: Buffer, name: string = 'doc'): Promise<string> {
  if (startsWith(buffer, RTF_SIGNATURE)) {
    return extractRtfText(buffer);
  }
  if (startsWith(buffer, ZIP_SIGNATURE)) {
    return extractDocxText(buffer, name);
  }
  const document = await new WordExtractor().extract(buffer);
  return [document.getBody(), document.getFootnotes(), document.getEndnotes()]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n\n');
}

export async function docToText(file: Express.Multer.File): Promise<string> {
  return extractDocText(await fs.promises.readFile(file.path), file.originalname ?? 'doc');
}

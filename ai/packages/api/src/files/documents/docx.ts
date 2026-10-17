import { assertSafeZipSize } from './zipSafety';

export async function extractDocxText(buffer: Buffer, name: string): Promise<string> {
  await assertSafeZipSize(buffer, { name });
  const { extractRawText } = await import('mammoth');
  const rawText = await extractRawText({ buffer });
  return rawText.value;
}

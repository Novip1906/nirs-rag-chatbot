import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import v8 from 'node:v8';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const require = createRequire('/app/api/package.json');
const api = require('@librechat/api');

const mimeByExtension = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  doc: 'application/msword',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
};

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error('usage: probe.mjs <file>');
  }

  const extension = path.extname(filePath).slice(1).toLowerCase();
  const mimetype = mimeByExtension[extension];
  if (!mimetype) {
    throw new Error(`unsupported extension: ${extension}`);
  }

  const fileSizeBytes = fs.statSync(filePath).size;
  const baselineRssMb = process.memoryUsage().rss / (1024 * 1024);
  const heapSizeLimitMb = v8.getHeapStatistics().heap_size_limit / (1024 * 1024);

  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();

  const file = {
    path: filePath,
    originalname: path.basename(filePath),
    mimetype,
    size: 1,
  };

  let text = '';
  let error = '';
  const parseStart = process.hrtime.bigint();
  try {
    const parsed = await api.parseDocument({ file });
    text = parsed.text ?? '';
  } catch (e) {
    error = `${e.name}: ${e.message}`;
  }
  const parseMs = Number(process.hrtime.bigint() - parseStart) / 1e6;

  const textChars = text.length;
  let tokens = 0;
  let countMs = 0;
  if (text) {
    const countStart = process.hrtime.bigint();
    tokens = await api.countTokens(text);
    countMs = Number(process.hrtime.bigint() - countStart) / 1e6;
  }

  loopDelay.disable();
  const maxLoopBlockMs = loopDelay.max / 1e6;
  const maxRssMb = process.resourceUsage().maxRSS / 1024;

  console.log(
    JSON.stringify({
      file: path.basename(filePath),
      mimetype,
      fileSizeBytes,
      baselineRssMb,
      heapSizeLimitMb,
      parseMs,
      textChars,
      tokens,
      countMs,
      error,
      maxLoopBlockMs,
      maxRssMb,
    }),
  );
}

main().catch((error) => {
  console.log(JSON.stringify({ error: `${error.name}: ${error.message}` }));
  process.exit(1);
});

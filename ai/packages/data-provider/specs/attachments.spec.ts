import { z } from 'zod';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { load, loadAll } from 'js-yaml';
import {
  AttachmentErrorCodes,
  ATTACHMENT_FORMATS,
  isAttachmentErrorCode,
  createAttachmentErrorBody,
  listAcceptedFormats,
  findAttachmentFormat,
} from '../src/attachments';
import { fileConfigSchema, convertStringsToRegex } from '../src/file-config';

const k8sConfigMapSchema = z.object({
  kind: z.string(),
  data: z.record(z.string()).optional(),
});

function loadDeployFileConfig(): z.infer<typeof fileConfigSchema> {
  const yamlPath = resolve(__dirname, '../../../deploy/10-config.yaml');
  const raw = readFileSync(yamlPath, 'utf8');
  const configMaps = loadAll(raw).map((doc) => k8sConfigMapSchema.parse(doc));
  const libreChatConfigMap = configMaps.find((doc) => doc.data?.['librechat.yaml'] != null);
  if (!libreChatConfigMap?.data) {
    throw new Error('deploy/10-config.yaml: librechat.yaml ConfigMap not found');
  }
  return z
    .object({ fileConfig: fileConfigSchema })
    .parse(load(libreChatConfigMap.data['librechat.yaml'])).fileConfig;
}

const CATALOG_FORMAT_IDS = Object.values(ATTACHMENT_FORMATS)
  .flat()
  .map((format) => format.id)
  .sort();

const REJECTED_MIME_TYPES = [
  'application/zip',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.presentation',
  'application/epub+zip',
  'application/x-msdownload',
  'audio/mpeg',
  'video/mp4',
  'image/svg+xml',
];

const CATALOG_MIME_TYPES = Object.values(ATTACHMENT_FORMATS)
  .flat()
  .flatMap((format) => format.mimeTypes);

const PROBE_MIME_TYPES = [
  ...CATALOG_MIME_TYPES,
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/html',
  'text/css',
  'text/x-python',
  'text/javascript',
  'text/xml',
  'application/json',
  'application/xml',
  'application/vnd.coffeescript',
  ...REJECTED_MIME_TYPES,
];

describe('deploy/10-config.yaml attachment catalog', () => {
  const deployFileConfig = loadDeployFileConfig();
  const endpointKeys = ['default', 'agents', 'custom'] as const;

  it.each(endpointKeys)('%s endpoint accepts exactly the attachment format catalog', (key) => {
    const endpoint = deployFileConfig.endpoints?.[key];
    expect(endpoint?.supportedMimeTypes).toBeDefined();

    const regexes = convertStringsToRegex(endpoint?.supportedMimeTypes ?? []);
    const acceptedIds = listAcceptedFormats(regexes)
      .map((format) => format.id)
      .sort();

    expect(acceptedIds).toEqual(CATALOG_FORMAT_IDS);
  });

  it.each(endpointKeys)('%s endpoint rejects zip, ppt, odp, epub, exe, mp3, mp4 and svg', (key) => {
    const endpoint = deployFileConfig.endpoints?.[key];
    const regexes = convertStringsToRegex(endpoint?.supportedMimeTypes ?? []);

    for (const mimeType of REJECTED_MIME_TYPES) {
      expect(regexes.some((regex) => regex.test(mimeType))).toBe(false);
    }
  });

  it.each(endpointKeys)(
    '%s endpoint: every MIME type it accepts resolves to a catalog entry',
    (key) => {
      const endpoint = deployFileConfig.endpoints?.[key];
      const regexes = convertStringsToRegex(endpoint?.supportedMimeTypes ?? []);

      for (const mimeType of PROBE_MIME_TYPES) {
        const acceptedByConfig = regexes.some((regex) => regex.test(mimeType));
        if (!acceptedByConfig) {
          continue;
        }
        expect(findAttachmentFormat(mimeType)).not.toBeNull();
      }
    },
  );
});

describe('isAttachmentErrorCode', () => {
  it('recognizes all eight attachment error codes', () => {
    Object.values(AttachmentErrorCodes).forEach((code) => {
      expect(isAttachmentErrorCode(code)).toBe(true);
    });
    expect(Object.values(AttachmentErrorCodes)).toHaveLength(8);
  });

  it('rejects the retired too_many_pages code', () => {
    expect(isAttachmentErrorCode('too_many_pages')).toBe(false);
  });
});

describe('createAttachmentErrorBody', () => {
  it('builds a context_overflow body carrying params and an English fallback message', () => {
    const body = createAttachmentErrorBody(AttachmentErrorCodes.context_overflow, {
      filename: 'report.pdf',
      pageCount: 400,
      tokens: 103200,
      contextTokens: 100000,
      requiredContextTokens: 150000,
      modelLabel: 'gpt-5.6-luna',
    });

    expect(body.errorCode).toBe(AttachmentErrorCodes.context_overflow);
    expect(body.params).toEqual({
      filename: 'report.pdf',
      pageCount: 400,
      tokens: 103200,
      contextTokens: 100000,
      requiredContextTokens: 150000,
      modelLabel: 'gpt-5.6-luna',
    });
    expect(body.message).toContain('report.pdf');
    expect(body.message).not.toMatch(/[а-яё]/i);
  });
});

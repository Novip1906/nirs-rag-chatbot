import { z } from 'zod';
import { Tools } from 'librechat-data-provider';
import { tool } from '@librechat/agents/langchain/tools';
import type { StructuredToolInterface } from '@librechat/agents/langchain/tools';
import { EXPORT_FILE_DESCRIPTION } from './definition';
import { parseExportFileArgs } from './validate';
import { parkRenderedExport } from './store';
import { renderExportFile } from './render';

export interface ExportFileArtifact {
  exportId: string;
  filename: string;
  mimeType: string;
  bytes: number;
}

const passthroughSchema = z.object({}).passthrough();

export function createExportFileTool(): StructuredToolInterface {
  return tool(
    async (input) => {
      const args = parseExportFileArgs(input);
      const file = await renderExportFile(args);
      const exportId = parkRenderedExport(file);
      const artifact: Record<Tools.export_file, ExportFileArtifact> = {
        [Tools.export_file]: {
          exportId,
          filename: file.filename,
          mimeType: file.mimeType,
          bytes: file.buffer.length,
        },
      };
      return [
        `Файл «${file.filename}» собран и прикреплён к ответу. Коротко скажи сотруднику, что файл приложен, и не повторяй его содержимое в ответе.`,
        artifact,
      ];
    },
    {
      name: Tools.export_file,
      description: EXPORT_FILE_DESCRIPTION,
      schema: passthroughSchema,
      responseFormat: 'content_and_artifact',
    },
  );
}

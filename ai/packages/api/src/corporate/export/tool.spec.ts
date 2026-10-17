import { Tools } from 'librechat-data-provider';
import type { ToolMessage } from '@langchain/core/messages';
import type { ExportFileArtifact } from './tool';
import { createExportFileTool } from './tool';
import { takeRenderedExport } from './store';
import { ExportFileError } from './types';

function exportArtifact(message: ToolMessage): ExportFileArtifact {
  return (message.artifact as Record<Tools.export_file, ExportFileArtifact>)[Tools.export_file];
}

describe('createExportFileTool', () => {
  it('собирает файл, откладывает его для обработчика и отвечает модели коротко', async () => {
    const message = (await createExportFileTool().invoke({
      name: Tools.export_file,
      id: 'call-1',
      type: 'tool_call',
      args: {
        format: 'csv',
        filename: 'Выгрузка',
        sheets: [{ name: 'Лист', columns: ['Город', 'Сумма'], rows: [['Москва', 1234.5]] }],
      },
    })) as ToolMessage;
    expect(message.content).toBe(
      'Файл «Выгрузка.csv» собран и прикреплён к ответу. Коротко скажи сотруднику, что файл приложен, и не повторяй его содержимое в ответе.',
    );
    const artifact = exportArtifact(message);
    expect(artifact).toMatchObject({ filename: 'Выгрузка.csv', mimeType: 'text/csv' });
    const parked = takeRenderedExport(artifact.exportId);
    expect(parked?.buffer.toString('utf8')).toBe('﻿Город;Сумма\r\nМосква;1234,5\r\n');
    expect(parked?.buffer.length).toBe(artifact.bytes);
    expect(takeRenderedExport(artifact.exportId)).toBeUndefined();
  });

  it('собирает md и откладывает его для обработчика', async () => {
    const message = (await createExportFileTool().invoke({
      name: Tools.export_file,
      id: 'call-3',
      type: 'tool_call',
      args: { format: 'md', filename: 'Заметки', markdown: '# Итоги' },
    })) as ToolMessage;
    const artifact = exportArtifact(message);
    expect(artifact).toMatchObject({ filename: 'Заметки.md', mimeType: 'text/markdown' });
    const parked = takeRenderedExport(artifact.exportId);
    expect(parked?.buffer.toString('utf8')).toBe('# Итоги\n');
  });

  it('возвращает модели ошибку проверки на русском', async () => {
    const invocation = createExportFileTool().invoke({
      name: Tools.export_file,
      id: 'call-2',
      type: 'tool_call',
      args: { format: 'docx', filename: 'Отчёт' },
    });
    await expect(invocation).rejects.toBeInstanceOf(ExportFileError);
    await expect(invocation).rejects.toThrow(
      'markdown: для формата docx нужен markdown с содержимым документа',
    );
  });
});

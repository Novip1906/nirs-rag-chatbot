jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    copyFile: jest.fn(),
    unlink: jest.fn(),
  },
}));

import fs from 'fs';
import { saveOriginalToDisk, removeOriginalFromDisk } from './storage';

const mockedFs = fs.promises as jest.Mocked<typeof fs.promises>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('saveOriginalToDisk', () => {
  it('создаёт каталог пространства и копирует файл по пути spaceId/fileId.extension', async () => {
    mockedFs.mkdir.mockResolvedValue(undefined);
    mockedFs.copyFile.mockResolvedValue(undefined);

    const destination = await saveOriginalToDisk({
      uploadsRoot: '/app/uploads/knowledge',
      spaceId: 'space-1',
      fileId: 'file-1',
      sourcePath: '/tmp/upload-1',
      extension: 'pdf',
    });

    expect(mockedFs.mkdir).toHaveBeenCalledWith('/app/uploads/knowledge/space-1', {
      recursive: true,
    });
    expect(mockedFs.copyFile).toHaveBeenCalledWith(
      '/tmp/upload-1',
      '/app/uploads/knowledge/space-1/file-1.pdf',
    );
    expect(destination).toBe('/app/uploads/knowledge/space-1/file-1.pdf');
  });

  it('не добавляет точку, если расширение не передано', async () => {
    mockedFs.mkdir.mockResolvedValue(undefined);
    mockedFs.copyFile.mockResolvedValue(undefined);

    const destination = await saveOriginalToDisk({
      uploadsRoot: '/app/uploads/knowledge',
      spaceId: 'space-1',
      fileId: 'file-1',
      sourcePath: '/tmp/upload-1',
      extension: '',
    });

    expect(destination).toBe('/app/uploads/knowledge/space-1/file-1');
  });
});

describe('removeOriginalFromDisk', () => {
  it('удаляет файл по пути', async () => {
    mockedFs.unlink.mockResolvedValue(undefined);
    await removeOriginalFromDisk('/app/uploads/knowledge/space-1/file-1.pdf');
    expect(mockedFs.unlink).toHaveBeenCalledWith('/app/uploads/knowledge/space-1/file-1.pdf');
  });

  it('пустой путь не трогает диск', async () => {
    await removeOriginalFromDisk('');
    expect(mockedFs.unlink).not.toHaveBeenCalled();
  });

  it('отсутствующий файл (ENOENT) не считается ошибкой', async () => {
    mockedFs.unlink.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(removeOriginalFromDisk('/gone')).resolves.toBeUndefined();
  });

  it('прочие ошибки диска пробрасываются', async () => {
    mockedFs.unlink.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    await expect(removeOriginalFromDisk('/no-access')).rejects.toThrow('EACCES');
  });
});

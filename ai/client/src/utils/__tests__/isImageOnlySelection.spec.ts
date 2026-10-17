import { isImageOnlySelection } from '../files';

const file = (name: string, type: string) => new File(['x'], name, { type });

describe('isImageOnlySelection', () => {
  it('признаёт выбор из одних картинок', () => {
    expect(isImageOnlySelection([file('снимок.png', 'image/png')])).toBe(true);
    expect(isImageOnlySelection([file('а.png', 'image/png'), file('б.jpg', 'image/jpeg')])).toBe(
      true,
    );
  });

  it('не признаёт выбор, где есть документ', () => {
    expect(
      isImageOnlySelection([file('снимок.png', 'image/png'), file('акт.pdf', 'application/pdf')]),
    ).toBe(false);
  });

  it('не признаёт документ', () => {
    expect(isImageOnlySelection([file('акт.pdf', 'application/pdf')])).toBe(false);
  });

  /** Пустой выбор не картинка: иначе он молча ушёл бы по пути «отправить модели». */
  it('не признаёт пустой выбор', () => {
    expect(isImageOnlySelection([])).toBe(false);
  });

  /** Из буфера обмена файлы приходят списком `FileList`, а не массивом. */
  it('работает со списком файлов, а не только с массивом', () => {
    const image = file('снимок.png', 'image/png');
    const list = {
      0: image,
      length: 1,
      item: () => image,
      [Symbol.iterator]: function* () {
        yield image;
      },
    } as unknown as FileList;

    expect(isImageOnlySelection(list)).toBe(true);
  });
});

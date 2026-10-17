import { encodeWav } from './wav';

const readAscii = (view: DataView, offset: number, length: number): string =>
  String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)));

describe('encodeWav', () => {
  it('пишет заголовок RIFF для PCM 16 бит моно', () => {
    const view = new DataView(encodeWav(new Float32Array(3), 16000));

    expect(view.byteLength).toBe(44 + 6);
    expect(readAscii(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 6);
    expect(readAscii(view, 8, 4)).toBe('WAVE');
    expect(readAscii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(readAscii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(6);
  });

  it('переводит отсчёты в PCM16 и обрезает всё, что за пределами [-1, 1]', () => {
    const samples = new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2]);
    const view = new DataView(encodeWav(samples, 16000));
    const pcm = Array.from({ length: samples.length }, (_, i) => view.getInt16(44 + i * 2, true));

    expect(pcm).toEqual([0, 32767, -32768, 16383, -16384, 32767, -32768]);
  });

  it('кодирует пустую запись одним заголовком', () => {
    const view = new DataView(encodeWav(new Float32Array(0), 16000));

    expect(view.byteLength).toBe(44);
    expect(view.getUint32(40, true)).toBe(0);
  });
});

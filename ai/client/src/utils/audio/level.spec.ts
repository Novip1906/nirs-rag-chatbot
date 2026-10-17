import { computeLevel, dotScales, WAVE_DOTS } from './level';

describe('computeLevel', () => {
  it('returns 0 for an empty buffer', () => {
    expect(computeLevel(new Uint8Array())).toBe(0);
  });

  it('returns 0 for silence', () => {
    expect(computeLevel(new Uint8Array(64).fill(128))).toBe(0);
  });

  it('returns about 0.25 for quiet alternating speech', () => {
    const samples = new Uint8Array(64);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = index % 2 === 0 ? 120 : 136;
    }
    expect(computeLevel(samples)).toBeCloseTo(0.25, 5);
  });

  it('caps at 1 for loud speech', () => {
    const samples = new Uint8Array(64);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = index % 2 === 0 ? 0 : 255;
    }
    expect(computeLevel(samples)).toBe(1);
  });
});

describe('dotScales', () => {
  it('returns WAVE_DOTS values', () => {
    expect(dotScales(0.5, WAVE_DOTS, 0)).toHaveLength(WAVE_DOTS);
  });

  it('is all 1 in silence', () => {
    expect(dotScales(0, WAVE_DOTS, 5)).toEqual(new Array(WAVE_DOTS).fill(1));
  });

  it('stays within [1, 4] and varies with sound', () => {
    const scales = dotScales(0.8, WAVE_DOTS, 3);
    scales.forEach((scale) => {
      expect(scale).toBeGreaterThanOrEqual(1);
      expect(scale).toBeLessThanOrEqual(4);
    });
    expect(new Set(scales).size).toBeGreaterThan(1);
  });

  it('does not stretch further above level 1', () => {
    const atOne = dotScales(1, WAVE_DOTS, 3);
    const aboveOne = dotScales(2, WAVE_DOTS, 3);
    expect(aboveOne).toEqual(atOne);
  });

  it('changes pattern with a different tick', () => {
    const first = dotScales(0.6, WAVE_DOTS, 0);
    const second = dotScales(0.6, WAVE_DOTS, 1);
    expect(second).not.toEqual(first);
  });
});

export const WAVE_DOTS = 8;

export const computeLevel = (samples: Uint8Array): number => {
  if (samples.length === 0) {
    return 0;
  }
  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const deviation = samples[index] - 128;
    sumSquares += deviation * deviation;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  return Math.min(1, (rms / 128) * 4);
};

export const dotScales = (level: number, count: number, tick: number): number[] => {
  const clampedLevel = Math.min(1, Math.max(0, level));
  const scales: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const phase = tick / 6 + (index / count) * Math.PI * 2;
    const wave = (Math.sin(phase) + 1) / 2;
    scales.push(1 + wave * clampedLevel * 3);
  }
  return scales;
};

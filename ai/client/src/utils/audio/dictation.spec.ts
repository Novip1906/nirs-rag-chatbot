import {
  formatSeconds,
  getDictationPhase,
  getRemainingSeconds,
  shouldShowCountdown,
} from './dictation';

describe('getRemainingSeconds', () => {
  it('отдаёт полный остаток в начале записи', () => {
    expect(getRemainingSeconds(0)).toBe(300);
  });

  it('отдаёт остаток перед автоостановкой', () => {
    expect(getRemainingSeconds(270)).toBe(30);
  });

  it('не уходит в минус после превышения лимита', () => {
    expect(getRemainingSeconds(301)).toBe(0);
  });
});

describe('shouldShowCountdown', () => {
  it('не показывает отсчёт, пока остаток больше 30 секунд', () => {
    expect(shouldShowCountdown(269)).toBe(false);
  });

  it('показывает отсчёт, когда остаток равен 30 секундам', () => {
    expect(shouldShowCountdown(270)).toBe(true);
  });
});

describe('formatSeconds', () => {
  it('форматирует секунды без минут', () => {
    expect(formatSeconds(30)).toBe('00:30');
  });

  it('форматирует минуты и секунды', () => {
    expect(formatSeconds(65)).toBe('01:05');
  });
});

describe('getDictationPhase', () => {
  it('отдаёт idle, когда ничего не происходит', () => {
    expect(getDictationPhase(false, false)).toBe('idle');
  });

  it('отдаёт listening во время записи', () => {
    expect(getDictationPhase(true, false)).toBe('listening');
  });

  it('отдаёт transcribing, когда запись закончилась и идёт распознавание', () => {
    expect(getDictationPhase(false, true)).toBe('transcribing');
  });

  it('запись важнее распознавания при одновременном состоянии', () => {
    expect(getDictationPhase(true, true)).toBe('listening');
  });
});

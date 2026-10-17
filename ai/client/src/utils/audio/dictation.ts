export const MAX_RECORDING_MS = 300000;
export const COUNTDOWN_SECONDS = 30;

const MAX_RECORDING_SECONDS = MAX_RECORDING_MS / 1000;

export type DictationPhase = 'idle' | 'listening' | 'transcribing';

export const getDictationPhase = (
  isListening: boolean,
  isTranscribing: boolean,
): DictationPhase => {
  if (isListening) {
    return 'listening';
  }
  if (isTranscribing) {
    return 'transcribing';
  }
  return 'idle';
};

export const getRemainingSeconds = (elapsedSeconds: number): number =>
  Math.max(0, MAX_RECORDING_SECONDS - elapsedSeconds);

export const shouldShowCountdown = (elapsedSeconds: number): boolean =>
  getRemainingSeconds(elapsedSeconds) <= COUNTDOWN_SECONDS;

export const formatSeconds = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds)}`;
};

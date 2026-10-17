import { useState, useRef, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { useToastContext } from '@librechat/client';
import { normalizeDictationLanguage } from 'librechat-data-provider';
import { dictationLanguageAtom } from '~/store/dictationLanguage';
import { MAX_RECORDING_MS } from '~/utils/audio/dictation';
import { useSpeechToTextMutation } from '~/data-provider';
import { toWav } from '~/utils/audio/convert';
import { useLocalize } from '~/hooks';

export { MAX_RECORDING_MS };

export interface ExternalSpeechToText {
  isListening: boolean;
  isLoading: boolean;
  isTranscribing: boolean;
  stream: MediaStream | null;
  canRetry: boolean;
  retry: () => void;
  externalStartRecording: () => Promise<void>;
  externalStopRecording: () => void;
  externalCancelRecording: () => void;
}

interface ActiveRecording {
  recorder: MediaRecorder;
  stream: MediaStream;
  timer: number;
  cancelled: boolean;
}

interface PendingAttempt {
  cancelled: boolean;
}

export const getBestSupportedMimeType = (
  isTypeSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
) => {
  const types = [
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'audio/webm;codecs=opus',
    'audio/mp4',
  ];

  for (const type of types) {
    if (isTypeSupported(type)) {
      return type;
    }
  }

  const ua = userAgent.toLowerCase();
  if (ua.indexOf('safari') !== -1 && ua.indexOf('chrome') === -1) {
    return 'audio/mp4';
  } else if (ua.indexOf('firefox') !== -1) {
    return 'audio/ogg';
  }

  return 'audio/webm';
};

const getServerMessage = (error: unknown): string | undefined => {
  const message = (error as { response?: { data?: { message?: unknown } } } | null | undefined)
    ?.response?.data?.message;
  return typeof message === 'string' && message.length > 0 ? message : undefined;
};

const stopTracks = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((track) => track.stop());
};

const endRecording = (recording: ActiveRecording) => {
  window.clearTimeout(recording.timer);
  if (recording.recorder.state === 'recording') {
    recording.recorder.stop();
  }
  stopTracks(recording.stream);
};

const useSpeechToTextExternal = (setText: (text: string) => void): ExternalSpeechToText => {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const recordingRef = useRef<ActiveRecording | null>(null);
  const pendingAttemptRef = useRef<PendingAttempt | null>(null);
  const startingRef = useRef(false);
  const lastAudioRef = useRef<Blob | null>(null);
  const discardRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const dictationLanguage = useAtomValue(dictationLanguageAtom);

  const { mutate: processAudio, isLoading: isProcessing } = useSpeechToTextMutation({
    onSuccess: (data) => {
      if (discardRef.current) {
        return;
      }
      lastAudioRef.current = null;
      setCanRetry(false);
      const text = data.text.trim();
      if (!text) {
        showToast({ message: localize('com_ui_speech_empty'), status: 'warning' });
        return;
      }
      setText(text);
    },
    onError: (error) => {
      if (discardRef.current) {
        return;
      }
      setCanRetry(lastAudioRef.current !== null);
      showToast({
        message: getServerMessage(error) ?? localize('com_ui_speech_failed'),
        status: 'error',
      });
    },
  });

  const sendAudio = (audio: Blob) => {
    const formData = new FormData();
    formData.append('audio', audio, 'audio.wav');
    formData.append('language', normalizeDictationLanguage(dictationLanguage));
    processAudio(formData);
  };

  const handleStop = async (chunks: Blob[], mimeType: string) => {
    if (discardRef.current) {
      return;
    }
    if (chunks.length === 0) {
      showToast({ message: localize('com_ui_speech_too_short'), status: 'warning' });
      return;
    }
    setIsConverting(true);
    try {
      const wav = await toWav(new Blob(chunks, { type: mimeType }));
      if (discardRef.current) {
        return;
      }
      lastAudioRef.current = wav;
      sendAudio(wav);
    } catch {
      if (!discardRef.current) {
        showToast({ message: localize('com_ui_speech_convert_failed'), status: 'error' });
      }
    } finally {
      setIsConverting(false);
    }
  };

  const finishRecording = (recording: ActiveRecording) => {
    endRecording(recording);
    if (recordingRef.current !== recording) {
      return;
    }
    recordingRef.current = null;
    setIsListening(false);
    setStream(null);
  };

  const externalStopRecording = () => {
    const recording = recordingRef.current;
    if (!recording) {
      return;
    }
    finishRecording(recording);
  };

  const externalCancelRecording = () => {
    lastAudioRef.current = null;
    setCanRetry(false);
    if (pendingAttemptRef.current) {
      pendingAttemptRef.current.cancelled = true;
    }
    const recording = recordingRef.current;
    if (!recording) {
      return;
    }
    recording.cancelled = true;
    finishRecording(recording);
  };

  const requestMicrophone = async (): Promise<MediaStream | null> => {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      return null;
    }
  };

  const beginRecording = async () => {
    const attempt: PendingAttempt = { cancelled: false };
    pendingAttemptRef.current = attempt;
    const stream = await requestMicrophone();
    if (attempt.cancelled || discardRef.current) {
      stopTracks(stream);
      return;
    }
    if (!stream) {
      showToast({ message: localize('com_ui_microphone_unavailable'), status: 'error' });
      return;
    }
    try {
      const mimeType = getBestSupportedMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      const recording: ActiveRecording = { recorder, stream, timer: 0, cancelled: false };
      recorder.addEventListener('dataavailable', (event: BlobEvent) => {
        chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        finishRecording(recording);
        if (!recording.cancelled) {
          handleStop(chunks, mimeType);
        }
      });
      lastAudioRef.current = null;
      setCanRetry(false);
      recorder.start(100);
      recording.timer = window.setTimeout(() => finishRecording(recording), MAX_RECORDING_MS);
      recordingRef.current = recording;
      pendingAttemptRef.current = null;
      setIsListening(true);
      setStream(stream);
    } catch {
      stopTracks(stream);
      showToast({ message: localize('com_ui_microphone_unavailable'), status: 'error' });
    }
  };

  const externalStartRecording = async () => {
    if (startingRef.current || recordingRef.current !== null) {
      return;
    }
    startingRef.current = true;
    try {
      if (isProcessing || isConverting) {
        showToast({ message: localize('com_ui_speech_busy'), status: 'warning' });
        return;
      }
      if (typeof MediaRecorder === 'undefined') {
        showToast({ message: localize('com_ui_speech_not_supported'), status: 'error' });
        return;
      }
      setIsStarting(true);
      await beginRecording();
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  };

  const retry = () => {
    const audio = lastAudioRef.current;
    if (!audio || isListening || isProcessing) {
      return;
    }
    setCanRetry(false);
    sendAudio(audio);
  };

  useEffect(
    () => () => {
      discardRef.current = true;
      if (pendingAttemptRef.current) {
        pendingAttemptRef.current.cancelled = true;
      }
      const recording = recordingRef.current;
      if (recording) {
        recording.cancelled = true;
        endRecording(recording);
      }
    },
    [],
  );

  return {
    isListening,
    isLoading: isProcessing || isConverting || isStarting,
    isTranscribing: isProcessing || isConverting,
    stream,
    canRetry,
    retry,
    externalStartRecording,
    externalStopRecording,
    externalCancelRecording,
  };
};

export default useSpeechToTextExternal;

import useSpeechToTextExternal from './useSpeechToTextExternal';
import useSpeechToTextBrowser from './useSpeechToTextBrowser';
import useGetAudioSettings from './useGetAudioSettings';

const useSpeechToText = (
  setText: (text: string) => void,
  onTranscriptionComplete: (text: string) => void,
): {
  isLoading?: boolean;
  isListening?: boolean;
  isTranscribing: boolean;
  stream: MediaStream | null;
  canRetry: boolean;
  retry: () => void;
  stopRecording: () => void | Promise<void>;
  startRecording: () => void | Promise<void>;
  cancelRecording: () => void;
} => {
  const { speechToTextEndpoint } = useGetAudioSettings();
  const externalSpeechToText = speechToTextEndpoint === 'external';

  const {
    isListening: speechIsListeningBrowser,
    isLoading: speechIsLoadingBrowser,
    startRecording: startSpeechRecordingBrowser,
    stopRecording: stopSpeechRecordingBrowser,
    cancelRecording: cancelSpeechRecordingBrowser,
  } = useSpeechToTextBrowser(setText, onTranscriptionComplete);

  const {
    isListening: speechIsListeningExternal,
    isLoading: speechIsLoadingExternal,
    isTranscribing: speechIsTranscribingExternal,
    stream: speechStreamExternal,
    canRetry: canRetryExternal,
    retry: retryExternal,
    externalStartRecording: startSpeechRecordingExternal,
    externalStopRecording: stopSpeechRecordingExternal,
    externalCancelRecording: cancelSpeechRecordingExternal,
  } = useSpeechToTextExternal(setText);

  const isListening = externalSpeechToText ? speechIsListeningExternal : speechIsListeningBrowser;
  const isLoading = externalSpeechToText ? speechIsLoadingExternal : speechIsLoadingBrowser;
  const isTranscribing = externalSpeechToText ? speechIsTranscribingExternal : false;
  const stream = externalSpeechToText ? speechStreamExternal : null;

  const startRecording = externalSpeechToText
    ? startSpeechRecordingExternal
    : startSpeechRecordingBrowser;
  const stopRecording = externalSpeechToText
    ? stopSpeechRecordingExternal
    : stopSpeechRecordingBrowser;
  const cancelRecording = externalSpeechToText
    ? cancelSpeechRecordingExternal
    : cancelSpeechRecordingBrowser;

  return {
    isLoading,
    isListening,
    isTranscribing,
    stream,
    canRetry: externalSpeechToText && canRetryExternal === true,
    retry: retryExternal,
    stopRecording,
    startRecording,
    cancelRecording,
  };
};

export default useSpeechToText;

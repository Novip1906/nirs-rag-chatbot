import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { Check, RotateCcw, X } from 'lucide-react';
import {
  IconButton,
  useToastContext,
  TooltipAnchor,
  ListeningIcon,
  Spinner,
} from '@librechat/client';
import type { DictationPhase } from '~/utils/audio/dictation';
import type { TAskFunction } from '~/common';
import {
  formatSeconds,
  getDictationPhase,
  getRemainingSeconds,
  shouldShowCountdown,
} from '~/utils/audio/dictation';
import { anyModalOpen, isWithinOpenMenu } from '~/hooks/useKeyboardShortcuts';
import { useLocalize, useSpeechToText, useGetAudioSettings } from '~/hooks';
import { DICTATION_STATUS_KEYS, Wave } from './Dictation';
import { globalAudioId, mainTextareaId } from '~/common';
import { useChatFormContext } from '~/Providers';
import store from '~/store';

const isExternalSTT = (speechToTextEndpoint: string) => speechToTextEndpoint === 'external';

export default memo(function AudioRecorder({
  disabled,
  ask,
  methods,
  isSubmitting,
  conversationId,
  onPhaseChange,
}: {
  disabled: boolean;
  ask: TAskFunction;
  methods: ReturnType<typeof useChatFormContext>;
  isSubmitting: boolean;
  conversationId: string;
  onPhaseChange?: (phase: DictationPhase) => void;
}) {
  const { setValue, reset, getValues } = methods;
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { speechToTextEndpoint } = useGetAudioSettings();
  const speechSettingsInitialized = useRecoilValue(store.speechSettingsInitialized);
  const recorderDisabled = disabled || !speechSettingsInitialized;

  const containerRef = useRef<HTMLDivElement>(null);
  const existingTextRef = useRef<string>('');
  const isSubmittingRef = useRef(isSubmitting);
  isSubmittingRef.current = isSubmitting;
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const recordingConversationRef = useRef(conversationId);

  const onTranscriptionComplete = useCallback(
    (text: string) => {
      if (isSubmittingRef.current) {
        showToast({
          message: localize('com_ui_speech_while_submitting'),
          status: 'error',
        });
        return;
      }
      if (text) {
        const globalAudio = document.getElementById(globalAudioId) as HTMLAudioElement | null;
        if (globalAudio) {
          globalAudio.muted = false;
        }
        const finalText =
          isExternalSTT(speechToTextEndpoint) && existingTextRef.current
            ? `${existingTextRef.current} ${text}`
            : text;
        const submitted = ask({ text: finalText });
        if (submitted === false) {
          return;
        }
        reset({ text: '' });
        existingTextRef.current = '';
      }
    },
    [ask, reset, showToast, localize, speechToTextEndpoint],
  );

  const setText = useCallback(
    (text: string) => {
      const external = isExternalSTT(speechToTextEndpoint);
      if (external && recordingConversationRef.current !== conversationIdRef.current) {
        return;
      }
      const draft = external ? getValues('text') || '' : existingTextRef.current;
      setValue('text', draft ? `${draft} ${text}` : text, {
        shouldValidate: true,
      });
    },
    [getValues, setValue, speechToTextEndpoint],
  );

  const {
    isListening,
    isLoading,
    isTranscribing,
    stream,
    canRetry,
    retry,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useSpeechToText(setText, onTranscriptionComplete);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const phase = getDictationPhase(isListening === true, isTranscribing);

  const onPhaseChangeRef = useRef(onPhaseChange);
  onPhaseChangeRef.current = onPhaseChange;

  useEffect(() => {
    onPhaseChangeRef.current?.(phase);
  }, [phase]);

  useEffect(() => {
    return () => {
      onPhaseChangeRef.current?.('idle');
    };
  }, []);

  useEffect(() => {
    if (isListening !== true) {
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => {
      window.clearInterval(timer);
      setElapsedSeconds(0);
    };
  }, [isListening]);

  const handleStartRecording = useCallback(() => {
    recordingConversationRef.current = conversationIdRef.current;
    existingTextRef.current = getValues('text') || '';
    startRecording();
  }, [getValues, startRecording]);

  const handleStopRecording = useCallback(() => {
    stopRecording();
    if (!isExternalSTT(speechToTextEndpoint)) {
      existingTextRef.current = '';
    }
  }, [speechToTextEndpoint, stopRecording]);

  const handleCancelRecording = useCallback(() => {
    cancelRecording();
    if (!isExternalSTT(speechToTextEndpoint)) {
      setValue('text', existingTextRef.current, { shouldValidate: true });
    }
  }, [cancelRecording, setValue, speechToTextEndpoint]);

  const handleRetry = useCallback(() => {
    recordingConversationRef.current = conversationIdRef.current;
    retry();
  }, [retry]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey || !event.altKey || event.code !== 'KeyL' || recorderDisabled) {
        return;
      }

      event.preventDefault();
      if (isListening === true) {
        handleStopRecording();
        return;
      }

      handleStartRecording();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleStartRecording, handleStopRecording, isListening, recorderDisabled]);

  useEffect(() => {
    if (phase !== 'listening') {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.shiftKey ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      ) {
        return;
      }

      if (anyModalOpen()) {
        return;
      }

      const target = event.target instanceof HTMLElement ? event.target : null;
      if (isWithinOpenMenu(target)) {
        return;
      }

      const tagName = target?.tagName;
      const isEditable =
        tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable === true;
      if (isEditable && target?.id !== mainTextareaId) {
        return;
      }

      const chatForm = containerRef.current?.closest('form') ?? null;
      const withinChatForm = target != null && chatForm != null && chatForm.contains(target);
      if (target !== document.body && !withinChatForm) {
        return;
      }

      event.preventDefault();
      handleCancelRecording();
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [phase, handleCancelRecording]);

  const remainingSeconds = getRemainingSeconds(elapsedSeconds);
  const showCountdown = phase === 'listening' && shouldShowCountdown(elapsedSeconds);
  const statusKey = phase === 'idle' ? null : DICTATION_STATUS_KEYS[phase];

  return (
    <div ref={containerRef} className="flex items-center">
      {phase === 'listening' ? (
        <>
          {showCountdown && (
            <span
              role="timer"
              aria-label={localize('com_ui_dictation_time_left')}
              className="px-1 text-xs tabular-nums text-text-secondary"
            >
              {formatSeconds(remainingSeconds)}
            </span>
          )}
          <span className="mr-2 flex items-center">
            <Wave stream={stream} />
          </span>
          <TooltipAnchor
            description={localize('com_ui_dictation_cancel')}
            render={
              <IconButton
                id="audio-recorder-cancel"
                type="button"
                variant="ghost"
                size="theme"
                shape="theme"
                label={localize('com_ui_dictation_cancel')}
                onClick={handleCancelRecording}
                disabled={recorderDisabled}
                className="p-1 hover:bg-surface-composer-hover"
              >
                <X className="stroke-status-error" />
              </IconButton>
            }
          />
          <TooltipAnchor
            description={localize('com_ui_dictation_finish')}
            render={
              <IconButton
                id="audio-recorder"
                type="button"
                variant="ghost"
                size="theme"
                shape="theme"
                label={localize('com_ui_dictation_finish')}
                onClick={handleStopRecording}
                disabled={recorderDisabled}
                className="p-1 hover:bg-surface-composer-hover"
              >
                <Check className="stroke-text-secondary" />
              </IconButton>
            }
          />
        </>
      ) : (
        <>
          {canRetry && isLoading !== true && (
            <TooltipAnchor
              description={localize('com_ui_retry')}
              render={
                <IconButton
                  id="audio-recorder-retry"
                  type="button"
                  variant="ghost"
                  size="theme"
                  shape="theme"
                  label={localize('com_ui_retry')}
                  onClick={handleRetry}
                  disabled={recorderDisabled}
                  className="p-1 hover:bg-surface-composer-hover"
                >
                  <RotateCcw className="stroke-text-secondary" />
                </IconButton>
              }
            />
          )}
          <TooltipAnchor
            description={localize('com_ui_use_micrphone')}
            render={
              <IconButton
                id="audio-recorder"
                type="button"
                variant="ghost"
                size="theme"
                shape="theme"
                label={localize('com_ui_use_micrphone')}
                onClick={handleStartRecording}
                disabled={recorderDisabled}
                className="p-1 hover:bg-surface-composer-hover"
              >
                {isLoading === true ? (
                  <Spinner className="stroke-text-secondary" />
                ) : (
                  <ListeningIcon className="stroke-text-secondary" />
                )}
              </IconButton>
            }
          />
        </>
      )}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {statusKey ? localize(statusKey) : ''}
      </span>
    </div>
  );
});

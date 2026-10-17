import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MEMORY_TITLE_MAX_LENGTH, PermissionTypes, Permissions } from 'librechat-data-provider';
import {
  OGDialog,
  OGDialogTemplate,
  Button,
  FieldMessage,
  Label,
  Input,
  Spinner,
  Textarea,
  useToastContext,
} from '@librechat/client';
import type { TUserMemory } from 'librechat-data-provider';
import {
  getRequiredFieldError,
  getMemoryApiErrorMessage,
  getMemoryDisplayTitle,
} from '~/utils/memory';
import { useUpdateMemoryMutation, useMemoriesQuery } from '~/data-provider';
import { getMemoryAddress, getMemoryUpdateAddress } from './address';
import { useLocalize, useHasAccess, useClockFormat } from '~/hooks';
import MemoryUsageBadge from './MemoryUsageBadge';
import { formatLocaleDateTime } from '~/utils';

interface MemoryEditDialogProps {
  memory: TUserMemory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  triggerRef?: React.MutableRefObject<HTMLButtonElement | null>;
}

export default function MemoryEditDialog({
  memory,
  open,
  onOpenChange,
  children,
  triggerRef,
}: MemoryEditDialogProps) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const { showToast } = useToastContext();
  const { data: memData } = useMemoriesQuery();
  const hour12 = useClockFormat();

  const hasUpdateAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.UPDATE,
  });

  const { mutate: updateMemory, isLoading } = useUpdateMemoryMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_ui_saved'),
        status: 'success',
      });
      onOpenChange(false);
      setTimeout(() => {
        triggerRef?.current?.focus();
      }, 0);
    },
    onError: (error: Error) => {
      showToast({
        message: getMemoryApiErrorMessage(error, localize('com_ui_error')),
        status: 'error',
      });
    },
  });

  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState({ title: false, value: false });
  const [prevMemory, setPrevMemory] = useState<TUserMemory | null>(null);
  const memoryAddress = memory ? getMemoryAddress(memory) : null;

  if (memory !== prevMemory) {
    setPrevMemory(memory);
    if (memory) {
      setTitle(getMemoryDisplayTitle(memory));
      setValue(memory.value);
      setTouched({ title: false, value: false });
    }
  }

  const titleError = getRequiredFieldError(title);
  const valueError = getRequiredFieldError(value);
  const hasErrors = titleError != null || valueError != null;
  /** Stay quiet on a pristine empty field; validate live once there is something to judge. */
  const showTitleError = hasUpdateAccess && (touched.title || title !== '');
  const showValueError = hasUpdateAccess && (touched.value || value !== '');

  const handleSave = () => {
    if (!hasUpdateAccess || !memory || !memoryAddress) {
      return;
    }

    if (titleError || valueError) {
      setTouched({ title: true, value: true });
      return;
    }

    const updateAddress = getMemoryUpdateAddress(memory, memory.key);
    if (!updateAddress) {
      return;
    }

    updateMemory({
      ...updateAddress,
      value: value.trim(),
      title: title.trim(),
      agentId: memory.agentId,
      chatProjectId: memory.chatProjectId,
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey && hasUpdateAccess) {
      handleSave();
    }
  };

  // Calculate memory-specific usage: available = tokenLimit - (totalTokens - thisMemoryTokens)
  const memoryUsage = useMemo(() => {
    if (!memory?.tokenCount || !memData?.tokenLimit) {
      return null;
    }
    const availableForMemory = memData.tokenLimit - (memData.totalTokens ?? 0) + memory.tokenCount;
    const percentage = Math.round((memory.tokenCount / availableForMemory) * 100);
    return { availableForMemory, percentage };
  }, [memory?.tokenCount, memData?.tokenLimit, memData?.totalTokens]);

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      {children}
      <OGDialogTemplate
        title={hasUpdateAccess ? localize('com_ui_edit_memory') : localize('com_ui_view_memory')}
        showCloseButton={false}
        className="w-11/12 md:max-w-lg"
        main={
          <div className="space-y-4">
            {/* Memory metadata */}
            {memory && (
              <div className="flex items-center justify-between rounded-lg border border-border-light bg-surface-secondary px-3 py-2">
                {/* Token count - Left */}
                {memory.tokenCount !== undefined ? (
                  <span className="text-xs text-text-secondary">
                    {localize('com_ui_token_count', { count: memory.tokenCount })}
                  </span>
                ) : (
                  <div />
                )}

                {/* Date - Center */}
                <span className="text-xs text-text-secondary">
                  {formatLocaleDateTime(memory.updated_at, i18n.language, hour12)}
                </span>

                {/* Usage badge - Right (memory-specific) */}
                {memoryUsage ? (
                  <MemoryUsageBadge
                    percentage={memoryUsage.percentage}
                    tokenLimit={memData?.tokenLimit ?? 0}
                    tooltipCurrent={memory.tokenCount}
                    tooltipMax={memoryUsage.availableForMemory}
                  />
                ) : (
                  <div />
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="memory-title" className="text-sm font-medium text-text-primary">
                {localize('com_ui_memory_title')}
              </Label>
              <Input
                id="memory-title"
                value={title}
                onChange={(e) => hasUpdateAccess && setTitle(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, title: true }))}
                onKeyDown={handleKeyPress}
                placeholder={localize('com_ui_memory_title_placeholder')}
                maxLength={MEMORY_TITLE_MAX_LENGTH}
                className="w-full"
                disabled={!hasUpdateAccess}
                aria-invalid={showTitleError && titleError != null}
                aria-describedby="memory-title-message"
              />
              <FieldMessage
                id="memory-title-message"
                message={showTitleError && titleError ? localize(titleError) : null}
              />
            </div>

            {/* Value textarea */}
            <div className="space-y-2">
              <Label htmlFor="memory-value" className="text-sm font-medium text-text-primary">
                {localize('com_ui_value')}
              </Label>
              <Textarea
                id="memory-value"
                value={value}
                onChange={(e) => hasUpdateAccess && setValue(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, value: true }))}
                onKeyDown={handleKeyPress}
                placeholder={localize('com_ui_enter_value')}
                className="min-h-[100px] w-full resize-none rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy disabled:cursor-not-allowed disabled:opacity-50"
                rows={4}
                disabled={!hasUpdateAccess}
                aria-invalid={showValueError && valueError != null}
                aria-describedby="memory-value-message"
              />
              <FieldMessage
                id="memory-value-message"
                message={showValueError && valueError ? localize(valueError) : null}
              />
            </div>
          </div>
        }
        buttons={
          hasUpdateAccess ? (
            <Button
              type="button"
              variant="submit"
              onClick={handleSave}
              aria-label={localize('com_ui_save')}
              disabled={isLoading || !memoryAddress || hasErrors}
            >
              {isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
            </Button>
          ) : null
        }
      />
    </OGDialog>
  );
}

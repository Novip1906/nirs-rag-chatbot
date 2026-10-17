import React, { memo } from 'react';
import { BookOpen } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { useLocalize, useKnowledgeBaseSpec } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import { badgeAccents } from './accents';

function KnowledgeSearch() {
  const localize = useLocalize();
  const context = useBadgeRowContext();
  const {
    toggleState: knowledgeSearchEnabled,
    debouncedChange,
    isPinned,
  } = context?.knowledgeSearch ?? {};

  const hasKnowledgeBase = useKnowledgeBaseSpec();

  if (!hasKnowledgeBase) {
    return null;
  }

  if (knowledgeSearchEnabled !== true && isPinned !== true) {
    return null;
  }

  return (
    <CheckboxButton
      checked={knowledgeSearchEnabled}
      setValue={debouncedChange}
      label={localize('com_ui_knowledge_search_toggle')}
      isCheckedClassName={badgeAccents.teal}
      icon={<BookOpen className="icon-md" aria-hidden="true" />}
    />
  );
}

export default memo(KnowledgeSearch);

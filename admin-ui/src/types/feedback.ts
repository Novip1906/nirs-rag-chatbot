export type TFeedbackRating = 'thumbsUp' | 'thumbsDown';

export const FEEDBACK_REASON_KEYS = [
  'not_matched',
  'inaccurate',
  'bad_style',
  'missing_image',
  'unjustified_refusal',
  'not_helpful',
  'other',
  'accurate_reliable',
  'creative_solution',
  'clear_well_written',
  'attention_to_detail',
] as const;

export type TFeedbackTagKey = (typeof FEEDBACK_REASON_KEYS)[number];

export interface TFeedbackTag {
  key: TFeedbackTagKey;
  label: string;
  direction: TFeedbackRating;
  icon: string;
}

export const FEEDBACK_TAGS: TFeedbackTag[] = [
  { key: 'not_matched', label: 'com_ui_feedback_tag_not_matched', direction: 'thumbsDown', icon: 'AlertCircle' },
  { key: 'inaccurate', label: 'com_ui_feedback_tag_inaccurate', direction: 'thumbsDown', icon: 'AlertCircle' },
  { key: 'bad_style', label: 'com_ui_feedback_tag_bad_style', direction: 'thumbsDown', icon: 'PenTool' },
  { key: 'missing_image', label: 'com_ui_feedback_tag_missing_image', direction: 'thumbsDown', icon: 'ImageOff' },
  { key: 'unjustified_refusal', label: 'com_ui_feedback_tag_unjustified_refusal', direction: 'thumbsDown', icon: 'Ban' },
  { key: 'not_helpful', label: 'com_ui_feedback_tag_not_helpful', direction: 'thumbsDown', icon: 'ThumbsDown' },
  { key: 'other', label: 'com_ui_feedback_tag_other', direction: 'thumbsDown', icon: 'HelpCircle' },
  { key: 'accurate_reliable', label: 'com_ui_feedback_tag_accurate_reliable', direction: 'thumbsUp', icon: 'CheckCircle' },
  { key: 'creative_solution', label: 'com_ui_feedback_tag_creative_solution', direction: 'thumbsUp', icon: 'Lightbulb' },
  { key: 'clear_well_written', label: 'com_ui_feedback_tag_clear_well_written', direction: 'thumbsUp', icon: 'PenTool' },
  { key: 'attention_to_detail', label: 'com_ui_feedback_tag_attention_to_detail', direction: 'thumbsUp', icon: 'Search' },
];

export function getTagByKey(key: TFeedbackTagKey | undefined): TFeedbackTag | undefined {
  if (!key) {
    return undefined;
  }
  return FEEDBACK_TAGS.find((tag) => tag.key === key);
}

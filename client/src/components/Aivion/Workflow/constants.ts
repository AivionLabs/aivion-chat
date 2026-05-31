import type { ReviewTagGroup, RunStatus } from './types';

export const TAG_COLOR_CLASSES: Record<ReviewTagGroup['color'], { border: string; bg: string; title: string; chip: string }> = {
  green:  { border: 'border-green-200 dark:border-green-800/40',   bg: 'bg-green-50 dark:bg-green-900/10',   title: 'text-green-700 dark:text-green-400',   chip: 'bg-green-100 text-green-700 dark:bg-green-800/30 dark:text-green-300' },
  amber:  { border: 'border-amber-200 dark:border-amber-800/40',   bg: 'bg-amber-50 dark:bg-amber-900/10',   title: 'text-amber-700 dark:text-amber-400',   chip: 'bg-amber-100 text-amber-700 dark:bg-amber-800/30 dark:text-amber-300' },
  red:    { border: 'border-red-200 dark:border-red-800/40',       bg: 'bg-red-50 dark:bg-red-900/10',       title: 'text-red-700 dark:text-red-400',       chip: 'bg-red-100 text-red-700 dark:bg-red-800/30 dark:text-red-300' },
  blue:   { border: 'border-blue-200 dark:border-blue-800/40',     bg: 'bg-blue-50 dark:bg-blue-900/10',     title: 'text-blue-700 dark:text-blue-400',     chip: 'bg-blue-100 text-blue-700 dark:bg-blue-800/30 dark:text-blue-300' },
  purple: { border: 'border-purple-200 dark:border-purple-800/40', bg: 'bg-purple-50 dark:bg-purple-900/10', title: 'text-purple-700 dark:text-purple-400', chip: 'bg-purple-100 text-purple-700 dark:bg-purple-800/30 dark:text-purple-300' },
  gray:   { border: 'border-border-light',                         bg: 'bg-surface-secondary',               title: 'text-text-secondary',                  chip: 'bg-surface-tertiary text-text-secondary' },
};

export const STATUS_LABEL: Record<RunStatus, string> = {
  pending: 'Queued',
  running: 'Running',
  awaiting_user: 'Awaiting Review',
  awaiting_oauth: 'Needs Reconnect',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const STATUS_BADGE: Record<RunStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  awaiting_user: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  awaiting_oauth: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'text-text-secondary bg-surface-secondary',
};

export const CHART_COLORS = ['#f59e0b', '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

export const PROGRESS_STATUS = {
  completed: { dot: 'bg-green-500',  text: 'text-green-700 dark:text-green-400',  bg: 'bg-green-100 dark:bg-green-900/30',  icon: '✓' },
  running:   { dot: 'bg-blue-500',   text: 'text-blue-700 dark:text-blue-400',    bg: 'bg-blue-100 dark:bg-blue-900/30',    icon: '↻' },
  pending:   { dot: 'bg-border-medium', text: 'text-text-tertiary',               bg: 'bg-surface-secondary',               icon: '○' },
  warning:   { dot: 'bg-amber-500',  text: 'text-amber-700 dark:text-amber-400',  bg: 'bg-amber-100 dark:bg-amber-900/30',  icon: '!' },
  failed:    { dot: 'bg-red-500',    text: 'text-red-700 dark:text-red-400',      bg: 'bg-red-100 dark:bg-red-900/30',      icon: '✕' },
};

export const REC_LABELS: Record<string, string> = {
  screen_call: 'Screen Call',
  technical_interview: 'Tech Interview',
  hold: 'Hold',
  request_more_info: 'More Info',
  reject: 'Reject',
};

export const REC_OPTS = [
  { value: 'screen_call', label: 'Screen Call', active: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700' },
  { value: 'technical_interview', label: 'Tech Interview', active: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700' },
  { value: 'hold', label: 'Hold', active: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700' },
  { value: 'request_more_info', label: 'More Info', active: 'bg-gray-200 text-gray-700 border-gray-400 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-500' },
  { value: 'reject', label: 'Reject', active: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700' },
];

export const PRIORITY_OPTS = [
  { value: 'high', label: 'High', active: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700' },
  { value: 'medium', label: 'Medium', active: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700' },
  { value: 'low', label: 'Low', active: 'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600' },
];

export const REC_CHIP: Record<string, string> = {
  screen_call:          'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  technical_interview:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  hold:                 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  reject:               'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export type WorkflowStep = {
  id: string;
  type:
    | 'llm'
    | 'file_extract'
    | 'user_input'
    | 'scrub'
    | 'unscrub'
    | 'integration'
    | 'loop'
    | 'template'
    | 'rss_fetch'
    | 'deduplicate_records'
    | 'cluster_records'
    | 'cluster_rows'
    | 'score_items'
    | 'prepare_selected_records'
    | 'research_records'
    | 'draft_articles'
    | 'revise_articles'
    | 'package_publication'
    | 'publish_publication_http';
  label?: string;
  inputs?: WorkflowInputField[];
  interactive?: boolean;
  review_chat_system_prompt?: string;
};

export type StepParametersSchema = {
  type: 'step_parameters';
  target_step_id: string;
  title?: string;
  description?: string;
  fields: WorkflowInputField[];
};

export type WorkflowInputField = {
  name: string;
  label: string;
  type:
    | 'string'
    | 'text'
    | 'textarea'
    | 'readonly'
    | 'number'
    | 'email'
    | 'date'
    | 'boolean'
    | 'select'
    | 'file'
    | 'file_array';
  required?: boolean;
  placeholder?: string;
  default?: string;
  options?: string[];
  accept?: string;
  max_files?: number;
};

export type WorkflowOutputField = {
  label: string;
  value: string;
  kind?: 'text' | 'list';
};

export type MetricItem = {
  label: string;
  value: string;
  format?: 'currency' | 'number' | 'percent' | 'text';
};

export type TableColumn = {
  field: string;
  label: string;
  format?: 'currency' | 'number' | 'percent' | 'text';
};

export type ComparisonField = {
  field: string;
  label: string;
  kind?: 'text' | 'list';
};

export type TimelineItem = {
  date: string;
  event: string;
  description?: string;
};

export type ProgressItem = {
  label: string;
  status: 'completed' | 'running' | 'pending' | 'warning' | 'failed';
  details?: string;
};

export type WorkflowOutputSection =
  | { type: 'key_value'; title?: string; fields: WorkflowOutputField[] }
  | { type: 'list'; title?: string; items: string[] }
  | { type: 'text'; title?: string; content: string }
  | { type: 'metric_grid'; title?: string; metrics: MetricItem[] }
  | { type: 'table'; title?: string; data_table: string; columns: TableColumn[] }
  | { type: 'comparison'; title?: string; data: string; fields_per_item: ComparisonField[] }
  | { type: 'bar_chart'; title?: string; chart_data: string; x_field: string; y_field: string }
  | { type: 'line_chart'; title?: string; chart_data: string; x_field: string; y_field: string }
  | {
      type: 'pie_chart';
      title?: string;
      chart_data: string;
      label_field: string;
      value_field: string;
    }
  | { type: 'document_preview'; title?: string; storage_key: string; filename?: string }
  | { type: 'timeline'; title?: string; timeline_items: TimelineItem[] }
  | { type: 'progress'; title?: string; progress_items: ProgressItem[] };

export type WorkflowOutput =
  | { type: 'report'; title?: string; sections: WorkflowOutputSection[] }
  | { type?: never; title?: string; fields?: WorkflowOutputField[] };

export type ReviewTagGroup = {
  label: string;
  field: string;
  color: 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'gray';
};

export type WorkflowReviewDisplay = {
  profile_label?: string;
  profile_fields?: string[];
  assessment_label?: string;
  assessment_fields?: string[];
  score_field?: string;
  rec_field?: string;
  tag_groups?: ReviewTagGroup[];
};

export type WorkflowSpec = {
  compiler_version?: number;
  steps?: WorkflowStep[];
  inputs?: WorkflowInputField[];
  output?: WorkflowOutput;
  review_display?: WorkflowReviewDisplay;
  allowed_modes?: Array<'single' | 'scheduled_once' | 'recurring' | 'calendar'>;
  default_mode?: 'single' | 'scheduled_once' | 'recurring' | 'calendar';
  schedule_config?: Record<string, unknown>;
  recurrence_config?: Record<string, unknown>;
  calendar_config?: Record<string, unknown>;
};

export type Workflow = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  category?: string | null;
  spec: WorkflowSpec;
  is_active: boolean;
  version: number;
  is_runnable?: boolean;
  required_connections?: string[];
  missing_connections?: string[];
};

export type ServiceConnection = {
  service_key: string;
  display_name: string;
  icon?: string | null;
  connected: boolean;
  account_email?: string | null;
  connected_at?: string | null;
};

export type RunStatus =
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'awaiting_user'
  | 'awaiting_oauth'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CandidateReviewField = {
  key: string;
  label: string;
};

export type CandidateReviewSchema = {
  type: 'candidate_review_form';
  iterations: Record<string, unknown>[];
  fields_per_candidate: CandidateReviewField[];
};

export type RecordSelectionMetadataField = {
  field: string;
  label: string;
};

export type RecordSelectionSchema = {
  type: 'record_selection';
  title?: string;
  description?: string;
  items: Record<string, unknown>[];
  id_field: string;
  title_field: string;
  summary_field?: string;
  score_field?: string;
  metadata_fields?: RecordSelectionMetadataField[];
  sections?: string[];
  max_selections?: number | string;
  require_section?: boolean;
  allow_editorial_direction?: boolean;
  allow_editor_notes?: boolean;
};

export type ArticleReviewSchema = {
  type: 'article_review';
  title?: string;
  description?: string;
  items: Record<string, unknown>[];
  title_field?: string;
  section_field?: string;
  language_field?: string;
  summary_field?: string;
  body_field?: string;
  caveats_field?: string;
  source_citations_field?: string;
  notes_label?: string;
  revision_notes_label?: string;
  decision_options?: string[];
  /** Per-article approve/cancel before gate can continue (review_drafts). */
  per_item_decisions?: boolean;
  /** Upstream artifact step for regenerate_item + resume handoff (Phase C). */
  source_step_id?: string;
};

export type WorkflowRun = {
  run_id: string;
  workflow_id: string;
  status: RunStatus;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown> | null;
  error_message?: string | null;
  pending_step_id?: string | null;
  pending_target_step_id?: string | null;
  pending_prompt?: string | null;
  pending_input_schema?:
    | StepParametersSchema
    | { type: string; fields: WorkflowInputField[] }
    | CandidateReviewSchema
    | RecordSelectionSchema
    | ArticleReviewSchema
    | null;
  scheduled_at?: string | null;
  execution_mode?: string | null;
  workflow_schedule_id?: string | null;
  failed_step_id?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
};

export type WorkflowArtifact = {
  stepId: string;
  fileUrl: string;
  storageKey?: string;
  fileName: string;
  contentType?: string;
};

export type WorkflowSchedule = {
  id: string;
  workflow_id: string;
  organization_id: string;
  clerk_user_id: string;
  status: 'active' | 'paused';
  cadence: 'daily' | 'weekly' | 'monthly';
  hour: number;
  minute: number;
  weekday?: number | null;
  day_of_month?: number | null;
  timezone: string;
  inputs: Record<string, unknown>;
  next_run_at: string;
  last_run_at?: string | null;
  last_run_id?: string | null;
  created_at: string;
  updated_at: string;
  workflow_slug?: string;
  workflow_name?: string;
};

export type WorkflowGatePrefill = {
  selectionIndices?: number[];
  section?: string;
  editorNotes?: string;
  decision?: string;
  reviewNotes?: string;
};

export type WorkflowReviewProps = {
  run: WorkflowRun;
  workflow: Workflow | null;
  runId: string;
  token: string;
  onResumed: () => void;
  /** Refresh run snapshot after in-gate artifact actions (e.g. regenerate). */
  onRunUpdated?: () => void | Promise<void>;
  /** True while regenerate/resume is in flight — parent can disable chat. */
  onGateBusyChange?: (busy: boolean) => void;
  compact?: boolean;
  prefill?: WorkflowGatePrefill;
  prefillToken?: number;
};

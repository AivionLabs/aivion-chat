export type WorkflowStep = {
  id: string;
  type: 'llm' | 'file_extract' | 'user_input' | 'scrub' | 'unscrub' | 'integration' | 'loop' | 'template';
  label?: string;
  review_chat_system_prompt?: string;
};

export type WorkflowInputField = {
  name: string;
  label: string;
  type: 'string' | 'text' | 'number' | 'email' | 'date' | 'boolean' | 'select' | 'file' | 'file_array';
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
  | { type: 'key_value';        title?: string; fields: WorkflowOutputField[] }
  | { type: 'list';             title?: string; items: string[] }
  | { type: 'text';             title?: string; content: string }
  | { type: 'metric_grid';      title?: string; metrics: MetricItem[] }
  | { type: 'table';            title?: string; data_table: string; columns: TableColumn[] }
  | { type: 'comparison';       title?: string; data: string; fields_per_item: ComparisonField[] }
  | { type: 'bar_chart';        title?: string; chart_data: string; x_field: string; y_field: string }
  | { type: 'line_chart';       title?: string; chart_data: string; x_field: string; y_field: string }
  | { type: 'pie_chart';        title?: string; chart_data: string; label_field: string; value_field: string }
  | { type: 'document_preview'; title?: string; storage_key: string; filename?: string }
  | { type: 'timeline';         title?: string; timeline_items: TimelineItem[] }
  | { type: 'progress';         title?: string; progress_items: ProgressItem[] };

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
  steps?: WorkflowStep[];
  inputs?: WorkflowInputField[];
  output?: WorkflowOutput;
  review_display?: WorkflowReviewDisplay;
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

export type WorkflowRun = {
  run_id: string;
  workflow_id: string;
  status: RunStatus;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown> | null;
  error_message?: string | null;
  pending_step_id?: string | null;
  pending_prompt?: string | null;
  pending_input_schema?: { type: string; fields: WorkflowInputField[] } | CandidateReviewSchema | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
};

export type WorkflowReviewProps = {
  run: WorkflowRun;
  workflow: Workflow | null;
  runId: string;
  token: string;
  onResumed: () => void;
};

/* eslint-disable i18next/no-literal-string */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowInputField } from './types';

const inputBase =
  'w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-amber-500/50 dark:border-border-medium';

function FileInput({
  field,
  onChange,
  showValidation,
  token,
}: {
  field: WorkflowInputField;
  onChange: (name: string, value: string) => void;
  showValidation?: boolean;
  token: string | undefined;
}) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [fileName, setFileName] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const showMissing = showValidation && status === 'idle';

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setStatus('uploading');
    setErrMsg('');
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/aivion/workflow/uploads', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const { storage_key } = await res.json();
      onChange(field.name, storage_key);
      setStatus('done');
    } catch {
      setStatus('error');
      setErrMsg('Upload failed. Please try again.');
    }
  }

  const border = showMissing
    ? 'border-red-400'
    : status === 'done'
      ? 'border-green-400'
      : 'border-border-light hover:border-border-medium';

  return (
    <div className="flex flex-col gap-1.5">
      <label
        className={`flex cursor-pointer items-center gap-2 rounded-lg border border-dashed ${border} bg-surface-secondary px-4 py-3 text-sm text-text-secondary transition-colors`}
      >
        <span className="truncate">
          {status === 'uploading'
            ? 'Uploading…'
            : status === 'done'
              ? fileName
              : (field.placeholder ?? 'Choose file')}
        </span>
        <input
          type="file"
          accept={field.accept ?? '.pdf'}
          className="sr-only"
          onChange={handleChange}
          disabled={status === 'uploading'}
        />
      </label>
      {status === 'error' && <p className="text-xs text-red-500">{errMsg}</p>}
      {showMissing && <p className="text-xs text-red-500">Please upload a file</p>}
    </div>
  );
}

type UploadItem = {
  id: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  storageKey?: string;
};

function FileArrayInput({
  field,
  onChange,
  showValidation,
  token,
}: {
  field: WorkflowInputField;
  onChange: (name: string, value: string) => void;
  showValidation?: boolean;
  token: string | undefined;
}) {
  const maxFiles = field.max_files ?? 10;
  const [items, setItems] = useState<UploadItem[]>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const doneCount = items.filter((i) => i.status === 'done').length;
  const showMissing = showValidation && doneCount === 0;

  useEffect(() => {
    const keys = items.filter((i) => i.status === 'done').map((i) => i.storageKey!);
    onChangeRef.current(field.name, JSON.stringify(keys));
  }, [items, field.name]);

  const uploadFile = useCallback(
    async (file: File) => {
      const id = Math.random().toString(36).slice(2);
      setItems((prev) => [...prev, { id, name: file.name, status: 'uploading' }]);
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch('/api/aivion/workflow/uploads', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const { storage_key } = await res.json();
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, status: 'done', storageKey: storage_key } : item,
          ),
        );
      } catch {
        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, status: 'error' } : item)),
        );
      }
    },
    [token],
  );

  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border-light px-3 py-4 text-center text-xs text-text-secondary">
        Click to upload files
        <input
          type="file"
          multiple
          accept={field.accept ?? '.pdf,.docx'}
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) Array.from(e.target.files).forEach((f) => void uploadFile(f));
            e.currentTarget.value = '';
          }}
        />
      </label>
      {showMissing && <p className="text-xs text-red-500">Please upload at least one file</p>}
    </div>
  );
}

export function WorkflowFormField({
  field,
  value,
  onChange,
  showValidation,
  token,
  modelOptions,
}: {
  field: WorkflowInputField;
  value: string;
  onChange: (name: string, value: string) => void;
  showValidation?: boolean;
  token: string | undefined;
  modelOptions?: string[];
}) {
  if (field.type === 'file') {
    return (
      <FileInput field={field} onChange={onChange} showValidation={showValidation} token={token} />
    );
  }
  if (field.type === 'file_array') {
    return (
      <FileArrayInput
        field={field}
        onChange={onChange}
        showValidation={showValidation}
        token={token}
      />
    );
  }

  const showError = showValidation && field.required && !value.trim();
  const errorClass = showError ? 'border-red-400 focus:ring-red-400/50' : '';
  const cls = `${inputBase} ${errorClass}`;
  const selectOptions =
    field.name === 'model' && modelOptions?.length ? modelOptions : field.options;

  let input: React.ReactNode;
  if (field.type === 'select' && selectOptions) {
    input = (
      <select className={cls} value={value} onChange={(e) => onChange(field.name, e.target.value)}>
        <option value="">Select…</option>
        {selectOptions.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (field.type === 'text' || field.type === 'textarea') {
    input = (
      <textarea
        rows={field.type === 'textarea' ? 4 : 3}
        className={`${cls} resize-y`}
        value={value}
        onChange={(e) => onChange(field.name, e.target.value)}
        placeholder={field.placeholder}
      />
    );
  } else if (field.type === 'boolean') {
    input = (
      <input
        type="checkbox"
        className="h-4 w-4 rounded"
        checked={value === 'true'}
        onChange={(e) => onChange(field.name, String(e.target.checked))}
      />
    );
  } else {
    const typeMap: Record<string, string> = {
      string: 'text',
      email: 'email',
      number: 'number',
      date: 'date',
    };
    input = (
      <input
        type={typeMap[field.type] ?? 'text'}
        className={cls}
        value={value}
        onChange={(e) => onChange(field.name, e.target.value)}
        placeholder={field.placeholder}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {input}
      {showError && <p className="text-xs text-red-500">This field is required</p>}
    </div>
  );
}

export default function WorkflowInputForm({
  fields,
  values,
  onChange,
  showValidation,
  token,
  compact,
}: {
  fields: WorkflowInputField[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  showValidation?: boolean;
  token: string | undefined;
  compact?: boolean;
}) {
  if (fields.length === 0) {
    return (
      <p className="text-xs text-text-secondary">This workflow has no run inputs — defaults apply.</p>
    );
  }

  return (
    <div className={compact ? 'flex max-h-64 flex-col gap-3 overflow-y-auto pr-1' : 'flex flex-col gap-4'}>
      {fields.map((field) => (
        <label key={field.name} className="grid gap-1.5">
          <span className="text-xs font-medium text-text-primary">
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          <WorkflowFormField
            field={field}
            value={values[field.name] ?? ''}
            onChange={onChange}
            showValidation={showValidation}
            token={token}
          />
        </label>
      ))}
    </div>
  );
}

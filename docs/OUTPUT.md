# Workflow Output Specification

**Updated: Using the composable sections pattern (like step types)**

---

## The Problem

Different verticals produce different output shapes. Hardcoding output types per workflow ("HR shortlist", "sales report", "finance summary") doesn't scale.

- **HR/Recruitment** — candidate lists, decisions, shortlists
- **Sales** — pipeline reports, charts, conversion metrics
- **Finance** — tables with totals, document previews
- **Marketing** — campaign metrics, audience segments

The solution: **output as composable primitives**, like step types.

---

## Output as Registry Pattern

Just as workflow steps use a registry of types (`llm`, `template`, `loop`, ...), output uses a registry of **section types**. The workflow spec declares which sections to use.

```
Step types: llm, template, scrub, loop, ...
Input types: string, file, select, file_array, ...
Output sections: metric_grid, table, bar_chart, text, comparison, ...
```

Same architectural pattern applied to output.

---

## The Vocabulary of Section Types

### Core Sections (v1) — Build First

| Section type | Use case | Data shape |
|---|---|---|
| `key_value` | Simple labelled fields | Array of {label, value, kind?} |
| `text` | Narrative, AI insights | String |
| `list` | Bullet points, action items | Array of strings |
| `comparison` | Side-by-side items (shortlist) | Array of objects + fields_per_item |
| `document_preview` | Generated docs, CVs | Storage reference + filename |

### Analytical Sections (v2) — Add on demand

| Section type | Use case | Data shape |
|---|---|---|
| `metric_grid` | KPIs at top of report | Array of {label, value, format} |
| `table` | Tabular data | Array of objects + column config |
| `bar_chart` | Comparing categories | Array + x/y field config |
| `line_chart` | Trends over time | Array + time/value config |
| `pie_chart` | Composition | Array + label/value config |

### Specialized Sections (v3+)

| Section type | Use case | Data shape |
|---|---|---|
| `timeline` | Sequence of events | Array of {date, event, description} |
| `progress` | Status indicators | Array of {label, status, details} |

---

## Specification Format

```json
{
  "output": {
    "type": "report",
    "title": "Q3 Sales Performance",
    "sections": [
      {
        "type": "metric_grid",
        "metrics": [
          { "label": "Total Revenue", "value": "${steps.aggregate.output.revenue}", "format": "currency" },
          { "label": "Deals Closed", "value": "${steps.aggregate.output.deals_count}", "format": "number" },
          { "label": "Win Rate", "value": "${steps.aggregate.output.win_rate}", "format": "percent" }
        ]
      },
      {
        "type": "bar_chart",
        "title": "Revenue by Region",
        "data": "${steps.aggregate.output.by_region}",
        "x_field": "region",
        "y_field": "revenue"
      },
      {
        "type": "table",
        "title": "Top 10 Deals",
        "data": "${steps.aggregate.output.top_deals}",
        "columns": [
          { "field": "deal_name", "label": "Deal" },
          { "field": "client", "label": "Client" },
          { "field": "value", "label": "Value", "format": "currency" }
        ]
      },
      {
        "type": "text",
        "title": "AI Insights",
        "content": "${steps.summarize.output}"
      }
    ],
    "actions": [
      { "type": "export", "format": "pdf" },
      { "type": "export", "format": "csv" }
    ]
  }
}
```

---

## Example Workflow Outputs

### RTR Contract

```json
{
  "type": "report",
  "title": "RTR sent",
  "sections": [
    {
      "type": "key_value",
      "fields": [
        { "label": "Sent to", "value": "${inputs.candidate_email}" },
        { "label": "Subject", "value": "${steps.review.output.subject}" }
      ]
    },
    {
      "type": "document_preview",
      "title": "Generated Document",
      "storage_key": "${steps.generate_doc.output.storage_key}",
      "filename": "${steps.generate_doc.output.file_name}"
    }
  ]
}
```

### Candidate Qualification

```json
{
  "type": "report",
  "title": "Shortlist ready",
  "sections": [
    {
      "type": "key_value",
      "fields": [
        { "label": "Reviewed", "value": "${steps.process.output.iterations.length}" },
        { "label": "Priority screens", "value": "${count.priority}" },
        { "label": "If capacity", "value": "${count.if_capacity}" },
        { "label": "Passed", "value": "${count.pass}" }
      ]
    },
    {
      "type": "comparison",
      "title": "Priority candidates",
      "data": "${filter.priority}",
      "fields_per_item": [
        { "field": "name", "label": "Name" },
        { "field": "current_role", "label": "Role" },
        { "field": "phone_screen_priorities", "label": "Focus areas", "kind": "list" }
      ]
    }
  ]
}
```

### Sales Performance Report

```json
{
  "type": "report",
  "title": "Q3 Sales",
  "sections": [
    { "type": "metric_grid", "metrics": [...] },
    { "type": "bar_chart", "data": "${steps.aggregate.output.by_region}", ... },
    { "type": "line_chart", "data": "${steps.aggregate.output.monthly_trend}", ... },
    { "type": "table", "data": "${steps.aggregate.output.top_deals}", ... },
    { "type": "text", "content": "${steps.ai_summary.output}" }
  ]
}
```

---

## Migration Path

### Current (deprecated)

```json
{
  "output": {
    "type": "summary",
    "title": "...",
    "fields": [
      { "label": "...", "value": "...", "kind": "text" }
    ]
  }
}
```

### New Format

```json
{
  "output": {
    "type": "report",
    "title": "...",
    "sections": [
      { "type": "key_value", "fields": [...] }
    ]
  }
}
```

**Backward compatibility:** Old `fields` format is deprecated but still works. New workflows should use `sections`.

---

## Build Sequence

### Phase 1: Core Sections (for RTR + Candidate Qualification)

1. `key_value` — simple labelled fields (already exists as `summary.fields`)
2. `comparison` — shortlist/shortlist view (gap to fill)
3. `text` — narrative output
4. `document_preview` — generated docs
5. `list` — bullet points

### Phase 2: Analytical (for sales/finance customers)

6. `metric_grid` — KPI displays
7. `table` — tabular data
8. `bar_chart`, `line_chart`, `pie_chart` — visualizations

### Phase 3: Specialized

9. `timeline` — event sequences
10. `progress` — status tracking

---

## Implementation

| File | Changes |
|------|---------|
| `SPEC_FORMAT_CONVENTIONS.md` | Document output sections as first-class concept |
| `admin/workflows/cv-screener.json` | Migrate to new sections format |
| `admin/workflows/rtr-contract.json` | Use document_preview section |
| `frontend/src/components/output/` | New section renderer components |
| `frontend/src/app/workspace/workflows/[id]/runs/[run_id]/page.tsx` | Use new section renderer |

---

## Architectural Principles

1. **Registry pattern** — finite set of section types, workflow author composes
2. **Each section = one component** — with defined data contract
3. **Backward compatible** — old `fields` format still works
4. **Extensible** — new section types added as needed
5. **Same pattern as steps** — discipline applied to output

---

## Open Questions

1. **Export actions** — Where to define: in each section or globally?
2. **Share functionality** — Authenticated link or public?
3. **Chart library** — Use recharts or native SVG?
4. **Validation** — JSON Schema for each section type?
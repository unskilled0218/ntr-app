// The Status / Project / Context / Sort dropdowns. Status + the two label filters drive the
// backend query (TodoPane refetches); Sort is client-side (re-render only). Ported from the
// #filters block of index.html + app.js.

import { KINDS, SORTS, STATUSES, type Kind, type Status } from "../config";

interface Props {
  status: Status;
  project: string;
  context: string;
  sort: string;
  serverLabels: { project: string[]; context: string[] };
  onStatus: (s: Status) => void;
  onProject: (p: string) => void;
  onContext: (c: string) => void;
  onSort: (s: string) => void;
  onRemove: (kind: Kind, name: string) => void;
}

export default function FilterBar({
  status,
  project,
  context,
  sort,
  serverLabels,
  onStatus,
  onProject,
  onContext,
  onSort,
  onRemove,
}: Props) {
  return (
    <div id="filters">
      <label>
        Status
        <select
          aria-label="Status filter"
          value={status}
          onChange={(e) => onStatus(e.currentTarget.value as Status)}
        >
          {Object.entries(STATUSES).map(([value, s]) => (
            <option key={value} value={value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Project
        <select aria-label="Project filter" value={project} onChange={(e) => onProject(e.currentTarget.value)}>
          <option value="">All {KINDS.project.singular}s</option>
          {[...serverLabels.project].sort().map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        aria-label={`Remove ${KINDS.project.singular}`}
        disabled={!project}
        onClick={() => onRemove("project", project)}
      >
        Remove
      </button>
      <label>
        Context
        <select aria-label="Context filter" value={context} onChange={(e) => onContext(e.currentTarget.value)}>
          <option value="">All {KINDS.context.singular}s</option>
          {[...serverLabels.context].sort().map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        aria-label={`Remove ${KINDS.context.singular}`}
        disabled={!context}
        onClick={() => onRemove("context", context)}
      >
        Remove
      </button>
      <label>
        Sort
        <select aria-label="Sort order" value={sort} onChange={(e) => onSort(e.currentTarget.value)}>
          {Object.entries(SORTS).map(([key, s]) => (
            <option key={key} value={key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

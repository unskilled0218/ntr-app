// The Status / Project / Context / Sort dropdowns. Status + the two label filters drive the
// backend query (TodoPane refetches); Sort is client-side (re-render only). Ported from the
// #filters block of index.html + app.js.
//
// The Project/Context selects double as the remove control: when a concrete label is selected,
// a trailing "Remove +name" option is offered, and choosing it calls onRemove instead of
// changing the filter (REMOVE_VALUE can never be a real label, see config.ts). onRemove only
// opens the confirm dialog in TodoPane, so an accidental keyboard-arrow selection is harmless.

import { KINDS, REMOVE_VALUE, SORTS, STATUSES, type Kind, type Status } from "../config";

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
        <select
          aria-label="Project filter"
          value={project}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v === REMOVE_VALUE) onRemove("project", project);
            else onProject(v);
          }}
        >
          <option value="">All {KINDS.project.singular}s</option>
          {[...serverLabels.project].sort().map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {project && (
            <option value={REMOVE_VALUE}>
              Remove {KINDS.project.prefix}
              {project}
            </option>
          )}
        </select>
      </label>
      <label>
        Context
        <select
          aria-label="Context filter"
          value={context}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v === REMOVE_VALUE) onRemove("context", context);
            else onContext(v);
          }}
        >
          <option value="">All {KINDS.context.singular}s</option>
          {[...serverLabels.context].sort().map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {context && (
            <option value={REMOVE_VALUE}>
              Remove {KINDS.context.prefix}
              {context}
            </option>
          )}
        </select>
      </label>
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

// The Status / Project / Context / Sort choosers. Status + the two label filters drive the
// backend query (TodoPane refetches); Sort is client-side (re-render only). Status/Project/Context
// are SelectFields (a trigger that opens a single-choice modal); Sort is a SortField — one trigger
// that opens one modal holding both the sort key and the direction (ASC/DESC).
//
// The Project/Context pickers mark each concrete label row `removable` and pass onRemove, so each
// label item carries a Remove button on its right; onRemove only opens the confirm dialog in
// TodoPane, so removal is still the deliberate, confirmed task-12 flow.

import { DIRECTIONS, KINDS, SORTS, STATUSES, type Kind, type Status } from "../config";
import SelectField, { type FieldOption } from "./SelectField";
import SortField from "./SortField";

interface Props {
  status: Status;
  project: string;
  context: string;
  sort: string;
  dir: string;
  serverLabels: { project: string[]; context: string[] };
  onStatus: (s: Status) => void;
  onProject: (p: string) => void;
  onContext: (c: string) => void;
  onSort: (s: string) => void;
  onDir: (d: string) => void;
  onRemove: (kind: Kind, name: string) => void;
}

const STATUS_OPTIONS: FieldOption[] = Object.entries(STATUSES).map(([value, s]) => ({
  value,
  label: s.label,
}));

const SORT_OPTIONS: FieldOption[] = Object.entries(SORTS).map(([value, s]) => ({
  value,
  label: s.label,
}));

const DIRECTION_OPTIONS: FieldOption[] = Object.entries(DIRECTIONS).map(([value, d]) => ({
  value,
  label: d.label,
}));

// "All <kind>s" first, then each concrete label as a removable row.
function labelOptions(kind: Kind, names: string[]): FieldOption[] {
  return [
    { value: "", label: `All ${KINDS[kind].singular}s` },
    ...[...names].sort().map((name) => ({ value: name, label: name, removable: true })),
  ];
}

export default function FilterBar({
  status,
  project,
  context,
  sort,
  dir,
  serverLabels,
  onStatus,
  onProject,
  onContext,
  onSort,
  onDir,
  onRemove,
}: Props) {
  return (
    <div id="filters">
      <label>
        Status
        <SelectField
          ariaLabel="Status filter"
          value={status}
          options={STATUS_OPTIONS}
          onChange={(v) => onStatus(v as Status)}
        />
      </label>
      <label>
        Project
        <SelectField
          ariaLabel="Project filter"
          value={project}
          options={labelOptions("project", serverLabels.project)}
          onChange={onProject}
          onRemove={(name) => onRemove("project", name)}
        />
      </label>
      <label>
        Context
        <SelectField
          ariaLabel="Context filter"
          value={context}
          options={labelOptions("context", serverLabels.context)}
          onChange={onContext}
          onRemove={(name) => onRemove("context", name)}
        />
      </label>
      <label>
        Sort
        <SortField
          sort={sort}
          dir={dir}
          sortOptions={SORT_OPTIONS}
          dirOptions={DIRECTION_OPTIONS}
          onSort={onSort}
          onDir={onDir}
        />
      </label>
    </div>
  );
}

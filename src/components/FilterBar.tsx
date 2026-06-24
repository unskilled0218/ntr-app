// The Status / Project / Context / Sort choosers. Status + the two label filters drive the
// backend query (TodoPane refetches); Sort is client-side (re-render only). Each chooser is a
// SelectField (a trigger button that opens a modal list), ported from the #filters block.
//
// The Project/Context pickers mark each concrete label row `removable` and pass onRemove, so each
// label item carries a Remove button on its right; onRemove only opens the confirm dialog in
// TodoPane, so removal is still the deliberate, confirmed task-12 flow.

import { KINDS, SORTS, STATUSES, type Kind, type Status } from "../config";
import SelectField, { type FieldOption } from "./SelectField";

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

const STATUS_OPTIONS: FieldOption[] = Object.entries(STATUSES).map(([value, s]) => ({
  value,
  label: s.label,
}));

const SORT_OPTIONS: FieldOption[] = Object.entries(SORTS).map(([value, s]) => ({
  value,
  label: s.label,
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
        <SelectField ariaLabel="Sort order" value={sort} options={SORT_OPTIONS} onChange={onSort} />
      </label>
    </div>
  );
}

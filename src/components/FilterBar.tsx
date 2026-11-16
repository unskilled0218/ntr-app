// The List / Sort choosers. List drives the backend query (TodoPane refetches);
// Sort is client-side (re-render only). List is a SelectField; Sort is a SortField — one trigger
// that opens one modal holding both the sort key and the direction (ASC/DESC). When `compact`, all
// choosers collapse behind a single "Options" button (an OptionsModal); they are identical
// either way — only where they render changes.
//
// The List picker marks each concrete label row `removable` and passes onRemove, so each
// label item carries a Remove button on its right; onRemove only opens the confirm dialog in
// TodoPane, so removal is still the deliberate, confirmed task-12 flow.

import { DIRECTIONS, SORTS } from "../config";
import { useRef } from "react";
import OptionsModal, { type OptionsModalHandle } from "./OptionsModal";
import SelectField, { type FieldOption } from "./SelectField";
import SortField from "./SortField";
import { HaListPicker, useHaLists } from "./HaLists";
import { recoveryEntries, relatedRecovery, type ListManagement } from "../lib/listActions";

interface Props {
  disabled?: boolean;
  list: string;
  sort: string;
  dir: string;
  compact: boolean; // when true, the choosers collapse behind one "Options" button
  serverLabels: { list: string[]; context: string[] };
  onList: (p: string) => void;
  onSort: (s: string) => void;
  onDir: (d: string) => void;
  onRemove: (kind: "list", name: string) => void;
  onRename?: (name: string) => void;
  management?: ListManagement;
}

const SORT_OPTIONS: FieldOption[] = Object.entries(SORTS).map(([value, s]) => ({
  value,
  label: s.label,
}));

const DIRECTION_OPTIONS: FieldOption[] = Object.entries(DIRECTIONS).map(([value, d]) => ({
  value,
  label: d.label,
}));

// All lists first, then each concrete list as a removable row.
function labelOptions(names: string[]): FieldOption[] {
  return [
    { value: "", label: "All lists" },
    ...[...names].sort().map((name) => ({ value: name, label: name, removable: true, renamable: true })),
  ];
}

export default function FilterBar({
  disabled = false,
  list,
  sort,
  dir,
  compact,
  serverLabels,
  onList,
  onSort,
  onDir,
  onRemove,
  onRename,
  management,
}: Props) {
  const ha = useHaLists();
  const optionsRef = useRef<OptionsModalHandle>(null);
  // The two choosers, defined once and rendered either inline (default) or inside the compact
  // Options modal — so each chooser's props and wiring live in exactly one place.
  const fields = (
    <>
      <label>
        List
        {ha ? <HaListPicker value={list} onChange={onList} filter /> : <SelectField
          ariaLabel="List filter"
          value={list}
          options={labelOptions(serverLabels.list).map((option) => ({ ...option, removable: !disabled && option.removable, renamable: !disabled && option.renamable, description: management ? relatedRecovery(option.value, management)?.summary : undefined }))}
          onChange={onList}
          onRemove={(name) => {
            if (management) { optionsRef.current?.close(); management.onAction({ action: "remove", name, scope: "known", destination: management.destination, origin: "filter", recoveryId: relatedRecovery(name, management)?.id }); }
            else onRemove("list", name);
          }}
          onRename={management || onRename ? (name) => {
            optionsRef.current?.close();
            if (management) management.onAction({ action: "rename", name, scope: "known", destination: management.destination, origin: "filter", recoveryId: relatedRecovery(name, management)?.id });
            else onRename?.(name);
          } : undefined}
          recoveries={recoveryEntries(serverLabels.list, management)}
          onRecover={(id) => { optionsRef.current?.close(); management?.onRecover(id, "filter"); }}
        />}
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
    </>
  );

  return (
    <div id="filters">
      {compact ? <OptionsModal ref={optionsRef} ariaLabel="Filter options">{fields}</OptionsModal> : fields}
    </div>
  );
}

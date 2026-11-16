// Shared label picker used by AddForm and EditTaskModal. Owns the options merge
// (serverLabels ∪ staged) and the "+ Add…" sentinel that opens the label modal. Renders the
// shared SelectField; removal is a store-level filter action (see task 12), so no onRemove here.

import { ADD_VALUE, EMPTY_LABEL, KINDS, type Kind } from "../config";
import { captureTransport, destination } from "../api";
import { HaListPicker, useHaLists } from "./HaLists";
import SelectField, { type FieldOption } from "./SelectField";
import { recoveryEntries, relatedRecovery, type ListActionRequest, type ListManagement, type ListSelectorSession } from "../lib/listActions";

interface Props {
  kind: Kind;
  value: string;
  serverLabels: string[];
  staged: string[];
  onChange(value: string): void;
  onAdd(session?: ListSelectorSession): void;
  management?: ListManagement;
  onListAction?: (request: ListActionRequest) => void;
  onRecover?: (id: number, session?: ListSelectorSession) => void;
  revision?: number;
}

export default function LabelSelect({ kind, value, serverLabels, staged, onChange, onAdd, management, onListAction, onRecover, revision }: Props) {
  const ha = useHaLists();
  if (ha && kind === "list") return <HaListPicker value={value} onChange={onChange} />;
  const names = [...new Set([...serverLabels, ...staged])].sort();
  const label = KINDS[kind].singular;

  const options: FieldOption[] = [
    { value: ADD_VALUE, label: `+ Add ${label}...` },
    { value: "", label: EMPTY_LABEL },
    ...names.map((name) => ({ value: name, label: name, renamable: !!onListAction, removable: !!onListAction,
      description: management ? relatedRecovery(name, management)?.summary : undefined })),
  ];

  // Selecting "+ Add..." opens the label modal instead of choosing a value (caller-owned sentinel).
  function handleChange(v: string, session?: ListSelectorSession) {
    if (v === ADD_VALUE) { onAdd(session); return; }
    onChange(v);
  }

  return (
    <SelectField
      ariaLabel={label[0].toUpperCase() + label.slice(1)}
      value={value}
      options={options}
      onChange={handleChange}
      retainChoices={[ADD_VALUE]}
      scopeKey={management?.destination ?? destination(captureTransport())}
      retainActions={!!onListAction}
      revision={revision}
      onRename={onListAction && management ? (name, session) => onListAction({ action: "rename", name, scope: serverLabels.includes(name) ? "known" : "staged", destination: management.destination, origin: "add", recoveryId: relatedRecovery(name, management)?.id, session }) : undefined}
      onRemove={onListAction && management ? (name, session) => onListAction({ action: "remove", name, scope: serverLabels.includes(name) ? "known" : "staged", destination: management.destination, origin: "add", recoveryId: relatedRecovery(name, management)?.id, session }) : undefined}
      recoveries={recoveryEntries(names, management)}
      onRecover={onRecover}
    />
  );
}

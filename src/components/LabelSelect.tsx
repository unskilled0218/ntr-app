// Shared label picker used by AddForm and EditTaskModal. Owns the options merge
// (serverLabels ∪ staged) and the "+ Add…" sentinel that opens the label modal. Renders the
// shared SelectField; removal is a store-level filter action (see task 12), so no onRemove here.

import { ADD_VALUE, EMPTY_LABEL, KINDS, type Kind } from "../config";
import SelectField, { type FieldOption } from "./SelectField";
import { recoveryEntries, relatedRecovery, type ProjectActionRequest, type ProjectManagement, type ProjectSelectorSession } from "../lib/projectActions";

interface Props {
  kind: Kind;
  value: string;
  serverLabels: string[];
  staged: string[];
  onChange(value: string): void;
  onAdd(): void;
  management?: ProjectManagement;
  onProjectAction?: (request: ProjectActionRequest) => void;
  onRecover?: (id: number, session?: ProjectSelectorSession) => void;
  revision?: number;
}

export default function LabelSelect({ kind, value, serverLabels, staged, onChange, onAdd, management, onProjectAction, onRecover, revision }: Props) {
  const names = [...new Set([...serverLabels, ...staged])].sort();
  const label = KINDS[kind].singular;

  const options: FieldOption[] = [
    { value: ADD_VALUE, label: `+ Add ${label}...` },
    { value: "", label: EMPTY_LABEL },
    ...names.map((name) => ({ value: name, label: name, renamable: !!onProjectAction, removable: !!onProjectAction,
      description: management ? relatedRecovery(name, management)?.summary : undefined })),
  ];

  // Selecting "+ Add..." opens the label modal instead of choosing a value (caller-owned sentinel).
  function handleChange(v: string) {
    if (v === ADD_VALUE) { onAdd(); return; }
    onChange(v);
  }

  return (
    <SelectField
      ariaLabel={label[0].toUpperCase() + label.slice(1)}
      value={value}
      options={options}
      onChange={handleChange}
      retainActions={!!onProjectAction}
      revision={revision}
      onRename={onProjectAction && management ? (name, session) => onProjectAction({ action: "rename", name, scope: serverLabels.includes(name) ? "known" : "staged", destination: management.destination, origin: "add", recoveryId: relatedRecovery(name, management)?.id, session }) : undefined}
      onRemove={onProjectAction && management ? (name, session) => onProjectAction({ action: "remove", name, scope: serverLabels.includes(name) ? "known" : "staged", destination: management.destination, origin: "add", recoveryId: relatedRecovery(name, management)?.id, session }) : undefined}
      recoveries={recoveryEntries(names, management)}
      onRecover={onRecover}
    />
  );
}

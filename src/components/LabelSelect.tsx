// Shared label dropdown used by AddForm and EditTaskModal. Owns the options merge
// (serverLabels ∪ staged) and the "+ Add…" sentinel that opens the label modal.

import { ADD_VALUE, EMPTY_LABEL, KINDS, type Kind } from "../config";

interface Props {
  kind: Kind;
  value: string;
  serverLabels: string[];
  staged: string[];
  onChange(value: string): void;
  onAdd(): void;
}

export default function LabelSelect({ kind, value, serverLabels, staged, onChange, onAdd }: Props) {
  const options = [...new Set([...serverLabels, ...staged])].sort();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.currentTarget.value;
    if (v === ADD_VALUE) { onAdd(); return; }
    onChange(v);
  }

  const label = KINDS[kind].singular;

  return (
    <select aria-label={label[0].toUpperCase() + label.slice(1)} value={value} onChange={handleChange}>
      <option value={ADD_VALUE}>+ Add {label}...</option>
      <option value="">{EMPTY_LABEL}</option>
      {options.map((name) => (
        <option key={name} value={name}>{name}</option>
      ))}
    </select>
  );
}

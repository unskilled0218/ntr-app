import { useId } from "react";
import ListActionIcon from "./ListActionIcon";
import type { ListAction } from "../lib/listActions";

// One group of selectable rows inside a picker modal: a vertical <ul> of option buttons with the
// current selection marked (aria-current), plus an optional Remove button per row (label pickers
// only). Shared by SelectField (its one group) and SortField (the Sort and Direction groups) so an
// option row looks and behaves identically everywhere — one home for "what a picker row is".

export interface FieldOption {
  value: string;
  label: string;
  removable?: boolean; // show a Remove button on this row's right (needs onRemove)
  renamable?: boolean;
  description?: string;
}

// The label of the option whose value matches, falling back to the first option's, then "" — the
// text a picker trigger shows for its current selection. One home so every trigger (SelectField,
// SortField) derives its display text the same way.
export function optionLabel(options: FieldOption[], value: string): string {
  return (options.find((o) => o.value === value) ?? options[0])?.label ?? "";
}

interface Props {
  options: FieldOption[];
  value: string;
  onChoose(value: string): void;
  onRemove?(value: string): void;
  onRename?(value: string): void;
  recoveries?: { id: number; label: string; kind: ListAction }[];
  onRecover?(id: number): void;
}

export default function PickerList({ options, value, onChoose, onRemove, onRename, recoveries, onRecover }: Props) {
  const id = useId();
  return (
    <ul className="picker-list">
      {options.map((o, index) => (
        <li key={o.value} className="picker-option">
          <button
            type="button"
            className="picker-choice"
            aria-current={o.value === value ? "true" : undefined}
            aria-describedby={o.description ? `${id}-${index}` : undefined}
            onClick={(event) => {
              // Closing a picker can remove this button before its label's default activation.
              event.preventDefault();
              onChoose(o.value);
            }}
          >
            {o.label}
          </button>
          {o.description && <span className="sr-only" id={`${id}-${index}`}>{o.description}</span>}
          {o.renamable && onRename && <button type="button" className="picker-rename" title={`Rename ${o.label}`} aria-label={`Rename ${o.label}`} aria-describedby={o.description ? `${id}-${index}` : undefined} onClick={(event) => {
            event.preventDefault(); onRename(o.value);
          }}><ListActionIcon action="rename" /></button>}
          {o.removable && onRemove && (
            <button
              type="button"
              className="picker-remove"
              aria-label={`Remove ${o.label}`}
              title={`Remove ${o.label}`}
              aria-describedby={o.description ? `${id}-${index}` : undefined}
              onClick={(event) => {
                event.preventDefault();
                onRemove(o.value);
              }}
            >
              <ListActionIcon action="remove" />
            </button>
          )}
        </li>
      ))}
      {recoveries?.map((entry) => <li key={`recovery-${entry.id}`} className="picker-recovery"><button type="button" onClick={(event) => {
        event.preventDefault(); onRecover?.(entry.id);
      }}><ListActionIcon action={entry.kind} /><span>{entry.label}</span></button></li>)}
    </ul>
  );
}

// One group of selectable rows inside a picker modal: a vertical <ul> of option buttons with the
// current selection marked (aria-current), plus an optional Remove button per row (label pickers
// only). Shared by SelectField (its one group) and SortField (the Sort and Direction groups) so an
// option row looks and behaves identically everywhere — one home for "what a picker row is".

export interface FieldOption {
  value: string;
  label: string;
  removable?: boolean; // show a Remove button on this row's right (needs onRemove)
  renamable?: boolean;
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
}

export default function PickerList({ options, value, onChoose, onRemove, onRename }: Props) {
  return (
    <ul className="picker-list">
      {options.map((o) => (
        <li key={o.value} className="picker-option">
          <button
            type="button"
            className="picker-choice"
            aria-current={o.value === value ? "true" : undefined}
            onClick={(event) => {
              // Closing a picker can remove this button before its label's default activation.
              event.preventDefault();
              onChoose(o.value);
            }}
          >
            {o.label}
          </button>
          {o.renamable && onRename && <button type="button" className="picker-rename" aria-label={`Rename ${o.label}`} onClick={(event) => {
            event.preventDefault(); onRename(o.value);
          }}>Rename</button>}
          {o.removable && onRemove && (
            <button
              type="button"
              className="picker-remove"
              aria-label={`Remove ${o.label}`}
              onClick={(event) => {
                event.preventDefault();
                onRemove(o.value);
              }}
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// One group of selectable rows inside a picker modal: a vertical <ul> of option buttons with the
// current selection marked (aria-current), plus an optional Remove button per row (label pickers
// only). Shared by SelectField (its one group) and SortField (the Sort and Direction groups) so an
// option row looks and behaves identically everywhere — one home for "what a picker row is".

export interface FieldOption {
  value: string;
  label: string;
  removable?: boolean; // show a Remove button on this row's right (needs onRemove)
}

interface Props {
  options: FieldOption[];
  value: string;
  onChoose(value: string): void;
  onRemove?(value: string): void;
}

export default function PickerList({ options, value, onChoose, onRemove }: Props) {
  return (
    <ul className="picker-list">
      {options.map((o) => (
        <li key={o.value} className="picker-option">
          <button
            type="button"
            className="picker-choice"
            aria-current={o.value === value ? "true" : undefined}
            onClick={() => onChoose(o.value)}
          >
            {o.label}
          </button>
          {o.removable && onRemove && (
            <button
              type="button"
              className="picker-remove"
              aria-label={`Remove ${o.label}`}
              onClick={() => onRemove(o.value)}
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

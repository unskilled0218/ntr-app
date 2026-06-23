# Plan Review — 05 Custom Data Directory

## Round 1 — Score 81/100

### Findings

**Warning: Knowledge Duplication — `set_path` re-implemented `load` logic**
Remedy applied: `set_path` now delegates to `*self = Store::load(new_path)?`.

**Warning: Accidental Complexity — Config writes unspecified as non-atomic**
Remedy applied: Plan now specifies `atomicfile::write` for config, matching store/note discipline.

**Suggestion: Paths unit tests require `AppHandle`**
Remedy applied: Private `read_custom_data_dir(&Path)` / `write_custom_data_dir(&Path, …)` helpers split from public `AppHandle`-dependent functions; tests call helpers directly.

## Round 2 — Score 98/100

### Findings

**Suggestion: `set_path` ID rotation not documented**
Remedy applied: Added note that IDs are re-assigned from 1 on `set_path`; callers must discard held IDs.

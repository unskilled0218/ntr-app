# Review Implementation — 06 Move Files on Path Change

## Code review round 1 — Score 96/100

**Suggestion: Cognitive Overload — rollback arms repeated three times**
Remedy applied: Extracted `rollback_moves(moved_todo, new_todo, old_todo, moved_note, new_note, old_note)` helper. All three error arms now call it instead of duplicating the `move_file` rollback logic.

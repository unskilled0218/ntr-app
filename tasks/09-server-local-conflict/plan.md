# 09 - Server/local conflict resolution

## Goal

When the app reconciles local files with a server (on open and on connect), and
the local copy of a resource differs from the server copy, resolve the
divergence according to a user-configured strategy:

- **Ask every time (default)** — show a dialog with both versions side by side
  and let the user choose which one to keep.
- **Always use server** — overwrite the local file with the server copy.
- **Always use local** — push the local file up to the server.

This replaces task 08's behaviour, where the server copy silently overwrote the
local files on every reconcile.

## Motivation

Task 07 made the local `todo.txt` / `Note.md` a mirror of the server; task 08
refreshed that mirror on startup by blindly writing the server copy over the
local one. That silently discards any edits the user made locally while the
server was unreachable. A user who worked offline and then reconnected would
lose exactly the work they did offline.

Conflict resolution closes that gap: divergence is surfaced, not swallowed, and
the user decides (or pre-decides via a setting) which side wins.

---

## Concepts and where they live

The feature has three separable concerns, each placed in the file that already
owns that kind of decision:

| Concern | Home | Why |
|---|---|---|
| "Do these two strings conflict?" (pure) | `src/lib/conflict.ts` (new) | Mirrors `src/lib/noteSync.ts`'s `classifyNoteEvent` — a pure, testable verdict with no I/O |
| Reading/writing each side + driving reconcile | `src/api.ts` | The only file that knows about Tauri vs HTTP transport |
| The conflict strategy setting (persisted) | `src/settings.ts` | Already the home for localStorage-backed connection settings |
| Choosing in the UI | `src/components/ConflictDialog.tsx` (new) + `src/App.tsx` | Dialog + queue wiring |

No Rust changes: every command the feature needs already exists
(`get_note`, `put_note`, `get_raw`, `put_raw`) as do the server routes
(`GET`/`PUT` `/api/note` and `/api/raw`).

---

## Design

### 1. The pure verdict — `src/lib/conflict.ts` (new)

```ts
// Reconciling one resource's local copy with the server's, with no stored base
// to compare against. Pure (two strings in, one verdict out), mirroring
// lib/noteSync.ts so the meaning has a single, testable home.
//
//   "in-sync"      — the two copies are identical; nothing to do.
//   "adopt-server" — they differ but the local copy is empty, so there is no
//                    local work to lose; take the server copy silently.
//   "conflict"     — they differ and the local copy is non-empty; the user
//                    (or the configured strategy) must choose a winner.
export type ConflictVerdict = "in-sync" | "adopt-server" | "conflict";

export function classifyConflict(local: string, server: string): ConflictVerdict {
  if (local === server) return "in-sync";
  if (local === "") return "adopt-server";
  return "conflict";
}
```

The empty-local case matters: a fresh install (or a never-used local file)
connecting to a populated server must not nag the user with a conflict dialog —
there is nothing local to protect. Both local reads (`get_note`, `get_raw`)
return `""` for a missing/empty file, so the check is exact.

We deliberately treat *any* non-empty difference as a conflict. There is no
stored common base on the sync path (unlike the note editor's live reconcile,
which has the last-saved text), so we cannot tell "the server legitimately
advanced" from "the two genuinely diverged". Surfacing the difference and
letting the user decide is the safe choice.

### 2. Strategy setting — `src/settings.ts`

Add a second persisted setting alongside the server URL:

```ts
const STRATEGY_KEY = "ntr.conflictStrategy";
export type ConflictStrategy = "ask" | "server" | "local";

export function getConflictStrategy(): ConflictStrategy {
  const v = localStorage.getItem(STRATEGY_KEY);
  return v === "server" || v === "local" ? v : "ask";
}

export function setConflictStrategy(s: ConflictStrategy): void {
  s === "ask" ? localStorage.removeItem(STRATEGY_KEY) : localStorage.setItem(STRATEGY_KEY, s);
}
```

`"ask"` is the default and is represented by the *absence* of the key (same
convention `setServerUrl` already uses: the default state stores nothing).

### 3. Transport + reconcile — `src/api.ts`

#### Exported types

```ts
export type ConflictResource = "note" | "tasks";
export type ConflictChoice = "server" | "local";

export interface Conflict {
  resource: ConflictResource;
  local: string;
  server: string;
}
```

#### One home for the text transport

The note PUT already builds a `{ method: "PUT", headers: { "Content-Type":
"text/plain" }, body }` init inline (`putNote`), and the note GET already does
`httpFetch(path).then(r => r.text())` (`getNote`). The reconcile path needs the
same two operations for both `/api/note` and `/api/raw`. Rather than repeat that
construction (it would otherwise appear in `getNote`, `putNote`, and four
`CONFLICT_IO` entries — six copies of one transport decision), extract two
private helpers next to `httpFetch`:

```ts
function httpText(path: string): Promise<string> {
  return httpFetch(path).then((r) => r.text());
}

function httpPutText(path: string, text: string): Promise<void> {
  return httpFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: text,
  }).then(() => {});
}
```

`getNote`'s server branch becomes `httpText("/api/note")` and `putNote`'s server
branch becomes `await httpPutText("/api/note", text)` — so the existing
user-write path and the new conflict path provably share one transport, and a
future change (auth header, content-type) has a single home.

#### One I/O table, two callers

Both reconcile and resolve need the same four operations per resource. Define
them once, in terms of the helpers above, so there is a single source of truth
for "where does the note/tasks local and server copy live":

```ts
interface ResourceIO {
  readLocal(): Promise<string>;
  readServer(): Promise<string>;
  writeLocal(text: string): Promise<void>;
  writeServer(text: string): Promise<void>;
}

const CONFLICT_IO: Record<ConflictResource, ResourceIO> = {
  note: {
    readLocal: () => invoke("get_note"),
    readServer: () => httpText("/api/note"),
    writeLocal: (text) => invoke("put_note", { text }),
    writeServer: (text) => httpPutText("/api/note", text),
  },
  tasks: {
    readLocal: () => invoke("get_raw"),
    readServer: () => httpText("/api/raw"),
    writeLocal: (text) => invoke("put_raw", { text }),
    writeServer: (text) => httpPutText("/api/raw", text),
  },
};
```

Using the server's `GET /api/raw` (not the task-list-and-join of task 08) means
the tasks comparison string is the server store's own `raw()` render, which is
byte-for-byte the format the local `get_raw` returns. No join logic, no
trailing-newline bookkeeping on the reconcile path — both sides are the
canonical render, so equal content compares equal.

#### Applying a choice

```ts
function applyChoice(c: Conflict, choice: ConflictChoice): Promise<void> {
  const io = CONFLICT_IO[c.resource];
  return choice === "server" ? io.writeLocal(c.server) : io.writeServer(c.local);
}
```

"Use server" writes the server copy down to the local file; "use local" pushes
the local copy up to the server. Either way both sides end up identical.

#### `reconcileWithServer` (renamed from `syncFromServer`)

`syncFromServer` (task 08) only ever wrote server → local. The function can now
also push local → server, so the one-directional name is no longer honest.
Rename it `reconcileWithServer`. It is one commit old and has exactly one caller
(`App.tsx`) plus its test block.

```ts
// Reconcile the local todo.txt / Note.md with a server's copies. Called on app
// open and after connecting. For each resource: identical copies are left
// alone; a difference with an empty local copy adopts the server silently; a
// real difference is resolved per the configured strategy ("server"/"local"
// auto-apply, "ask" is returned for the UI to prompt). Best-effort: a failure
// on one resource is logged and does not block the other. No-op in local mode.
export async function reconcileWithServer(): Promise<Conflict[]> {
  if (!getServerUrl()) return [];
  const strategy = getConflictStrategy();
  const conflicts: Conflict[] = [];
  for (const resource of ["note", "tasks"] as ConflictResource[]) {
    try {
      const io = CONFLICT_IO[resource];
      const [local, server] = await Promise.all([io.readLocal(), io.readServer()]);
      const verdict = classifyConflict(local, server);
      if (verdict === "in-sync") continue;
      const conflict: Conflict = { resource, local, server };
      if (verdict === "adopt-server") {
        await applyChoice(conflict, "server");
      } else if (strategy === "ask") {
        conflicts.push(conflict);
      } else {
        await applyChoice(conflict, strategy); // "server" | "local"
      }
    } catch (e) {
      console.warn(`reconcile ${resource} failed:`, e);
    }
  }
  return conflicts;
}
```

In the `else` branch `strategy` is narrowed to `"server" | "local"`, which is
exactly `ConflictChoice`, so `applyChoice` type-checks with no cast.

#### `resolveConflict` (new, called by the UI)

```ts
// Apply the user's dialog choice for one conflict. "server" overwrites the
// local file with the server copy; "local" pushes the local copy to the server.
export function resolveConflict(c: Conflict, choice: ConflictChoice): Promise<void> {
  return applyChoice(c, choice);
}
```

`applyChoice` stays private; `resolveConflict` is the public, intention-named
entry the dialog calls.

### 4. The dialog — `src/components/ConflictDialog.tsx` (new)

A native `<dialog>` modal (same pattern as `NoteConflictDialog`), but with
local/server semantics and a non-destructive dismiss. Reuses the existing
`.note-conflict-versions` / `.note-conflict-text` / `.modal-actions` CSS classes
— no new styles.

```ts
import { useEffect, useRef } from "react";
import type { Conflict, ConflictChoice } from "../api";

interface Props {
  conflict: Conflict | null;          // null = closed
  onChoose(choice: ConflictChoice): void;
  onDismiss(): void;                  // Escape / backdrop = leave both sides as-is
}
```

- Title names the resource: `Note` for `"note"`, `Tasks` for `"tasks"`.
- Two `<pre>` columns: "On this device" (`conflict.local`) and "On the server"
  (`conflict.server`).
- Buttons: **Use server** (`onChoose("server")`) and **Use local**
  (`onChoose("local")`, `className="primary"` — keeping the user's own copy is
  the safer-looking default action).
- The native `onClose` event (Escape / backdrop) calls `onDismiss`. Dismiss is
  intentionally non-destructive: it writes nothing, so the two copies stay
  divergent and the user is asked again on the next reconcile. Defaulting to
  either side on dismiss could silently destroy data on the losing side.
- `showModal()`/`close()` are driven by `conflict !== null` via the same
  `useEffect` guard `NoteConflictDialog` uses.

### 5. Wiring — `src/App.tsx`

Replace the fire-and-forget reconcile effect with one that captures the returned
conflicts into a queue, and render a `ConflictDialog` for the head of the queue.

```ts
const [conflicts, setConflicts] = useState<Conflict[]>([]);

useEffect(() => {
  let cancelled = false;
  reconcileWithServer().then((found) => {
    if (!cancelled) setConflicts(found);
  });
  return () => { cancelled = true; };
}, [connectionKey]);

function refreshPanes() {
  todoRef.current?.onTasksChanged();
  noteRef.current?.onNoteChange();
}

async function endConflict(choice: ConflictChoice | null) {
  const [head, ...rest] = conflicts;
  if (choice && head) {
    try {
      await resolveConflict(head, choice);
      refreshPanes(); // a local write may have landed; reload the affected pane
    } catch (e) {
      console.warn("conflict resolution failed:", e);
    }
  }
  setConflicts(rest);
}
```

- `endConflict("server" | "local")` is the choose handler; `endConflict(null)`
  is the dismiss handler.
- Conflicts are handled one at a time (note then tasks): each call pops the head
  and, on a choice, applies it and reloads the panes immediately. Dismiss writes
  nothing and just advances. There is no "is the queue empty" bookkeeping —
  refresh is tied to "a write happened", not to queue position, which keeps the
  wiring a flat pop-and-advance.
- Render: `<ConflictDialog conflict={conflicts[0] ?? null}
  onChoose={endConflict} onDismiss={() => endConflict(null)} />`.

All the *decisions* this feature makes — verdict (`classifyConflict`),
strategy → auto-apply vs. ask (`reconcileWithServer`), which side is written
(`applyChoice`/`resolveConflict`) — live in pure or transport functions that are
unit-tested below. What is left in `App` is declarative React state plus a
flat pop-and-advance, so the untested surface is wiring, not logic (see Tests).

`onSettingsClose` already bumps `connectionKey`, so changing the server URL (or
the strategy, which is read fresh inside `reconcileWithServer`) re-runs the
reconcile.

### 6. Settings UI — `src/components/SettingsModal.tsx`

Add a "Conflict resolution" section after the Data directory section:

```tsx
<h2>Conflict resolution</h2>
<p className="settings-hint">
  When the local files differ from the server on connect.
</p>
<label>
  On conflict
  <select
    value={strategy}
    onChange={(e) => {
      const s = e.target.value as ConflictStrategy;
      setStrategy(s);
      setConflictStrategy(s);
    }}
  >
    <option value="ask">Ask every time</option>
    <option value="server">Always use server</option>
    <option value="local">Always use local</option>
  </select>
</label>
```

- New local state `const [strategy, setStrategy] = useState<ConflictStrategy>("ask")`.
- Seed it from `getConflictStrategy()` in the existing `open` effect (next to
  the `getDataDir()` call).
- The select persists immediately via `setConflictStrategy` (no extra button) —
  it is an independent preference, unlike the URL/path fields that apply on an
  explicit action.

---

## Files changed

| File | Change |
|---|---|
| `src/lib/conflict.ts` | **New.** `ConflictVerdict` + pure `classifyConflict` |
| `src/settings.ts` | Add `ConflictStrategy`, `getConflictStrategy`, `setConflictStrategy` |
| `src/api.ts` | Add `httpText`/`httpPutText` transport helpers and route `getNote`/`putNote` through them; add conflict types, `CONFLICT_IO`, `applyChoice`; rename `syncFromServer` → `reconcileWithServer` (now returns `Conflict[]`); add `resolveConflict` |
| `src/components/ConflictDialog.tsx` | **New.** Local/server choice dialog |
| `src/App.tsx` | Conflict queue state, updated reconcile effect, `endConflict`, render `ConflictDialog`; import rename |
| `src/components/SettingsModal.tsx` | "Conflict resolution" select |

---

## Tests

### `src/lib/conflict.test.ts` (new)

- `classifyConflict("a", "a")` → `"in-sync"`
- `classifyConflict("", "")` → `"in-sync"` (equality is checked first)
- `classifyConflict("", "server text")` → `"adopt-server"`
- `classifyConflict("local text", "server text")` → `"conflict"`

### `src/settings.test.ts` (extend)

- Default strategy is `"ask"` when nothing stored.
- `setConflictStrategy("server")` / `"local"` persist and round-trip via
  `getConflictStrategy`.
- `setConflictStrategy("ask")` removes the key (round-trips back to `"ask"`).
- An unrecognised stored value falls back to `"ask"`.

### `src/api.test.ts` (replace the `syncFromServer` block with `reconcileWithServer`)

`invoke` is mocked per test with `mockImplementation((cmd) => ...)` to return the
local copy for `get_note` / `get_raw`; `fetch` is driven by `makeFetchSeq` in the
order the function reads — `/api/note` then `/api/raw`.

- **Local mode no-op**: clear `ntr.serverUrl`; `reconcileWithServer()` resolves
  to `[]` and `fetch` is not called.
- **In-sync**: local `get_note`/`get_raw` equal the server bodies → returns `[]`;
  `invoke` is not called with `put_note` or `put_raw`.
- **adopt-server (empty local)**: `get_note` → `""`, server note → `"hello"` →
  `put_note` called with `"hello"`; not returned as a conflict.
- **Conflict, strategy "ask"**: local non-empty and differs → returns one
  `Conflict { resource: "note", local, server }`; no write performed.
- **Conflict, strategy "server"**: set `ntr.conflictStrategy = "server"` →
  `put_note` called with the server text; returns `[]`.
- **Conflict, strategy "local"**: set `"local"` → a `PUT` to `/api/note` with the
  local text body; returns `[]`.
- **Best-effort isolation**: make the note `fetch` reject/404 while the tasks
  reads succeed and conflict → the returned array contains only the tasks
  conflict (note failure is swallowed and logged).

- **`resolveConflict`**: for `{ resource: "tasks", ... }`, `"server"` calls
  `invoke("put_raw", { text: server })`; `"local"` issues `PUT /api/raw` with the
  local body.

### `src/components/ConflictDialog.test.tsx` (new)

Mirrors `EditTaskModal.test.tsx`'s `<dialog>` setup (polyfill `showModal`/`close`
in `beforeAll`).

- Renders the resource title and both bodies when `conflict` is non-null.
- "Use server" / "Use local" buttons invoke `onChoose` with the matching choice.
- Firing the dialog `close` event invokes `onDismiss`.

### Not automated

- `App.tsx` pop-and-advance wiring and the `SettingsModal` select: there is no
  `App` test harness and the settings modal has no component tests today
  (consistent with task 08). This is deliberate and bounded: every *decision* the
  feature makes is unit-tested in `conflict.test.ts` (the verdict),
  `api.test.ts` (strategy → auto-apply vs. ask, and which side is written), and
  `ConflictDialog.test.tsx` (the choose/dismiss callbacks fire correctly). What
  remains in `App` is flat array-tail advancement and `useState`/`useEffect`
  glue with no branching logic of its own, so the untested surface carries no
  decision a test could meaningfully pin down. Covered by the manual
  verification below.

---

## Verification

- `npx vitest run` → all existing + new tests pass.
- `npm run build` → TypeScript clean (note the `reconcileWithServer` rename has
  no stale `syncFromServer` references), Vite bundles.
- `cd src-tauri && cargo test` → unchanged (no Rust changes).
- Manual (server running):
  - Edit `todo.txt` locally while disconnected, connect → with default "Ask",
    the dialog appears showing both versions; "Use local" pushes local up to the
    server, "Use server" restores the server copy.
  - Set strategy to "Always use server" → reconnect applies the server copy with
    no dialog; "Always use local" pushes local with no dialog.
  - Fresh/empty local file connecting to a populated server → no dialog (server
    adopted silently).

---

## Non-goals

- The per-mutation `backupNoteLocally` / `backupTasksLocally` helpers (task 07)
  are unchanged. They run after the user's own writes in server mode, where the
  local copy is by definition the value just written — there is no conflict to
  detect there.
- No three-way merge: resolution is whole-file, pick-a-side. Partial/line-level
  merging is out of scope.
- `NoteConflictDialog` (the editor's live file-watch conflict) is untouched;
  it solves a different problem (unsaved editor edits vs. a changed file) and
  keeps its mine/theirs semantics.

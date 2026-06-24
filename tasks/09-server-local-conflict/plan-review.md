# Plan review — 09 server/local conflict

brooks-review (PR Review mode) on `plan.md`, iterated to the 95+ gate.

## Round 1 — 88/100

- 🟡 Knowledge Duplication — the text GET/PUT init was repeated across `getNote`,
  `putNote`, and four `CONFLICT_IO` server entries (six copies of one transport
  decision).
- 🟡 Coverage Illusion — the App conflict-queue orchestration (pop head, ask
  next, refresh-when-empty) was the most stateful new code yet left to manual
  verification only.
- 🟢 Cognitive Overload — `reconcileWithServer` interleaves verdict and strategy.
- 🟢 Accidental Complexity — `ResourceIO` Record borderline indirection
  (judged justified, kept).

## Changes made

- Extracted `httpText(path)` and `httpPutText(path, text)` in `api.ts`; routed
  `getNote`/`putNote` and all `CONFLICT_IO` server ops through them. One home for
  the text transport. (Resolves W1.)
- Simplified App wiring to a flat pop-and-advance: refresh is tied to "a write
  happened", not to queue position; removed the queue-empty conditional. Made
  explicit that every *decision* (verdict, strategy mapping, which side writes)
  lives in unit-tested pure/transport functions, so App holds only decision-free
  glue. (Resolves W2.)

## Round 2 — 99/100

- 🟢 Cognitive Overload (reconcile loop) — left intentionally; extracting a
  `decide()` helper would force a `ConflictStrategy` import into the otherwise
  dependency-free `lib/conflict.ts`, a worse trade.

Gate cleared (99 ≥ 95). Proceeding to implementation.

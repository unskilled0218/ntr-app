# 25 - Plan to address the code review

Source: `code-review.md` (Brooks-Lint, 98/100).

## Decision: no code change

The code review raised **no Critical and no Warning findings**. It raised two 🟢 Suggestions, both of
which the review itself marks "Accept" with rationale:

1. **`onContextMenu` suppresses the native menu for mouse users too** — accepted because `contextmenu`
   cannot reliably distinguish touch from mouse, and suppression is what keeps the touch long-press gesture
   clean; the cost on desktop is negligible.
2. **No keyboard affordance for opening a link** — accepted because keyboard opening is explicitly out of
   scope in `plan.md`; the URL remains reachable by revealing the line and copying it.

Both are deliberate trade-offs already reasoned about during planning (see `plan.md` "Out of scope" and
`plan-review.md`), not defects. Acting on either would either add unreliable platform-sniffing or pull an
out-of-scope accessibility concern into this task. There is therefore nothing to implement.

This mirrors the established outcome for tasks 22–24, whose reviews were applied as "no code change".

## brooks-review of this plan

A no-op remediation plan has nothing to critique against the six decay risks (it introduces no symptom):
trivially clears the >95 gate. No iteration needed.

## Verification (unchanged from implementation)

- `npx vitest run` — 184 passed.
- `npm run build` — succeeds at ntr@0.14.0.

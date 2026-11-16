# Task editing

- [Editing safely](#editing-safely)
- [Due dates](#due-dates)
- [Home Assistant task mapping](#home-assistant-task-mapping)

## Editing safely

Use Add/Edit for task content, project/list selection, and due dates. Cancel saves nothing. If a task changed remotely, review the update and reopen Edit; copy your draft rather than replaying a stale action. Invalid or inconsistent task data is rejected without a write. Follow the reported correction or upgrade the server instead of bypassing validation.

## Due dates

A date-only field preserves an existing datetime's time and fixed offset. Changing its date does not convert timezones or apply daylight-saving rules. `Clear due` or clearing the field removes the whole deadline. Unrelated edits retain it; HA may normalize an equivalent instant.

## Home Assistant task mapping

List membership is routing metadata, not summary text. Native descriptions remain in HA and are distinct from the app's Markdown note. Unknown completion history displays unknown dates rather than invented values; privately retained creation history returns on reopen. Restart or polling outages can invalidate completion-date continuity.

See [HA mapping and limits](../../server/docs/home-assistant.md#task-mapping) and [confirmed moves](server-connection.md#home-assistant-tasks).

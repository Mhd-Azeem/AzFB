# Follow-up reminders

The reminder panel shows exact counts for your assigned overdue and due-today tasks, plus the first three pending reminders with direct lead links. Existing visible-tab polling remains five minutes; completion, creation and rescheduling also refresh the data. There are no push, SMS, background or WhatsApp notification providers. Reminders require the CRM to be open to be seen.

Tasks now offers Mine / Whole workspace scope and Open, Overdue, Due today and Upcoming filters. The summary is calculated across the selected scope, not merely the visible 25-row page. Today includes already-overdue tasks from today, so today and overdue counts can overlap. Upcoming means not overdue and on a later local day. Completed tasks are excluded from summaries. Existing role checks still govern updates, completion and assignment.

Due-time inputs and task labels use the device timezone; timestamps persist as UTC. The browser submits its local calendar-day bounds to tasks/notifications; the server validates them and uses parameterized, workspace-scoped queries. Clients without bounds retain explicit UTC-day behavior. Use Tomorrow at 9 AM when creating a task, or Remind me tomorrow at 9 AM to persistently reschedule an existing task. This changes the task's due time rather than creating another task. Existing saved timestamps are not shifted.

Lead cards show the earliest incomplete task due date for that submission. Account filtering remains enforced by the existing lead listing API. No database migration is needed.

Validation covers local-day bounds, overdue/completed labels, tomorrow scheduling, reminder ownership, task completion exclusion, persisted rescheduling, invalid date/filter rejection, greeting personalization, draft encoding/length limits and no message body in activities. Browser layout, WhatsApp app handoff and actual sending require manual device testing.

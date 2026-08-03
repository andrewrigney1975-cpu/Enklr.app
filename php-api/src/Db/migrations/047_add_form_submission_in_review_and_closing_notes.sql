-- InReviewAt: stamped the instant a task-raised submission's RaisedTask is first assigned to a
-- team member (FormSubmissionService::markInReviewIfTaskAssigned) -- makes "In Review" (Status
-- "inProgress") mean someone actually picked up the raised Task, not just that it was raised.
-- ClosingNotes: a closing summary, set either by the deciding approver (actOnApproval) or
-- transcribed from the raised Task's assignee on completion (resumeIfLinkedTaskDone) -- shown in
-- the Portal's post-completion read-only view alongside the Approval Trail.
ALTER TABLE "FormSubmissions" ADD COLUMN "InReviewAt" timestamptz;
ALTER TABLE "FormSubmissions" ADD COLUMN "ClosingNotes" text;

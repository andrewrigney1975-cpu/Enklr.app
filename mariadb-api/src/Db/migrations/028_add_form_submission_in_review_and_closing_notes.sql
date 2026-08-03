-- Ported from php-api/src/Db/migrations/047_add_form_submission_in_review_and_closing_notes.sql.
-- InReviewAt: stamped the instant a task-raised submission's RaisedTask is first assigned to a
-- team member (FormSubmissionService::markInReviewIfTaskAssigned) -- makes "In Review" (Status
-- "inProgress") mean someone actually picked up the raised Task, not just that it was raised.
-- ClosingNotes: a closing summary, set either by the deciding approver (actOnApproval) or
-- transcribed from the raised Task's assignee on completion (resumeIfLinkedTaskDone).
ALTER TABLE "FormSubmissions" ADD COLUMN "InReviewAt" DATETIME(6) NULL;
ALTER TABLE "FormSubmissions" ADD COLUMN "ClosingNotes" TEXT NULL;

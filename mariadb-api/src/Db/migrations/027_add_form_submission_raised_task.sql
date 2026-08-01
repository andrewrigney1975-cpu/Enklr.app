-- Ported from php-api/src/Db/migrations/046_add_form_submission_raised_task.sql. Links a
-- FormSubmission to the Task a "raiseTaskInPortal" Form Workflow action node raised for it. SET
-- NULL, not RESTRICT/CASCADE — a Task being deleted must never block on or cascade into deleting
-- the FormSubmission that raised it, just orphan the link. Indexed since resumeIfLinkedTaskDone's
-- whole lookup is keyed by this column, run on every task update.
ALTER TABLE "FormSubmissions" ADD COLUMN "RaisedTaskId" CHAR(36) NULL;
ALTER TABLE "FormSubmissions" ADD CONSTRAINT "FK_FormSubmissions_Tasks_RaisedTaskId" FOREIGN KEY ("RaisedTaskId") REFERENCES "Tasks" ("Id") ON DELETE SET NULL;
CREATE INDEX "IX_FormSubmissions_RaisedTaskId" ON "FormSubmissions" ("RaisedTaskId");

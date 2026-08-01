-- Links a FormSubmission to the Task a "raiseTaskInPortal" Form Workflow action node raised for it
-- (Services/FormSubmissionService.php's ExecuteActionNodeAsync/executeActionNode sets this at
-- creation time). SET NULL, not RESTRICT/CASCADE — a Task being deleted must never block on or
-- cascade into deleting the FormSubmission that raised it, just orphan the link. Indexed since
-- resumeIfLinkedTaskDone's whole lookup is keyed by this column, run on every task update.
ALTER TABLE "FormSubmissions" ADD COLUMN "RaisedTaskId" uuid REFERENCES "Tasks" ("Id") ON DELETE SET NULL;
CREATE INDEX "IX_FormSubmissions_RaisedTaskId" ON "FormSubmissions" ("RaisedTaskId");

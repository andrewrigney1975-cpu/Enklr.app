-- Ported from api/Enkl.Api's AddTaskLocalDelete migration. Set true when a browser exports this
-- task's archived content to disk and removes its own local copy to reclaim storage — never
-- cleared back to false. GetProjectDetail (TaskService::fetchTaskDtos) excludes rows with this
-- set, so the row keeps existing here without ever being re-synced down to any browser again.
ALTER TABLE "Tasks" ADD COLUMN "LocalDelete" boolean NOT NULL DEFAULT false;

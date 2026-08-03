<?php

declare(strict_types=1);

namespace Enkl\Api\Controllers;

use Enkl\Api\Db\Database;
use Enkl\Api\Realtime\Broadcaster;
use Enkl\Api\Services\FormSubmissionService;
use Enkl\Api\Services\TaskService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Ported from Controllers/TasksController.cs. */
final class TasksController extends BaseController
{
    private function service(): TaskService
    {
        return new TaskService(Database::connection());
    }

    private function formSubmissions(): FormSubmissionService
    {
        return new FormSubmissionService(Database::connection());
    }

    public function create(Request $request, Response $response, array $args): Response
    {
        $result = $this->service()->create($args['projectId'], $this->body($request));
        if ($result === null) {
            return $this->json($response, ['message' => 'Invalid column.'], 400);
        }
        $this->broadcast($request, $args['projectId'], $result['id'], $result['key'], $result['title'], 'created');
        return $this->json($response, $result);
    }

    public function update(Request $request, Response $response, array $args): Response
    {
        $body = $this->body($request);
        $result = $this->service()->update(
            $args['projectId'],
            $args['taskId'],
            $body,
            $this->callerDisplayName($request)
        );
        if ($result === null) {
            return $this->notFound($response);
        }
        $this->broadcast($request, $args['projectId'], $result['id'], $result['key'], $result['title'], 'updated');
        // Cheap no-op for the overwhelming majority of task updates (an indexed lookup that finds
        // nothing) — only actually does anything when this Task was raised by a Form Workflow
        // "raiseTaskInPortal" action node AND this update just moved it into a Done column. See
        // FormSubmissionService::resumeIfLinkedTaskDone's own doc comment for the full shape.
        // formClosingNotes is not a Task field — it's a pass-through that only matters when this
        // update happens to be the Done-column move for a linked submission (ignored otherwise).
        $this->notifyLinkedFormResumed($args['taskId'], $body['formClosingNotes'] ?? null);
        // Same shape, for the "In Review" transition — only does anything the first time this Task's
        // AssigneeId goes non-null while its linked submission is still 'submitted'.
        try {
            $this->formSubmissions()->markInReviewIfTaskAssigned($args['taskId']);
        } catch (\Throwable) {
            // best-effort, same as notifyLinkedFormResumed
        }
        return $this->json($response, $result);
    }

    /** GET .../tasks/{taskId}/form-link — cheap single-indexed-lookup check the frontend fires only
     * at the moment a Task is about to move into a Done column, to decide whether to show the
     * optional "Add closing notes?" prompt. Deliberately NOT part of the Task's own DTO/the full
     * project-detail graph fetch, which every task on every board load would otherwise pay for. 404
     * (not an empty 200) when unlinked, so the frontend treats "not linked" and "no such task"
     * identically — nothing to prompt for either way. */
    public function formLink(Request $request, Response $response, array $args): Response
    {
        $submissionId = $this->formSubmissions()->getRaisedFromTaskId($args['projectId'], $args['taskId']);
        if ($submissionId === null) {
            return $this->notFound($response);
        }
        return $this->json($response, ['submissionId' => $submissionId]);
    }

    /** Best-effort — a notification failure must never fail the task update itself. Broadcast
     * ownership stays at this controller level (same convention as Portal/Forms controllers) — the
     * service only decides WHO/what to notify. */
    private function notifyLinkedFormResumed(string $taskId, ?string $closingNotes): void
    {
        try {
            $result = $this->formSubmissions()->resumeIfLinkedTaskDone($taskId, $closingNotes);
            $target = $result['decisionNotify'] ?? null;
            if ($target === null) {
                return;
            }
            (new Broadcaster(Database::connection()))->broadcastFormSubmissionDecided(
                $target['userId'], $result['projectId'], $result['submissionId'], $result['formName'] ?? '',
                $target['decision'], $target['displayName'], null
            );
        } catch (\Throwable) {
            // best-effort, see comment above
        }
    }

    public function delete(Request $request, Response $response, array $args): Response
    {
        $service = $this->service();
        // Grab the key/title before deleting so the "X was deleted" toast can still name it.
        $deleted = $service->getTaskSummary($args['projectId'], $args['taskId']);
        if (!$service->delete($args['projectId'], $args['taskId'])) {
            return $this->notFound($response);
        }
        if ($deleted !== null) {
            $this->broadcast($request, $args['projectId'], $deleted['taskId'], $deleted['key'], $deleted['title'], 'deleted');
        }
        return $this->noContent($response);
    }

    /** Best-effort — a notification failure must never fail the mutation itself. */
    private function broadcast(Request $request, string $projectId, string $taskId, string $taskKey, string $title, string $changeType): void
    {
        try {
            $service = $this->service();
            $memberUserIds = $service->getProjectMemberUserIds($projectId);
            $claims = $request->getAttribute('jwtClaims');
            $userId = (string) ($claims->sub ?? '');
            $displayName = $claims->displayName ?? 'Someone';
            $clientSessionId = $request->getHeaderLine('X-Client-Session-Id') ?: null;

            (new Broadcaster(Database::connection()))->broadcastTaskChanged(
                $memberUserIds, $projectId, $taskId, $taskKey, $title, $changeType, $userId, $displayName, $clientSessionId
            );
        } catch (\Throwable) {
            // Notification is best-effort — the mutation already succeeded and its response is already
            // being returned to the caller regardless.
        }
    }
}

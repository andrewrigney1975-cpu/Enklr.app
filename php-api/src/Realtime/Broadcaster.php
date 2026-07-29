<?php

declare(strict_types=1);

namespace Enkl\Api\Realtime;

use PDO;

/**
 * Publishes task-change events via Postgres LISTEN/NOTIFY on channel "task_changed" — the PHP-FPM
 * equivalent of the .NET tier's in-memory SseBroadcaster. Each web worker process is stateless and
 * short-lived, so there is no in-process registry of open connections to write into directly; instead
 * every mutation NOTIFYs Postgres, and every open SSE stream (Controllers/EventsController.php) runs
 * its own dedicated long-lived connection with `LISTEN task_changed` and filters incoming payloads for
 * itself (by memberUserIds/excludeClientSessionId, both embedded in the payload). This is strictly
 * better than the .NET singleton for horizontal scaling: it works correctly across any number of
 * php-fpm workers/hosts, since Postgres itself is the shared backplane.
 */
final class Broadcaster
{
    public function __construct(private readonly PDO $db)
    {
    }

    /**
     * @param string[] $memberUserIds
     */
    public function broadcastTaskChanged(
        array $memberUserIds,
        string $projectId,
        string $taskId,
        string $taskKey,
        string $title,
        string $changeType,
        string $changedByUserId,
        string $changedByDisplayName,
        ?string $excludeClientSessionId
    ): void {
        $payload = json_encode([
            'memberUserIds' => $memberUserIds,
            'excludeClientSessionId' => $excludeClientSessionId,
            'event' => [
                'projectId' => $projectId, 'taskId' => $taskId, 'taskKey' => $taskKey, 'title' => $title,
                'changeType' => $changeType, 'changedByUserId' => $changedByUserId,
                'changedByDisplayName' => $changedByDisplayName,
            ],
        ]);

        // pg_notify's payload is capped at 8000 bytes by Postgres itself, comfortably above anything a
        // single task-changed event can produce (title is capped well below that at the DB layer).
        $stmt = $this->db->prepare('SELECT pg_notify(:channel, :payload)');
        $stmt->execute(['channel' => 'task_changed', 'payload' => $payload]);
    }

    /**
     * @param string[] $channelMemberUserIds
     * @param string[] $mentionedUserIds
     */
    public function broadcastChatMessage(
        array $channelMemberUserIds,
        string $channelId,
        string $messageId,
        string $text,
        string $changeType,
        ?string $authorUserId,
        string $authorName,
        string $dateCreated,
        bool $isDeleted,
        array $mentionedUserIds,
        ?string $excludeClientSessionId
    ): void {
        $payload = json_encode([
            'memberUserIds' => $channelMemberUserIds,
            'excludeClientSessionId' => $excludeClientSessionId,
            'event' => [
                'channelId' => $channelId, 'messageId' => $messageId, 'text' => $text,
                'changeType' => $changeType, 'authorUserId' => $authorUserId, 'authorName' => $authorName,
                'dateCreated' => $dateCreated, 'isDeleted' => $isDeleted, 'mentionedUserIds' => $mentionedUserIds,
            ],
        ]);

        $stmt = $this->db->prepare('SELECT pg_notify(:channel, :payload)');
        $stmt->execute(['channel' => 'chat_message', 'payload' => $payload]);
    }

    /**
     * @param string[] $channelMemberUserIds
     * @param array<int, array{emoji: string, count: int, reactedByMe: bool, userNames: string[]}> $reactions
     */
    public function broadcastChatReaction(
        array $channelMemberUserIds,
        string $channelId,
        string $messageId,
        array $reactions,
        ?string $excludeClientSessionId
    ): void {
        $payload = json_encode([
            'memberUserIds' => $channelMemberUserIds,
            'excludeClientSessionId' => $excludeClientSessionId,
            'event' => ['channelId' => $channelId, 'messageId' => $messageId, 'reactions' => $reactions],
        ]);

        $stmt = $this->db->prepare('SELECT pg_notify(:channel, :payload)');
        $stmt->execute(['channel' => 'chat_reaction', 'payload' => $payload]);
    }

    /** Single named-user target (memberUserIds is a one-element array) — no excludeClientSessionId,
     * unlike every broadcast above: the acting approver/author and the notified user are always two
     * different people here, so there's no "own tab already knows" case to exclude. */
    public function broadcastFormActionRequired(string $targetUserId, string $projectId, string $submissionId, string $formName): void
    {
        $payload = json_encode([
            'memberUserIds' => [$targetUserId],
            'excludeClientSessionId' => null,
            'event' => [
                'projectId' => $projectId, 'submissionId' => $submissionId, 'formName' => $formName,
                'timestamp' => gmdate('Y-m-d\TH:i:s\Z'),
            ],
        ]);

        $stmt = $this->db->prepare('SELECT pg_notify(:channel, :payload)');
        $stmt->execute(['channel' => 'form_action_required', 'payload' => $payload]);
    }

    /** Single named-user target: the ORIGINAL SUBMITTER, always and unconditionally (unlike
     * broadcastFormActionRequired's gate-satisfaction-dependent targeting) — a final decision
     * (approved or rejected) has exactly one unambiguous interested party. No excludeClientSessionId,
     * same reasoning as above. FormName travels alongside Decision specifically so the toast reads
     * as "X was approved/rejected" rather than a bare result with no context. */
    public function broadcastFormSubmissionDecided(
        string $targetUserId,
        string $projectId,
        string $submissionId,
        string $formName,
        string $decision,
        string $actedByDisplayName,
        ?string $comment
    ): void {
        $payload = json_encode([
            'memberUserIds' => [$targetUserId],
            'excludeClientSessionId' => null,
            'event' => [
                'projectId' => $projectId, 'submissionId' => $submissionId, 'formName' => $formName,
                'decision' => $decision, 'actedByDisplayName' => $actedByDisplayName, 'comment' => $comment,
                'timestamp' => gmdate('Y-m-d\TH:i:s\Z'),
            ],
        ]);

        $stmt = $this->db->prepare('SELECT pg_notify(:channel, :payload)');
        $stmt->execute(['channel' => 'form_submission_decided', 'payload' => $payload]);
    }

    /**
     * @param string[] $participantUserIds
     */
    public function broadcastWhiteboardParticipant(
        array $participantUserIds,
        string $sessionId,
        string $userId,
        string $displayName,
        string $changeType,
        ?string $excludeClientSessionId
    ): void {
        $payload = json_encode([
            'memberUserIds' => $participantUserIds,
            'excludeClientSessionId' => $excludeClientSessionId,
            'event' => ['sessionId' => $sessionId, 'userId' => $userId, 'displayName' => $displayName, 'changeType' => $changeType],
        ]);

        $stmt = $this->db->prepare('SELECT pg_notify(:channel, :payload)');
        $stmt->execute(['channel' => 'whiteboard_participant_changed', 'payload' => $payload]);
    }

    /**
     * @param string[] $participantUserIds
     * @param array{id: string, elementType: string, elementJson: string, createdByUserId: string, createdAt: string} $element
     */
    public function broadcastWhiteboardElement(
        array $participantUserIds,
        string $sessionId,
        array $element,
        string $changeType,
        ?string $excludeClientSessionId
    ): void {
        $payload = json_encode([
            'memberUserIds' => $participantUserIds,
            'excludeClientSessionId' => $excludeClientSessionId,
            'event' => ['sessionId' => $sessionId, 'element' => $element, 'changeType' => $changeType],
        ]);

        $stmt = $this->db->prepare('SELECT pg_notify(:channel, :payload)');
        $stmt->execute(['channel' => 'whiteboard_element_changed', 'payload' => $payload]);
    }

    /** No excludeClientSessionId — the closing tab navigates away via its own HTTP response, not
     * this broadcast, so every one of the host's own tabs still needs the event too.
     *
     * @param string[] $participantUserIds
     */
    public function broadcastWhiteboardSessionClosed(array $participantUserIds, string $sessionId): void
    {
        $payload = json_encode([
            'memberUserIds' => $participantUserIds,
            'excludeClientSessionId' => null,
            'event' => ['sessionId' => $sessionId],
        ]);

        $stmt = $this->db->prepare('SELECT pg_notify(:channel, :payload)');
        $stmt->execute(['channel' => 'whiteboard_session_closed', 'payload' => $payload]);
    }

    /** Ephemeral, not persisted anywhere (unlike every other broadcast here, which mirrors a
     * durable DB write) — a cursor position is purely transient. .NET/php-api tiers only; no
     * MariaDB equivalent exists at all. X/Y are in the frontend's fixed 1600x900 SVG viewBox
     * coordinate space, not raw pixels.
     *
     * @param string[] $participantUserIds
     */
    public function broadcastWhiteboardCursorMoved(
        array $participantUserIds,
        string $sessionId,
        string $userId,
        string $displayName,
        float $x,
        float $y
    ): void {
        $payload = json_encode([
            'memberUserIds' => $participantUserIds,
            'excludeClientSessionId' => null,
            'event' => ['sessionId' => $sessionId, 'userId' => $userId, 'displayName' => $displayName, 'x' => $x, 'y' => $y],
        ]);

        $stmt = $this->db->prepare('SELECT pg_notify(:channel, :payload)');
        $stmt->execute(['channel' => 'whiteboard_cursor_moved', 'payload' => $payload]);
    }
}

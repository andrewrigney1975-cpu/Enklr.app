<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Support\SqlDateTime;
use Enkl\Api\Support\Uuid;
use PDO;

/**
 * Ported from Services/WhiteboardService.cs (php-api's own port is the direct template — see that
 * file's comments for the "why" behind each piece). Org-wide collaborative whiteboard sessions, no
 * ProjectMember concept applies. Every lookup re-derives the session from the caller's own
 * OrganisationId (never trusted from the client) and, for host-only actions, the caller's own
 * UserId against the session's stored HostUserId. A wrong join code and a right code for a
 * different org's session return the identical "not found" (no enumeration oracle).
 *
 * MariaDB-port notes (mariadb-api/CLAUDE.md §4): boolean binds use (int), never a raw PHP bool or
 * Postgres-style 't'/'f' literal (§4.7); timestamps bound via SqlDateTime::now() rather than
 * gmdate()'s ISO-8601-with-"T"/"Z" form, which MariaDB's DATETIME columns reject (§4.6); the
 * Postgres-only `UPDATE t SET ... FROM other WHERE ...` shape becomes a standard multi-table
 * `UPDATE t JOIN other ON ... SET ...` (see ChatService::setChannelMuted's own port for the same
 * substitution).
 */
final class WhiteboardService
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function createSession(string $organisationId, string $callerUserId, ?string $title): array
    {
        $joinCode = $this->generateUniqueOpenJoinCode();
        $sessionId = Uuid::v4();
        $dateCreated = SqlDateTime::now();
        $trimmedTitle = $title !== null && trim($title) !== '' ? trim($title) : null;

        $this->db->beginTransaction();
        try {
            $this->db->prepare(
                'INSERT INTO "WhiteboardSessions" ("Id", "OrganisationId", "HostUserId", "JoinCode", "Title", "Status", "IsSaved", "CreatedAt")
                 VALUES (:id, :orgId, :hostId, :code, :title, \'open\', :saved, :created)'
            )->execute([
                'id' => $sessionId, 'orgId' => $organisationId, 'hostId' => $callerUserId,
                'code' => $joinCode, 'title' => $trimmedTitle, 'saved' => 0, 'created' => $dateCreated,
            ]);
            $this->db->prepare(
                'INSERT INTO "WhiteboardParticipants" ("Id", "SessionId", "UserId", "JoinedAt") VALUES (:id, :sid, :uid, :joined)'
            )->execute(['id' => Uuid::v4(), 'sid' => $sessionId, 'uid' => $callerUserId, 'joined' => $dateCreated]);
            $this->db->commit();
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }

        $this->cleanupExpiredUnsavedSessionsOpportunistically();
        return $this->buildStateDto($sessionId, $callerUserId);
    }

    /** "Scratch until saved" — a session closed with IsSaved still false gets purged after a short
     * grace window (1 hour), same opportunistic 1-in-20-chance-on-write pattern already used by
     * this tier's own Events outbox pruning (Realtime/Broadcaster.php). WhiteboardElements/
     * WhiteboardParticipants cascade-delete with their parent session (ON DELETE CASCADE, see the
     * migration), so this is a single bulk delete, not a fan-out. MariaDB port: Postgres's
     * `interval '1 hour'` literal syntax isn't valid here — MariaDB uses the keyword form
     * `INTERVAL 1 HOUR`, same substitution as ChatService::onlineUserIds. */
    private function cleanupExpiredUnsavedSessionsOpportunistically(): void
    {
        if (random_int(1, 20) !== 1) {
            return;
        }

        $this->db->exec('DELETE FROM "WhiteboardSessions" WHERE "Status" = \'closed\' AND "IsSaved" = 0 AND "ClosedAt" < now() - INTERVAL 1 HOUR');
    }

    /**
     * Resolves a join code to a session (must be open, must belong to the caller's own org) and
     * creates/reactivates the caller's participant row. Returns null for a wrong code OR a right
     * code belonging to a different org OR a closed session — all three indistinguishable, deliberately.
     *
     * @return array{state: array, participantUserIds: string[]}|null
     */
    public function joinSession(string $organisationId, string $callerUserId, string $joinCode): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT "Id" FROM "WhiteboardSessions" WHERE "JoinCode" = :code AND "OrganisationId" = :orgId AND "Status" = \'open\''
        );
        $stmt->execute(['code' => $joinCode, 'orgId' => $organisationId]);
        $sessionId = $stmt->fetchColumn();
        if ($sessionId === false) {
            return null;
        }

        $dateNow = SqlDateTime::now();
        $existing = $this->db->prepare('SELECT "Id", "LeftAt" FROM "WhiteboardParticipants" WHERE "SessionId" = :sid AND "UserId" = :uid');
        $existing->execute(['sid' => $sessionId, 'uid' => $callerUserId]);
        $participant = $existing->fetch();

        if ($participant === false) {
            $this->db->prepare(
                'INSERT INTO "WhiteboardParticipants" ("Id", "SessionId", "UserId", "JoinedAt") VALUES (:id, :sid, :uid, :joined)'
            )->execute(['id' => Uuid::v4(), 'sid' => $sessionId, 'uid' => $callerUserId, 'joined' => $dateNow]);
        } elseif ($participant['LeftAt'] !== null) {
            $this->db->prepare(
                'UPDATE "WhiteboardParticipants" SET "LeftAt" = NULL, "JoinedAt" = :joined WHERE "Id" = :id'
            )->execute(['joined' => $dateNow, 'id' => $participant['Id']]);
        }

        // Includes the caller's own userId — broadcasting only needs to skip the ORIGINATING TAB
        // (excludeClientSessionId, applied by the controller), not the whole user, so a second tab
        // of the same joining user still gets notified. Same convention as ChatService's own
        // broadcastChatMessage, which targets the full channel membership including the sender.
        $participantsStmt = $this->db->prepare(
            'SELECT "UserId" FROM "WhiteboardParticipants" WHERE "SessionId" = :sid AND "LeftAt" IS NULL'
        );
        $participantsStmt->execute(['sid' => $sessionId]);
        $participantUserIds = array_column($participantsStmt->fetchAll(), 'UserId');

        return ['state' => $this->buildStateDto((string) $sessionId, $callerUserId), 'participantUserIds' => $participantUserIds];
    }

    /** Current state for a resync — the caller must be a currently-present participant (LeftAt IS
     * NULL); a former participant or a stranger gets the same null a wrong session id would, no oracle. */
    public function getState(string $organisationId, string $callerUserId, string $sessionId): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT p."Id" FROM "WhiteboardParticipants" p
             JOIN "WhiteboardSessions" s ON s."Id" = p."SessionId"
             WHERE p."SessionId" = :sid AND p."UserId" = :uid AND p."LeftAt" IS NULL AND s."OrganisationId" = :orgId'
        );
        $stmt->execute(['sid' => $sessionId, 'uid' => $callerUserId, 'orgId' => $organisationId]);
        if ($stmt->fetchColumn() === false) {
            return null;
        }

        return $this->buildStateDto($sessionId, $callerUserId);
    }

    /** @return string[]|null Remaining currently-present participant user ids, or null if the
     * caller wasn't a current participant. */
    public function leaveSession(string $organisationId, string $callerUserId, string $sessionId): ?array
    {
        // MariaDB multi-table UPDATE (Postgres's own `UPDATE ... FROM ...` has no direct equivalent
        // here) — same substitution as ChatService::setChannelMuted's own port.
        $stmt = $this->db->prepare(
            'UPDATE "WhiteboardParticipants" p
             JOIN "WhiteboardSessions" s ON s."Id" = p."SessionId"
             SET p."LeftAt" = :left
             WHERE p."SessionId" = :sid AND p."UserId" = :uid AND p."LeftAt" IS NULL AND s."OrganisationId" = :orgId'
        );
        $stmt->execute(['left' => SqlDateTime::now(), 'sid' => $sessionId, 'uid' => $callerUserId, 'orgId' => $organisationId]);
        if ($stmt->rowCount() === 0) {
            return null;
        }

        $remaining = $this->db->prepare('SELECT "UserId" FROM "WhiteboardParticipants" WHERE "SessionId" = :sid AND "LeftAt" IS NULL');
        $remaining->execute(['sid' => $sessionId]);
        return array_column($remaining->fetchAll(), 'UserId');
    }

    /** Host-only. Returns false for "not the host"/"session doesn't exist in your org". */
    public function saveSession(string $organisationId, string $callerUserId, string $sessionId): bool
    {
        $stmt = $this->db->prepare(
            'UPDATE "WhiteboardSessions" SET "IsSaved" = :saved, "SavedAt" = :savedAt
             WHERE "Id" = :sid AND "OrganisationId" = :orgId AND "HostUserId" = :uid'
        );
        $stmt->execute(['saved' => 1, 'savedAt' => SqlDateTime::now(), 'sid' => $sessionId, 'orgId' => $organisationId, 'uid' => $callerUserId]);
        return $stmt->rowCount() > 0;
    }

    /** Host-only. On success, returns the full list of currently-present participant user ids
     * (captured before closing) so the controller can broadcast whiteboard-session-closed to
     * everyone, including participants who never call GET-state again. Returns null if the caller
     * isn't the host of a session in their own org. */
    public function closeSession(string $organisationId, string $callerUserId, string $sessionId): ?array
    {
        $ownershipStmt = $this->db->prepare(
            'SELECT "Id" FROM "WhiteboardSessions" WHERE "Id" = :sid AND "OrganisationId" = :orgId AND "HostUserId" = :uid'
        );
        $ownershipStmt->execute(['sid' => $sessionId, 'orgId' => $organisationId, 'uid' => $callerUserId]);
        if ($ownershipStmt->fetchColumn() === false) {
            return null;
        }

        $participantsStmt = $this->db->prepare('SELECT "UserId" FROM "WhiteboardParticipants" WHERE "SessionId" = :sid AND "LeftAt" IS NULL');
        $participantsStmt->execute(['sid' => $sessionId]);
        $participantUserIds = array_column($participantsStmt->fetchAll(), 'UserId');

        $this->db->prepare(
            'UPDATE "WhiteboardSessions" SET "Status" = \'closed\', "ClosedAt" = :closed WHERE "Id" = :sid'
        )->execute(['closed' => SqlDateTime::now(), 'sid' => $sessionId]);

        return $participantUserIds;
    }

    /** Caller must be a currently-present participant of an open session in their own org — a
     * former participant, a stranger, or a closed session all get the same null.
     *
     * Broadcast target includes the caller's own userId — only the ORIGINATING TAB needs skipping
     * (excludeClientSessionId, applied by the controller), not the whole user, so a second tab of
     * the same acting user still gets the broadcast (same convention as ChatService's own
     * postMessage, which targets the full channel membership including the sender).
     *
     * @return array{element: array, participantUserIds: string[]}|null
     */
    public function addElement(string $organisationId, string $callerUserId, string $sessionId, string $elementType, string $elementJson): ?array
    {
        if (!$this->isCurrentParticipantOfOpenSession($organisationId, $callerUserId, $sessionId)) {
            return null;
        }

        $elementId = Uuid::v4();
        $createdAt = SqlDateTime::now();
        $this->db->prepare(
            'INSERT INTO "WhiteboardElements" ("Id", "SessionId", "CreatedByUserId", "ElementType", "ElementJson", "CreatedAt")
             VALUES (:id, :sid, :uid, :type, :json, :created)'
        )->execute(['id' => $elementId, 'sid' => $sessionId, 'uid' => $callerUserId, 'type' => $elementType, 'json' => $elementJson, 'created' => $createdAt]);

        $participantsStmt = $this->db->prepare('SELECT "UserId" FROM "WhiteboardParticipants" WHERE "SessionId" = :sid AND "LeftAt" IS NULL');
        $participantsStmt->execute(['sid' => $sessionId]);

        return [
            'element' => ['id' => $elementId, 'elementType' => $elementType, 'elementJson' => $elementJson, 'createdByUserId' => $callerUserId, 'createdAt' => $createdAt],
            'participantUserIds' => array_column($participantsStmt->fetchAll(), 'UserId'),
        ];
    }

    /** Move/resize (or any other in-place edit) of an existing element — same
     * currently-present-participant gate as addElement. The new elementJson fully replaces the old
     * one; the server never interprets it (same "opaque JSON blob" convention as addElement).
     *
     * @return array{element: array, participantUserIds: string[]}|null Null if the caller isn't a
     *   current participant of an open session in their own org, or the element doesn't belong to
     *   this session.
     */
    public function updateElement(string $organisationId, string $callerUserId, string $sessionId, string $elementId, string $elementJson): ?array
    {
        if (!$this->isCurrentParticipantOfOpenSession($organisationId, $callerUserId, $sessionId)) {
            return null;
        }

        $stmt = $this->db->prepare(
            'UPDATE "WhiteboardElements" SET "ElementJson" = :json WHERE "Id" = :eid AND "SessionId" = :sid AND "DeletedAt" IS NULL'
        );
        $stmt->execute(['json' => $elementJson, 'eid' => $elementId, 'sid' => $sessionId]);
        if ($stmt->rowCount() === 0) {
            return null;
        }

        $elementStmt = $this->db->prepare(
            'SELECT "Id", "ElementType", "ElementJson", "CreatedByUserId", "CreatedAt" FROM "WhiteboardElements" WHERE "Id" = :eid'
        );
        $elementStmt->execute(['eid' => $elementId]);
        $element = $elementStmt->fetch();

        $participantsStmt = $this->db->prepare('SELECT "UserId" FROM "WhiteboardParticipants" WHERE "SessionId" = :sid AND "LeftAt" IS NULL');
        $participantsStmt->execute(['sid' => $sessionId]);

        return [
            'element' => [
                'id' => $element['Id'], 'elementType' => $element['ElementType'], 'elementJson' => $element['ElementJson'],
                'createdByUserId' => $element['CreatedByUserId'], 'createdAt' => $element['CreatedAt'],
            ],
            'participantUserIds' => array_column($participantsStmt->fetchAll(), 'UserId'),
        ];
    }

    /** Soft-delete (eraser) — same currently-present-participant gate as addElement.
     *
     * @return string[]|null Every currently-present participant's user id (including the caller —
     *   see addElement's own doc comment for why) for broadcast, or null if the caller isn't a
     *   current participant or the element doesn't belong to this session.
     */
    public function removeElement(string $organisationId, string $callerUserId, string $sessionId, string $elementId): ?array
    {
        if (!$this->isCurrentParticipantOfOpenSession($organisationId, $callerUserId, $sessionId)) {
            return null;
        }

        $stmt = $this->db->prepare(
            'UPDATE "WhiteboardElements" SET "DeletedAt" = :deleted WHERE "Id" = :eid AND "SessionId" = :sid AND "DeletedAt" IS NULL'
        );
        $stmt->execute(['deleted' => SqlDateTime::now(), 'eid' => $elementId, 'sid' => $sessionId]);
        if ($stmt->rowCount() === 0) {
            return null;
        }

        $participantsStmt = $this->db->prepare('SELECT "UserId" FROM "WhiteboardParticipants" WHERE "SessionId" = :sid AND "LeftAt" IS NULL');
        $participantsStmt->execute(['sid' => $sessionId]);
        return array_column($participantsStmt->fetchAll(), 'UserId');
    }

    // ---- Helpers ----

    private function isCurrentParticipantOfOpenSession(string $organisationId, string $callerUserId, string $sessionId): bool
    {
        $stmt = $this->db->prepare(
            'SELECT p."Id" FROM "WhiteboardParticipants" p
             JOIN "WhiteboardSessions" s ON s."Id" = p."SessionId"
             WHERE p."SessionId" = :sid AND p."UserId" = :uid AND p."LeftAt" IS NULL AND s."OrganisationId" = :orgId AND s."Status" = \'open\''
        );
        $stmt->execute(['sid' => $sessionId, 'uid' => $callerUserId, 'orgId' => $organisationId]);
        return $stmt->fetchColumn() !== false;
    }

    private function generateUniqueOpenJoinCode(): string
    {
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            $stmt = $this->db->prepare('SELECT 1 FROM "WhiteboardSessions" WHERE "JoinCode" = :code AND "Status" = \'open\'');
            $stmt->execute(['code' => $code]);
            if ($stmt->fetchColumn() === false) {
                return $code;
            }
        }
        throw new \RuntimeException('Could not generate a unique whiteboard join code — too many open sessions.');
    }

    private function buildStateDto(string $sessionId, string $callerUserId): array
    {
        $stmt = $this->db->prepare(
            'SELECT s."Id", s."JoinCode", s."Title", s."Status", s."IsSaved", s."HostUserId", s."CreatedAt", u."DisplayName" AS "HostDisplayName"
             FROM "WhiteboardSessions" s JOIN "Users" u ON u."Id" = s."HostUserId" WHERE s."Id" = :sid'
        );
        $stmt->execute(['sid' => $sessionId]);
        $session = $stmt->fetch();

        $online = $this->onlineUserIds();

        $participantsStmt = $this->db->prepare(
            'SELECT p."UserId", u."DisplayName" FROM "WhiteboardParticipants" p
             JOIN "Users" u ON u."Id" = p."UserId" WHERE p."SessionId" = :sid AND p."LeftAt" IS NULL'
        );
        $participantsStmt->execute(['sid' => $sessionId]);
        $participants = array_map(
            fn (array $p) => [
                'userId' => $p['UserId'], 'displayName' => $p['DisplayName'],
                'isHost' => $p['UserId'] === $session['HostUserId'], 'isOnline' => in_array($p['UserId'], $online, true),
            ],
            $participantsStmt->fetchAll()
        );

        $elementsStmt = $this->db->prepare(
            'SELECT "Id", "ElementType", "ElementJson", "CreatedByUserId", "CreatedAt" FROM "WhiteboardElements"
             WHERE "SessionId" = :sid AND "DeletedAt" IS NULL ORDER BY "CreatedAt"'
        );
        $elementsStmt->execute(['sid' => $sessionId]);
        $elements = array_map(
            fn (array $e) => [
                'id' => $e['Id'], 'elementType' => $e['ElementType'], 'elementJson' => $e['ElementJson'],
                'createdByUserId' => $e['CreatedByUserId'], 'createdAt' => $e['CreatedAt'],
            ],
            $elementsStmt->fetchAll()
        );

        return [
            'id' => $session['Id'], 'joinCode' => $session['JoinCode'], 'title' => $session['Title'],
            'status' => $session['Status'], 'isSaved' => (bool) $session['IsSaved'],
            'isHost' => $session['HostUserId'] === $callerUserId, 'hostUserId' => $session['HostUserId'],
            'hostDisplayName' => $session['HostDisplayName'], 'createdAt' => $session['CreatedAt'],
            'participants' => $participants, 'elements' => $elements,
        ];
    }

    /** @return string[] */
    private function onlineUserIds(): array
    {
        // MariaDB port: Postgres's `interval '25 seconds'` literal isn't valid here — MariaDB uses
        // the keyword form `INTERVAL 25 SECOND`, same substitution as ChatService::onlineUserIds.
        $stmt = $this->db->query('SELECT "UserId" FROM "SsePresence" WHERE "LastSeenAt" > now() - INTERVAL 25 SECOND');
        return array_column($stmt->fetchAll(), 'UserId');
    }
}

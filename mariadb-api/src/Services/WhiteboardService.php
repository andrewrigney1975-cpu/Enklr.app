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

        return $this->buildStateDto($sessionId, $callerUserId);
    }

    /**
     * Resolves a join code to a session (must be open, must belong to the caller's own org) and
     * creates/reactivates the caller's participant row. Returns null for a wrong code OR a right
     * code belonging to a different org OR a closed session — all three indistinguishable, deliberately.
     *
     * @return array{state: array, otherParticipantUserIds: string[]}|null
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

        $othersStmt = $this->db->prepare(
            'SELECT "UserId" FROM "WhiteboardParticipants" WHERE "SessionId" = :sid AND "LeftAt" IS NULL AND "UserId" != :uid'
        );
        $othersStmt->execute(['sid' => $sessionId, 'uid' => $callerUserId]);
        $otherParticipantUserIds = array_column($othersStmt->fetchAll(), 'UserId');

        return ['state' => $this->buildStateDto((string) $sessionId, $callerUserId), 'otherParticipantUserIds' => $otherParticipantUserIds];
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

    // ---- Helpers ----

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

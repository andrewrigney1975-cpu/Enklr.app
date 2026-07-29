<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use PDO;

/**
 * Ported from Services/PortalAccessService.cs. The one shared access predicate for Organisational
 * Portals — independently re-derives whether a user has access to a Portal from its
 * PortalAccessGrants rows, never trusting a client-supplied claim. A Portal with zero grants is
 * invisible to every org user — closed by default.
 */
final class PortalAccessService
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function userHasPortalAccess(string $portalId, string $userId): bool
    {
        $stmt = $this->db->prepare('SELECT "Kind", "Value" FROM "PortalAccessGrants" WHERE "PortalId" = :portalId');
        $stmt->execute(['portalId' => $portalId]);
        $grants = $stmt->fetchAll();
        if (count($grants) === 0) {
            return false;
        }

        $orgTeamIds = [];
        $teamCommitteeIds = [];
        foreach ($grants as $grant) {
            if ($grant['Kind'] === 'namedUser' && $grant['Value'] === $userId) {
                return true;
            }
            if ($grant['Kind'] === 'orgTeam') {
                $orgTeamIds[] = $grant['Value'];
            }
            if ($grant['Kind'] === 'teamCommittee') {
                $teamCommitteeIds[] = $grant['Value'];
            }
        }

        if (count($orgTeamIds) > 0) {
            $placeholders = implode(',', array_map(static fn($i) => ":ot{$i}", array_keys($orgTeamIds)));
            $stmt = $this->db->prepare(
                "SELECT 1 FROM \"OrgTeamMember\" WHERE \"UserId\" = :userId AND \"OrgTeamId\" IN ({$placeholders})"
            );
            $params = ['userId' => $userId];
            foreach ($orgTeamIds as $i => $id) {
                $params["ot{$i}"] = $id;
            }
            $stmt->execute($params);
            if ($stmt->fetch() !== false) {
                return true;
            }
        }

        if (count($teamCommitteeIds) > 0) {
            // TeamCommitteeMembers links to ProjectMemberId, not UserId directly — a user must
            // already be a ProjectMember of whatever project that TeamCommittee belongs to.
            $placeholders = implode(',', array_map(static fn($i) => ":tc{$i}", array_keys($teamCommitteeIds)));
            $stmt = $this->db->prepare(<<<SQL
                SELECT 1 FROM "TeamCommitteeMember" tcm
                JOIN "ProjectMembers" pm ON pm."Id" = tcm."ProjectMemberId"
                WHERE pm."UserId" = :userId AND tcm."TeamCommitteeId" IN ({$placeholders})
            SQL);
            $params = ['userId' => $userId];
            foreach ($teamCommitteeIds as $i => $id) {
                $params["tc{$i}"] = $id;
            }
            $stmt->execute($params);
            if ($stmt->fetch() !== false) {
                return true;
            }
        }

        return false;
    }
}

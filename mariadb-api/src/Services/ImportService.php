<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Auth\UsernameNormalizer;
use Enkl\Api\Validation\ApiValidationException;
use PDO;
use Throwable;

/**
 * Ported from Services/ImportService.cs. Import Centre's bulk-import execution engine (Phase 2:
 * Organisation Users. Phase 4 (this pass): Team Members. Teams & Committees and Portal Q&A land in
 * later phases, each getting their own method here once built). Deliberately its own new service
 * rather than an extension of MigrationService, which wraps its entire import in ONE all-or-nothing
 * transaction around the whole request — this needs the opposite shape: every row gets its OWN
 * transaction, independent of every other row, so one bad row in a 500-row file doesn't sink the
 * other 499.
 *
 * dryRun runs every row for real, through the same entity-creation logic a committed import would
 * use (OrganisationService::createUser / MemberService::createInTransaction+updateInTransaction+
 * setProjectAdmin — the "InTransaction" variants specifically, since PDO has no nested-transaction
 * support and MemberService::create/update each open their own transaction; see MemberService.php's
 * own doc comment on those two methods), so "would this succeed" can never diverge from what
 * actually happens on a real commit — it just always rolls back afterward regardless of outcome,
 * including any dependent rows that creation path might itself have written along the way.
 *
 * **Cross-row reference gotcha, inherent to per-row-transaction dry runs, not a bug**: see
 * Enkl.Api.Tests/ImportServiceTests.cs's own class doc comment on the .NET tier — a Team Member row's
 * optional `reportsTo` naming an earlier, brand-new row's own username will resolve during a real
 * Commit but NOT during a Test Run, since that earlier row's own transaction rolls back before this
 * row's lookup runs.
 */
final class ImportService
{
    public function __construct(private readonly PDO $db, private readonly OrganisationService $organisations, private readonly MemberService $members)
    {
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     * @return array{total: int, succeeded: int, failed: int, results: list<array{row: int, success: bool, message: ?string, data: array<string, mixed>}>}
     */
    public function importOrganisationUsers(string $organisationId, array $rows, bool $dryRun): array
    {
        $results = [];
        $succeeded = 0;
        $failed = 0;

        foreach (array_values($rows) as $index => $row) {
            $rowNumber = $index + 1;
            $this->db->beginTransaction();
            try {
                $username = $this->requireField($row, 'username');
                $displayName = $this->requireField($row, 'displayName');
                $password = $this->requireField($row, 'password');
                $email = $this->optionalField($row, 'email');

                $this->organisations->createUser($organisationId, [
                    'username' => $username,
                    'displayName' => $displayName,
                    'password' => $password,
                    'emailAddress' => $email ?? '',
                ]);

                if ($dryRun) {
                    $this->db->rollBack();
                } else {
                    $this->db->commit();
                }
                $results[] = ['row' => $rowNumber, 'success' => true, 'message' => null, 'data' => $row];
                $succeeded++;
            } catch (Throwable $e) {
                if ($this->db->inTransaction()) {
                    $this->db->rollBack();
                }
                $results[] = ['row' => $rowNumber, 'success' => false, 'message' => $e->getMessage(), 'data' => $row];
                $failed++;
            }
        }

        return ['total' => count($rows), 'succeeded' => $succeeded, 'failed' => $failed, 'results' => $results];
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     * @return array{total: int, succeeded: int, failed: int, results: list<array{row: int, success: bool, message: ?string, data: array<string, mixed>}>}
     */
    public function importTeamMembers(string $organisationId, array $rows, bool $dryRun): array
    {
        $results = [];
        $succeeded = 0;
        $failed = 0;

        foreach (array_values($rows) as $index => $row) {
            $rowNumber = $index + 1;
            $this->db->beginTransaction();
            try {
                $projectKey = $this->requireField($row, 'projectKey');
                $name = $this->requireField($row, 'name');
                $email = $this->optionalField($row, 'email');
                $role = $this->optionalField($row, 'role');
                $allocatedFractionRaw = $this->optionalField($row, 'allocatedFraction');
                $reportsToUsername = $this->optionalField($row, 'reportsTo');
                $isProjectAdminRaw = $this->optionalField($row, 'isProjectAdmin');

                // Re-derived server-side against the CALLER'S OWN org — never trust a client-supplied
                // key as-is (root CLAUDE.md's own cross-org-isolation pattern, applied here to a
                // project KEY instead of an id list). A key in a different org is indistinguishable
                // from one that doesn't exist — same error either way, no enumeration oracle.
                $stmt = $this->db->prepare('SELECT "Id" FROM "Projects" WHERE "Key" = :key AND "OrganisationId" = :org');
                $stmt->execute(['key' => $projectKey, 'org' => $organisationId]);
                $projectId = $stmt->fetchColumn();
                if ($projectId === false) {
                    throw new ApiValidationException("No project with key \"{$projectKey}\" exists in your organisation.");
                }

                $created = $this->members->createInTransaction($projectId, ['name' => $name, 'email' => $email]);
                if ($created === null) {
                    throw new ApiValidationException('Could not create the team member.');
                }

                $allocatedFraction = null;
                if ($allocatedFractionRaw !== null) {
                    if (!is_numeric($allocatedFractionRaw) || (string) (int) $allocatedFractionRaw !== $allocatedFractionRaw) {
                        throw new ApiValidationException("\"allocatedFraction\" must be a whole number, got \"{$allocatedFractionRaw}\".");
                    }
                    $allocatedFraction = (int) $allocatedFractionRaw;
                }

                // Resolved by username WITHIN this same project, then handed to update() as a real
                // ProjectMember id — deliberately stricter than update()'s own interactive-UI behavior
                // (which silently falls back to "no manager" for an unresolvable id, since a real
                // dropdown can't offer an invalid option in the first place). A free-text CSV/JSON
                // column has no such guarantee, so an unresolvable reportsTo is a genuine, reportable
                // row error here, not something to quietly drop.
                $reportsToId = null;
                if ($reportsToUsername !== null) {
                    $normalizedReportsTo = UsernameNormalizer::normalize($reportsToUsername);
                    $stmt = $this->db->prepare(
                        'SELECT m."Id" FROM "ProjectMembers" m JOIN "Users" u ON u."Id" = m."UserId" WHERE m."ProjectId" = :pid AND u."NormalizedUsername" = :n'
                    );
                    $stmt->execute(['pid' => $projectId, 'n' => $normalizedReportsTo]);
                    $reportsToId = $stmt->fetchColumn();
                    if ($reportsToId === false) {
                        throw new ApiValidationException("\"reportsTo\" username \"{$reportsToUsername}\" is not a member of project \"{$projectKey}\".");
                    }
                }

                if ($role !== null || $allocatedFraction !== null || $reportsToId !== null) {
                    $this->members->updateInTransaction($projectId, $created['id'], [
                        'name' => $name, 'role' => $role, 'allocatedFraction' => $allocatedFraction, 'reportsToId' => $reportsToId,
                    ]);
                }

                $isProjectAdmin = $isProjectAdminRaw !== null && (strcasecmp($isProjectAdminRaw, 'true') === 0 || $isProjectAdminRaw === '1');
                if ($isProjectAdmin) {
                    $this->members->setProjectAdmin($projectId, $created['id'], true);
                }

                if ($dryRun) {
                    $this->db->rollBack();
                } else {
                    $this->db->commit();
                }
                $results[] = ['row' => $rowNumber, 'success' => true, 'message' => null, 'data' => $row];
                $succeeded++;
            } catch (Throwable $e) {
                if ($this->db->inTransaction()) {
                    $this->db->rollBack();
                }
                $results[] = ['row' => $rowNumber, 'success' => false, 'message' => $e->getMessage(), 'data' => $row];
                $failed++;
            }
        }

        return ['total' => count($rows), 'succeeded' => $succeeded, 'failed' => $failed, 'results' => $results];
    }

    /** @param array<string, mixed> $row */
    private function requireField(array $row, string $field): string
    {
        $value = isset($row[$field]) ? trim((string) $row[$field]) : '';
        if ($value === '') {
            throw new ApiValidationException("\"{$field}\" is required.");
        }
        return $value;
    }

    /** @param array<string, mixed> $row */
    private function optionalField(array $row, string $field): ?string
    {
        $value = isset($row[$field]) ? trim((string) $row[$field]) : '';
        return $value === '' ? null : $value;
    }
}

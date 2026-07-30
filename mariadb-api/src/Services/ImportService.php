<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Validation\ApiValidationException;
use PDO;
use Throwable;

/**
 * Ported from Services/ImportService.cs. Import Centre's bulk-import execution engine (Phase 2:
 * Organisation Users only — Team Members, Teams & Committees, and Portal Q&A land in later phases,
 * each getting their own method here once built). Deliberately its own new service rather than an
 * extension of MigrationService, which wraps its entire import in ONE all-or-nothing transaction
 * around the whole request — this needs the opposite shape: every row gets its OWN transaction,
 * independent of every other row, so one bad row in a 500-row file doesn't sink the other 499.
 *
 * dryRun runs every row for real, through the exact same entity-creation service a committed import
 * would use (OrganisationService::createUser here), so "would this succeed" can never diverge from
 * what actually happens on a real commit — it just always rolls back afterward regardless of
 * outcome, including any dependent rows that creation path might itself have written along the way.
 */
final class ImportService
{
    public function __construct(private readonly PDO $db, private readonly OrganisationService $organisations)
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

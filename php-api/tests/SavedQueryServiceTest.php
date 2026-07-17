<?php

declare(strict_types=1);

namespace Enkl\Api\Tests;

use Enkl\Api\Db\Database;
use Enkl\Api\Services\SavedQueryService;
use Enkl\Api\Support\Uuid;
use Enkl\Api\Tests\Support\TestDataHelper;
use PDO;
use PHPUnit\Framework\TestCase;

/**
 * Direct-service-call coverage for SavedQueryService — Create + Delete only, no Update (mirrors
 * api/Enkl.Api.Tests/SavedQueryServiceTests.cs). No transaction wrapping needed (single-statement
 * writes only, no junction tables).
 */
final class SavedQueryServiceTest extends TestCase
{
    private static PDO $db;
    private static SavedQueryService $savedQueries;

    public static function setUpBeforeClass(): void
    {
        self::$db = Database::connection();
        self::$savedQueries = new SavedQueryService(self::$db);
    }

    public function testCreateAndDeleteRoundTrip(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('user'));
        $projectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'));

        $created = self::$savedQueries->create($projectId, ['name' => 'All tasks', 'sql' => 'SELECT * FROM tasks']);
        self::assertNotNull($created);
        self::assertSame('All tasks', $created['name']);
        self::assertSame('SELECT * FROM tasks', $created['sql']);
        $queryId = $created['id'];

        $stmt = self::$db->prepare('SELECT "ProjectId", "Name" FROM "SavedQueries" WHERE "Id" = :id');
        $stmt->execute(['id' => $queryId]);
        $row = $stmt->fetch();
        self::assertSame($projectId, $row['ProjectId']);
        self::assertSame('All tasks', $row['Name']);

        $deleted = self::$savedQueries->delete($projectId, $queryId);
        self::assertTrue($deleted);

        $stmt = self::$db->prepare('SELECT 1 FROM "SavedQueries" WHERE "Id" = :id');
        $stmt->execute(['id' => $queryId]);
        self::assertFalse($stmt->fetch());
    }

    public function testCreateReturnsNullForNonexistentProject(): void
    {
        $result = self::$savedQueries->create(Uuid::v4(), ['name' => 'Name', 'sql' => 'SELECT 1']);
        self::assertNull($result);
    }

    public function testDeleteReturnsFalseForWrongProjectOrMissingId(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('user'));
        $projectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'));
        $otherProjectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'));
        $created = self::$savedQueries->create($projectId, ['name' => 'Temp', 'sql' => 'SELECT 1']);

        self::assertFalse(self::$savedQueries->delete($otherProjectId, $created['id']));
        self::assertFalse(self::$savedQueries->delete($projectId, Uuid::v4()));
    }
}

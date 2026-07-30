<?php

declare(strict_types=1);

namespace Enkl\Api\Tests;

use Enkl\Api\Auth\UsernameNormalizer;
use Enkl\Api\Db\Database;
use Enkl\Api\Services\ImportService;
use Enkl\Api\Services\OrganisationService;
use Enkl\Api\Tests\Support\TestDataHelper;
use PDO;
use PHPUnit\Framework\TestCase;

/**
 * Ported from Enkl.Api.Tests/ImportServiceTests.cs. Direct-service-call coverage for
 * ImportService::importOrganisationUsers — Import Centre Phase 2's first entity. Focuses on the two
 * things this service adds over plain OrganisationService::createUser: per-row transactional
 * independence (one bad row doesn't sink the others) and dryRun's "runs for real, always rolls
 * back" semantics.
 */
final class ImportServiceTest extends TestCase
{
    private static PDO $db;
    private static ImportService $import;

    public static function setUpBeforeClass(): void
    {
        self::$db = Database::connection();
        self::$import = new ImportService(self::$db, new OrganisationService(self::$db));
    }

    /** @return array<string, string> */
    private static function userRow(string $username, ?string $email = null): array
    {
        return [
            'username' => $username,
            'displayName' => 'Imported ' . $username,
            'password' => 'ImportedPass1!',
            'email' => $email ?? ($username . '@example.com'),
        ];
    }

    public function testCommitValidRowActuallyPersistsTheUser(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $username = TestDataHelper::unique('importeduser');

        $result = self::$import->importOrganisationUsers($seeded['orgId'], [self::userRow($username)], false);

        self::assertSame(1, $result['total']);
        self::assertSame(1, $result['succeeded']);
        self::assertSame(0, $result['failed']);
        self::assertTrue($result['results'][0]['success']);
        self::assertSame(1, $result['results'][0]['row']);

        $stmt = self::$db->prepare('SELECT "OrganisationId" FROM "Users" WHERE "NormalizedUsername" = :n');
        $stmt->execute(['n' => UsernameNormalizer::normalize($username)]);
        $row = $stmt->fetch();
        self::assertNotFalse($row);
        self::assertSame($seeded['orgId'], $row['OrganisationId']);
    }

    public function testDryRunValidRowReportsSuccessButDoesNotPersistAnything(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $username = TestDataHelper::unique('dryrunuser');

        $result = self::$import->importOrganisationUsers($seeded['orgId'], [self::userRow($username)], true);

        self::assertSame(1, $result['succeeded']);
        self::assertTrue($result['results'][0]['success']);

        $stmt = self::$db->prepare('SELECT 1 FROM "Users" WHERE "NormalizedUsername" = :n');
        $stmt->execute(['n' => UsernameNormalizer::normalize($username)]);
        self::assertFalse($stmt->fetch());
    }

    public function testMissingRequiredFieldFailsThatRowWithAClearMessage(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $row = self::userRow(TestDataHelper::unique('nopassuser'));
        unset($row['password']);

        $result = self::$import->importOrganisationUsers($seeded['orgId'], [$row], false);

        self::assertSame(0, $result['succeeded']);
        self::assertSame(1, $result['failed']);
        self::assertFalse($result['results'][0]['success']);
        self::assertStringContainsString('password', $result['results'][0]['message']);
    }

    public function testOneBadRowAmongGoodOnesDoesNotSinkTheOthers(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $good1 = TestDataHelper::unique('gooduser1');
        $good2 = TestDataHelper::unique('gooduser2');
        $bad = self::userRow(TestDataHelper::unique('badrowuser'));
        unset($bad['password']);

        $result = self::$import->importOrganisationUsers($seeded['orgId'], [self::userRow($good1), $bad, self::userRow($good2)], false);

        self::assertSame(3, $result['total']);
        self::assertSame(2, $result['succeeded']);
        self::assertSame(1, $result['failed']);
        self::assertTrue($result['results'][0]['success']);
        self::assertFalse($result['results'][1]['success']);
        self::assertTrue($result['results'][2]['success']);

        foreach ([$good1, $good2] as $username) {
            $stmt = self::$db->prepare('SELECT 1 FROM "Users" WHERE "NormalizedUsername" = :n');
            $stmt->execute(['n' => UsernameNormalizer::normalize($username)]);
            self::assertNotFalse($stmt->fetch());
        }
    }

    public function testDuplicateUsernameWithinSameBatchSecondRowFailsFirstRowStillCommitted(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $username = TestDataHelper::unique('dupeuser');

        $result = self::$import->importOrganisationUsers($seeded['orgId'], [self::userRow($username), self::userRow($username)], false);

        self::assertSame(1, $result['succeeded']);
        self::assertSame(1, $result['failed']);
        self::assertTrue($result['results'][0]['success']);
        self::assertFalse($result['results'][1]['success']);
        self::assertStringContainsString('already taken', $result['results'][1]['message']);
    }
}

<?php

declare(strict_types=1);

namespace Enkl\Api\Tests;

use Enkl\Api\Auth\UsernameNormalizer;
use Enkl\Api\Db\Database;
use Enkl\Api\Services\ImportService;
use Enkl\Api\Services\MemberService;
use Enkl\Api\Services\OrganisationService;
use Enkl\Api\Tests\Support\TestDataHelper;
use PDO;
use PHPUnit\Framework\TestCase;

/**
 * Ported from Enkl.Api.Tests/ImportServiceTests.cs. Direct-service-call coverage for
 * ImportService::importOrganisationUsers (Phase 2) and ::importTeamMembers (Phase 4). Focuses on
 * the things these methods add over the plain OrganisationService::createUser / MemberService::
 * createInTransaction+updateInTransaction+setProjectAdmin they call into: per-row transactional
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
        self::$import = new ImportService(self::$db, new OrganisationService(self::$db), new MemberService(self::$db));
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

    // ── Team Members (Phase 4) ─────────────────────────────────────────────────────────────────

    /** @return array<string, string> */
    private static function memberRow(string $projectKey, string $name, ?array $extra = null): array
    {
        $row = ['projectKey' => $projectKey, 'name' => $name, 'email' => UsernameNormalizer::normalize($name) . '@example.com'];
        return $extra !== null ? array_merge($row, $extra) : $row;
    }

    public function testImportTeamMembersCommitValidRowActuallyAddsTheMember(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $projectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'), $seeded['userId']);
        $stmt = self::$db->prepare('SELECT "Key" FROM "Projects" WHERE "Id" = :id');
        $stmt->execute(['id' => $projectId]);
        $projectKey = $stmt->fetchColumn();

        $result = self::$import->importTeamMembers($seeded['orgId'], [self::memberRow($projectKey, 'Imported Member')], false);

        self::assertSame(1, $result['succeeded']);
        $stmt = self::$db->prepare('SELECT 1 FROM "ProjectMembers" m JOIN "Users" u ON u."Id" = m."UserId" WHERE m."ProjectId" = :pid AND u."DisplayName" = :name');
        $stmt->execute(['pid' => $projectId, 'name' => 'Imported Member']);
        self::assertNotFalse($stmt->fetch());
    }

    public function testImportTeamMembersUnknownProjectKeyFailsThatRow(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));

        $result = self::$import->importTeamMembers($seeded['orgId'], [self::memberRow('NOSUCHKEY', 'Someone')], false);

        self::assertSame(0, $result['succeeded']);
        self::assertStringContainsString('No project with key', $result['results'][0]['message']);
    }

    public function testImportTeamMembersProjectKeyBelongingToAnotherOrgFailsWithTheSameNotFoundMessage(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $otherSeeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('otherOrg'), TestDataHelper::unique('otherAdmin'));
        $otherProjectId = TestDataHelper::seedProject(self::$db, $otherSeeded['orgId'], TestDataHelper::unique('P'), $otherSeeded['userId']);
        $stmt = self::$db->prepare('SELECT "Key" FROM "Projects" WHERE "Id" = :id');
        $stmt->execute(['id' => $otherProjectId]);
        $otherProjectKey = $stmt->fetchColumn();

        $result = self::$import->importTeamMembers($seeded['orgId'], [self::memberRow($otherProjectKey, 'Someone')], false);

        self::assertSame(0, $result['succeeded']);
        self::assertStringContainsString('No project with key', $result['results'][0]['message']);
    }

    public function testImportTeamMembersSetsRoleAllocatedFractionAndIsProjectAdmin(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $projectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'), $seeded['userId']);
        $stmt = self::$db->prepare('SELECT "Key" FROM "Projects" WHERE "Id" = :id');
        $stmt->execute(['id' => $projectId]);
        $projectKey = $stmt->fetchColumn();

        $result = self::$import->importTeamMembers($seeded['orgId'], [
            self::memberRow($projectKey, 'Admin Member', ['role' => 'Lead', 'allocatedFraction' => '75', 'isProjectAdmin' => 'true']),
        ], false);

        self::assertSame(1, $result['succeeded']);
        $stmt = self::$db->prepare('SELECT m."Role", m."AllocatedFraction", m."IsProjectAdmin" FROM "ProjectMembers" m JOIN "Users" u ON u."Id" = m."UserId" WHERE m."ProjectId" = :pid AND u."DisplayName" = :name');
        $stmt->execute(['pid' => $projectId, 'name' => 'Admin Member']);
        $row = $stmt->fetch();
        self::assertSame('Lead', $row['Role']);
        self::assertSame(75, (int) $row['AllocatedFraction']);
        self::assertTrue((bool) $row['IsProjectAdmin']);
    }

    public function testImportTeamMembersReportsToAnUnresolvableUsernameFailsThatRow(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $projectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'), $seeded['userId']);
        $stmt = self::$db->prepare('SELECT "Key" FROM "Projects" WHERE "Id" = :id');
        $stmt->execute(['id' => $projectId]);
        $projectKey = $stmt->fetchColumn();

        $result = self::$import->importTeamMembers($seeded['orgId'], [
            self::memberRow($projectKey, 'Nobody Manages Me', ['reportsTo' => 'nosuchperson']),
        ], false);

        self::assertSame(0, $result['succeeded']);
        self::assertStringContainsString('reportsTo', $result['results'][0]['message']);
        self::assertStringContainsString('is not a member of project', $result['results'][0]['message']);
    }

    public function testImportTeamMembersInvalidAllocatedFractionFailsThatRow(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $projectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'), $seeded['userId']);
        $stmt = self::$db->prepare('SELECT "Key" FROM "Projects" WHERE "Id" = :id');
        $stmt->execute(['id' => $projectId]);
        $projectKey = $stmt->fetchColumn();

        $result = self::$import->importTeamMembers($seeded['orgId'], [
            self::memberRow($projectKey, 'Bad Fraction', ['allocatedFraction' => 'not-a-number']),
        ], false);

        self::assertSame(0, $result['succeeded']);
        self::assertStringContainsString('allocatedFraction', $result['results'][0]['message']);
    }

    public function testImportTeamMembersDryRunDoesNotActuallyAddTheMember(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $projectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'), $seeded['userId']);
        $stmt = self::$db->prepare('SELECT "Key" FROM "Projects" WHERE "Id" = :id');
        $stmt->execute(['id' => $projectId]);
        $projectKey = $stmt->fetchColumn();

        $result = self::$import->importTeamMembers($seeded['orgId'], [self::memberRow($projectKey, 'Dry Run Member')], true);

        self::assertSame(1, $result['succeeded']);
        $stmt = self::$db->prepare('SELECT 1 FROM "ProjectMembers" m JOIN "Users" u ON u."Id" = m."UserId" WHERE m."ProjectId" = :pid AND u."DisplayName" = :name');
        $stmt->execute(['pid' => $projectId, 'name' => 'Dry Run Member']);
        self::assertFalse($stmt->fetch());
    }
}

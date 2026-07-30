<?php

declare(strict_types=1);

namespace Enkl\Api\Tests;

use Enkl\Api\Auth\UsernameNormalizer;
use Enkl\Api\Db\Database;
use Enkl\Api\Services\ImportService;
use Enkl\Api\Services\MemberService;
use Enkl\Api\Services\OrganisationService;
use Enkl\Api\Services\TeamCommitteeService;
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
        self::$import = new ImportService(self::$db, new OrganisationService(self::$db), new MemberService(self::$db), new TeamCommitteeService(self::$db));
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

    // ── Teams & Committees (Phase 5) ───────────────────────────────────────────────────────────

    /** @return array<string, string> */
    private static function teamRow(string $projectKey, string $name, ?array $extra = null): array
    {
        $row = ['projectKey' => $projectKey, 'name' => $name, 'type' => 'team'];
        return $extra !== null ? array_merge($row, $extra) : $row;
    }

    private static function projectKeyFor(string $projectId): string
    {
        $stmt = self::$db->prepare('SELECT "Key" FROM "Projects" WHERE "Id" = :id');
        $stmt->execute(['id' => $projectId]);
        return $stmt->fetchColumn();
    }

    public function testImportTeamsCommitteesCommitValidRowActuallyPersistsIt(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $projectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'), $seeded['userId']);
        $projectKey = self::projectKeyFor($projectId);

        $result = self::$import->importTeamsCommittees($seeded['orgId'], [
            self::teamRow($projectKey, 'Imported Team', ['type' => 'committee', 'description' => 'A committee']),
        ], false);

        self::assertSame(1, $result['succeeded']);
        $stmt = self::$db->prepare('SELECT "Type", "Description" FROM "TeamsCommittees" WHERE "ProjectId" = :pid AND "Name" = :name');
        $stmt->execute(['pid' => $projectId, 'name' => 'Imported Team']);
        $row = $stmt->fetch();
        self::assertNotFalse($row);
        self::assertSame('committee', $row['Type']);
        self::assertSame('A committee', $row['Description']);
    }

    public function testImportTeamsCommitteesUnknownProjectKeyFailsThatRow(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));

        $result = self::$import->importTeamsCommittees($seeded['orgId'], [self::teamRow('NOSUCHKEY', "Someone's Team")], false);

        self::assertSame(0, $result['succeeded']);
        self::assertStringContainsString('No project with key', $result['results'][0]['message']);
    }

    public function testImportTeamsCommitteesProjectKeyBelongingToAnotherOrgFailsWithTheSameNotFoundMessage(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $otherSeeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('otherOrg'), TestDataHelper::unique('otherAdmin'));
        $otherProjectId = TestDataHelper::seedProject(self::$db, $otherSeeded['orgId'], TestDataHelper::unique('P'), $otherSeeded['userId']);
        $otherProjectKey = self::projectKeyFor($otherProjectId);

        $result = self::$import->importTeamsCommittees($seeded['orgId'], [self::teamRow($otherProjectKey, "Someone's Team")], false);

        self::assertSame(0, $result['succeeded']);
        self::assertStringContainsString('No project with key', $result['results'][0]['message']);
    }

    public function testImportTeamsCommitteesInvalidTypeFailsThatRow(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $projectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'), $seeded['userId']);
        $projectKey = self::projectKeyFor($projectId);

        $result = self::$import->importTeamsCommittees($seeded['orgId'], [
            self::teamRow($projectKey, 'Bad Type Team', ['type' => 'not-a-real-type']),
        ], false);

        self::assertSame(0, $result['succeeded']);
        self::assertStringContainsString('"type"', $result['results'][0]['message']);
    }

    public function testImportTeamsCommitteesParentResolvesToAnAlreadyExistingTeamCommittee(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $projectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'), $seeded['userId']);
        $projectKey = self::projectKeyFor($projectId);
        $parent = (new TeamCommitteeService(self::$db))->create($projectId, ['name' => 'Parent Team', 'type' => 'team']);

        $result = self::$import->importTeamsCommittees($seeded['orgId'], [
            self::teamRow($projectKey, 'Child Team', ['parent' => 'Parent Team']),
        ], false);

        self::assertSame(1, $result['succeeded']);
        $stmt = self::$db->prepare('SELECT "ParentId" FROM "TeamsCommittees" WHERE "ProjectId" = :pid AND "Name" = :name');
        $stmt->execute(['pid' => $projectId, 'name' => 'Child Team']);
        self::assertSame($parent['id'], $stmt->fetchColumn());
    }

    public function testImportTeamsCommitteesUnresolvableParentFailsThatRow(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $projectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'), $seeded['userId']);
        $projectKey = self::projectKeyFor($projectId);

        $result = self::$import->importTeamsCommittees($seeded['orgId'], [
            self::teamRow($projectKey, 'Orphan Team', ['parent' => 'No Such Parent']),
        ], false);

        self::assertSame(0, $result['succeeded']);
        self::assertStringContainsString('"parent"', $result['results'][0]['message']);
    }

    public function testImportTeamsCommitteesMembersResolveToExistingProjectMembers(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $projectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'), $seeded['userId']);
        $projectKey = self::projectKeyFor($projectId);
        $username = TestDataHelper::unique('member1');
        $userId = TestDataHelper::seedUserInOrg(self::$db, $seeded['orgId'], $username);
        $pmId = self::addProjectMember($projectId, $userId);

        $result = self::$import->importTeamsCommittees($seeded['orgId'], [
            self::teamRow($projectKey, 'Staffed Team', ['members' => $username]),
        ], false);

        self::assertSame(1, $result['succeeded']);
        $stmt = self::$db->prepare('SELECT tcm."ProjectMemberId" FROM "TeamCommitteeMember" tcm JOIN "TeamsCommittees" tc ON tc."Id" = tcm."TeamCommitteeId" WHERE tc."ProjectId" = :pid AND tc."Name" = :name');
        $stmt->execute(['pid' => $projectId, 'name' => 'Staffed Team']);
        self::assertSame($pmId, $stmt->fetchColumn());
    }

    private static function addProjectMember(string $projectId, string $userId): string
    {
        $id = \Enkl\Api\Support\Uuid::v4();
        self::$db->prepare('INSERT INTO "ProjectMembers" ("Id", "ProjectId", "UserId", "Color") VALUES (:id, :pid, :uid, :color)')
            ->execute(['id' => $id, 'pid' => $projectId, 'uid' => $userId, 'color' => '#000000']);
        return $id;
    }

    public function testImportTeamsCommitteesUnresolvableMemberUsernameFailsThatRow(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $projectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'), $seeded['userId']);
        $projectKey = self::projectKeyFor($projectId);

        $result = self::$import->importTeamsCommittees($seeded['orgId'], [
            self::teamRow($projectKey, 'Bad Members Team', ['members' => 'nosuchperson']),
        ], false);

        self::assertSame(0, $result['succeeded']);
        self::assertStringContainsString('"members"', $result['results'][0]['message']);
        self::assertStringContainsString('is not a member of project', $result['results'][0]['message']);
    }

    public function testImportTeamsCommitteesDryRunDoesNotActuallyPersistIt(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $projectId = TestDataHelper::seedProject(self::$db, $seeded['orgId'], TestDataHelper::unique('P'), $seeded['userId']);
        $projectKey = self::projectKeyFor($projectId);

        $result = self::$import->importTeamsCommittees($seeded['orgId'], [self::teamRow($projectKey, 'Dry Run Team')], true);

        self::assertSame(1, $result['succeeded']);
        $stmt = self::$db->prepare('SELECT 1 FROM "TeamsCommittees" WHERE "ProjectId" = :pid AND "Name" = :name');
        $stmt->execute(['pid' => $projectId, 'name' => 'Dry Run Team']);
        self::assertFalse($stmt->fetch());
    }
}

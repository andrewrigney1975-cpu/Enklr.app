<?php

declare(strict_types=1);

namespace Enkl\Api\Tests;

use Enkl\Api\Auth\PasswordHasher;
use Enkl\Api\Db\Database;
use Enkl\Api\Services\OrganisationService;
use Enkl\Api\Tests\Support\TestDataHelper;
use Enkl\Api\Validation\ApiValidationException;
use PDO;
use PHPUnit\Framework\TestCase;

/**
 * Direct-service-call coverage for OrganisationService::createUser, per the review's minimum ask —
 * not transaction-wrapped this session (single-statement INSERT after EmailValidation's own SELECT
 * pre-check), but had zero coverage before this pass.
 */
final class OrganisationServiceTest extends TestCase
{
    private static PDO $db;
    private static OrganisationService $organisations;

    public static function setUpBeforeClass(): void
    {
        self::$db = Database::connection();
        self::$organisations = new OrganisationService(self::$db);
    }

    public function testCreateUserInsertsRealUser(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));

        $username = TestDataHelper::unique('newuser');
        $email = TestDataHelper::unique('newuser') . '@example.com';
        $created = self::$organisations->createUser($seeded['orgId'], [
            'displayName' => 'New User', 'username' => $username, 'password' => 'SuperSecret123!', 'emailAddress' => $email,
        ]);

        self::assertSame('New User', $created['displayName']);
        self::assertFalse($created['isOrgAdmin']);
        self::assertTrue($created['isActive']);

        $stmt = self::$db->prepare('SELECT "OrganisationId", "EmailAddress" FROM "Users" WHERE "Id" = :id');
        $stmt->execute(['id' => $created['id']]);
        $row = $stmt->fetch();
        self::assertSame($seeded['orgId'], $row['OrganisationId']);
        self::assertSame($email, $row['EmailAddress']);
    }

    public function testCreateUserWithDuplicateUsernameThrowsValidationException(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));
        $username = TestDataHelper::unique('dupuser');

        self::$organisations->createUser($seeded['orgId'], [
            'displayName' => 'First', 'username' => $username, 'password' => 'SuperSecret123!', 'emailAddress' => TestDataHelper::unique('a') . '@example.com',
        ]);

        $this->expectException(ApiValidationException::class);
        self::$organisations->createUser($seeded['orgId'], [
            'displayName' => 'Second', 'username' => $username, 'password' => 'SuperSecret123!', 'emailAddress' => TestDataHelper::unique('b') . '@example.com',
        ]);
    }

    public function testCreateUserWithShortPasswordThrowsValidationException(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));

        $this->expectException(ApiValidationException::class);
        self::$organisations->createUser($seeded['orgId'], [
            'displayName' => 'Short Pw', 'username' => TestDataHelper::unique('shortpw'), 'password' => 'short', 'emailAddress' => TestDataHelper::unique('c') . '@example.com',
        ]);
    }

    public function testGetOrganisationHasCustomDefaultPasswordFalseByDefault(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));

        $org = self::$organisations->getOrganisation($seeded['orgId']);

        self::assertFalse($org['hasCustomDefaultPassword']);
    }

    public function testSetDefaultNewUserPasswordUpdatesHashAndFlag(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));

        $ok = self::$organisations->setDefaultNewUserPassword($seeded['orgId'], 'OrgChosenPassword1!');
        self::assertTrue($ok);

        $org = self::$organisations->getOrganisation($seeded['orgId']);
        self::assertTrue($org['hasCustomDefaultPassword']);

        $stmt = self::$db->prepare('SELECT "DefaultNewUserPasswordHash" FROM "Organisations" WHERE "Id" = :id');
        $stmt->execute(['id' => $seeded['orgId']]);
        $hash = $stmt->fetchColumn();
        self::assertTrue(PasswordHasher::verify('OrgChosenPassword1!', $hash));
    }

    public function testSetDefaultNewUserPasswordWithShortPasswordThrowsValidationException(): void
    {
        $seeded = TestDataHelper::seedOrgAndUser(self::$db, TestDataHelper::unique('org'), TestDataHelper::unique('admin'));

        $this->expectException(ApiValidationException::class);
        self::$organisations->setDefaultNewUserPassword($seeded['orgId'], 'short');
    }
}

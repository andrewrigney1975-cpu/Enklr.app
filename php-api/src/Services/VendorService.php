<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Auth\PasswordHasher;
use Enkl\Api\Support\Uuid;
use Enkl\Api\Validation\ApiValidationException;
use PDO;

/**
 * Ported from Services/VendorService.cs. OrgAdmin-facing CRUD for Vendor records, plus per-Vendor
 * API key generate/revoke — folded into this one service rather than split out the way
 * OrganisationApiKeyService is its own class (that split exists because the org-wide key is one row
 * shared across many unrelated features; a Vendor's key is intrinsically part of that one Vendor's
 * own record). Every id is re-validated against the caller's own organisationId before anything is
 * touched — same cross-org-isolation discipline as AnnouncementService, no enumeration oracle.
 */
final class VendorService
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function list(string $organisationId): array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Vendors" WHERE "OrganisationId" = :orgId ORDER BY "Name"');
        $stmt->execute(['orgId' => $organisationId]);
        return array_map(fn(array $v) => $this->toDto($v), $stmt->fetchAll());
    }

    public function get(string $organisationId, string $vendorId): ?array
    {
        $vendor = $this->find($vendorId, $organisationId);
        return $vendor === null ? null : $this->toDto($vendor);
    }

    public function create(string $organisationId, array $request): array
    {
        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            throw new ApiValidationException('Name is required.');
        }

        $id = Uuid::v4();
        $stmt = $this->db->prepare(<<<SQL
            INSERT INTO "Vendors"
                ("Id", "OrganisationId", "Name", "PrimaryContactPerson", "ContactEmailAddress", "ContactUrl", "TaxNumber", "DateCreated", "DateLastModified")
            VALUES (:id, :orgId, :name, :contact, :email, :url, :taxNumber, now(), now())
        SQL);
        $stmt->execute([
            'id' => $id, 'orgId' => $organisationId, 'name' => $name,
            'contact' => $this->trimmedOrNull($request['primaryContactPerson'] ?? null),
            'email' => $this->trimmedOrNull($request['contactEmailAddress'] ?? null),
            'url' => $this->trimmedOrNull($request['contactUrl'] ?? null),
            'taxNumber' => $this->trimmedOrNull($request['taxNumber'] ?? null),
        ]);

        return $this->toDto($this->find($id, $organisationId));
    }

    public function update(string $organisationId, string $vendorId, array $request): ?array
    {
        if ($this->find($vendorId, $organisationId) === null) {
            return null;
        }

        $name = trim((string) ($request['name'] ?? ''));
        if ($name === '') {
            throw new ApiValidationException('Name is required.');
        }

        $stmt = $this->db->prepare(<<<SQL
            UPDATE "Vendors"
            SET "Name" = :name, "PrimaryContactPerson" = :contact, "ContactEmailAddress" = :email,
                "ContactUrl" = :url, "TaxNumber" = :taxNumber, "IsActive" = :isActive, "DateLastModified" = now()
            WHERE "Id" = :id AND "OrganisationId" = :orgId
        SQL);
        $stmt->execute([
            'name' => $name,
            'contact' => $this->trimmedOrNull($request['primaryContactPerson'] ?? null),
            'email' => $this->trimmedOrNull($request['contactEmailAddress'] ?? null),
            'url' => $this->trimmedOrNull($request['contactUrl'] ?? null),
            'taxNumber' => $this->trimmedOrNull($request['taxNumber'] ?? null),
            'isActive' => !empty($request['isActive']) ? 1 : 0,
            'id' => $vendorId, 'orgId' => $organisationId,
        ]);

        return $this->toDto($this->find($vendorId, $organisationId));
    }

    public function delete(string $organisationId, string $vendorId): bool
    {
        // VendorIntegrations cascade-delete with it (ON DELETE CASCADE) — no separate cleanup needed.
        $stmt = $this->db->prepare('DELETE FROM "Vendors" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $vendorId, 'orgId' => $organisationId]);
        return $stmt->rowCount() > 0;
    }

    /** Mints a new random key, stores only its hash, and returns the raw value — the one and only
     * time it's ever retrievable. "Rotate-only": reuses the Vendor's existing VendorIntegration row
     * if one already exists rather than inserting a second one, so a Vendor only ever has at most
     * one key. Distinct "enklr_vendor_key_" prefix from the org-wide key's own "enklr_key_". */
    public function generateApiKey(string $organisationId, string $vendorId): ?array
    {
        if ($this->find($vendorId, $organisationId) === null) {
            return null;
        }

        $rawKey = 'enklr_vendor_key_' . rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $hash = PasswordHasher::hash($rawKey);

        $integration = $this->findIntegration($vendorId);
        if ($integration !== null) {
            $this->db->prepare(
                'UPDATE "VendorIntegrations" SET "ApiKeyHash" = :hash, "GeneratedAt" = now(), "IsActive" = true, "DateLastModified" = now() WHERE "Id" = :id'
            )->execute(['hash' => $hash, 'id' => $integration['Id']]);
        } else {
            $this->db->prepare(<<<SQL
                INSERT INTO "VendorIntegrations" ("Id", "VendorId", "ApiKeyHash", "GeneratedAt", "IsActive", "DateCreated", "DateLastModified")
                VALUES (:id, :vendorId, :hash, now(), true, now(), now())
            SQL)->execute(['id' => Uuid::v4(), 'vendorId' => $vendorId, 'hash' => $hash]);
        }

        return ['key' => $rawKey];
    }

    public function revokeApiKey(string $organisationId, string $vendorId): ?array
    {
        $vendor = $this->find($vendorId, $organisationId);
        if ($vendor === null) {
            return null;
        }

        $integration = $this->findIntegration($vendorId);
        if ($integration !== null) {
            // Soft-disable, row kept for audit — same shape as OrganisationApiKeyService::revoke.
            $this->db->prepare('UPDATE "VendorIntegrations" SET "IsActive" = false, "DateLastModified" = now() WHERE "Id" = :id')
                ->execute(['id' => $integration['Id']]);
        }

        return $this->toDto($this->find($vendorId, $organisationId));
    }

    private function find(string $vendorId, string $organisationId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Vendors" WHERE "Id" = :id AND "OrganisationId" = :orgId');
        $stmt->execute(['id' => $vendorId, 'orgId' => $organisationId]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    private function findIntegration(string $vendorId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "VendorIntegrations" WHERE "VendorId" = :vendorId LIMIT 1');
        $stmt->execute(['vendorId' => $vendorId]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    private function trimmedOrNull(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $trimmed = trim($value);
        return $trimmed === '' ? null : $trimmed;
    }

    private function toDto(?array $vendor): array
    {
        $integration = $vendor !== null ? $this->findIntegration($vendor['Id']) : null;
        return [
            'id' => $vendor['Id'], 'name' => $vendor['Name'],
            'primaryContactPerson' => $vendor['PrimaryContactPerson'], 'contactEmailAddress' => $vendor['ContactEmailAddress'],
            'contactUrl' => $vendor['ContactUrl'], 'taxNumber' => $vendor['TaxNumber'],
            'isActive' => (bool) $vendor['IsActive'], 'dateCreated' => $vendor['DateCreated'], 'dateLastModified' => $vendor['DateLastModified'],
            'hasApiKey' => $integration !== null && !empty($integration['ApiKeyHash']),
            'apiKeyEnabled' => $integration !== null && (bool) $integration['IsActive'],
            'apiKeyGeneratedAt' => $integration['GeneratedAt'] ?? null,
            'apiKeyLastUsedAt' => $integration['LastUsedAt'] ?? null,
        ];
    }
}

<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

use Enkl\Api\Support\Uuid;
use PDO;

/** Ported from Services/DashboardService.cs. */
final class DashboardService
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function list(string $projectId): array
    {
        $stmt = $this->db->prepare(<<<SQL
            SELECT d."Id", d."Name", d."Description", d."DateLastModified",
                   (SELECT COUNT(*) FROM "DashboardWidgets" w WHERE w."DashboardId" = d."Id") AS "WidgetCount"
            FROM "Dashboards" d
            WHERE d."ProjectId" = :pid
            ORDER BY d."Name"
        SQL);
        $stmt->execute(['pid' => $projectId]);
        return array_map(fn($d) => [
            'id' => $d['Id'], 'name' => $d['Name'], 'description' => $d['Description'],
            'widgetCount' => (int) $d['WidgetCount'], 'dateLastModified' => $d['DateLastModified'],
            'widgets' => $this->listWidgetsFor($d['Id']),
        ], $stmt->fetchAll());
    }

    /** Lightweight per-widget shape (type/width/sortOrder/configJson) for the Dashboards picker's
     * tile preview (modals/dashboards.js's buildDashboardTilePreviewSvg) — same DashboardWidgetDto
     * shape list()/getForOrg() already return, just fetched once per row here rather than via a JOIN
     * (row-multiplication-free, and this list is never large enough to matter). */
    private function listWidgetsFor(string $dashboardId): array
    {
        $stmt = $this->db->prepare('SELECT * FROM "DashboardWidgets" WHERE "DashboardId" = :did ORDER BY "SortOrder"');
        $stmt->execute(['did' => $dashboardId]);
        return array_map(fn($w) => $this->toWidgetDto($w), $stmt->fetchAll());
    }

    public function get(string $projectId, string $dashboardId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "Dashboards" WHERE "Id" = :id AND "ProjectId" = :pid');
        $stmt->execute(['id' => $dashboardId, 'pid' => $projectId]);
        $dashboard = $stmt->fetch();
        return $dashboard === false ? null : $this->toDetailDto($dashboard);
    }

    public function create(string $projectId, array $request): ?array
    {
        $stmt = $this->db->prepare('SELECT 1 FROM "Projects" WHERE "Id" = :id');
        $stmt->execute(['id' => $projectId]);
        if ($stmt->fetch() === false) {
            return null;
        }

        $id = Uuid::v4();
        $this->db->prepare(<<<SQL
            INSERT INTO "Dashboards" ("Id", "ProjectId", "Name", "Description", "DateCreated", "DateLastModified")
            VALUES (:id, :pid, :name, :description, now(), now())
        SQL)->execute([
            'id' => $id, 'pid' => $projectId, 'name' => $request['name'] ?? '',
            'description' => $request['description'] ?? null,
        ]);

        return $this->get($projectId, $id);
    }

    public function update(string $projectId, string $dashboardId, array $request): ?array
    {
        $stmt = $this->db->prepare('SELECT 1 FROM "Dashboards" WHERE "Id" = :id AND "ProjectId" = :pid');
        $stmt->execute(['id' => $dashboardId, 'pid' => $projectId]);
        if ($stmt->fetch() === false) {
            return null;
        }

        $this->db->prepare(<<<SQL
            UPDATE "Dashboards" SET "Name" = :name, "Description" = :description, "DateLastModified" = now()
            WHERE "Id" = :id
        SQL)->execute([
            'name' => $request['name'] ?? '', 'description' => $request['description'] ?? null, 'id' => $dashboardId,
        ]);

        return $this->get($projectId, $dashboardId);
    }

    public function delete(string $projectId, string $dashboardId): bool
    {
        $stmt = $this->db->prepare('DELETE FROM "Dashboards" WHERE "Id" = :id AND "ProjectId" = :pid');
        $stmt->execute(['id' => $dashboardId, 'pid' => $projectId]);
        return $stmt->rowCount() > 0;
    }

    /** Org-Admin-only cross-project browse (Controllers/OrgDashboardsController.php) — pure
     * org-scoped read, no client-supplied id list to re-derive, same as the .NET tier's own
     * ListForOrgAsync. */
    public function listForOrg(string $organisationId): array
    {
        $stmt = $this->db->prepare(<<<SQL
            SELECT d."Id", d."Name", d."Description", d."DateLastModified",
                   d."ProjectId", p."Name" AS "ProjectName", p."Key" AS "ProjectKey",
                   (SELECT COUNT(*) FROM "DashboardWidgets" w WHERE w."DashboardId" = d."Id") AS "WidgetCount"
            FROM "Dashboards" d
            JOIN "Projects" p ON p."Id" = d."ProjectId"
            WHERE p."OrganisationId" = :orgId
            ORDER BY p."Name", d."Name"
        SQL);
        $stmt->execute(['orgId' => $organisationId]);
        return array_map(fn($d) => [
            'id' => $d['Id'], 'name' => $d['Name'], 'description' => $d['Description'],
            'widgetCount' => (int) $d['WidgetCount'], 'dateLastModified' => $d['DateLastModified'],
            'projectId' => $d['ProjectId'], 'projectName' => $d['ProjectName'], 'projectKey' => $d['ProjectKey'],
            'widgets' => $this->listWidgetsFor($d['Id']),
        ], $stmt->fetchAll());
    }

    // ---- Widgets ------------------------------------------------------------------------------

    private function dashboardExists(string $projectId, string $dashboardId): bool
    {
        $stmt = $this->db->prepare('SELECT 1 FROM "Dashboards" WHERE "Id" = :id AND "ProjectId" = :pid');
        $stmt->execute(['id' => $dashboardId, 'pid' => $projectId]);
        return $stmt->fetch() !== false;
    }

    private function touchDashboard(string $dashboardId): void
    {
        $this->db->prepare('UPDATE "Dashboards" SET "DateLastModified" = now() WHERE "Id" = :id')
            ->execute(['id' => $dashboardId]);
    }

    public function createWidget(string $projectId, string $dashboardId, array $request): ?array
    {
        if (!$this->dashboardExists($projectId, $dashboardId)) {
            return null;
        }

        $id = Uuid::v4();
        $this->db->prepare(<<<SQL
            INSERT INTO "DashboardWidgets"
                ("Id", "DashboardId", "WidgetType", "Title", "SavedQueryId", "Width", "SortOrder", "ConfigJson", "DateCreated", "DateLastModified")
            VALUES (:id, :did, :type, :title, :sqid, :width, :sortOrder, :config, now(), now())
        SQL)->execute([
            'id' => $id, 'did' => $dashboardId, 'type' => $request['widgetType'] ?? '',
            'title' => $request['title'] ?? '', 'sqid' => $request['savedQueryId'] ?? null,
            'width' => $request['width'] ?? 'full', 'sortOrder' => (int) ($request['sortOrder'] ?? 0),
            'config' => $request['configJson'] ?? null,
        ]);
        $this->touchDashboard($dashboardId);

        return $this->getWidget($id);
    }

    public function updateWidget(string $projectId, string $dashboardId, string $widgetId, array $request): ?array
    {
        if (!$this->dashboardExists($projectId, $dashboardId)) {
            return null;
        }
        $stmt = $this->db->prepare('SELECT 1 FROM "DashboardWidgets" WHERE "Id" = :id AND "DashboardId" = :did');
        $stmt->execute(['id' => $widgetId, 'did' => $dashboardId]);
        if ($stmt->fetch() === false) {
            return null;
        }

        $this->db->prepare(<<<SQL
            UPDATE "DashboardWidgets" SET
                "WidgetType" = :type, "Title" = :title, "SavedQueryId" = :sqid, "Width" = :width,
                "SortOrder" = :sortOrder, "ConfigJson" = :config, "DateLastModified" = now()
            WHERE "Id" = :id
        SQL)->execute([
            'type' => $request['widgetType'] ?? '', 'title' => $request['title'] ?? '',
            'sqid' => $request['savedQueryId'] ?? null, 'width' => $request['width'] ?? 'full',
            'sortOrder' => (int) ($request['sortOrder'] ?? 0), 'config' => $request['configJson'] ?? null,
            'id' => $widgetId,
        ]);
        $this->touchDashboard($dashboardId);

        return $this->getWidget($widgetId);
    }

    public function deleteWidget(string $projectId, string $dashboardId, string $widgetId): bool
    {
        if (!$this->dashboardExists($projectId, $dashboardId)) {
            return false;
        }
        $stmt = $this->db->prepare('DELETE FROM "DashboardWidgets" WHERE "Id" = :id AND "DashboardId" = :did');
        $stmt->execute(['id' => $widgetId, 'did' => $dashboardId]);
        $deleted = $stmt->rowCount() > 0;
        if ($deleted) {
            $this->touchDashboard($dashboardId);
        }
        return $deleted;
    }

    private function getWidget(string $widgetId): ?array
    {
        $stmt = $this->db->prepare('SELECT * FROM "DashboardWidgets" WHERE "Id" = :id');
        $stmt->execute(['id' => $widgetId]);
        $w = $stmt->fetch();
        return $w === false ? null : $this->toWidgetDto($w);
    }

    private function toDetailDto(array $d): array
    {
        $stmt = $this->db->prepare('SELECT * FROM "DashboardWidgets" WHERE "DashboardId" = :did ORDER BY "SortOrder"');
        $stmt->execute(['did' => $d['Id']]);
        $widgets = array_map(fn($w) => $this->toWidgetDto($w), $stmt->fetchAll());

        return [
            'id' => $d['Id'], 'name' => $d['Name'], 'description' => $d['Description'],
            'dateCreated' => $d['DateCreated'], 'dateLastModified' => $d['DateLastModified'],
            'widgets' => $widgets,
        ];
    }

    private function toWidgetDto(array $w): array
    {
        return [
            'id' => $w['Id'], 'widgetType' => $w['WidgetType'], 'title' => $w['Title'],
            'savedQueryId' => $w['SavedQueryId'], 'width' => $w['Width'], 'sortOrder' => (int) $w['SortOrder'],
            'configJson' => $w['ConfigJson'],
        ];
    }
}

<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

/**
 * Ported from Services/ProjectSettingsSerializer.cs. Defaults mirror normalizeHeaderButtonVisibility
 * (src/js/storage.js) exactly: every field is opt-out (defaults true) except workflow,
 * changeAuditing and retrospective, which are opt-in (default false) — a missing/corrupted value
 * must never silently start enforcing/recording/showing something the user never asked for. Keys
 * are camelCase to match both the frontend's own field names and the "changeAuditing" key
 * TaskService::isChangeAuditingEnabled reads from this same column.
 *
 * @phpstan-type ProjectSettings array{documents:bool,risks:bool,decisions:bool,health:bool,principles:bool,objectives:bool,teamsCommittees:bool,workflow:bool,timeTracking:bool,changeAuditing:bool,subTasks:bool,retrospective:bool,strategy:bool,dashboards:bool,forms:bool,portfolioPlanner:bool}
 */
final class ProjectSettingsSerializer
{
    private const DEFAULTS = [
        'documents' => true,
        'risks' => true,
        'decisions' => true,
        'health' => true,
        'principles' => true,
        'objectives' => true,
        'teamsCommittees' => true,
        'workflow' => false,
        'timeTracking' => true,
        'changeAuditing' => false,
        'subTasks' => true,
        // Opt-in, like workflow: brand-new functionality nobody has configured yet, so a
        // missing/corrupted value must never silently turn it on.
        'retrospective' => false,
        // Opt-in, like workflow/retrospective: a missing/corrupted value must never silently turn on
        // a module the project never asked for.
        'strategy' => false,
        // Opt-in, like strategy: the Self-Service Dashboard module stays invisible until a Project
        // Admin deliberately turns it on.
        'dashboards' => false,
        // Opt-in, Org-Admin-authored: Enterprise Forms & Workflow stays invisible until an Org Admin
        // deliberately turns it on for this project (same shape as strategy).
        'forms' => false,
        // Opt-in, same shape as forms — was previously a pure Org-Admin permission gate with no
        // per-project toggle at all; a missing/corrupted value must fail closed to that same
        // hidden-until-toggled behavior, not silently re-expose the nav entry everywhere.
        'portfolioPlanner' => false,
    ];

    public static function serialize(array $settings): string
    {
        $result = [];
        foreach (self::DEFAULTS as $key => $default) {
            $result[$key] = (bool) ($settings[$key] ?? $default);
        }
        return json_encode($result);
    }

    /** @return ProjectSettings */
    public static function parse(?string $json): array
    {
        $decoded = [];
        if ($json !== null && $json !== '') {
            $tmp = json_decode($json, true);
            if (is_array($tmp)) {
                $decoded = $tmp;
            }
        }

        $result = [];
        foreach (self::DEFAULTS as $key => $default) {
            $value = $decoded[$key] ?? null;
            $result[$key] = is_bool($value) ? $value : $default;
        }
        return $result;
    }
}

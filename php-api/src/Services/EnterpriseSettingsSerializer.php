<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

/**
 * Ported from Services/EnterpriseSettingsSerializer.cs. Shared camelCase (de)serialization for
 * Organisations.EnterpriseSettingsJson — the small subset of App Settings' "Enterprise" category
 * that applies org-WIDE (Forms & Workflow, Portfolio Planner, Portals) rather than per-project like
 * every other App Settings toggle. Every field is opt-in (default false) — a missing/corrupted value
 * must never silently turn on a module no Org Admin has ever actually switched on.
 *
 * @phpstan-type EnterpriseSettings array{forms:bool,portfolioPlanner:bool,portals:bool}
 */
final class EnterpriseSettingsSerializer
{
    private const DEFAULTS = [
        'forms' => false,
        'portfolioPlanner' => false,
        'portals' => false,
    ];

    public static function serialize(array $settings): string
    {
        $result = [];
        foreach (self::DEFAULTS as $key => $default) {
            $result[$key] = (bool) ($settings[$key] ?? $default);
        }
        return json_encode($result);
    }

    /** @return EnterpriseSettings */
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

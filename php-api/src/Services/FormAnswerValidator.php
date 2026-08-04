<?php

declare(strict_types=1);

namespace Enkl\Api\Services;

/**
 * Ported from Services/FormAnswerValidator.cs — see that file's own doc comment for the full
 * rationale (validates an AI-Assistant-constructed AnswersJson object against a Form's own
 * FieldsJson schema before FormSubmissionService::create/submit ever sees it; AnswersJson has no
 * server-side validation for the human fill-out path today, since its rendered widgets already
 * enforce required/type/option constraints before an answer can even be typed in — an LLM has no
 * such guardrail, so this is a genuinely NEW validation path scoped to the AI Assistant's
 * submit_form tool only).
 *
 * Mirrors features/form-answers.js's own storage shape exactly: text/textarea -> string, numeric ->
 * number, checkboxGroup -> array of option ids, radio(single) -> bool, radio(mutexGroup)/
 * select(single)/priority -> single option id, radio(multiGroup)/select(multiple) -> array of
 * option ids, datetime -> date string. Option values may be given as either the real option id OR
 * its label (case-insensitive) — normalized to the real id in the cleaned output.
 */
final class FormAnswerValidator
{
    /** Parses fieldsJson into a display-ready field list — [ok, error, fields[]], each field:
     * {id, type, label, helpText, required, multiple, mutex, groupMode, options: [{id,label}]|null}.
     * @return array{0: bool, 1: ?string, 2: array<int, array<string, mixed>>} */
    public static function describeFields(?string $fieldsJson): array
    {
        $fields = self::parseFields($fieldsJson);
        if ($fields === null) {
            return [false, "This form's field definitions could not be read.", []];
        }
        return [true, null, $fields];
    }

    /** Validates $answers against $fieldsJson field-by-field and returns a clean, re-serialized
     * AnswersJson containing only real field ids with normalized option values — any stray key the
     * model supplied that doesn't match a real field id is silently dropped. On failure, the error
     * names the specific field and what's wrong.
     * @return array{0: bool,1: ?string,2: string} [ok, error, answersJson] */
    public static function validate(?string $fieldsJson, array $answers): array
    {
        $fields = self::parseFields($fieldsJson);
        if ($fields === null) {
            return [false, "This form's field definitions could not be read.", '{}'];
        }

        $clean = [];
        foreach ($fields as $field) {
            $provided = array_key_exists($field['id'], $answers) && $answers[$field['id']] !== null;
            $rawValue = $provided ? $answers[$field['id']] : null;
            [$isEmpty, $error, $normalized] = self::validateFieldValue($field, $rawValue);
            if ($error !== null) {
                return [false, $error, '{}'];
            }
            if (!empty($field['required']) && $isEmpty) {
                return [false, "The field \"{$field['label']}\" is required.", '{}'];
            }
            if ($provided && !$isEmpty) {
                $clean[$field['id']] = $normalized;
            }
        }

        return [true, null, json_encode($clean)];
    }

    /** @return ?array<int, array<string, mixed>> */
    private static function parseFields(?string $fieldsJson): ?array
    {
        if ($fieldsJson === null || trim($fieldsJson) === '') {
            return [];
        }
        $decoded = json_decode($fieldsJson, true);
        return is_array($decoded) ? $decoded : null;
    }

    /** @return array{0: bool, 1: ?string, 2: mixed} [isEmpty, error, normalizedValue] */
    private static function validateFieldValue(array $field, mixed $value): array
    {
        if ($value === null) {
            return [true, null, null];
        }
        $type = $field['type'] ?? '';
        $label = $field['label'] ?? $field['id'] ?? '';

        switch ($type) {
            case 'text':
            case 'textarea':
                if (!is_string($value) && !is_numeric($value) && !is_bool($value)) {
                    return [false, "The field \"{$label}\" must be text.", null];
                }
                $s = is_bool($value) ? ($value ? 'true' : 'false') : (string) $value;
                return [trim($s) === '', null, $s];

            case 'numeric':
                if (is_numeric($value)) {
                    return [false, null, $value + 0];
                }
                return [false, "The field \"{$label}\" must be a number.", null];

            case 'datetime':
                $s = is_string($value) ? $value : (string) $value;
                if (trim($s) === '') {
                    return [true, null, null];
                }
                if (strtotime($s) === false) {
                    return [false, "The field \"{$label}\" must be a valid date (e.g. YYYY-MM-DD).", null];
                }
                return [false, null, $s];

            case 'select':
            case 'priority':
                if (!empty($field['multiple'])) {
                    [$ids, $error] = self::resolveOptionArray($field, $value);
                    if ($error !== null) {
                        return [false, $error, null];
                    }
                    return [count($ids) === 0, null, $ids];
                }
                $single = is_string($value) ? $value : (is_scalar($value) ? (string) $value : null);
                if ($single === null || trim($single) === '') {
                    return [true, null, null];
                }
                [$id, $err] = self::matchOption($field, $single);
                if ($err !== null) {
                    return [false, $err, null];
                }
                return [false, null, $id];

            case 'checkboxGroup':
                [$ids, $error] = self::resolveOptionArray($field, $value);
                if ($error !== null) {
                    return [false, $error, null];
                }
                if (!empty($field['mutex']) && count($ids) > 1) {
                    return [false, "Only one option may be selected for \"{$label}\".", null];
                }
                return [count($ids) === 0, null, $ids];

            case 'radio':
                if (($field['groupMode'] ?? null) === 'single') {
                    if (is_bool($value)) {
                        return [$value !== true, null, $value];
                    }
                    if (is_string($value) && in_array(strtolower($value), ['true', 'false'], true)) {
                        $b = strtolower($value) === 'true';
                        return [!$b, null, $b];
                    }
                    return [false, "The field \"{$label}\" must be true or false.", null];
                }
                if (($field['groupMode'] ?? null) === 'multiGroup') {
                    [$ids, $error] = self::resolveOptionArray($field, $value);
                    if ($error !== null) {
                        return [false, $error, null];
                    }
                    return [count($ids) === 0, null, $ids];
                }
                // mutexGroup (the default when groupMode is unset)
                $single = is_string($value) ? $value : (is_scalar($value) ? (string) $value : null);
                if ($single === null || trim($single) === '') {
                    return [true, null, null];
                }
                [$id, $err] = self::matchOption($field, $single);
                if ($err !== null) {
                    return [false, $err, null];
                }
                return [false, null, $id];

            default:
                // An unrecognized field type — pass the raw value through unvalidated rather than
                // blocking the whole submission, same "never let a missing case break the primary
                // flow" posture as elsewhere in this codebase (e.g. PortalQaImageResolver.cs).
                return [false, null, $value];
        }
    }

    /** @return array{0: array<int, string>, 1: ?string} */
    private static function resolveOptionArray(array $field, mixed $value): array
    {
        if (!is_array($value)) {
            return [[], "The field \"" . ($field['label'] ?? $field['id'] ?? '') . "\" must be a list of selected options."];
        }
        $ids = [];
        foreach ($value as $item) {
            $text = is_string($item) ? $item : (is_scalar($item) ? (string) $item : null);
            if ($text === null || trim($text) === '') {
                continue;
            }
            [$id, $err] = self::matchOption($field, $text);
            if ($err !== null) {
                return [[], $err];
            }
            $ids[] = $id;
        }
        return [$ids, null];
    }

    /** @return array{0: ?string, 1: ?string} [id, error] */
    private static function matchOption(array $field, string $valueText): array
    {
        $options = $field['options'] ?? [];
        foreach ($options as $o) {
            if (($o['id'] ?? null) === $valueText) {
                return [$o['id'], null];
            }
        }
        foreach ($options as $o) {
            if (strcasecmp((string) ($o['label'] ?? ''), $valueText) === 0) {
                return [$o['id'], null];
            }
        }
        $label = $field['label'] ?? $field['id'] ?? '';
        $available = count($options) === 0 ? '(no options defined)' : implode(', ', array_map(
            static fn(array $o) => '"' . ($o['label'] ?? '') . '"',
            $options
        ));
        return [null, "\"{$valueText}\" is not a valid option for \"{$label}\". Available: {$available}."];
    }
}

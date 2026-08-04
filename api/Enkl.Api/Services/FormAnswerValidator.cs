using System.Text.Json;
using System.Text.Json.Nodes;

namespace Enkl.Api.Services;

/// <summary>
/// Validates an AI-Assistant-constructed AnswersJson object against a Form's own FieldsJson schema
/// before FormSubmissionService.CreateAsync/SubmitAsync ever sees it. AnswersJson is normally "opaque,
/// server-unvalidated" (see Domain/Entities/FormSubmission.cs's own doc comment) — that's fine for the
/// human fill-out UI, since the rendered widgets themselves (features/form-answers.js) already enforce
/// required/type/option constraints before an answer can even be typed in. An LLM constructing the same
/// blob from a schema description has no such guardrail (it can typo a field id, invent an option
/// value, or omit a required field), so this is a genuinely NEW validation path scoped to the AI
/// Assistant's submit_form tool only — not a retrofit of the existing human path, which is a real,
/// separate decision left for later (see AI-ASSISTANT.md).
///
/// Mirrors features/form-answers.js's own storage shape exactly (its module doc comment is the source
/// of truth this was written against): text/textarea -> string, numeric -> number, checkboxGroup ->
/// array of option ids, radio(single) -> bool, radio(mutexGroup)/select(single)/priority -> single
/// option id, radio(multiGroup)/select(multiple) -> array of option ids, datetime -> date string.
/// Option values may be given as either the real option id OR its label (case-insensitive) — normalized
/// to the real id in the cleaned output — same tolerance the existing assigneeName/typeName resolvers
/// already give the model elsewhere in this file, rather than requiring an exact opaque id match.
/// </summary>
public static class FormAnswerValidator
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    private class FieldOption { public string Id { get; set; } = ""; public string Label { get; set; } = ""; }
    private class FieldDef
    {
        public string Id { get; set; } = "";
        public string Type { get; set; } = "";
        public string Label { get; set; } = "";
        public string? HelpText { get; set; }
        public bool Required { get; set; }
        public bool Multiple { get; set; }
        public bool Mutex { get; set; }
        public string? GroupMode { get; set; }
        public List<FieldOption>? Options { get; set; }
    }

    /// <summary>Public projection of FieldDef for callers outside this file (AiAssistantService's
    /// get_form_fields tool) that need to describe a form's schema without duplicating the JSON parsing
    /// this class already does for <see cref="Validate"/> — same field-shape knowledge, one source.</summary>
    public record FieldSummary(
        string Id, string Type, string Label, string? HelpText, bool Required, bool Multiple, bool Mutex,
        string? GroupMode, List<(string Id, string Label)>? Options);

    /// <summary>Parses <paramref name="fieldsJson"/> into a display-ready field list — returns
    /// Ok=false with the same "could not be read" error <see cref="Validate"/> would surface, so a
    /// malformed FieldsJson blob is reported identically regardless of which tool call hit it
    /// first.</summary>
    public static (bool Ok, string? Error, List<FieldSummary> Fields) DescribeFields(string? fieldsJson)
    {
        List<FieldDef> fields;
        try { fields = JsonSerializer.Deserialize<List<FieldDef>>(fieldsJson ?? "[]", JsonOpts) ?? new(); }
        catch (JsonException) { return (false, "This form's field definitions could not be read.", new()); }

        var summaries = fields.Select(f => new FieldSummary(
            f.Id, f.Type, f.Label, f.HelpText, f.Required, f.Multiple, f.Mutex, f.GroupMode,
            f.Options?.Select(o => (o.Id, o.Label)).ToList())).ToList();
        return (true, null, summaries);
    }

    /// <summary>Parses <paramref name="fieldsJson"/>, validates every field's answer in
    /// <paramref name="answers"/>, and returns a clean, re-serialized AnswersJson containing only real
    /// field ids with normalized option values — any stray key the model supplied that doesn't match a
    /// real field id is silently dropped, same defensive-default posture as everywhere else in this
    /// codebase (never let unexpected model-shaped input reach storage verbatim). On failure, Error
    /// names the specific field and what's wrong, so the calling tool can hand it back to the model as
    /// an actionable message it can relay/ask about, rather than a generic failure.</summary>
    public static (bool Ok, string? Error, string AnswersJson) Validate(string? fieldsJson, JsonObject answers)
    {
        List<FieldDef> fields;
        try { fields = JsonSerializer.Deserialize<List<FieldDef>>(fieldsJson ?? "[]", JsonOpts) ?? new(); }
        catch (JsonException) { return (false, "This form's field definitions could not be read.", "{}"); }

        var clean = new JsonObject();
        foreach (var field in fields)
        {
            var provided = answers.TryGetPropertyValue(field.Id, out var rawValue) && rawValue is not null;
            var (isEmpty, error, normalized) = ValidateFieldValue(field, provided ? rawValue : null);
            if (error is not null) return (false, error, "{}");
            if (field.Required && isEmpty) return (false, $"The field \"{field.Label}\" is required.", "{}");
            if (provided && !isEmpty) clean[field.Id] = normalized;
        }

        return (true, null, clean.ToJsonString());
    }

    private static (bool IsEmpty, string? Error, JsonNode? Normalized) ValidateFieldValue(FieldDef field, JsonNode? value)
    {
        if (value is null) return (true, null, null);

        switch (field.Type)
        {
            case "text":
            case "textarea":
            {
                var s = AsString(value);
                if (s is null) return (false, $"The field \"{field.Label}\" must be text.", null);
                return (string.IsNullOrWhiteSpace(s), null, JsonValue.Create(s));
            }
            case "numeric":
            {
                var n = AsNumber(value);
                if (n is null) return (false, $"The field \"{field.Label}\" must be a number.", null);
                return (false, null, JsonValue.Create(n.Value));
            }
            case "datetime":
            {
                var s = AsString(value);
                if (string.IsNullOrWhiteSpace(s)) return (true, null, null);
                if (!DateTime.TryParse(s, out _)) return (false, $"The field \"{field.Label}\" must be a valid date (e.g. YYYY-MM-DD).", null);
                return (false, null, JsonValue.Create(s));
            }
            case "select":
            case "priority":
            {
                if (field.Multiple)
                {
                    var (ids, error) = ResolveOptionArray(field, value);
                    if (error is not null) return (false, error, null);
                    return (ids!.Count == 0, null, ToJsonArray(ids));
                }
                var single = AsString(value);
                if (string.IsNullOrWhiteSpace(single)) return (true, null, null);
                var (id, err) = MatchOption(field, single);
                if (err is not null) return (false, err, null);
                return (false, null, JsonValue.Create(id));
            }
            case "checkboxGroup":
            {
                var (ids, error) = ResolveOptionArray(field, value);
                if (error is not null) return (false, error, null);
                if (field.Mutex && ids!.Count > 1) return (false, $"Only one option may be selected for \"{field.Label}\".", null);
                return (ids!.Count == 0, null, ToJsonArray(ids));
            }
            case "radio" when field.GroupMode == "single":
            {
                var b = AsBool(value);
                if (b is null) return (false, $"The field \"{field.Label}\" must be true or false.", null);
                return (b != true, null, JsonValue.Create(b.Value));
            }
            case "radio" when field.GroupMode == "multiGroup":
            {
                var (ids, error) = ResolveOptionArray(field, value);
                if (error is not null) return (false, error, null);
                return (ids!.Count == 0, null, ToJsonArray(ids));
            }
            case "radio": // mutexGroup (the default when GroupMode is unset)
            {
                var single = AsString(value);
                if (string.IsNullOrWhiteSpace(single)) return (true, null, null);
                var (id, err) = MatchOption(field, single);
                if (err is not null) return (false, err, null);
                return (false, null, JsonValue.Create(id));
            }
            default:
                // An unrecognized field type (a future field type this validator hasn't been taught
                // about yet) — pass the raw value through unvalidated rather than blocking the whole
                // submission, same "never let a missing case break the primary flow" posture as
                // PortalQaImageResolver's own best-effort fallback.
                return (false, null, value.DeepClone());
        }
    }

    private static (List<string>? Ids, string? Error) ResolveOptionArray(FieldDef field, JsonNode value)
    {
        if (value is not JsonArray arr) return (null, $"The field \"{field.Label}\" must be a list of selected options.");
        var ids = new List<string>();
        foreach (var item in arr)
        {
            var text = AsString(item);
            if (string.IsNullOrWhiteSpace(text)) continue;
            var (id, err) = MatchOption(field, text);
            if (err is not null) return (null, err);
            ids.Add(id!);
        }
        return (ids, null);
    }

    private static (string? Id, string? Error) MatchOption(FieldDef field, string valueText)
    {
        var options = field.Options ?? new();
        var byId = options.FirstOrDefault(o => o.Id == valueText);
        if (byId is not null) return (byId.Id, null);
        var byLabel = options.FirstOrDefault(o => string.Equals(o.Label, valueText, StringComparison.OrdinalIgnoreCase));
        if (byLabel is not null) return (byLabel.Id, null);
        var available = options.Count == 0 ? "(no options defined)" : string.Join(", ", options.Select(o => $"\"{o.Label}\""));
        return (null, $"\"{valueText}\" is not a valid option for \"{field.Label}\". Available: {available}.");
    }

    private static JsonArray ToJsonArray(List<string> ids) => new(ids.Select(id => (JsonNode?)JsonValue.Create(id)).ToArray());

    private static string? AsString(JsonNode? node)
    {
        if (node is null) return null;
        try
        {
            var element = node.GetValue<JsonElement>();
            return element.ValueKind switch
            {
                JsonValueKind.String => element.GetString(),
                JsonValueKind.Number => element.ToString(),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                _ => null
            };
        }
        catch (InvalidOperationException) { return node.ToJsonString().Trim('"'); }
    }

    private static double? AsNumber(JsonNode? node)
    {
        if (node is null) return null;
        try
        {
            var element = node.GetValue<JsonElement>();
            if (element.ValueKind == JsonValueKind.Number) return element.GetDouble();
            if (element.ValueKind == JsonValueKind.String && double.TryParse(element.GetString(), out var parsed)) return parsed;
        }
        catch (InvalidOperationException) { /* fall through */ }
        return null;
    }

    private static bool? AsBool(JsonNode? node)
    {
        if (node is null) return null;
        try
        {
            var element = node.GetValue<JsonElement>();
            if (element.ValueKind == JsonValueKind.True) return true;
            if (element.ValueKind == JsonValueKind.False) return false;
            if (element.ValueKind == JsonValueKind.String)
            {
                var s = element.GetString();
                if (string.Equals(s, "true", StringComparison.OrdinalIgnoreCase)) return true;
                if (string.Equals(s, "false", StringComparison.OrdinalIgnoreCase)) return false;
            }
        }
        catch (InvalidOperationException) { /* fall through */ }
        return null;
    }
}

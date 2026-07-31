namespace Enkl.Api.Dtos;

/// <summary>Import Centre (root CLAUDE.md's own Import Centre notes) request shape — one entry per
/// tier/entity endpoint. Rows are a flat string-keyed map (both CSV and JSON sources normalize down
/// to this same shape client-side before ever reaching the server) rather than a typed per-entity
/// DTO, since the whole point is one generic transport shape reused across every entity's own import
/// endpoint; each entity's own service method is what actually knows which keys it expects.</summary>
public record ImportRequest(List<Dictionary<string, string?>> Rows, bool DryRun);

/// <summary>Data echoes back the row exactly as submitted (not the created entity) — this is what
/// lets the frontend's results table show "row 7: {the fields you sent}" next to its own outcome,
/// without a second round-trip to re-fetch what was created.</summary>
public record ImportRowResult(int Row, bool Success, string? Message, Dictionary<string, string?> Data);

public record ImportResult(int Total, int Succeeded, int Failed, List<ImportRowResult> Results);

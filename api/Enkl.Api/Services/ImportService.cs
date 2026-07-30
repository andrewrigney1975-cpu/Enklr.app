using Enkl.Api.Data;
using Enkl.Api.Dtos;
using Enkl.Api.Validation;

namespace Enkl.Api.Services;

/// <summary>
/// Import Centre's bulk-import execution engine (Phase 2: Organisation Users only — Team Members,
/// Teams &amp; Committees, and Portal Q&amp;A land in later phases, each getting their own method here
/// once built). Deliberately its own new service rather than an extension of MigrationService, which
/// wraps its entire import in ONE all-or-nothing transaction around the whole request (see that
/// service's own doc comment) — this needs the opposite shape: every row gets its OWN transaction,
/// independent of every other row, so one bad row in a 500-row file doesn't sink the other 499.
///
/// DryRun runs every row for real, through the exact same entity-creation service a committed import
/// would use (OrganisationService.CreateUserAsync here), so "would this succeed" can never diverge
/// from what actually happens on a real commit — it just always rolls back afterward regardless of
/// outcome, including any dependent rows that creation path might itself have written along the way.
/// </summary>
public class ImportService
{
    private readonly AppDbContext _db;
    private readonly OrganisationService _organisations;

    public ImportService(AppDbContext db, OrganisationService organisations)
    {
        _db = db;
        _organisations = organisations;
    }

    public async Task<ImportResult> ImportOrganisationUsersAsync(Guid organisationId, ImportRequest request)
    {
        var results = new List<ImportRowResult>();
        int succeeded = 0, failed = 0;

        for (int i = 0; i < request.Rows.Count; i++)
        {
            var row = request.Rows[i];
            int rowNumber = i + 1;
            await using var transaction = await _db.Database.BeginTransactionAsync();
            try
            {
                var username = RequireField(row, "username");
                var displayName = RequireField(row, "displayName");
                var password = RequireField(row, "password");
                var email = OptionalField(row, "email");

                await _organisations.CreateUserAsync(organisationId, new CreateUserRequest(username, displayName, password, email ?? ""));

                if (request.DryRun) await transaction.RollbackAsync();
                else await transaction.CommitAsync();

                results.Add(new ImportRowResult(rowNumber, true, null, row));
                succeeded++;
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                results.Add(new ImportRowResult(rowNumber, false, ex.Message, row));
                failed++;
            }
        }

        return new ImportResult(request.Rows.Count, succeeded, failed, results);
    }

    private static string RequireField(Dictionary<string, string?> row, string field)
    {
        if (!row.TryGetValue(field, out var value) || string.IsNullOrWhiteSpace(value))
        {
            throw new ApiValidationException($"\"{field}\" is required.");
        }
        return value.Trim();
    }

    private static string? OptionalField(Dictionary<string, string?> row, string field)
    {
        return row.TryGetValue(field, out var value) && !string.IsNullOrWhiteSpace(value) ? value.Trim() : null;
    }
}

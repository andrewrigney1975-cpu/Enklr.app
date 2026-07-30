using Enkl.Api.Data;
using Enkl.Api.Domain;
using Enkl.Api.Dtos;
using Enkl.Api.Validation;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// Import Centre's bulk-import execution engine (Phase 2: Organisation Users. Phase 4 (this pass):
/// Team Members. Teams &amp; Committees and Portal Q&amp;A land in later phases, each getting their own
/// method here once built). Deliberately its own new service rather than an extension of
/// MigrationService, which wraps its entire import in ONE all-or-nothing transaction around the
/// whole request (see that service's own doc comment) — this needs the opposite shape: every row
/// gets its OWN transaction, independent of every other row, so one bad row in a 500-row file
/// doesn't sink the other 499.
///
/// DryRun runs every row for real, through the exact same entity-creation service(s) a committed
/// import would use (OrganisationService.CreateUserAsync / MemberService.CreateAsync+UpdateAsync+
/// SetProjectAdminAsync), so "would this succeed" can never diverge from what actually happens on a
/// real commit — it just always rolls back afterward regardless of outcome, including any dependent
/// rows that creation path might itself have written along the way.
///
/// **Cross-row reference gotcha, inherent to per-row-transaction dry runs, not a bug**: Team
/// Members' optional `reportsTo` column names another row's own username. If that other row appears
/// EARLIER in the same file and is a brand-new person (not already an existing member before this
/// import started), a DRY RUN will roll that earlier row back before this row's `reportsTo` lookup
/// runs — so the lookup correctly reports "not a member of this project" even though the row "looks
/// like" it should resolve once actually committed. Only a real Commit makes an earlier row's own
/// creation durable enough for a later row in the same file to reference it. Document this for
/// anyone confused by a Test Run flagging a reportsTo that a Commit then accepts.
/// </summary>
public class ImportService
{
    private readonly AppDbContext _db;
    private readonly OrganisationService _organisations;
    private readonly MemberService _members;

    public ImportService(AppDbContext db, OrganisationService organisations, MemberService members)
    {
        _db = db;
        _organisations = organisations;
        _members = members;
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

    public async Task<ImportResult> ImportTeamMembersAsync(Guid organisationId, ImportRequest request)
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
                var projectKey = RequireField(row, "projectKey");
                var name = RequireField(row, "name");
                var email = OptionalField(row, "email");
                var role = OptionalField(row, "role");
                var allocatedFractionRaw = OptionalField(row, "allocatedFraction");
                var reportsToUsername = OptionalField(row, "reportsTo");
                var isProjectAdminRaw = OptionalField(row, "isProjectAdmin");

                // Re-derived server-side against the CALLER'S OWN org — never trust a client-
                // supplied key as-is (root CLAUDE.md's own cross-org-isolation pattern, applied here
                // to a project KEY instead of an id list). A key that exists in a different org is
                // indistinguishable from one that doesn't exist at all — same error either way, no
                // enumeration oracle.
                var project = await _db.Projects.AsNoTracking()
                    .FirstOrDefaultAsync(p => p.Key == projectKey && p.OrganisationId == organisationId);
                if (project is null)
                {
                    throw new ApiValidationException($"No project with key \"{projectKey}\" exists in your organisation.");
                }

                var created = await _members.CreateAsync(project.Id, new CreateMemberRequest(name, email))
                    ?? throw new ApiValidationException("Could not create the team member.");

                int? allocatedFraction = null;
                if (allocatedFractionRaw != null)
                {
                    if (!int.TryParse(allocatedFractionRaw, out var parsedFraction))
                    {
                        throw new ApiValidationException($"\"allocatedFraction\" must be a whole number, got \"{allocatedFractionRaw}\".");
                    }
                    allocatedFraction = parsedFraction;
                }

                // Resolved by username WITHIN this same project, then handed to UpdateAsync as a real
                // ProjectMember id — deliberately stricter than UpdateAsync's own interactive-UI
                // behavior (which silently falls back to "no manager" for an unresolvable id, since a
                // real dropdown can't offer an invalid option in the first place). A free-text CSV/
                // JSON column has no such guarantee, so an unresolvable reportsTo is a genuine,
                // reportable row error here, not something to quietly drop.
                Guid? reportsToId = null;
                if (reportsToUsername != null)
                {
                    var normalizedReportsTo = UsernameNormalizer.Normalize(reportsToUsername);
                    var reportsToMember = await _db.ProjectMembers.AsNoTracking()
                        .Include(m => m.User)
                        .FirstOrDefaultAsync(m => m.ProjectId == project.Id && m.User.NormalizedUsername == normalizedReportsTo);
                    if (reportsToMember is null)
                    {
                        throw new ApiValidationException($"\"reportsTo\" username \"{reportsToUsername}\" is not a member of project \"{projectKey}\".");
                    }
                    reportsToId = reportsToMember.Id;
                }

                if (role != null || allocatedFraction != null || reportsToId != null)
                {
                    await _members.UpdateAsync(project.Id, created.Id, new UpdateMemberRequest(name, role, allocatedFraction, reportsToId));
                }

                bool isProjectAdmin = isProjectAdminRaw != null &&
                    (isProjectAdminRaw.Equals("true", StringComparison.OrdinalIgnoreCase) || isProjectAdminRaw == "1");
                if (isProjectAdmin)
                {
                    await _members.SetProjectAdminAsync(project.Id, created.Id, true);
                }

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

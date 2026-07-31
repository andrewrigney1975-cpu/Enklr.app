using Enkl.Api.Data;
using Enkl.Api.Domain;
using Enkl.Api.Dtos;
using Enkl.Api.Validation;
using Microsoft.EntityFrameworkCore;

namespace Enkl.Api.Services;

/// <summary>
/// Import Centre's bulk-import execution engine (Phase 2: Organisation Users. Phase 4: Team Members.
/// Phase 5: Teams &amp; Committees. Phase 6 (this pass): Portal Q&amp;A). Deliberately its own new service
/// rather than an extension of
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
/// Members' optional `reportsTo` column (and Teams &amp; Committees' `parent`/`members` columns) name
/// another row's own username/name. If that other row appears EARLIER in the same file and is
/// brand-new (not already existing before this import started), a DRY RUN will roll that earlier
/// row back before this row's lookup runs — so the lookup correctly reports "not found" even though
/// the row "looks like" it should resolve once actually committed. Only a real Commit makes an
/// earlier row's own creation durable enough for a later row in the same file to reference it.
/// Document this for anyone confused by a Test Run flagging a reference that a Commit then accepts.
/// </summary>
public class ImportService
{
    private readonly AppDbContext _db;
    private readonly OrganisationService _organisations;
    private readonly MemberService _members;
    private readonly TeamCommitteeService _teamsCommittees;
    private readonly PortalService _portals;

    public ImportService(AppDbContext db, OrganisationService organisations, MemberService members, TeamCommitteeService teamsCommittees, PortalService portals)
    {
        _db = db;
        _organisations = organisations;
        _members = members;
        _teamsCommittees = teamsCommittees;
        _portals = portals;
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

    public async Task<ImportResult> ImportTeamsCommitteesAsync(Guid organisationId, ImportRequest request)
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
                var type = RequireField(row, "type");
                var description = OptionalField(row, "description");
                var parentName = OptionalField(row, "parent");
                var membersRaw = OptionalField(row, "members");

                if (type != "team" && type != "committee")
                {
                    throw new ApiValidationException($"\"type\" must be \"team\" or \"committee\", got \"{type}\".");
                }

                // Same cross-org re-derivation as ImportTeamMembersAsync above — never trust the
                // client-supplied key as-is.
                var project = await _db.Projects.AsNoTracking()
                    .FirstOrDefaultAsync(p => p.Key == projectKey && p.OrganisationId == organisationId);
                if (project is null)
                {
                    throw new ApiValidationException($"No project with key \"{projectKey}\" exists in your organisation.");
                }

                // Resolved by NAME within this same project, then handed to CreateAsync as a real id —
                // deliberately stricter than CreateAsync's own interactive-UI behavior (which silently
                // drops an unresolvable ParentId to null, since a real dropdown can't offer an invalid
                // option in the first place). A free-text CSV/JSON column has no such guarantee, so an
                // unresolvable parent is a genuine, reportable row error here, not something to
                // quietly drop.
                Guid? parentId = null;
                if (parentName != null)
                {
                    var parent = await _db.TeamsCommittees.AsNoTracking()
                        .FirstOrDefaultAsync(t => t.ProjectId == project.Id && t.Name == parentName);
                    if (parent is null)
                    {
                        throw new ApiValidationException($"\"parent\" \"{parentName}\" was not found among Teams & Committees in project \"{projectKey}\".");
                    }
                    parentId = parent.Id;
                }

                // Semicolon-separated usernames, each resolved to a ProjectMember WITHIN this same
                // project — same strictness rationale as parent above.
                List<Guid>? memberIds = null;
                if (membersRaw != null)
                {
                    memberIds = new List<Guid>();
                    foreach (var rawUsername in membersRaw.Split(';', StringSplitOptions.RemoveEmptyEntries))
                    {
                        var username = rawUsername.Trim();
                        if (username.Length == 0) continue;
                        var normalizedUsername = UsernameNormalizer.Normalize(username);
                        var member = await _db.ProjectMembers.AsNoTracking()
                            .Include(m => m.User)
                            .FirstOrDefaultAsync(m => m.ProjectId == project.Id && m.User.NormalizedUsername == normalizedUsername);
                        if (member is null)
                        {
                            throw new ApiValidationException($"\"members\" username \"{username}\" is not a member of project \"{projectKey}\".");
                        }
                        memberIds.Add(member.Id);
                    }
                }

                var created = await _teamsCommittees.CreateAsync(project.Id, new CreateTeamCommitteeRequest(name, description, type, parentId, memberIds))
                    ?? throw new ApiValidationException("Could not create the team/committee.");

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

    public async Task<ImportResult> ImportPortalQaAsync(Guid organisationId, Guid callerUserId, ImportRequest request)
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
                var portalRef = RequireField(row, "portal");
                var question = RequireField(row, "question");
                var topicName = OptionalField(row, "topic");
                var answer = OptionalField(row, "answer");
                var orderRaw = OptionalField(row, "order");

                // Re-derived server-side against the CALLER'S OWN org — matched by slug OR name,
                // same cross-org-isolation rationale as projectKey above, applied to a Portal
                // reference instead.
                var portal = await _db.Portals.AsNoTracking()
                    .FirstOrDefaultAsync(p => p.OrganisationId == organisationId && (p.Slug == portalRef || p.Name == portalRef));
                if (portal is null)
                {
                    throw new ApiValidationException($"No Portal with slug or name \"{portalRef}\" exists in your organisation.");
                }

                // Resolved by NAME within this same Portal, then handed to CreateQaEntryAsync as a
                // real id — a free-text CSV/JSON column has no dropdown-style guarantee of validity,
                // so an unresolvable topic is a genuine, reportable row error, not something to
                // silently leave the entry ungrouped.
                Guid? topicId = null;
                if (topicName != null)
                {
                    var topic = await _db.PortalTopics.AsNoTracking()
                        .FirstOrDefaultAsync(t => t.PortalId == portal.Id && t.Title == topicName);
                    if (topic is null)
                    {
                        throw new ApiValidationException($"\"topic\" \"{topicName}\" was not found on Portal \"{portalRef}\".");
                    }
                    topicId = topic.Id;
                }

                int order;
                if (orderRaw != null)
                {
                    if (!int.TryParse(orderRaw, out order))
                    {
                        throw new ApiValidationException($"\"order\" must be a whole number, got \"{orderRaw}\".");
                    }
                }
                else
                {
                    // "Defaults to appending at the end" — one past whatever's currently the highest
                    // Order among this Portal's existing entries (0 if there are none yet).
                    var maxOrder = await _db.PortalQaEntries.Where(e => e.PortalId == portal.Id)
                        .Select(e => (int?)e.Order).MaxAsync();
                    order = (maxOrder ?? -1) + 1;
                }

                var created = await _portals.CreateQaEntryAsync(organisationId, portal.Id, callerUserId, new CreatePortalQaEntryRequest(question, answer, topicId, order))
                    ?? throw new ApiValidationException("Could not create the Portal Q&A entry.");

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

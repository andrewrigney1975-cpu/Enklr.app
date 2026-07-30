using Enkl.Api.Data;
using Enkl.Api.Domain;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Enkl.Api.Tests;

/// <summary>
/// Coverage for ImportService.ImportOrganisationUsersAsync — Import Centre Phase 2's first entity.
/// Direct service-call style, same as OrganisationServiceTests.cs. Focuses on the two things this
/// service actually adds over plain OrganisationService.CreateUserAsync: per-row transactional
/// independence (one bad row doesn't sink the others) and DryRun's "runs for real, always rolls
/// back" semantics.
/// </summary>
[Collection("Postgres API collection")]
public class ImportServiceTests
{
    private readonly PostgresApiFixture _fixture;

    public ImportServiceTests(PostgresApiFixture fixture)
    {
        _fixture = fixture;
    }

    private static Dictionary<string, string?> UserRow(string username, string? email = null) => new()
    {
        ["username"] = username,
        ["displayName"] = "Imported " + username,
        ["password"] = "ImportedPass1!",
        ["email"] = email ?? (username + "@example.com")
    };

    [Fact]
    public async Task Commit_ValidRow_ActuallyPersistsTheUser()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var username = TestDataHelper.Unique("importeduser");

        var result = await import.ImportOrganisationUsersAsync(org.Id, new ImportRequest(new() { UserRow(username) }, DryRun: false));

        Assert.Equal(1, result.Total);
        Assert.Equal(1, result.Succeeded);
        Assert.Equal(0, result.Failed);
        Assert.True(result.Results[0].Success);
        Assert.Equal(1, result.Results[0].Row);

        var normalized = UsernameNormalizer.Normalize(username);
        var persisted = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.NormalizedUsername == normalized);
        Assert.NotNull(persisted);
        Assert.Equal(org.Id, persisted!.OrganisationId);
    }

    [Fact]
    public async Task DryRun_ValidRow_ReportsSuccess_ButDoesNotPersistAnything()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var username = TestDataHelper.Unique("dryrunuser");

        var result = await import.ImportOrganisationUsersAsync(org.Id, new ImportRequest(new() { UserRow(username) }, DryRun: true));

        Assert.Equal(1, result.Succeeded);
        Assert.True(result.Results[0].Success);

        var normalized = UsernameNormalizer.Normalize(username);
        var persisted = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.NormalizedUsername == normalized);
        Assert.Null(persisted);
    }

    [Fact]
    public async Task MissingRequiredField_FailsThatRowWithAClearMessage_WithoutThrowing()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var row = UserRow(TestDataHelper.Unique("nopassuser"));
        row.Remove("password");

        var result = await import.ImportOrganisationUsersAsync(org.Id, new ImportRequest(new() { row }, DryRun: false));

        Assert.Equal(0, result.Succeeded);
        Assert.Equal(1, result.Failed);
        Assert.False(result.Results[0].Success);
        Assert.Contains("password", result.Results[0].Message);
    }

    [Fact]
    public async Task MissingEmail_FailsThatRow_OrganisationUsersEmailIsEffectivelyRequired()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var row = UserRow(TestDataHelper.Unique("noemailuser"));
        row.Remove("email");

        var result = await import.ImportOrganisationUsersAsync(org.Id, new ImportRequest(new() { row }, DryRun: false));

        Assert.Equal(0, result.Succeeded);
        Assert.False(result.Results[0].Success);
        Assert.Contains("email", result.Results[0].Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task OneBadRowAmongGoodOnes_DoesNotSinkTheOthers_EachRowIsIndependent()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var goodUsername1 = TestDataHelper.Unique("gooduser1");
        var goodUsername2 = TestDataHelper.Unique("gooduser2");
        var badRow = UserRow(TestDataHelper.Unique("badrowuser"));
        badRow.Remove("password");

        var rows = new List<Dictionary<string, string?>> { UserRow(goodUsername1), badRow, UserRow(goodUsername2) };
        var result = await import.ImportOrganisationUsersAsync(org.Id, new ImportRequest(rows, DryRun: false));

        Assert.Equal(3, result.Total);
        Assert.Equal(2, result.Succeeded);
        Assert.Equal(1, result.Failed);

        Assert.True(result.Results[0].Success);
        Assert.Equal(1, result.Results[0].Row);
        Assert.False(result.Results[1].Success);
        Assert.Equal(2, result.Results[1].Row);
        Assert.True(result.Results[2].Success);
        Assert.Equal(3, result.Results[2].Row);

        var normalized1 = UsernameNormalizer.Normalize(goodUsername1);
        var normalized2 = UsernameNormalizer.Normalize(goodUsername2);
        Assert.NotNull(await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.NormalizedUsername == normalized1));
        Assert.NotNull(await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.NormalizedUsername == normalized2));
    }

    [Fact]
    public async Task DuplicateUsernameWithinSameBatch_SecondRowFails_FirstRowStillCommitted()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var username = TestDataHelper.Unique("dupeuser");

        var rows = new List<Dictionary<string, string?>> { UserRow(username), UserRow(username) };
        var result = await import.ImportOrganisationUsersAsync(org.Id, new ImportRequest(rows, DryRun: false));

        Assert.Equal(1, result.Succeeded);
        Assert.Equal(1, result.Failed);
        Assert.True(result.Results[0].Success);
        Assert.False(result.Results[1].Success);
        Assert.Contains("already taken", result.Results[1].Message);
    }

    // ── Team Members (Phase 4) ─────────────────────────────────────────────────────────────────

    private static Dictionary<string, string?> MemberRow(string projectKey, string name, string? email = null, string? role = null, string? allocatedFraction = null, string? reportsTo = null, string? isProjectAdmin = null)
    {
        var row = new Dictionary<string, string?> { ["projectKey"] = projectKey, ["name"] = name, ["email"] = email ?? (UsernameNormalizer.Normalize(name) + "@example.com") };
        if(role != null) row["role"] = role;
        if(allocatedFraction != null) row["allocatedFraction"] = allocatedFraction;
        if(reportsTo != null) row["reportsTo"] = reportsTo;
        if(isProjectAdmin != null) row["isProjectAdmin"] = isProjectAdmin;
        return row;
    }

    [Fact]
    public async Task ImportTeamMembers_Commit_ValidRow_ActuallyAddsTheMember()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("P"), owner);

        var result = await import.ImportTeamMembersAsync(org.Id, new ImportRequest(new() { MemberRow(project.Key, "Imported Member") }, DryRun: false));

        Assert.Equal(1, result.Succeeded);
        var member = await db.ProjectMembers.AsNoTracking().Include(m => m.User).FirstOrDefaultAsync(m => m.ProjectId == project.Id && m.User.DisplayName == "Imported Member");
        Assert.NotNull(member);
    }

    [Fact]
    public async Task ImportTeamMembers_UnknownProjectKey_FailsThatRow()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));

        var result = await import.ImportTeamMembersAsync(org.Id, new ImportRequest(new() { MemberRow("NOSUCHKEY", "Someone") }, DryRun: false));

        Assert.Equal(0, result.Succeeded);
        Assert.Contains("No project with key", result.Results[0].Message);
    }

    [Fact]
    public async Task ImportTeamMembers_ProjectKeyBelongingToAnotherOrg_FailsWithTheSameNotFoundMessage()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var (otherOrg, otherOwner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("otherOrg"), TestDataHelper.Unique("otherAdmin"));
        var otherOrgProject = await TestDataHelper.SeedProjectAsync(db, otherOrg.Id, TestDataHelper.Unique("P"), otherOwner);

        // Caller is `org`, but the key belongs to `otherOrg` — must fail exactly like a nonexistent
        // key (no-enumeration-oracle: never let an org admin distinguish "not yours" from "doesn't exist").
        var result = await import.ImportTeamMembersAsync(org.Id, new ImportRequest(new() { MemberRow(otherOrgProject.Key, "Someone") }, DryRun: false));

        Assert.Equal(0, result.Succeeded);
        Assert.Contains("No project with key", result.Results[0].Message);
    }

    [Fact]
    public async Task ImportTeamMembers_SetsRoleAllocatedFractionAndIsProjectAdmin()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("P"), owner);

        var result = await import.ImportTeamMembersAsync(org.Id, new ImportRequest(new() {
            MemberRow(project.Key, "Admin Member", role: "Lead", allocatedFraction: "75", isProjectAdmin: "true")
        }, DryRun: false));

        Assert.Equal(1, result.Succeeded);
        var member = await db.ProjectMembers.AsNoTracking().Include(m => m.User).FirstAsync(m => m.ProjectId == project.Id && m.User.DisplayName == "Admin Member");
        Assert.Equal("Lead", member.Role);
        Assert.Equal(75, member.AllocatedFraction);
        Assert.True(member.IsProjectAdmin);
    }

    [Fact]
    public async Task ImportTeamMembers_ReportsToAnAlreadyExistingMember_ResolvesCorrectly()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("P"), owner);
        var manager = await TestDataHelper.SeedUserInOrgAsync(db, org.Id, TestDataHelper.Unique("manager"));
        db.ProjectMembers.Add(new Domain.Entities.ProjectMember { Id = Guid.NewGuid(), ProjectId = project.Id, UserId = manager.Id, Color = "#000000" });
        await db.SaveChangesAsync();

        var result = await import.ImportTeamMembersAsync(org.Id, new ImportRequest(new() {
            MemberRow(project.Key, "Reports To Manager", reportsTo: manager.Username)
        }, DryRun: false));

        Assert.Equal(1, result.Succeeded);
        var member = await db.ProjectMembers.AsNoTracking().Include(m => m.User).FirstAsync(m => m.ProjectId == project.Id && m.User.DisplayName == "Reports To Manager");
        var managerMember = await db.ProjectMembers.AsNoTracking().FirstAsync(m => m.ProjectId == project.Id && m.UserId == manager.Id);
        Assert.Equal(managerMember.Id, member.ReportsToId);
    }

    [Fact]
    public async Task ImportTeamMembers_ReportsToAnUnresolvableUsername_FailsThatRowWithAClearMessage()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("P"), owner);

        var result = await import.ImportTeamMembersAsync(org.Id, new ImportRequest(new() {
            MemberRow(project.Key, "Nobody Manages Me", reportsTo: "nosuchperson")
        }, DryRun: false));

        Assert.Equal(0, result.Succeeded);
        Assert.Contains("reportsTo", result.Results[0].Message);
        Assert.Contains("is not a member of project", result.Results[0].Message);
    }

    [Fact]
    public async Task ImportTeamMembers_InvalidAllocatedFraction_FailsThatRowWithAClearMessage()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("P"), owner);

        var result = await import.ImportTeamMembersAsync(org.Id, new ImportRequest(new() {
            MemberRow(project.Key, "Bad Fraction", allocatedFraction: "not-a-number")
        }, DryRun: false));

        Assert.Equal(0, result.Succeeded);
        Assert.Contains("allocatedFraction", result.Results[0].Message);
    }

    [Fact]
    public async Task ImportTeamMembers_DryRun_DoesNotActuallyAddTheMember()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("P"), owner);

        var result = await import.ImportTeamMembersAsync(org.Id, new ImportRequest(new() { MemberRow(project.Key, "Dry Run Member") }, DryRun: true));

        Assert.Equal(1, result.Succeeded);
        var member = await db.ProjectMembers.AsNoTracking().Include(m => m.User).FirstOrDefaultAsync(m => m.ProjectId == project.Id && m.User.DisplayName == "Dry Run Member");
        Assert.Null(member);
    }

    // ── Teams & Committees (Phase 5) ───────────────────────────────────────────────────────────

    private static Dictionary<string, string?> TeamRow(string projectKey, string name, string type = "team", string? description = null, string? parent = null, string? members = null)
    {
        var row = new Dictionary<string, string?> { ["projectKey"] = projectKey, ["name"] = name, ["type"] = type };
        if (description != null) row["description"] = description;
        if (parent != null) row["parent"] = parent;
        if (members != null) row["members"] = members;
        return row;
    }

    [Fact]
    public async Task ImportTeamsCommittees_Commit_ValidRow_ActuallyPersistsIt()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("P"), owner);

        var result = await import.ImportTeamsCommitteesAsync(org.Id, new ImportRequest(new() { TeamRow(project.Key, "Imported Team", type: "committee", description: "A committee") }, DryRun: false));

        Assert.Equal(1, result.Succeeded);
        var tc = await db.TeamsCommittees.AsNoTracking().FirstOrDefaultAsync(t => t.ProjectId == project.Id && t.Name == "Imported Team");
        Assert.NotNull(tc);
        Assert.Equal("committee", tc!.Type);
        Assert.Equal("A committee", tc.Description);
    }

    [Fact]
    public async Task ImportTeamsCommittees_UnknownProjectKey_FailsThatRow()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));

        var result = await import.ImportTeamsCommitteesAsync(org.Id, new ImportRequest(new() { TeamRow("NOSUCHKEY", "Someone's Team") }, DryRun: false));

        Assert.Equal(0, result.Succeeded);
        Assert.Contains("No project with key", result.Results[0].Message);
    }

    [Fact]
    public async Task ImportTeamsCommittees_ProjectKeyBelongingToAnotherOrg_FailsWithTheSameNotFoundMessage()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var (otherOrg, otherOwner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("otherOrg"), TestDataHelper.Unique("otherAdmin"));
        var otherOrgProject = await TestDataHelper.SeedProjectAsync(db, otherOrg.Id, TestDataHelper.Unique("P"), otherOwner);

        var result = await import.ImportTeamsCommitteesAsync(org.Id, new ImportRequest(new() { TeamRow(otherOrgProject.Key, "Someone's Team") }, DryRun: false));

        Assert.Equal(0, result.Succeeded);
        Assert.Contains("No project with key", result.Results[0].Message);
    }

    [Fact]
    public async Task ImportTeamsCommittees_InvalidType_FailsThatRowWithAClearMessage()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("P"), owner);

        var result = await import.ImportTeamsCommitteesAsync(org.Id, new ImportRequest(new() { TeamRow(project.Key, "Bad Type Team", type: "not-a-real-type") }, DryRun: false));

        Assert.Equal(0, result.Succeeded);
        Assert.Contains("\"type\"", result.Results[0].Message);
    }

    [Fact]
    public async Task ImportTeamsCommittees_ParentResolvesToAnAlreadyExistingTeamCommittee()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("P"), owner);
        var teamsCommittees = scope.ServiceProvider.GetRequiredService<TeamCommitteeService>();
        var parentDto = await teamsCommittees.CreateAsync(project.Id, new CreateTeamCommitteeRequest("Parent Team", null, "team", null, null));

        var result = await import.ImportTeamsCommitteesAsync(org.Id, new ImportRequest(new() { TeamRow(project.Key, "Child Team", parent: "Parent Team") }, DryRun: false));

        Assert.Equal(1, result.Succeeded);
        var child = await db.TeamsCommittees.AsNoTracking().FirstAsync(t => t.ProjectId == project.Id && t.Name == "Child Team");
        Assert.Equal(parentDto!.Id, child.ParentId);
    }

    [Fact]
    public async Task ImportTeamsCommittees_UnresolvableParent_FailsThatRowWithAClearMessage()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("P"), owner);

        var result = await import.ImportTeamsCommitteesAsync(org.Id, new ImportRequest(new() { TeamRow(project.Key, "Orphan Team", parent: "No Such Parent") }, DryRun: false));

        Assert.Equal(0, result.Succeeded);
        Assert.Contains("\"parent\"", result.Results[0].Message);
    }

    [Fact]
    public async Task ImportTeamsCommittees_MembersResolveToExistingProjectMembers()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("P"), owner);
        var user1 = await TestDataHelper.SeedUserInOrgAsync(db, org.Id, TestDataHelper.Unique("member1"));
        var pm1 = new Domain.Entities.ProjectMember { Id = Guid.NewGuid(), ProjectId = project.Id, UserId = user1.Id, Color = "#000000" };
        db.ProjectMembers.Add(pm1);
        await db.SaveChangesAsync();

        var result = await import.ImportTeamsCommitteesAsync(org.Id, new ImportRequest(new() { TeamRow(project.Key, "Staffed Team", members: user1.Username) }, DryRun: false));

        Assert.Equal(1, result.Succeeded);
        var tc = await db.TeamsCommittees.AsNoTracking().Include(t => t.Members).FirstAsync(t => t.ProjectId == project.Id && t.Name == "Staffed Team");
        Assert.Contains(tc.Members, m => m.ProjectMemberId == pm1.Id);
    }

    [Fact]
    public async Task ImportTeamsCommittees_UnresolvableMemberUsername_FailsThatRowWithAClearMessage()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("P"), owner);

        var result = await import.ImportTeamsCommitteesAsync(org.Id, new ImportRequest(new() { TeamRow(project.Key, "Bad Members Team", members: "nosuchperson") }, DryRun: false));

        Assert.Equal(0, result.Succeeded);
        Assert.Contains("\"members\"", result.Results[0].Message);
        Assert.Contains("is not a member of project", result.Results[0].Message);
    }

    [Fact]
    public async Task ImportTeamsCommittees_DryRun_DoesNotActuallyPersistIt()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var import = scope.ServiceProvider.GetRequiredService<ImportService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("admin"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("P"), owner);

        var result = await import.ImportTeamsCommitteesAsync(org.Id, new ImportRequest(new() { TeamRow(project.Key, "Dry Run Team") }, DryRun: true));

        Assert.Equal(1, result.Succeeded);
        var tc = await db.TeamsCommittees.AsNoTracking().FirstOrDefaultAsync(t => t.ProjectId == project.Id && t.Name == "Dry Run Team");
        Assert.Null(tc);
    }
}

using Enkl.Api.Data;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Enkl.Api.Validation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Enkl.Api.Tests;

/// <summary>
/// Project Administrator role coverage: the "project owner is by default a Project Admin" default,
/// and MemberService's last-admin guard (a project must always keep at least one Project Admin, or
/// nobody left could ever reach the "manage team members" capability that grants the role at all).
/// Direct service-call style, same as MigrationServiceTests.cs/PortfolioServiceTests.cs — what's
/// under test here is business logic, not the HTTP/auth pipeline (that's AuthTests.cs's job).
/// </summary>
[Collection("Postgres API collection")]
public class MemberServiceTests
{
    private readonly PostgresApiFixture _fixture;

    public MemberServiceTests(PostgresApiFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task ProjectService_CreateAsync_MakesCreatorAProjectAdmin()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var projects = scope.ServiceProvider.GetRequiredService<ProjectService>();

        var (_, user) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("user"));

        var result = await projects.CreateAsync(user.Id, new CreateProjectRequest(TestDataHelper.Unique("New Project"), TestDataHelper.Unique("PRJ"), null, null));

        Assert.NotNull(result);
        var member = result!.Project!.Members.Single(m => m.UserId == user.Id);
        Assert.True(member.IsProjectAdmin);
    }

    [Fact]
    public async Task SetProjectAdminAsync_PromotesAndDemotesWhenAnotherAdminRemains()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var members = scope.ServiceProvider.GetRequiredService<MemberService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("owner"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"), owner, memberIsProjectAdmin: true);
        var (_, otherUser) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org2"), TestDataHelper.Unique("other"));
        // Second member added directly (not via MemberService.CreateAsync, which requires a real
        // email round trip) — the point here is testing the admin-toggle guard, not member creation.
        var secondMemberId = Guid.NewGuid();
        db.ProjectMembers.Add(new Domain.Entities.ProjectMember { Id = secondMemberId, ProjectId = project.Id, UserId = otherUser.Id, Color = "#123456" });
        await db.SaveChangesAsync();

        var promoted = await members.SetProjectAdminAsync(project.Id, secondMemberId, true);
        Assert.NotNull(promoted);
        Assert.True(promoted!.IsProjectAdmin);

        // Now two admins exist, so demoting the original owner is allowed.
        var ownerMemberId = await db.ProjectMembers.Where(m => m.ProjectId == project.Id && m.UserId == owner.Id).Select(m => m.Id).SingleAsync();
        var demoted = await members.SetProjectAdminAsync(project.Id, ownerMemberId, false);
        Assert.NotNull(demoted);
        Assert.False(demoted!.IsProjectAdmin);
    }

    [Fact]
    public async Task SetProjectAdminAsync_RejectsDemotingTheOnlyProjectAdmin()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var members = scope.ServiceProvider.GetRequiredService<MemberService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("owner"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"), owner, memberIsProjectAdmin: true);
        var ownerMemberId = await db.ProjectMembers.Where(m => m.ProjectId == project.Id && m.UserId == owner.Id).Select(m => m.Id).SingleAsync();

        var ex = await Assert.ThrowsAsync<ApiValidationException>(() => members.SetProjectAdminAsync(project.Id, ownerMemberId, false));
        Assert.Contains("at least one Project Admin", ex.Message);

        // Confirm nothing actually changed in the DB — a rejected demotion must not partially apply.
        var stillAdmin = await db.ProjectMembers.Where(m => m.Id == ownerMemberId).Select(m => m.IsProjectAdmin).SingleAsync();
        Assert.True(stillAdmin);
    }

    [Fact]
    public async Task DeleteAsync_RejectsRemovingTheOnlyProjectAdmin()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var members = scope.ServiceProvider.GetRequiredService<MemberService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("owner"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"), owner, memberIsProjectAdmin: true);
        var ownerMemberId = await db.ProjectMembers.Where(m => m.ProjectId == project.Id && m.UserId == owner.Id).Select(m => m.Id).SingleAsync();

        await Assert.ThrowsAsync<ApiValidationException>(() => members.DeleteAsync(project.Id, ownerMemberId));

        Assert.True(await db.ProjectMembers.AnyAsync(m => m.Id == ownerMemberId));
    }

    [Fact]
    public async Task DeleteAsync_AllowsRemovingAProjectAdminWhenAnotherRemains()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var members = scope.ServiceProvider.GetRequiredService<MemberService>();

        var (org, owner) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("owner"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"), owner, memberIsProjectAdmin: true);
        var (_, otherUser) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org2"), TestDataHelper.Unique("other"));
        var secondMemberId = Guid.NewGuid();
        db.ProjectMembers.Add(new Domain.Entities.ProjectMember { Id = secondMemberId, ProjectId = project.Id, UserId = otherUser.Id, Color = "#123456", IsProjectAdmin = true });
        await db.SaveChangesAsync();

        var ownerMemberId = await db.ProjectMembers.Where(m => m.ProjectId == project.Id && m.UserId == owner.Id).Select(m => m.Id).SingleAsync();
        var deleted = await members.DeleteAsync(project.Id, ownerMemberId);

        Assert.True(deleted);
        Assert.False(await db.ProjectMembers.AnyAsync(m => m.Id == ownerMemberId));
    }
}

using Enkl.Api.Data;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Enkl.Api.Validation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Enkl.Api.Tests;

/// <summary>
/// ARCHITECTURE-REVIEW.md finding 2.5 — none of the existing test coverage exercises the services
/// FluentValidation was wired into (MemberService/OrganisationService/RetrospectiveService/
/// TemplateService/ToDoService), so "the build succeeds and other tests still pass" wouldn't catch a
/// DI registration mistake (a missing/wrong-lifetime IValidator&lt;T&gt; only surfaces as a runtime
/// InvalidOperationException the first time a controller resolves it, not at compile time). These
/// tests exist specifically to prove the validators are actually wired end to end, not just that the
/// code compiles — one blank-input-rejected + one valid-input-accepted pair is enough to prove DI
/// resolution works; if it works for one IValidator&lt;T&gt; registered via
/// AddValidatorsFromAssemblyContaining, it works for all of them (same registration mechanism, not
/// individually hand-wired).
/// </summary>
[Collection("Postgres API collection")]
public class FluentValidationTests
{
    private readonly PostgresApiFixture _fixture;

    public FluentValidationTests(PostgresApiFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task MemberService_CreateAsync_RejectsBlankName()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var members = scope.ServiceProvider.GetRequiredService<MemberService>();

        var (_, project) = await SeedOrgAndProjectAsync(db);

        var ex = await Assert.ThrowsAsync<ApiValidationException>(
            () => members.CreateAsync(project, new CreateMemberRequest("   ", null)));
        Assert.Equal("Please enter a name.", ex.Message);
    }

    [Fact]
    public async Task MemberService_CreateAsync_AcceptsValidName()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var members = scope.ServiceProvider.GetRequiredService<MemberService>();

        var (_, project) = await SeedOrgAndProjectAsync(db);

        var result = await members.CreateAsync(project, new CreateMemberRequest(TestDataHelper.Unique("Member"), $"{TestDataHelper.Unique("member")}@example.com"));
        Assert.NotNull(result);
    }

    [Fact]
    public async Task ToDoService_CreateListAsync_RejectsBlankTitle()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var todo = scope.ServiceProvider.GetRequiredService<ToDoService>();

        var (_, seededUser) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("user"));

        var ex = await Assert.ThrowsAsync<ApiValidationException>(
            () => todo.CreateListAsync(seededUser.Id, new CreateToDoListRequest("")));
        Assert.Equal("Please enter a list title.", ex.Message);
    }

    [Fact]
    public async Task OrganisationService_CreateUserAsync_RejectsShortPassword()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var organisations = scope.ServiceProvider.GetRequiredService<OrganisationService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("user"));

        var ex = await Assert.ThrowsAsync<ApiValidationException>(() => organisations.CreateUserAsync(
            org.Id, new CreateUserRequest(TestDataHelper.Unique("newuser"), "New User", "short", "new@example.com")));
        Assert.Equal("Password must be at least 8 characters.", ex.Message);
    }

    private static async Task<(Guid OrgId, Guid ProjectId)> SeedOrgAndProjectAsync(AppDbContext db)
    {
        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("user"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"));
        return (org.Id, project.Id);
    }
}

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
}

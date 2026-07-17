using Enkl.Api.Data;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Enkl.Api.Tests;

/// <summary>
/// SavedQuery is a flat, project-scoped entity (Advanced Query library, features/query-engine.js on
/// the frontend). Originally Create + Delete only; Update was added for the "Update Query" button
/// (overwriting the loaded saved query's SQL in place). Covers the create/update/delete round trip
/// plus not-found paths for each.
/// </summary>
[Collection("Postgres API collection")]
public class SavedQueryServiceTests
{
    private readonly PostgresApiFixture _fixture;

    public SavedQueryServiceTests(PostgresApiFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task CreateAsync_CreatesSavedQueryForExistingProject()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var savedQueries = scope.ServiceProvider.GetRequiredService<SavedQueryService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("user"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"));

        var result = await savedQueries.CreateAsync(project.Id, new CreateSavedQueryRequest("All tasks", "SELECT * FROM tasks"));

        Assert.NotNull(result);
        Assert.Equal("All tasks", result!.Name);
        Assert.Equal("SELECT * FROM tasks", result.Sql);

        var row = await db.SavedQueries.FindAsync(result.Id);
        Assert.NotNull(row);
        Assert.Equal(project.Id, row!.ProjectId);
    }

    [Fact]
    public async Task CreateAsync_ReturnsNullForNonexistentProject()
    {
        using var scope = _fixture.CreateScope();
        var savedQueries = scope.ServiceProvider.GetRequiredService<SavedQueryService>();

        var result = await savedQueries.CreateAsync(Guid.NewGuid(), new CreateSavedQueryRequest("Name", "SELECT 1"));

        Assert.Null(result);
    }

    [Fact]
    public async Task UpdateAsync_OverwritesNameAndSql()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var savedQueries = scope.ServiceProvider.GetRequiredService<SavedQueryService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("user"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"));
        var created = await savedQueries.CreateAsync(project.Id, new CreateSavedQueryRequest("All tasks", "SELECT * FROM tasks"));

        var updated = await savedQueries.UpdateAsync(project.Id, created!.Id, new CreateSavedQueryRequest("All tasks", "SELECT * FROM tasks WHERE priority = 'high'"));

        Assert.NotNull(updated);
        Assert.Equal("All tasks", updated!.Name);
        Assert.Equal("SELECT * FROM tasks WHERE priority = 'high'", updated.Sql);

        var row = await db.SavedQueries.FindAsync(created.Id);
        Assert.Equal("SELECT * FROM tasks WHERE priority = 'high'", row!.Sql);
    }

    [Fact]
    public async Task UpdateAsync_ReturnsNullForWrongProjectOrMissingId()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var savedQueries = scope.ServiceProvider.GetRequiredService<SavedQueryService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("user"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"));
        var otherProject = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"));
        var created = await savedQueries.CreateAsync(project.Id, new CreateSavedQueryRequest("Temp", "SELECT 1"));

        Assert.Null(await savedQueries.UpdateAsync(otherProject.Id, created!.Id, new CreateSavedQueryRequest("Temp", "SELECT 2")));
        Assert.Null(await savedQueries.UpdateAsync(project.Id, Guid.NewGuid(), new CreateSavedQueryRequest("Temp", "SELECT 2")));
    }

    [Fact]
    public async Task DeleteAsync_RemovesRowAndReturnsTrue()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var savedQueries = scope.ServiceProvider.GetRequiredService<SavedQueryService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("user"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"));
        var created = await savedQueries.CreateAsync(project.Id, new CreateSavedQueryRequest("Temp", "SELECT 1"));

        var deleted = await savedQueries.DeleteAsync(project.Id, created!.Id);

        Assert.True(deleted);
        Assert.Null(await db.SavedQueries.FindAsync(created.Id));
    }

    [Fact]
    public async Task DeleteAsync_ReturnsFalseForWrongProjectOrMissingId()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var savedQueries = scope.ServiceProvider.GetRequiredService<SavedQueryService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("user"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"));
        var otherProject = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"));
        var created = await savedQueries.CreateAsync(project.Id, new CreateSavedQueryRequest("Temp", "SELECT 1"));

        Assert.False(await savedQueries.DeleteAsync(otherProject.Id, created!.Id));
        Assert.False(await savedQueries.DeleteAsync(project.Id, Guid.NewGuid()));
    }
}

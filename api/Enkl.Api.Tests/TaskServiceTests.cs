using Enkl.Api.Data;
using Enkl.Api.Domain.Entities;
using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Enkl.Api.Tests;

/// <summary>
/// ARCHITECTURE-REVIEW.md finding 2.2 — GetTasksPagedAsync is a brand-new endpoint (additive, not a
/// replacement for GetProjectDetailAsync), so this is its only coverage: proves the pagination math
/// (page/pageSize/TotalCount) and the not-found-project case, both introduced by this change.
/// </summary>
[Collection("Postgres API collection")]
public class TaskServiceTests
{
    private readonly PostgresApiFixture _fixture;

    public TaskServiceTests(PostgresApiFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task GetTasksPagedAsync_ReturnsCorrectSliceAndTotalCount()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var tasks = scope.ServiceProvider.GetRequiredService<TaskService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("user"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"));

        var column = new Column { Id = Guid.NewGuid(), ProjectId = project.Id, Name = "To Do", Done = false, Order = 0 };
        db.Columns.Add(column);

        for (var i = 0; i < 5; i++)
        {
            db.Tasks.Add(new TaskItem
            {
                Id = Guid.NewGuid(),
                ProjectId = project.Id,
                Key = $"{project.Key}-{i + 1}",
                Title = $"Task {i}",
                ColumnId = column.Id,
                DateCreated = DateTime.UtcNow.AddMinutes(i),
                DateLastModified = DateTime.UtcNow.AddMinutes(i)
            });
        }
        await db.SaveChangesAsync();

        var firstPage = await tasks.GetTasksPagedAsync(project.Id, page: 1, pageSize: 2);
        Assert.NotNull(firstPage);
        Assert.Equal(5, firstPage!.TotalCount);
        Assert.Equal(2, firstPage.Items.Count);
        Assert.Equal("Task 0", firstPage.Items[0].Title);
        Assert.Equal("Task 1", firstPage.Items[1].Title);

        var secondPage = await tasks.GetTasksPagedAsync(project.Id, page: 2, pageSize: 2);
        Assert.Equal("Task 2", secondPage!.Items[0].Title);

        var lastPage = await tasks.GetTasksPagedAsync(project.Id, page: 3, pageSize: 2);
        Assert.Single(lastPage!.Items);
        Assert.Equal("Task 4", lastPage.Items[0].Title);
    }

    [Fact]
    public async Task GetTasksPagedAsync_ReturnsNullForNonexistentProject()
    {
        using var scope = _fixture.CreateScope();
        var tasks = scope.ServiceProvider.GetRequiredService<TaskService>();

        var result = await tasks.GetTasksPagedAsync(Guid.NewGuid(), page: 1, pageSize: 50);

        Assert.Null(result);
    }

    [Fact]
    public async Task GetTasksPagedAsync_ClampsPageSizeToMaximum()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var tasks = scope.ServiceProvider.GetRequiredService<TaskService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("user"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"));

        var result = await tasks.GetTasksPagedAsync(project.Id, page: 1, pageSize: 10000);

        Assert.NotNull(result);
        Assert.Equal(200, result!.PageSize);
    }

    // Regression test: CreateTaskRequest originally only carried the identity/relation fields
    // (title/priority/columnId/assigneeId/releaseId/typeId/parentTaskId/dependsOnTaskIds) — dates,
    // effort, value/cost, documentationUrl, progress, and archived were silently dropped by model
    // binding on create (present in UpdateTaskRequest, absent here), even though the frontend always
    // sent them. A brand-new task with any of those fields set lost them the instant
    // refreshProjectFromServer() re-fetched the just-created task missing everything Create never
    // persisted. Fixed by adding the missing fields (with safe defaults) to CreateTaskRequest and
    // actually assigning them in CreateAsync.
    [Fact]
    public async Task CreateAsync_PersistsDatesEffortValueCostProgressAndDocumentationUrl()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var tasks = scope.ServiceProvider.GetRequiredService<TaskService>();

        var (org, _) = await TestDataHelper.SeedOrgAndUserAsync(db, TestDataHelper.Unique("org"), TestDataHelper.Unique("user"));
        var project = await TestDataHelper.SeedProjectAsync(db, org.Id, TestDataHelper.Unique("PRJ"));

        var column = new Column { Id = Guid.NewGuid(), ProjectId = project.Id, Name = "To Do", Done = false, Order = 0 };
        db.Columns.Add(column);
        await db.SaveChangesAsync();

        var request = new CreateTaskRequest(
            Title: "Test task with all fields", Description: null, Priority: "high", ColumnId: column.Id,
            AssigneeId: null, ReleaseId: null, TypeId: null, ParentTaskId: null, DependsOnTaskIds: null,
            DocumentationUrl: "https://example.com/spec", StartDate: new DateOnly(2026, 8, 1), EndDate: new DateOnly(2026, 8, 15),
            BusinessValue: 750, TaskCost: 300, Progress: 25, EstimatedEffort: 12.5m, ActualEffort: 3.5m, Archived: false);

        var created = await tasks.CreateAsync(project.Id, request);
        Assert.NotNull(created);

        // Re-fetch fresh from the DB, not the in-memory return value, to prove the values actually
        // persisted rather than just being echoed back from the request.
        var reloaded = await db.Tasks.AsNoTracking().FirstAsync(t => t.Id == created!.Id);
        Assert.Equal("https://example.com/spec", reloaded.DocumentationUrl);
        Assert.Equal(new DateOnly(2026, 8, 1), reloaded.StartDate);
        Assert.Equal(new DateOnly(2026, 8, 15), reloaded.EndDate);
        Assert.Equal(750, reloaded.BusinessValue);
        Assert.Equal(300, reloaded.TaskCost);
        Assert.Equal(25, reloaded.Progress);
        Assert.Equal(12.5m, reloaded.EstimatedEffort);
        Assert.Equal(3.5m, reloaded.ActualEffort);
        Assert.False(reloaded.Archived);
    }
}

using System.Security.Claims;
using System.Text;
using Enkl.Api.Auth;
using Enkl.Api.Data;
using Enkl.Api.Services;
using Enkl.Api.Validation;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// Defense-in-depth against the checked-in dev placeholders in appsettings.json ever reaching a
// real deployment: docker-compose.yml now fails to even start the container if DB_PASSWORD/
// JWT_SIGNING_KEY aren't set, but a bare (non-Docker) Kestrel deployment reads appsettings.json
// directly, so this catches that path too. Development is exempted since the whole point of the
// checked-in placeholders is a zero-setup local `dotnet run`.
if (!builder.Environment.IsDevelopment())
{
    const string placeholderSigningKey = "dev-only-signing-key-change-me-please-32chars-min";
    var signingKey = builder.Configuration["Jwt:SigningKey"];
    if (string.IsNullOrWhiteSpace(signingKey) || signingKey == placeholderSigningKey || signingKey.Length < 32)
    {
        throw new InvalidOperationException(
            "Jwt:SigningKey is missing, is the checked-in development placeholder, or is shorter than " +
            "32 characters. Set a real, random JWT_SIGNING_KEY before starting outside Development.");
    }

    const string placeholderDbPassword = "enkl_dev_password";
    var connectionString = builder.Configuration.GetConnectionString("Default");
    if (string.IsNullOrWhiteSpace(connectionString) || connectionString.Contains($"Password={placeholderDbPassword}"))
    {
        throw new InvalidOperationException(
            "The database connection string is missing or still uses the checked-in development " +
            "password. Set a real DB_PASSWORD before starting outside Development.");
    }
}

builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.AddHttpContextAccessor();

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

builder.Services.AddScoped<JwtTokenService>();
builder.Services.AddScoped<ProjectService>();
builder.Services.AddScoped<ColumnService>();
builder.Services.AddScoped<TaskService>();
builder.Services.AddScoped<MigrationService>();
builder.Services.AddScoped<OrganisationService>();
builder.Services.AddScoped<ReleaseService>();
builder.Services.AddScoped<TaskTypeService>();
builder.Services.AddScoped<PrincipleService>();
builder.Services.AddScoped<RetrospectiveService>();
builder.Services.AddScoped<DocumentService>();
builder.Services.AddScoped<RiskService>();
builder.Services.AddScoped<ObjectiveService>();
builder.Services.AddScoped<TeamCommitteeService>();
builder.Services.AddScoped<DecisionService>();
builder.Services.AddScoped<MemberService>();
builder.Services.AddScoped<TemplateService>();
builder.Services.AddScoped<ToDoService>();
builder.Services.AddScoped<SamlService>();
builder.Services.AddScoped<OrganisationSsoConfigService>();
builder.Services.AddScoped<ScimUserService>();
builder.Services.AddScoped<ScimGroupService>();
builder.Services.AddSingleton<SseBroadcaster>();
builder.Services.AddSingleton<SsoExchangeCodeStore>();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidateAudience = true,
            ValidAudience = builder.Configuration["Jwt:Audience"],
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(builder.Configuration["Jwt:SigningKey"]!)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1)
        };
    });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy("ProjectMember", policy => policy.Requirements.Add(new ProjectMemberRequirement()))
    .AddPolicy("OrgAdmin", policy => policy.RequireClaim("orgAdmin", "true"));
builder.Services.AddSingleton<IAuthorizationHandler, ProjectMemberAuthorizationHandler>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

if (app.Configuration.GetValue<bool>("RunMigrationsOnStartup"))
{
    await MigrateDatabaseWithRetryAsync(app);
}

// Unhandled exceptions otherwise reach the client as an empty-bodied 500 in Production (no dev
// exception page, no JSON) — the frontend's toast then has nothing to show the user. This gives
// every endpoint a JSON error body without each controller needing its own try/catch.
app.UseExceptionHandler(errApp => errApp.Run(async context =>
{
    var feature = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>();
    var error = feature?.Error;

    // ApiValidationException carries a caller-facing message (cycle checks, etc. — see
    // Validation/ApiValidationException.cs) and is intentionally not logged as an error: it's
    // expected input rejection, not a bug. Every other exception is logged and hidden from the
    // response body.
    if (error is ApiValidationException validationEx)
    {
        context.Response.ContentType = "application/json";
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new { message = validationEx.Message });
        return;
    }

    var logger = context.RequestServices.GetRequiredService<ILogger<Program>>();
    logger.LogError(error, "Unhandled exception");

    context.Response.ContentType = "application/json";
    context.Response.StatusCode = error is DbUpdateException ? StatusCodes.Status409Conflict : StatusCodes.Status500InternalServerError;
    await context.Response.WriteAsJsonAsync(new { message = "An unexpected error occurred. Please try again." });
}));

app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();

app.UseAuthentication();
app.UseAuthorization();

// Server-side enforcement of User.MustChangePassword (security review finding C4): the flag was
// being set at account creation (e.g. MigrationService's default "enklUserPassword" accounts) and
// returned in the login response, but nothing previously stopped an account from being used
// indefinitely without ever actually changing it. Only mutating requests (POST/PUT/PATCH/DELETE)
// are blocked — reads still work so a signed-in client isn't broken while the change-password
// prompt is up — and it's a live DB read, not a JWT claim, since the token never carries this flag
// and would go stale the instant it's cleared anyway. /api/auth/change-password is the one
// exempted mutating route — it's the only way to ever clear the flag.
var mutatingHttpMethods = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "POST", "PUT", "PATCH", "DELETE" };
app.Use(async (context, next) =>
{
    var isMutating = mutatingHttpMethods.Contains(context.Request.Method);
    var isChangePasswordRoute = context.Request.Path.StartsWithSegments("/api/auth/change-password");
    if (isMutating && !isChangePasswordRoute && context.User.Identity?.IsAuthenticated == true)
    {
        var userIdClaim = context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? context.User.FindFirstValue("sub");
        if (userIdClaim is not null && Guid.TryParse(userIdClaim, out var userId))
        {
            var db = context.RequestServices.GetRequiredService<AppDbContext>();
            var mustChangePassword = await db.Users.Where(u => u.Id == userId).Select(u => u.MustChangePassword).FirstOrDefaultAsync();
            if (mustChangePassword)
            {
                context.Response.ContentType = "application/json";
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new { code = "must_change_password", message = "You must change your password before making further changes." });
                return;
            }
        }
    }
    await next();
});

app.MapControllers();

app.Run();

static async Task MigrateDatabaseWithRetryAsync(WebApplication app)
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

    const int maxAttempts = 10;
    for (var attempt = 1; attempt <= maxAttempts; attempt++)
    {
        try
        {
            await db.Database.MigrateAsync();
            return;
        }
        catch (Exception ex) when (attempt < maxAttempts)
        {
            logger.LogWarning(ex, "Database not ready yet (attempt {Attempt}/{MaxAttempts}), retrying...", attempt, maxAttempts);
            await Task.Delay(TimeSpan.FromSeconds(3));
        }
    }
}

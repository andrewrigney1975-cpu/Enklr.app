using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Enkl.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddStrategyManagement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Strategies",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    DateCreated = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Strategies", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Strategies_Organisations_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StrategyPillars",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StrategyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StrategyPillars", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StrategyPillars_Strategies_StrategyId",
                        column: x => x.StrategyId,
                        principalTable: "Strategies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProjectPillarFulfilments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    PillarId = table.Column<Guid>(type: "uuid", nullable: false),
                    FulfilmentPercent = table.Column<int>(type: "integer", nullable: false),
                    DateLastModified = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProjectPillarFulfilments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProjectPillarFulfilments_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ProjectPillarFulfilments_StrategyPillars_PillarId",
                        column: x => x.PillarId,
                        principalTable: "StrategyPillars",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StrategyEnablers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PillarId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StrategyEnablers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StrategyEnablers_StrategyPillars_PillarId",
                        column: x => x.PillarId,
                        principalTable: "StrategyPillars",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StrategyMetrics",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PillarId = table.Column<Guid>(type: "uuid", nullable: true),
                    EnablerId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    TargetValue = table.Column<double>(type: "double precision", nullable: true),
                    UnitLabel = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StrategyMetrics", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StrategyMetrics_StrategyEnablers_EnablerId",
                        column: x => x.EnablerId,
                        principalTable: "StrategyEnablers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_StrategyMetrics_StrategyPillars_PillarId",
                        column: x => x.PillarId,
                        principalTable: "StrategyPillars",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StrategyMetricEntries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MetricId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecordedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Value = table.Column<double>(type: "double precision", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StrategyMetricEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StrategyMetricEntries_StrategyMetrics_MetricId",
                        column: x => x.MetricId,
                        principalTable: "StrategyMetrics",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProjectPillarFulfilments_PillarId",
                table: "ProjectPillarFulfilments",
                column: "PillarId");

            migrationBuilder.CreateIndex(
                name: "IX_ProjectPillarFulfilments_ProjectId_PillarId",
                table: "ProjectPillarFulfilments",
                columns: new[] { "ProjectId", "PillarId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Strategies_OrganisationId_IsActive",
                table: "Strategies",
                columns: new[] { "OrganisationId", "IsActive" });

            migrationBuilder.CreateIndex(
                name: "IX_StrategyEnablers_PillarId",
                table: "StrategyEnablers",
                column: "PillarId");

            migrationBuilder.CreateIndex(
                name: "IX_StrategyMetricEntries_MetricId_RecordedAt",
                table: "StrategyMetricEntries",
                columns: new[] { "MetricId", "RecordedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_StrategyMetrics_EnablerId",
                table: "StrategyMetrics",
                column: "EnablerId");

            migrationBuilder.CreateIndex(
                name: "IX_StrategyMetrics_PillarId",
                table: "StrategyMetrics",
                column: "PillarId");

            migrationBuilder.CreateIndex(
                name: "IX_StrategyPillars_StrategyId",
                table: "StrategyPillars",
                column: "StrategyId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProjectPillarFulfilments");

            migrationBuilder.DropTable(
                name: "StrategyMetricEntries");

            migrationBuilder.DropTable(
                name: "StrategyMetrics");

            migrationBuilder.DropTable(
                name: "StrategyEnablers");

            migrationBuilder.DropTable(
                name: "StrategyPillars");

            migrationBuilder.DropTable(
                name: "Strategies");
        }
    }
}

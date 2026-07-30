using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Enkl.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPortals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Portals",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Slug = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "draft"),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DateCreated = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DateLastModified = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PublishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Portals", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Portals_Organisations_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Portals_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Portals_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "PortalAccessGrants",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PortalId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Value = table.Column<Guid>(type: "uuid", nullable: false),
                    DateCreated = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PortalAccessGrants", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PortalAccessGrants_Portals_PortalId",
                        column: x => x.PortalId,
                        principalTable: "Portals",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PortalForms",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PortalId = table.Column<Guid>(type: "uuid", nullable: false),
                    FormGroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    DateCreated = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PortalForms", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PortalForms_Portals_PortalId",
                        column: x => x.PortalId,
                        principalTable: "Portals",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PortalTopics",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PortalId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    DateCreated = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DateLastModified = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PortalTopics", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PortalTopics_Portals_PortalId",
                        column: x => x.PortalId,
                        principalTable: "Portals",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PortalQaEntries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PortalId = table.Column<Guid>(type: "uuid", nullable: false),
                    PortalTopicId = table.Column<Guid>(type: "uuid", nullable: true),
                    Question = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Answer = table.Column<string>(type: "text", nullable: true),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DateCreated = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DateLastModified = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PortalQaEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PortalQaEntries_PortalTopics_PortalTopicId",
                        column: x => x.PortalTopicId,
                        principalTable: "PortalTopics",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_PortalQaEntries_Portals_PortalId",
                        column: x => x.PortalId,
                        principalTable: "Portals",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PortalQaEntries_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PortalAccessGrants_PortalId_Kind_Value",
                table: "PortalAccessGrants",
                columns: new[] { "PortalId", "Kind", "Value" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PortalForms_PortalId_FormGroupId",
                table: "PortalForms",
                columns: new[] { "PortalId", "FormGroupId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PortalQaEntries_CreatedByUserId",
                table: "PortalQaEntries",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_PortalQaEntries_PortalId",
                table: "PortalQaEntries",
                column: "PortalId");

            migrationBuilder.CreateIndex(
                name: "IX_PortalQaEntries_PortalTopicId",
                table: "PortalQaEntries",
                column: "PortalTopicId");

            migrationBuilder.CreateIndex(
                name: "IX_Portals_CreatedByUserId",
                table: "Portals",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Portals_OrganisationId_Slug",
                table: "Portals",
                columns: new[] { "OrganisationId", "Slug" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Portals_ProjectId",
                table: "Portals",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_PortalTopics_PortalId",
                table: "PortalTopics",
                column: "PortalId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PortalAccessGrants");

            migrationBuilder.DropTable(
                name: "PortalForms");

            migrationBuilder.DropTable(
                name: "PortalQaEntries");

            migrationBuilder.DropTable(
                name: "PortalTopics");

            migrationBuilder.DropTable(
                name: "Portals");
        }
    }
}

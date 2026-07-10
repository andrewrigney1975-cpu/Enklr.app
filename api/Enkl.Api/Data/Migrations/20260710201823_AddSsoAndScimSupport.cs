using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Enkl.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSsoAndScimSupport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "PasswordHash",
                table: "Users",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                table: "Users",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "OrganisationSsoConfigs",
                columns: table => new
                {
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    SamlEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    IdpEntityId = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IdpSsoUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IdpSigningCertificate = table.Column<string>(type: "text", nullable: true),
                    SamlJitProvisioning = table.Column<bool>(type: "boolean", nullable: false),
                    RequireSso = table.Column<bool>(type: "boolean", nullable: false),
                    ScimEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    ScimBearerTokenHash = table.Column<string>(type: "text", nullable: true),
                    ScimTokenGeneratedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DateLastModified = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrganisationSsoConfigs", x => x.OrganisationId);
                    table.ForeignKey(
                        name: "FK_OrganisationSsoConfigs_Organisations_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OrgTeams",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ScimExternalId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DateCreated = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DateLastModified = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrgTeams", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OrgTeams_Organisations_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OrgTeamMember",
                columns: table => new
                {
                    OrgTeamId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrgTeamMember", x => new { x.OrgTeamId, x.UserId });
                    table.ForeignKey(
                        name: "FK_OrgTeamMember_OrgTeams_OrgTeamId",
                        column: x => x.OrgTeamId,
                        principalTable: "OrgTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_OrgTeamMember_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OrgTeamMember_UserId",
                table: "OrgTeamMember",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_OrgTeams_OrganisationId_ScimExternalId",
                table: "OrgTeams",
                columns: new[] { "OrganisationId", "ScimExternalId" },
                unique: true,
                filter: "\"ScimExternalId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "OrganisationSsoConfigs");

            migrationBuilder.DropTable(
                name: "OrgTeamMember");

            migrationBuilder.DropTable(
                name: "OrgTeams");

            migrationBuilder.DropColumn(
                name: "IsActive",
                table: "Users");

            migrationBuilder.AlterColumn<string>(
                name: "PasswordHash",
                table: "Users",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);
        }
    }
}

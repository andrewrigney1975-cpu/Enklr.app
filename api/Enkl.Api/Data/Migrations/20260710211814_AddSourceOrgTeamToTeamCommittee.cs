using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Enkl.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSourceOrgTeamToTeamCommittee : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "SourceOrgTeamId",
                table: "TeamsCommittees",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_TeamsCommittees_SourceOrgTeamId",
                table: "TeamsCommittees",
                column: "SourceOrgTeamId");

            migrationBuilder.AddForeignKey(
                name: "FK_TeamsCommittees_OrgTeams_SourceOrgTeamId",
                table: "TeamsCommittees",
                column: "SourceOrgTeamId",
                principalTable: "OrgTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_TeamsCommittees_OrgTeams_SourceOrgTeamId",
                table: "TeamsCommittees");

            migrationBuilder.DropIndex(
                name: "IX_TeamsCommittees_SourceOrgTeamId",
                table: "TeamsCommittees");

            migrationBuilder.DropColumn(
                name: "SourceOrgTeamId",
                table: "TeamsCommittees");
        }
    }
}

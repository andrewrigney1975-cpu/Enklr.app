using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Enkl.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ScopeProjectKeyUniquenessToOrganisation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Projects_Key",
                table: "Projects");

            migrationBuilder.DropIndex(
                name: "IX_Projects_OrganisationId",
                table: "Projects");

            migrationBuilder.CreateIndex(
                name: "IX_Projects_OrganisationId_Key",
                table: "Projects",
                columns: new[] { "OrganisationId", "Key" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Projects_OrganisationId_Key",
                table: "Projects");

            migrationBuilder.CreateIndex(
                name: "IX_Projects_Key",
                table: "Projects",
                column: "Key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Projects_OrganisationId",
                table: "Projects",
                column: "OrganisationId");
        }
    }
}

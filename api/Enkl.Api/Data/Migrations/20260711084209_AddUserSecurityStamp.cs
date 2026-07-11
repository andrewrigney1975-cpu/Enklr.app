using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Enkl.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUserSecurityStamp : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "SecurityStamp",
                table: "Users",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            // Every existing row otherwise gets the same all-zero placeholder above (every existing
            // user's already-issued token predates this claim entirely, so all of them fail the new
            // revocation check and get forced to re-login regardless) — this just gives each of them
            // a genuinely distinct, unguessable stamp from the moment this migration runs rather than
            // a shared placeholder value, consistent with how User.SecurityStamp's C# default
            // (Guid.NewGuid()) behaves for every row created after this migration.
            migrationBuilder.Sql("UPDATE \"Users\" SET \"SecurityStamp\" = gen_random_uuid();");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SecurityStamp",
                table: "Users");
        }
    }
}

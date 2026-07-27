using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Enkl.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddReleaseColor : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Color",
                table: "Releases",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "#cccccc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Color",
                table: "Releases");
        }
    }
}

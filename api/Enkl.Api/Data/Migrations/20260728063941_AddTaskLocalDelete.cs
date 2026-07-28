using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Enkl.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddTaskLocalDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "LocalDelete",
                table: "Tasks",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LocalDelete",
                table: "Tasks");
        }
    }
}

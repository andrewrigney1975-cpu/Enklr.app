using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Enkl.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddProjectResourcePlaceholderUser : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "UserId",
                table: "ProjectResourcePlaceholders",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProjectResourcePlaceholders_UserId",
                table: "ProjectResourcePlaceholders",
                column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_ProjectResourcePlaceholders_Users_UserId",
                table: "ProjectResourcePlaceholders",
                column: "UserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ProjectResourcePlaceholders_Users_UserId",
                table: "ProjectResourcePlaceholders");

            migrationBuilder.DropIndex(
                name: "IX_ProjectResourcePlaceholders_UserId",
                table: "ProjectResourcePlaceholders");

            migrationBuilder.DropColumn(
                name: "UserId",
                table: "ProjectResourcePlaceholders");
        }
    }
}

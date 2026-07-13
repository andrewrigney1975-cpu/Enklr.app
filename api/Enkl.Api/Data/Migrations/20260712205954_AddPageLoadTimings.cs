using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Enkl.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPageLoadTimings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PageLoadTimings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RecordedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DurationMs = table.Column<double>(type: "double precision", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PageLoadTimings", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PageLoadTimings_RecordedAt",
                table: "PageLoadTimings",
                column: "RecordedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PageLoadTimings");
        }
    }
}

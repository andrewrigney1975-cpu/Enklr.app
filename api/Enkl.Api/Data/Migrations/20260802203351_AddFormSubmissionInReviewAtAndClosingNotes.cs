using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Enkl.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFormSubmissionInReviewAtAndClosingNotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ClosingNotes",
                table: "FormSubmissions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "InReviewAt",
                table: "FormSubmissions",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ClosingNotes",
                table: "FormSubmissions");

            migrationBuilder.DropColumn(
                name: "InReviewAt",
                table: "FormSubmissions");
        }
    }
}

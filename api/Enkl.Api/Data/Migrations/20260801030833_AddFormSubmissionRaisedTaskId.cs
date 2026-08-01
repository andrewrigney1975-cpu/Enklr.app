using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Enkl.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFormSubmissionRaisedTaskId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "RaisedTaskId",
                table: "FormSubmissions",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_FormSubmissions_RaisedTaskId",
                table: "FormSubmissions",
                column: "RaisedTaskId");

            migrationBuilder.AddForeignKey(
                name: "FK_FormSubmissions_Tasks_RaisedTaskId",
                table: "FormSubmissions",
                column: "RaisedTaskId",
                principalTable: "Tasks",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_FormSubmissions_Tasks_RaisedTaskId",
                table: "FormSubmissions");

            migrationBuilder.DropIndex(
                name: "IX_FormSubmissions_RaisedTaskId",
                table: "FormSubmissions");

            migrationBuilder.DropColumn(
                name: "RaisedTaskId",
                table: "FormSubmissions");
        }
    }
}

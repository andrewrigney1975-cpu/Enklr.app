using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Enkl.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWhiteboardSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WhiteboardSessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uuid", nullable: false),
                    HostUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    JoinCode = table.Column<string>(type: "character varying(6)", maxLength: 6, nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "open"),
                    IsSaved = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ClosedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SavedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WhiteboardSessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WhiteboardSessions_Organisations_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_WhiteboardSessions_Users_HostUserId",
                        column: x => x.HostUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WhiteboardElements",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ElementType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ElementJson = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WhiteboardElements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WhiteboardElements_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_WhiteboardElements_WhiteboardSessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "WhiteboardSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WhiteboardParticipants",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    JoinedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LeftAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WhiteboardParticipants", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WhiteboardParticipants_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_WhiteboardParticipants_WhiteboardSessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "WhiteboardSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardElements_CreatedByUserId",
                table: "WhiteboardElements",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardElements_SessionId_DeletedAt",
                table: "WhiteboardElements",
                columns: new[] { "SessionId", "DeletedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardParticipants_SessionId_UserId",
                table: "WhiteboardParticipants",
                columns: new[] { "SessionId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardParticipants_UserId",
                table: "WhiteboardParticipants",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardSessions_HostUserId",
                table: "WhiteboardSessions",
                column: "HostUserId");

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardSessions_JoinCode_Status",
                table: "WhiteboardSessions",
                columns: new[] { "JoinCode", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardSessions_OrganisationId",
                table: "WhiteboardSessions",
                column: "OrganisationId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WhiteboardElements");

            migrationBuilder.DropTable(
                name: "WhiteboardParticipants");

            migrationBuilder.DropTable(
                name: "WhiteboardSessions");
        }
    }
}

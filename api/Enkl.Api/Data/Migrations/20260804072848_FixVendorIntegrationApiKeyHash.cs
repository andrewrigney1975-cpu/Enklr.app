using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Enkl.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class FixVendorIntegrationApiKeyHash : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_VendorIntegrations_ApiKey",
                table: "VendorIntegrations");

            migrationBuilder.DropColumn(
                name: "ApiKey",
                table: "VendorIntegrations");

            migrationBuilder.AlterColumn<bool>(
                name: "IsActive",
                table: "VendorIntegrations",
                type: "boolean",
                nullable: false,
                defaultValue: true,
                oldClrType: typeof(bool),
                oldType: "boolean");

            migrationBuilder.AddColumn<string>(
                name: "ApiKeyHash",
                table: "VendorIntegrations",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "GeneratedAt",
                table: "VendorIntegrations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastUsedAt",
                table: "VendorIntegrations",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ApiKeyHash",
                table: "VendorIntegrations");

            migrationBuilder.DropColumn(
                name: "GeneratedAt",
                table: "VendorIntegrations");

            migrationBuilder.DropColumn(
                name: "LastUsedAt",
                table: "VendorIntegrations");

            migrationBuilder.AlterColumn<bool>(
                name: "IsActive",
                table: "VendorIntegrations",
                type: "boolean",
                nullable: false,
                oldClrType: typeof(bool),
                oldType: "boolean",
                oldDefaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "ApiKey",
                table: "VendorIntegrations",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_VendorIntegrations_ApiKey",
                table: "VendorIntegrations",
                column: "ApiKey",
                unique: true);
        }
    }
}

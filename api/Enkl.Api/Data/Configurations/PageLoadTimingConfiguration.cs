using Enkl.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Enkl.Api.Data.Configurations;

public class PageLoadTimingConfiguration : IEntityTypeConfiguration<PageLoadTiming>
{
    public void Configure(EntityTypeBuilder<PageLoadTiming> b)
    {
        b.HasKey(p => p.Id);
        // Vendor Portal's reader always filters/orders on this column (WHERE RecordedAt > now() -
        // interval, ORDER BY RecordedAt) — see its dashboard.js route.
        b.HasIndex(p => p.RecordedAt);
    }
}

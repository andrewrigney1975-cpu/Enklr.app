namespace Enkl.Api.Domain.Entities;

/// <summary>One question/answer entry in a Portal's self-serve Q&amp;A rail — modelled like
/// knowledge-base articles, with expand/collapse per entry in the frontend. Answer is stored as
/// markdown (the rich-text editor's own serialization format, src/js/rich-text/markdown.js), same
/// convention as TaskItem.Description — never raw HTML.</summary>
public class PortalQaEntry
{
    public Guid Id { get; set; }
    public Guid PortalId { get; set; }
    public Portal Portal { get; set; } = null!;

    /// <summary>Nullable — an entry may sit directly under the Portal, ungrouped.</summary>
    public Guid? PortalTopicId { get; set; }
    public PortalTopic? PortalTopic { get; set; }

    public string Question { get; set; } = "";
    public string? Answer { get; set; }
    public int Order { get; set; }

    /// <summary>Simple thumbs-up/down tally — end users vote via PortalHomeController, unrestricted
    /// (no per-user vote tracking, no floor/ceiling), each vote just applies a +1/-1 delta.</summary>
    public int Nps { get; set; }

    /// <summary>Resolved once, server-side, at Create/Update time (PortalQaImageResolver) from a
    /// Pexels search over the entry's own keyword-extracted Question+Answer text — never re-resolved
    /// on read. Null if no reasonable image match was found (or PEXELS_API_KEY isn't configured), in
    /// which case HeaderImageColor is set instead.</summary>
    public string? HeaderImageUrl { get; set; }

    /// <summary>Set only when HeaderImageUrl is null — a random hex colour picked once from a fixed
    /// palette (PortalQaImageResolver.ColorPalette) and persisted, so the same entry always shows the
    /// same fallback colour across page views rather than re-randomizing on every render.</summary>
    public string? HeaderImageColor { get; set; }

    public Guid? CreatedByUserId { get; set; }
    public User? CreatedByUser { get; set; }
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }
}

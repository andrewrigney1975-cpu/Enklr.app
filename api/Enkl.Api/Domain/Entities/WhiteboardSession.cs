namespace Enkl.Api.Domain.Entities;

/// <summary>An organisation-wide, ephemeral-by-default collaborative whiteboard session — org-scoped
/// (any authenticated org member can start or join one, not project-scoped), same "org concept, not
/// a project one" reasoning as ChatChannel/PortfolioCategory. JoinCode is a 6-digit numeric string,
/// unique only among currently-open sessions (WhiteboardService re-rolls on collision), not globally
/// unique — scoped uniqueness, same convention as Projects.Key being org-scoped rather than global.
/// "Scratch until saved": a session's WhiteboardElements are durable while Status="open" (so
/// reconnecting/late-joining participants always see current state), but if the host closes the
/// session with IsSaved still false, WhiteboardCleanupService purges it (and its elements/
/// participants) after a short grace window — IsSaved=true is what makes a session's content
/// permanent. Never trust a client-supplied "I am the host" flag — every host-only action
/// (Save/Close) must re-check HostUserId against the caller's own JWT-derived user id server-side.</summary>
public class WhiteboardSession
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Organisation Organisation { get; set; } = null!;
    public Guid HostUserId { get; set; }
    public User HostUser { get; set; } = null!;
    public string JoinCode { get; set; } = "";
    public string? Title { get; set; }

    /// <summary>open|closed — plain unconstrained string, no enum/CHECK, same convention as
    /// Form.Status/TaskItem.Priority.</summary>
    public string Status { get; set; } = "open";

    public bool IsSaved { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ClosedAt { get; set; }
    public DateTime? SavedAt { get; set; }

    public List<WhiteboardParticipant> Participants { get; set; } = new();
    public List<WhiteboardElement> Elements { get; set; } = new();
}

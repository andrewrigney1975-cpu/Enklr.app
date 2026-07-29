namespace Enkl.Api.Domain.Entities;

/// <summary>A join/leave log row for a WhiteboardSession — also doubles as the "who's currently
/// present" roster (rows with LeftAt == null are present). A user rejoining after leaving gets
/// LeftAt reset to null on the existing row rather than a new row, so the roster never accumulates
/// duplicate entries for the same user across a reconnect.</summary>
public class WhiteboardParticipant
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public WhiteboardSession Session { get; set; } = null!;
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public DateTime JoinedAt { get; set; }
    public DateTime? LeftAt { get; set; }
}

namespace Enkl.Api.Domain.Entities;

/// <summary>
/// Join row: which Users belong to a ChatChannel — the org-wide analog of ProjectMember, but with no
/// per-member role/admin flag of its own (a channel member is just "in" or "not in"; moderation is
/// handled entirely by User.IsOrgAdmin, there is no per-channel admin tier). Unique on
/// (ChannelId, UserId) — see ChatConfiguration.
/// </summary>
public class ChatChannelMember
{
    public Guid Id { get; set; }
    public Guid ChannelId { get; set; }
    public ChatChannel Channel { get; set; } = null!;
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public DateTime DateJoined { get; set; }

    /// <summary>Per-(channel,user) mute — suppresses this caller's own sound/toast notifications for
    /// the channel (badges still update, see ChatService.SetChannelMutedAsync's own doc comment).
    /// Deliberately NOT on ChatChannel itself: muting is a personal preference, not a channel-wide
    /// setting.</summary>
    public bool IsMuted { get; set; }
}

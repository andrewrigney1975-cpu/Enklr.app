namespace Enkl.Api.Domain.Entities;

/// <summary>
/// One user's reaction to a chat message — one row per (message, user, emoji) combination, so a user
/// can react with several different emoji on the same message but not duplicate the same one twice
/// (enforced by a unique index, see ChatConfiguration). Emoji is validated against a small fixed
/// allowed set at the service layer (ChatService.AllowedReactionEmoji) — plain unconstrained string
/// column, no CHECK constraint, same convention as every other enum-like field in this codebase.
/// Toggled, not independently deletable: posting the same emoji again removes it (see
/// ChatService.ToggleReactionAsync).
/// </summary>
public class ChatMessageReaction
{
    public Guid Id { get; set; }
    public Guid MessageId { get; set; }
    public ChatMessage Message { get; set; } = null!;
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public string Emoji { get; set; } = "";
    public DateTime DateCreated { get; set; }
}

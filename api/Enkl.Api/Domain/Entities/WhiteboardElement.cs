namespace Enkl.Api.Domain.Entities;

/// <summary>One drawn object on a whiteboard — a freehand pen stroke, a shape, a text box, or a
/// connector line. ElementJson is an opaque, server-unvalidated blob (same "no CHECK constraints,
/// application-level validation only" convention as Form.FieldsJson/DashboardWidget.ConfigJson) —
/// the frontend's drawing tools own interpreting the shape-specific payload (points array for
/// pen/connector, x/y/w/h+style for shapes, x/y/text/fontSize for text boxes) entirely; the server
/// just stores and rebroadcasts the raw JSON. Soft-deleted (DeletedAt) rather than hard-deleted so
/// "current board state" is always a plain WHERE DeletedAt IS NULL query — used both to serve a
/// joining/reconnecting participant the live board and, later, to answer "does this session still
/// have content" for the unsaved-changes-on-close check.</summary>
public class WhiteboardElement
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public WhiteboardSession Session { get; set; } = null!;
    public Guid CreatedByUserId { get; set; }
    public User CreatedByUser { get; set; } = null!;

    /// <summary>pen|shape-rect|shape-circle|shape-oval|shape-triangle|shape-diamond|text|connector —
    /// plain unconstrained string, no enum/CHECK, same convention as Form.Status.</summary>
    public string ElementType { get; set; } = "";

    public string ElementJson { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}

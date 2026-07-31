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

    public Guid? CreatedByUserId { get; set; }
    public User? CreatedByUser { get; set; }
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }
}

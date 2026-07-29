namespace Enkl.Api.Domain.Entities;

/// <summary>An Org-Admin-authored, curated front door for org users who aren't necessarily members
/// of any Project — surfaces a set of Forms, the user's own submission/status history, and a Q&amp;A
/// rail. ProjectId points at a dedicated, membership-free "actioner" Project auto-provisioned at
/// creation time (5 columns, Trivial..Critical — see PortalService.CreateAsync), where any
/// "raise task" Form Workflow action lands its tasks for analysts/consultants to work. Access is
/// closed by default — see PortalAccessGrant; a Portal with zero grants is invisible to every org
/// user, matching this codebase's defensive-default convention.</summary>
public class Portal
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Organisation Organisation { get; set; } = null!;
    public string Name { get; set; } = "";

    /// <summary>Human-readable, org-unique, hashbang-routable (#!/portal/&lt;slug&gt;) — derived from
    /// Name at creation (see PortalSlugResolver, mirroring ProjectKeyResolver's derive-then-uniquify
    /// shape), editable afterward.</summary>
    public string Slug { get; set; } = "";

    public string? Description { get; set; }

    /// <summary>draft|published|archived — plain unconstrained string, same convention as
    /// Form.Status/TaskItem.Priority. Only a "published" Portal is ever resolvable via its slug by an
    /// end user (PortalHomeService); draft/archived are Org-Admin-preview-only.</summary>
    public string Status { get; set; } = "draft";

    public Guid ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public Guid? CreatedByUserId { get; set; }
    public User? CreatedByUser { get; set; }
    public DateTime DateCreated { get; set; }
    public DateTime DateLastModified { get; set; }
    public DateTime? PublishedAt { get; set; }

    public List<PortalAccessGrant> AccessGrants { get; set; } = new();
    public List<PortalForm> Forms { get; set; } = new();
    public List<PortalTopic> Topics { get; set; } = new();
    public List<PortalQaEntry> QaEntries { get; set; } = new();
}

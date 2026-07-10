using System.Text.RegularExpressions;

namespace Enkl.Api.Services;

/// <summary>
/// Shared by ScimUserService and ScimGroupService's list filtering — both only need to recognize
/// the single-clause `attr eq "value"` shape (the common case every IdP sends for a targeted
/// lookup); anything else falls through to each service's own "no matches" fallback rather than a
/// hard 400, same reasoning as ScimUserService.ListAsync's own comment on unsupported filters.
/// </summary>
public static class ScimFilterParser
{
    private static readonly Regex EqFilter = new("^(?<attr>[\\w.]+)\\s+eq\\s+\"(?<value>[^\"]*)\"$", RegexOptions.IgnoreCase);

    public static (string? Attr, string? Value) ParseEq(string filter)
    {
        var match = EqFilter.Match(filter.Trim());
        return match.Success ? (match.Groups["attr"].Value.ToLowerInvariant(), match.Groups["value"].Value) : (null, null);
    }
}

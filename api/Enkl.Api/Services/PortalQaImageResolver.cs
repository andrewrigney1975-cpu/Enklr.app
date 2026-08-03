using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Enkl.Api.Services;

/// <summary>Resolves a PortalQaEntry's header image ONCE, at Create/Update time (called from
/// PortalService.CreateQaEntryAsync/UpdateQaEntryAsync) — never re-resolved on read, so the Portal
/// home page pays zero Pexels latency/rate-limit cost on view. Searches Pexels using keywords
/// extracted from the entry's own Question+Answer text ("keyword density" — the most frequent
/// non-stopword terms, with Question terms weighted double since the title is the strongest topic
/// signal). Best-effort throughout: a missing API key, a Pexels outage, a timeout, or zero search
/// results all fall back to a persisted random colour rather than ever blocking or failing the
/// entry's own save — same "an external dependency failure must never break the primary flow"
/// posture as FormSubmissionService.ExecuteActionNodeAsync's own misconfigured-Portal handling.</summary>
public class PortalQaImageResolver
{
    // A small, fixed palette (not the member palette — visually distinct, chosen for readability as
    // a header-block background) — picked once per entry and persisted, so a fallback entry always
    // shows the same colour rather than re-randomizing on every render.
    private static readonly string[] ColorPalette =
    {
        "#0052CC", "#00875A", "#DE350B", "#5243AA", "#FF8B00", "#0065FF", "#008DA6", "#6B778C"
    };

    private static readonly HashSet<string> Stopwords = new(StringComparer.OrdinalIgnoreCase)
    {
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "and", "or", "but", "if",
        "then", "so", "to", "of", "in", "on", "at", "for", "with", "as", "by", "from", "this", "that",
        "these", "those", "it", "its", "i", "you", "your", "we", "our", "they", "their", "he", "she",
        "do", "does", "did", "can", "could", "will", "would", "should", "may", "might", "must", "not",
        "what", "when", "where", "why", "how", "who", "which", "there", "here", "have", "has", "had",
        "just", "about", "into", "up", "down", "out", "get", "gets", "please", "also"
    };

    private static readonly Random Rng = new();
    private static readonly Regex WordPattern = new(@"[a-zA-Z']+", RegexOptions.Compiled);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<PortalQaImageResolver> _logger;

    public PortalQaImageResolver(IHttpClientFactory httpClientFactory, IConfiguration config, ILogger<PortalQaImageResolver> logger)
    {
        _httpClientFactory = httpClientFactory;
        _config = config;
        _logger = logger;
    }

    public async Task<(string? ImageUrl, string? Color)> ResolveAsync(string question, string? answer)
    {
        try
        {
            var apiKey = _config["Pexels:ApiKey"];
            if (!string.IsNullOrWhiteSpace(apiKey))
            {
                var query = BuildSearchQuery(question, answer);
                var imageUrl = await SearchPexelsAsync(apiKey, query);
                if (imageUrl is not null) return (imageUrl, null);
            }
        }
        catch (Exception ex)
        {
            // Best-effort — any failure (network, timeout, malformed response) falls through to the
            // fallback colour below rather than propagating and failing the entry's own save.
            _logger.LogWarning(ex, "Pexels header image search failed; falling back to a random colour.");
        }

        return (null, ColorPalette[Rng.Next(ColorPalette.Length)]);
    }

    /// <summary>Strips Markdown syntax (this is just search-query material, not a rendered output —
    /// no need for a full parser), tokenizes, drops stopwords, counts frequency — Question words
    /// counted twice, since the title is the strongest topic signal — and returns the top 2 most
    /// frequent terms joined by a space. Falls back to the raw Question text if tokenization yields
    /// nothing (a very short or all-stopword entry).</summary>
    internal static string BuildSearchQuery(string question, string? answer)
    {
        var plainAnswer = Regex.Replace(answer ?? "", @"[#*_\[\]()>`~-]", " ");
        var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        void CountWords(string text, int weight)
        {
            foreach (Match m in WordPattern.Matches(text))
            {
                var word = m.Value.ToLowerInvariant();
                if (word.Length < 3 || Stopwords.Contains(word)) continue;
                counts[word] = counts.GetValueOrDefault(word) + weight;
            }
        }
        CountWords(question, 2);
        CountWords(plainAnswer, 1);

        var top = counts.OrderByDescending(kv => kv.Value).Take(2).Select(kv => kv.Key).ToList();
        return top.Count > 0 ? string.Join(' ', top) : question;
    }

    private async Task<string?> SearchPexelsAsync(string apiKey, string query)
    {
        var client = _httpClientFactory.CreateClient("Pexels");
        client.DefaultRequestHeaders.Remove("Authorization");
        client.DefaultRequestHeaders.Add("Authorization", apiKey);

        var url = $"v1/search?query={Uri.EscapeDataString(query)}&per_page=1&orientation=landscape";
        using var response = await client.GetAsync(url);
        if (!response.IsSuccessStatusCode) return null;

        var body = await response.Content.ReadAsStringAsync();
        var json = JsonNode.Parse(body)?.AsObject();
        var photos = json?["photos"]?.AsArray();
        if (photos is null || photos.Count == 0) return null;

        return photos[0]?["src"]?["medium"]?.GetValue<string>();
    }
}

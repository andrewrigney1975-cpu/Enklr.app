<?php

declare(strict_types=1);

namespace Enkl\Api\Support;

use Enkl\Api\Config\Config;

/**
 * Ported from Services/PortalQaImageResolver.cs. Resolves a PortalQaEntry's header image ONCE, at
 * Create/Update time (called from PortalService::createQaEntry/updateQaEntry) — never re-resolved on
 * read. Searches Pexels using keywords extracted from the entry's own Question+Answer text ("keyword
 * density" — the most frequent non-stopword terms, Question terms weighted double since the title is
 * the strongest topic signal). Best-effort throughout: a missing API key, a Pexels outage, a timeout,
 * or zero search results all fall back to a persisted random colour rather than ever blocking or
 * failing the entry's own save. Plain cURL, matching AiAssistantService.php's own zero-HTTP-client-
 * dependency call to Anthropic (no Guzzle in this tier).
 */
final class PortalQaImageResolver
{
    // Same fixed palette as the .NET version — not the member palette, visually distinct, chosen for
    // readability as a header-block background. Picked once per entry and persisted.
    private const COLOR_PALETTE = ['#0052CC', '#00875A', '#DE350B', '#5243AA', '#FF8B00', '#0065FF', '#008DA6', '#6B778C'];

    private const STOPWORDS = [
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'and', 'or', 'but', 'if',
        'then', 'so', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'as', 'by', 'from', 'this', 'that',
        'these', 'those', 'it', 'its', 'i', 'you', 'your', 'we', 'our', 'they', 'their', 'he', 'she',
        'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'not',
        'what', 'when', 'where', 'why', 'how', 'who', 'which', 'there', 'here', 'have', 'has', 'had',
        'just', 'about', 'into', 'up', 'down', 'out', 'get', 'gets', 'please', 'also',
    ];

    /** @return array{0: ?string, 1: ?string} [imageUrl, color] */
    public function resolve(string $question, ?string $answer): array
    {
        try {
            $apiKey = Config::get('PEXELS_API_KEY', '');
            if ($apiKey !== null && $apiKey !== '') {
                $query = self::buildSearchQuery($question, $answer);
                $imageUrl = $this->searchPexels($apiKey, $query);
                if ($imageUrl !== null) {
                    return [$imageUrl, null];
                }
            }
        } catch (\Throwable $e) {
            // Best-effort — any failure (network, timeout, malformed response) falls through to the
            // fallback colour below rather than propagating and failing the entry's own save.
            Log::channel()->warning('Pexels header image search failed; falling back to a random colour.', ['error' => $e->getMessage()]);
        }

        return [null, self::COLOR_PALETTE[array_rand(self::COLOR_PALETTE)]];
    }

    /** Strips Markdown syntax (search-query material, not a rendered output — no need for a full
     * parser), tokenizes, drops stopwords, counts frequency — Question words counted twice — and
     * returns the top 2 most frequent terms joined by a space. Falls back to the raw Question text
     * if tokenization yields nothing. */
    public static function buildSearchQuery(string $question, ?string $answer): string
    {
        $plainAnswer = preg_replace('/[#*_\[\]()>`~-]/', ' ', $answer ?? '') ?? '';
        $counts = [];

        $countWords = function (string $text, int $weight) use (&$counts): void {
            preg_match_all('/[a-zA-Z\']+/', $text, $matches);
            foreach ($matches[0] as $raw) {
                $word = strtolower($raw);
                if (strlen($word) < 3 || in_array($word, self::STOPWORDS, true)) {
                    continue;
                }
                $counts[$word] = ($counts[$word] ?? 0) + $weight;
            }
        };
        $countWords($question, 2);
        $countWords($plainAnswer, 1);

        arsort($counts);
        $top = array_slice(array_keys($counts), 0, 2);
        return count($top) > 0 ? implode(' ', $top) : $question;
    }

    private function searchPexels(string $apiKey, string $query): ?string
    {
        $url = 'https://api.pexels.com/v1/search?query=' . urlencode($query) . '&per_page=1&orientation=landscape';
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Authorization: ' . $apiKey],
            CURLOPT_TIMEOUT => 15,
        ]);
        $responseBody = curl_exec($ch);
        $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($responseBody === false || $curlError !== '' || $statusCode < 200 || $statusCode >= 300) {
            return null;
        }

        $decoded = json_decode((string) $responseBody, true);
        $photos = $decoded['photos'] ?? null;
        if (!is_array($photos) || count($photos) === 0) {
            return null;
        }

        return $photos[0]['src']['medium'] ?? null;
    }
}

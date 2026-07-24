/* Keyword extraction — deliberately conservative, not a general-purpose NLP keyword extractor.
   This module's whole job is producing candidate keywords that are SAFE to count and later expose
   (via the same >=5-distinct-messages suppression threshold already used for topic/sentiment
   buckets — see chat_trend_keywords_public in migrations/002_create_chat_trend_keywords.sql), not
   maximally informative ones. Two independent filters, both applied before a token is even a
   candidate:
     1. A stopword list drops common filler words.
     2. A "looks like a proper noun" heuristic drops @mentions and any word that's capitalised in
        the ORIGINAL text but isn't the first word of a sentence — the same shape of thing a real
        NER model would flag as PERSON/ORG, just cheaper and with no model download. Imperfect (an
        all-lowercase name slips through, a capitalised common word at a sentence start is kept when
        it maybe shouldn't be), but combined with the frequency threshold this is applied alongside,
        a one-off name mention can't surface on its own — see this file's own doc comment on
        `extractKeywords` for exactly what "one-off" means here. */

// Common English stopwords + generic chat/support filler words that would otherwise dominate every
// bucket's "top keywords" without saying anything useful.
const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','so','to','of','in','on','at','by','for','with','from','as',
  'is','are','was','were','be','been','being','it','its','this','that','these','those','i','me','my',
  'we','us','our','you','your','he','him','his','she','her','they','them','their','not','no','yes',
  'do','does','did','doing','done','have','has','had','having','will','would','can','could','should',
  'may','might','must','shall','than','then','there','here','when','where','why','how','what','which',
  'who','whom','about','again','all','also','am','any','because','before','below','between','both',
  'down','during','each','few','further','into','more','most','once','only','other','out','over',
  'own','same','some','such','too','under','until','up','very','just','like','get','got','really',
  'thanks','thank','cheers','hi','hey','hello','ok','okay','please','one','two','still','now'
]);

const WORD_RE = /[A-Za-z][A-Za-z'-]{1,}/g;

/* Returns a Set of lowercased candidate keywords for one message — deduplicated WITHIN the
   message, so a word repeated three times in one message still only ever counts as ONE occurrence
   toward the cross-message frequency this feature actually measures ("appears in >=5 distinct
   messages", not ">=5 total mentions"). This is what keeps a single verbose message from being able
   to push a keyword over the exposure threshold on its own. */
export function extractKeywords(text){
  if (!text) return new Set();

  const candidates = new Set();
  // Split into naive "sentences" first so the capitalisation heuristic below knows which words are
  // sentence-initial (always allowed) vs. mid-sentence (capitalised => likely a proper noun => drop).
  const sentences = text.split(/(?<=[.!?])\s+/);

  for (const sentence of sentences) {
    const words = sentence.match(WORD_RE);
    if (!words) continue;

    words.forEach((word, i) => {
      const raw = word.replace(/^['-]+|['-]+$/g, '');
      if (raw.length < 3) return;

      // @mentions are never a candidate at all, regardless of position.
      const precedingChar = sentence[sentence.indexOf(word) - 1];
      if (precedingChar === '@') return;

      const isCapitalised = raw[0] === raw[0].toUpperCase() && raw[0] !== raw[0].toLowerCase();
      const isSentenceInitial = i === 0;
      if (isCapitalised && !isSentenceInitial) return; // likely a proper noun — drop entirely

      const lower = raw.toLowerCase();
      if (STOPWORDS.has(lower)) return;
      candidates.add(lower);
    });
  }

  return candidates;
}

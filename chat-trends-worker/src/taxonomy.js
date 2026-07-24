// Fixed, small topic taxonomy — the zero-shot classifier only ever picks one of these labels,
// never text derived from the message itself. That's what makes the "topic" output structurally
// incapable of leaking a name, org, or project string, not just a policy/convention.
export const TOPICS = [
  'bug or issue',
  'feature request',
  'onboarding or setup help',
  'positive feedback',
  'billing or account',
  'performance or reliability',
  'documentation',
  'general discussion'
];

// Below this confidence, a message is classified as 'uncategorised' rather than forced into the
// closest (possibly wrong) label.
export const TOPIC_CONFIDENCE_FLOOR = 0.4;
export const UNCATEGORISED_TOPIC = 'uncategorised';

export const SENTIMENTS = ['positive', 'neutral', 'negative'];

// The underlying sentiment model is binary (positive/negative only, no neutral class) — anything
// below this confidence on its winning label is bucketed as 'neutral' instead of forced to
// positive/negative, since a low-confidence binary call isn't a meaningful signal either way.
export const SENTIMENT_CONFIDENCE_FLOOR = 0.65;

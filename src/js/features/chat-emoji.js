"use strict";

/* Shared emoji set for both the inline ":shortcode:" compose autocomplete (views/chat.js) and the
   message-reaction popover (also views/chat.js) — one place so the two surfaces can never drift
   apart. Server-side, only the literal unicode characters (not these codes) are persisted/validated
   against — ChatService's own allow-list on both tiers (.NET's AllowedReactionEmoji,
   PHP's ALLOWED_REACTION_EMOJI) — keep those two lists and this one in sync by hand if this set ever
   changes, same as every other duplicated-by-necessity constant across this codebase's tiers. */
export var CHAT_EMOJI = [
  {code: 'smile', char: '\u{1F600}', label: 'Smiley face'},
  {code: 'thumbsup', char: '\u{1F44D}', label: 'Thumbs up'},
  {code: 'thumbsdown', char: '\u{1F44E}', label: 'Thumbs down'},
  {code: 'sad', char: '\u{1F622}', label: 'Sad face'},
  {code: 'eyes', char: '\u{1F440}', label: 'Eyes'},
  {code: 'question', char: '\u{2753}', label: 'Question mark'},
  {code: 'exclamation', char: '\u{2757}', label: 'Exclamation mark'},
  {code: 'neutral', char: '\u{1F610}', label: 'Neutral face'},
  {code: '100', char: '\u{1F4AF}', label: '100'},
  {code: 'heart', char: '\u{2764}\u{FE0F}', label: 'Love heart'},
  {code: 'laughing', char: '\u{1F602}', label: 'Laughing (LOL)'}
];

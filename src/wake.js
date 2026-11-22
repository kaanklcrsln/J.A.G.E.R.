// Wake word and local intents. Pure functions: no Electron, no I/O.
'use strict';

// The wake word is "Jager", said "JAY-ger". Whisper has no idea how to spell
// it and writes "Jager", "Jaeger", "J. Jair", "J.J.R.", "Jai Jai", "Jay Jay",
// "J.G.E.R." and more. So the first one to three words are squashed to
// letters and matched by sound: J/Y, a vowel, J/G, a vowel, maybe R.
// "Just", "Jake", "jagged" and "Jay, call mom" do not match.
const WAKE_SOUND = /^(?:j|y|dj)(?:a|ae|ai|ay|e|ea|ei|ey)?(?:y|i)?(?:j|g|gg|dg|dj)(?:e|a|u|ai|ay|ey|ei|ah|uh)?(?:r|rr|re)?$/;
// Whole utterance only (nothing after it): Whisper sometimes keeps just "J."
const WAKE_ALONE = /^(?:j|jj|jay|jayj|yay)$/;
const GREETING = /^(?:hey|hi|ok|okay|yo|h)$/;

function normalize(text) {
  return String(text || '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ') // whisper tags: [BLANK_AUDIO], (music)
    .replace(/\s+/g, ' ')
    .trim();
}

const letters = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// -> null when the wake word is absent, else { command } ('' when the user
// only said the wake word and is waiting to be heard).
function matchWake(text) {
  let tokens = normalize(text).split(' ').filter(Boolean);
  // "Hey Jager", "H.J. Jair": drop the greeting, whether it came out as a
  // word or glued to the wake word as a stray H.
  if (tokens.length && GREETING.test(letters(tokens[0])) && tokens.length > 1) tokens = tokens.slice(1);
  for (let n = 1; n <= Math.min(3, tokens.length); n++) {
    let head = letters(tokens.slice(0, n).join(''));
    if (head.startsWith('hj')) head = head.slice(1);
    const rest = tokens.slice(n).join(' ');
    if (WAKE_SOUND.test(head) || (!rest && WAKE_ALONE.test(head))) {
      return { command: rest.replace(/^[\s,.!?:;-]+/, '').trim() };
    }
  }
  return null;
}

const STOP_RE = /^(?:please\s+)?(?:stop|cancel|never ?mind|forget it|shut up|quiet|that'?s (?:all|it|enough)|thanks?(?: you)?|thank you|go away|dismiss)[.!]?$/i;
const RESET_RE = /^(?:(?:start (?:a )?)?new|fresh|reset|clear|restart)(?: the)? (?:conversation|chat|session|context)[.!]?$|^start over[.!]?$/i;

// "Appreciated, Jager": the sign-off. Stops listening and ends the conversation.
const DISMISS_RE = /^(?:(?:much|very much|greatly|really)\s+)?(?:appreciated|appreciate (?:it|that|you)|apprec[a-z]*)[.!]?$/i;

// "Appreciated, Jager." -> "Appreciated": a wake word at the end is a sign-off
// courtesy, not a request.
function stripTrailingWake(text) {
  const tokens = normalize(text).split(' ').filter(Boolean);
  for (let n = Math.min(3, tokens.length - 1); n >= 1; n--) {
    if (WAKE_SOUND.test(letters(tokens.slice(-n).join('')))) {
      return tokens.slice(0, -n).join(' ').replace(/[\s,;:-]+$/, '');
    }
  }
  return normalize(text);
}

// -> 'dismiss' | 'stop' | 'reset' | 'empty' | 'ask'
function classify(text) {
  const clean = normalize(text);
  if (!clean || clean.replace(/[^a-z0-9]/gi, '').length < 2) return 'empty';
  if (DISMISS_RE.test(stripTrailingWake(clean))) return 'dismiss';
  if (STOP_RE.test(clean)) return 'stop';
  if (RESET_RE.test(clean)) return 'reset';
  return 'ask';
}

module.exports = { matchWake, classify, normalize };

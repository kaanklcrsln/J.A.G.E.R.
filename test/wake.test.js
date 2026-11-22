const test = require('node:test');
const assert = require('node:assert');
const { matchWake, classify } = require('../src/wake');

test('"Jager" (JAY-ger) in the spellings Whisper actually produces', () => {
  const heard = {
    'Jager, open Safari.': 'open Safari.',
    'Hey Jager, what time is it?': 'what time is it?',
    'Jaeger turn the volume down': 'turn the volume down',
    'Jäger, play some music': 'play some music',
    'Yager, lock the screen': 'lock the screen',
    'Jagger. Open Mail': 'Open Mail',
    'J. Jair, open safari.': 'open safari.',
    'Hey J.J.R., what time is it?': 'what time is it?',
    'Jai Jai, open safari.': 'open safari.',
    'Hey Jay Jay, what time is it?': 'what time is it?',
    'J.G.E.R. Open Safari.': 'Open Safari.',
    'H.J. Jair, what time is it?': 'what time is it?',
    'Okay, Jayger. Mute': 'Mute',
  };
  for (const [text, command] of Object.entries(heard)) assert.deepEqual(matchWake(text), { command }, text);
  for (const alone of ['Jager.', 'Jaija', 'J.', 'Hey Jager?', '[BLANK_AUDIO] Jager']) assert.deepEqual(matchWake(alone), { command: '' }, alone);
});

test('ordinary sentences do not wake it', () => {
  for (const text of [
    'I told Jager about it yesterday', 'Just do it', 'Jake, come here', 'Jay, call mom', 'Jagged edges everywhere',
    'Yeah, go ahead', 'Jarvis, open Safari', 'June is coming', 'Yoga at six', 'J. Crew has a sale', '', 'Hey',
  ]) assert.equal(matchWake(text), null, text);
});

test('"Appreciated, Jager" signs off, with the name before, after or not at all', () => {
  for (const s of ['Appreciated, Jager.', 'Appreciated Jaeger', 'Appreciated, J. Jair.', 'appreciated', 'Much appreciated, Jager!', 'Appreciate it, Jager.', 'Appreciate that.'])
    assert.equal(classify(s), 'dismiss', s);
  assert.deepEqual(matchWake('Jager, appreciated.'), { command: 'appreciated.' });
  assert.equal(classify(matchWake('Jager, appreciated.').command), 'dismiss');
  for (const s of ['I appreciated the help, Jager, now open Mail', 'Appreciated. Now open Safari']) assert.equal(classify(s), 'ask', s);
});

test('local intents: stop, reset, empty, otherwise an ask', () => {
  for (const s of ['stop', 'Cancel.', 'never mind', 'thank you', "that's all"]) assert.equal(classify(s), 'stop', s);
  for (const s of ['new conversation', 'Start a new chat.', 'reset the session', 'start over']) assert.equal(classify(s), 'reset', s);
  for (const s of ['', '  ', '[BLANK_AUDIO]', '.']) assert.equal(classify(s), 'empty', JSON.stringify(s));
  for (const s of ['stop the music in Spotify', 'open a new conversation in Messages with Ali', 'thanks, now open Mail']) assert.equal(classify(s), 'ask', s);
});

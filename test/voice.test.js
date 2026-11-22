const test = require('node:test');
const assert = require('node:assert');
const { createSegmenter } = require('../renderer/vad');
const { toSpeech } = require('../src/tts');

const CHUNK = 160; // 10 ms at 16 kHz
const quiet = () => ({ pcm: new Int16Array(CHUNK), level: 0.002 });
const loud = () => ({ pcm: new Int16Array(CHUNK).fill(3000), level: 0.09 });
function feed(seg, parts) {
  const results = [];
  for (const [kind, ms] of parts) {
    for (let t = 0; t < ms; t += 10) {
      const c = kind === 'loud' ? loud() : quiet();
      const r = seg.push(c.pcm, c.level);
      if (r.utterance || r.timeout) results.push(r);
    }
  }
  return results;
}

test('speech followed by silence becomes one utterance with pre-roll', () => {
  const seg = createSegmenter({ endSilenceMs: 500, preRollMs: 200 });
  const out = feed(seg, [['quiet', 1000], ['loud', 800], ['quiet', 600]]);
  assert.equal(out.length, 1);
  const ms = (out[0].utterance.length / 16000) * 1000;
  assert.ok(ms >= 1300 && ms <= 1550, `utterance ${ms}ms = pre-roll + speech + tail`);
});

test('a click shorter than minSpeechMs is dropped', () => {
  const seg = createSegmenter({ endSilenceMs: 300, minSpeechMs: 250 });
  assert.equal(feed(seg, [['quiet', 300], ['loud', 60], ['quiet', 400]]).length, 0);
});

test('no speech within noSpeechMs times out; flush returns what was said', () => {
  const seg = createSegmenter({ noSpeechMs: 1000 });
  const out = feed(seg, [['quiet', 1100]]);
  assert.equal(out.length, 1);
  assert.equal(out[0].timeout, true);

  const seg2 = createSegmenter({ endSilenceMs: 5000 });
  feed(seg2, [['quiet', 200], ['loud', 400]]);
  assert.ok(seg2.flush().length > 0);
  assert.equal(seg2.flush(), null);
});

test('replies are cleaned up for the ear', () => {
  assert.equal(toSpeech('**Done.** Opened `Safari` — see [docs](https://x.y).'), 'Done. Opened Safari — see docs.');
  assert.equal(toSpeech('# Result\n- one\n- two'), 'Result one two');
  assert.equal(toSpeech('It is at https://example.com/page now'), 'It is at the link now');
});

// Energy-based voice activity detection: cuts the 16 kHz mic stream into
// utterances. Loaded by the renderer as a script and by the tests via require.
(function (root) {
  'use strict';

  const RATE = 16000;

  function createSegmenter(opts = {}) {
    const o = {
      preRollMs: 300,       // audio kept from just before speech starts
      endSilenceMs: 900,    // this much quiet ends the utterance
      minSpeechMs: 250,     // shorter bursts (a click, a cough) are dropped
      maxMs: 20000,         // hard cap per utterance
      noSpeechMs: 0,        // >0: give up if no speech starts within this
      floor: 0.012,         // absolute minimum speech level (RMS 0..1)
      ratio: 3.2,           // speech must be this much louder than the noise
      ...opts,
    };
    let noise = 0.004;      // running noise estimate
    let pre = [];           // [{ pcm, ms }]
    let preMs = 0;
    let chunks = null;      // collecting when non-null
    let totalMs = 0, speechMs = 0, silenceMs = 0, waitedMs = 0;

    function reset() { chunks = null; totalMs = 0; speechMs = 0; silenceMs = 0; }

    function finish() {
      const keep = speechMs >= o.minSpeechMs;
      const parts = chunks || [];
      reset();
      if (!keep) return null;
      const len = parts.reduce((n, p) => n + p.length, 0);
      const out = new Int16Array(len);
      let at = 0;
      for (const p of parts) { out.set(p, at); at += p.length; }
      return out;
    }

    // pcm: Int16Array chunk; level: its RMS 0..1.
    // -> { utterance?: Int16Array, timeout?: true, speaking: bool }
    function push(pcm, level) {
      const ms = (pcm.length / RATE) * 1000;
      const threshold = Math.max(o.floor, noise * o.ratio);
      const loud = level > threshold;
      if (!loud) noise = noise * 0.97 + level * 0.03; // adapt only on quiet

      if (!chunks) {
        if (loud) {
          chunks = pre.map((p) => p.pcm);
          totalMs = preMs; speechMs = ms; silenceMs = 0;
          chunks.push(pcm); totalMs += ms;
          pre = []; preMs = 0;
          return { speaking: true };
        }
        pre.push({ pcm, ms }); preMs += ms;
        while (pre.length && preMs - pre[0].ms >= o.preRollMs) preMs -= pre.shift().ms;
        waitedMs += ms;
        if (o.noSpeechMs && waitedMs >= o.noSpeechMs) { waitedMs = 0; return { timeout: true, speaking: false }; }
        return { speaking: false };
      }

      chunks.push(pcm); totalMs += ms;
      if (loud) { speechMs += ms; silenceMs = 0; } else silenceMs += ms;
      if (silenceMs >= o.endSilenceMs || totalMs >= o.maxMs) {
        waitedMs = 0;
        const utterance = finish();
        return utterance ? { utterance, speaking: false } : { speaking: false };
      }
      return { speaking: true };
    }

    // Ends the current utterance now (push-to-talk released early).
    function flush() { waitedMs = 0; pre = []; preMs = 0; return chunks ? finish() : null; }

    return { push, flush, get collecting() { return Boolean(chunks); } };
  }

  const api = { createSegmenter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JagerVAD = api;
})(typeof self !== 'undefined' ? self : this);

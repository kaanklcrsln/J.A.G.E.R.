// The island: renders state from the main process, owns the microphone, and
// cuts the stream into utterances (vad.js) for the main process to transcribe.
'use strict';

(() => {
  const jager = window.jager;
  const $ = (id) => document.getElementById(id);
  const island = $('island');
  const lineEl = $('line');
  const bars = [...document.querySelectorAll('.wave i')];

  // ---------- layout from the main process ----------
  const params = new URLSearchParams(location.search);
  const menuBar = Math.max(24, Number(params.get('menuBar')) || 32);
  document.documentElement.style.setProperty('--mb', `${menuBar}px`);
  if (params.get('notch') === '1') {
    document.body.classList.add('notch');
    const nw = Number(params.get('notchW')) || 180;
    const nh = Number(params.get('notchH')) || menuBar - 1;
    document.documentElement.style.setProperty('--notch-w', `${nw}px`);
    document.documentElement.style.setProperty('--notch-h', `${nh}px`);
  }

  // ---------- rendering ----------
  let ui = { state: 'idle' };
  let hovered = false;
  const IDLE_HINT = '⌥Space or say “Jager”';

  function render() {
    const s = ui.state;
    island.dataset.state = s;
    const busy = s !== 'idle';
    const hasBody = Boolean(ui.transcript || ui.reply || (ui.activity && ui.activity.length) || ui.hint);
    island.classList.toggle('open', busy && (hasBody || s === 'error' || s === 'setup'));
    island.classList.toggle('peek', (busy && !hasBody && s !== 'error' && s !== 'setup') || (!busy && hovered));
    lineEl.textContent = s === 'idle' ? (hovered ? IDLE_HINT : '') : (ui.line || '');
    $('transcript').textContent = s === 'idle' ? '' : (ui.transcript || '');
    $('reply').textContent = s === 'speaking' || (s === 'listening' && ui.reply) ? (ui.reply || '') : '';
    $('hint').textContent = s === 'idle' ? '' : (ui.hint || '');
    const act = $('activity');
    // While thinking, the newest step is already the headline: list the earlier ones.
    const steps = s === 'thinking' ? (ui.activity || []).slice(0, -1) : s === 'speaking' ? (ui.activity || []) : [];
    act.replaceChildren(...steps.map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }));
  }

  jager.onUi((next) => {
    const prev = ui.state;
    ui = next;
    if (next.state === 'listening' && prev !== 'listening') chime(880, 1320);
    if (prev === 'listening' && next.state === 'transcribing') chime(1320, 990);
    render();
  });

  // ---------- pointer: the window is click-through except over the island ----------
  island.addEventListener('mouseenter', () => { hovered = true; jager.interactive(true); render(); });
  island.addEventListener('mouseleave', () => { hovered = false; jager.interactive(false); render(); });
  island.addEventListener('click', (e) => {
    if (e.target.closest('#stop')) return;
    jager.toggle();
  });
  $('stop').addEventListener('click', (e) => { e.stopPropagation(); jager.cancel(); });

  // ---------- sound cues ----------
  let cueCtx = null;
  function chime(from, to) {
    try {
      cueCtx = cueCtx || new AudioContext();
      const t = cueCtx.currentTime;
      const osc = cueCtx.createOscillator();
      const gain = cueCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + 0.09);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.06, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain).connect(cueCtx.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    } catch {}
  }

  // ---------- microphone + segmentation ----------
  let mode = 'off';      // 'wake' | 'command' | 'pending' | 'off'
  let wakeEnabled = true;
  let segmenter = null;
  let mic = null;        // { stream, ctx, node }
  let opening = null;

  const SEGMENT_OPTS = {
    wake: { endSilenceMs: 650, maxMs: 9000, minSpeechMs: 300 },
    command: { endSilenceMs: 1000, maxMs: 30000, minSpeechMs: 200 },
  };

  async function openMic() {
    if (mic) return mic;
    if (opening) return opening;
    opening = (async () => {
      // No forced sampleRate: some drivers reject it; the worklet downsamples.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      await ctx.audioWorklet.addModule('pcm-processor.js');
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'pcm-processor', { processorOptions: { targetRate: 16000 } });
      const sink = ctx.createGain();
      sink.gain.value = 0;
      src.connect(node); node.connect(sink); sink.connect(ctx.destination);
      node.port.onmessage = (e) => onChunk(new Int16Array(e.data.buffer), e.data.level || 0);
      mic = { stream, ctx, node };
      jager.log(`mic open at ${ctx.sampleRate}Hz via ${stream.getAudioTracks()[0]?.label || 'default'}`);
      return mic;
    })();
    try { return await opening; } finally { opening = null; }
  }

  function closeMic() {
    if (!mic) return;
    try { mic.node.port.onmessage = null; } catch {}
    try { mic.stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { mic.ctx.close(); } catch {}
    mic = null;
  }

  function onChunk(pcm, level) {
    if (mode === 'command') drawLevel(level);
    if (!segmenter || (mode !== 'wake' && mode !== 'command')) return;
    const r = segmenter.push(pcm, level);
    if (r.utterance) {
      const sentMode = mode;
      if (sentMode === 'command') { mode = 'pending'; segmenter = null; }
      jager.utterance(sentMode, r.utterance.buffer);
    } else if (r.timeout && mode === 'command') {
      mode = 'pending';
      segmenter = null;
      jager.listenTimeout();
    }
  }

  function drawLevel(level) {
    const v = Math.min(1, level * 9);
    bars.forEach((b, i) => {
      const shape = [0.55, 0.85, 1, 0.8, 0.5][i];
      b.style.height = `${4 + Math.round(12 * v * shape * (0.75 + Math.random() * 0.5))}px`;
    });
  }

  jager.onListen(async ({ mode: next, wake, noSpeechMs }) => {
    wakeEnabled = Boolean(wake);
    if (next === 'flush') {
      if (mode !== 'command') return;
      const u = segmenter && segmenter.flush();
      mode = 'pending';
      segmenter = null;
      if (u && u.length) jager.utterance('command', u.buffer);
      else jager.listenTimeout();
      return;
    }
    mode = next;
    bars.forEach((b) => { b.style.height = ''; });
    segmenter = next === 'wake' || next === 'command'
      ? window.JagerVAD.createSegmenter({ ...SEGMENT_OPTS[next], noSpeechMs: next === 'command' ? (noSpeechMs || 0) : 0 })
      : null;
    // Keep the mic open while the wake word is on (no re-open lag); otherwise
    // only while something is listening.
    if (next === 'wake' || next === 'command') {
      try { await openMic(); } catch (e) { jager.log(`mic failed: ${e && e.name} ${e && e.message}`); }
    } else if (!wakeEnabled) {
      closeMic();
    }
  });

  render();
  jager.ready();
})();

// Speaks replies with macOS `say`. Interruptible: stop() kills the voice.
'use strict';

const { spawn } = require('child_process');

// Ava is the English voice (download it in System Settings > Spoken Content). Override with
// JAGER_VOICE (any name from `say -v '?'`) and JAGER_VOICE_RATE (words/min).
const VOICE = process.env.JAGER_VOICE || 'Ava';
const RATE = process.env.JAGER_VOICE_RATE || '195';

// Text meant for the eye -> text meant for the ear.
function toSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'the link')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

let current = null;

function stop() {
  if (current) { try { current.kill('SIGTERM'); } catch {} current = null; }
}

function sayOnce(args) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn('/usr/bin/say', args); } catch { return resolve({ code: -1, stopped: false }); }
    current = child;
    child.on('error', () => { if (current === child) current = null; resolve({ code: -1, stopped: false }); });
    child.on('close', (code) => {
      const stopped = current !== child;
      if (!stopped) current = null;
      resolve({ code, stopped });
    });
  });
}

// Resolves when speech ends or is stopped. Never rejects.
async function speak(text) {
  stop();
  const words = toSpeech(text);
  if (!words) return;
  const first = await sayOnce(['-v', VOICE, '-r', RATE, words]);
  // Unknown voice exits non-zero: fall back to Samantha once.
  if (!first.stopped && first.code !== 0) await sayOnce(['-v', 'Samantha', '-r', RATE, words]);
}

function speaking() { return Boolean(current); }

module.exports = { speak, stop, speaking, toSpeech };

// Speaks replies with macOS `say`. Interruptible: stop() kills the voice.
'use strict';

const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const ema = require('./ema');

// An American male voice: the best one installed, from the downloadable
// Premium/Enhanced voices (System Settings › Accessibility › Spoken Content)
// down to Reed, which ships with macOS. JAGER_VOICE overrides (any name from
// `say -v '?'`), JAGER_VOICE_RATE sets words per minute.
const PREFERRED_VOICES = [
  'Evan (Premium)', 'Nathan (Premium)', 'Evan (Enhanced)', 'Nathan (Enhanced)', 'Tom (Enhanced)', 'Alex',
  'Reed (English (US))', 'Eddy (English (US))', 'Fred',
];
const RATE = process.env.JAGER_VOICE_RATE || '190';

function installedVoices() {
  try {
    return execFileSync('/usr/bin/say', ['-v', '?'], { encoding: 'utf8', timeout: 4000 })
      .split('\n')
      .map((line) => line.replace(/\s+[a-z]{2}_[A-Z]{2}\s+#.*$/, '').trim())
      .filter(Boolean);
  } catch { return []; }
}

function pickVoice(installed = installedVoices()) {
  if (process.env.JAGER_VOICE) return process.env.JAGER_VOICE;
  return PREFERRED_VOICES.find((v) => installed.includes(v)) || 'Reed (English (US))';
}

let chosenVoice = null;
const voice = () => (chosenVoice = chosenVoice || pickVoice());

// Turkish replies go to EMA Lightning (see ema.js); everything else to `say`.
// Turkish-only letters, or a couple of very common Turkish words, decide it.
const TR_LETTERS = /[çğışöüÇĞİŞÖÜ]/g;
const TR_WORDS = /\b(?:ve|bir|bu|için|ile|değil|evet|hayır|şu|çok|var|yok|tamam|şimdi|sonra|yüzde|saat|dakika|açtım|kapattım)\b/gi;
function isTurkish(text) {
  const t = String(text || '');
  const letters = (t.match(TR_LETTERS) || []).length;
  const words = (t.match(TR_WORDS) || []).length;
  return letters >= 2 || (letters >= 1 && words >= 1) || words >= 3;
}

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
let generation = 0;

function stop() {
  generation++;
  if (current) { try { current.kill('SIGTERM'); } catch {} current = null; }
}

function play(cmd, args) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args); } catch { return resolve({ code: -1, stopped: false }); }
    current = child;
    child.on('error', () => { if (current === child) current = null; resolve({ code: -1, stopped: false }); });
    child.on('close', (code) => {
      const stopped = current !== child;
      if (!stopped) current = null;
      resolve({ code, stopped });
    });
  });
}

const sayOnce = (args) => play('/usr/bin/say', args);

// Resolves when speech ends or is stopped. Never rejects.
async function speak(text) {
  stop();
  const mine = generation;
  const words = toSpeech(text);
  if (!words) return;
  if (isTurkish(words) && ema.available()) {
    const wav = await ema.synthesize(words.replace(/\bthe link\b/g, 'bağlantı'));
    if (mine !== generation) { if (wav) fs.rm(wav, { force: true }, () => {}); return; } // stopped while synthesizing
    if (wav) {
      await play('/usr/bin/afplay', [wav]);
      fs.rm(wav, { force: true }, () => {});
      return;
    }
    // EMA failed: fall through to `say` rather than stay silent.
  }
  const first = await sayOnce(['-v', voice(), '-r', RATE, words]);
  // Unknown voice exits non-zero: fall back to Fred (male, US, always installed) once.
  if (mine === generation && !first.stopped && first.code !== 0) await sayOnce(['-v', 'Fred', '-r', RATE, words]);
}

function speaking() { return Boolean(current); }

module.exports = { speak, stop, speaking, toSpeech, pickVoice, isTurkish };

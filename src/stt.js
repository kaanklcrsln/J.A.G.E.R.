// Local speech to text with whisper.cpp (`brew install whisper-cpp`).
// No cloud, no keys: each utterance is written to a temp WAV and transcribed
// by whisper-cli; the transcript comes back on stdout.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pcmToWav, rms16 } = require('./wav');

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin';
// Multilingual models first; the .en ones are English-only fallbacks.
const MODEL_NAMES = ['ggml-small-q5_1.bin', 'ggml-small.en-q5_1.bin', 'ggml-base.en-q5_1.bin', 'ggml-base.en.bin'];
const EXE_NAMES = ['whisper-cli', 'whisper-cpp', 'main'];
const TIMEOUT_MS = 30_000;
const MIN_BYTES = 16000 * 2 * 0.3; // 0.3 s of 16 kHz Int16
const RMS_GATE = 180;
const LEAD_SILENCE = Buffer.alloc(16000 * 2 * 0.25);

let userDataDir = null;
let cachedExe;

function init({ userData }) { userDataDir = userData; }

function binaryDirs() {
  return [
    process.env.JAGER_WHISPER_DIR,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(__dirname, '..', 'vendor', 'whisper'),
  ].filter(Boolean);
}

function findBinary() {
  if (cachedExe) return cachedExe;
  for (const dir of binaryDirs()) {
    for (const name of EXE_NAMES) {
      const full = path.join(dir, name);
      try { if (fs.statSync(full).isFile()) return (cachedExe = full); } catch {}
    }
  }
  return null;
}

function modelDirs() {
  return [
    userDataDir && path.join(userDataDir, 'whisper-models'),
    path.join(__dirname, '..', 'vendor', 'whisper-models'),
  ].filter(Boolean);
}

function findModel() {
  for (const name of MODEL_NAMES) {
    for (const dir of modelDirs()) {
      const full = path.join(dir, name);
      try { if (fs.statSync(full).size > 1e6) return full; } catch {}
    }
  }
  return null;
}

function status() {
  return { binary: Boolean(findBinary()), model: Boolean(findModel()) };
}

// Downloads the small multilingual model (~181 MB) into userData on first run.
async function ensureModel(onProgress) {
  const existing = findModel();
  if (existing) return existing;
  if (!userDataDir) throw new Error('stt_not_initialized');
  const dir = path.join(userDataDir, 'whisper-models');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(new URL(MODEL_URL).pathname));
  const tmp = dest + '.part';
  const res = await fetch(MODEL_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`model_download_failed_${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(tmp);
  let got = 0;
  for await (const chunk of res.body) {
    out.write(Buffer.from(chunk));
    got += chunk.length;
    if (total && onProgress) onProgress(Math.round((got / total) * 100));
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  fs.renameSync(tmp, dest);
  return dest;
}

function runWhisper(exe, model, wavPath) {
  return new Promise((resolve) => {
    const threads = String(Math.max(1, Math.min(6, os.cpus().length - 2)));
    // JAGER_LANG: 'tr' (default), 'en', or 'auto'. English-only models always use 'en'.
    const lang = /\.en[.-]/.test(path.basename(model)) ? 'en' : (process.env.JAGER_LANG || 'tr');
    const child = spawn(exe, ['-m', model, '-f', wavPath, '-l', lang, '-t', threads, '-nt', '-np']);
    let out = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {} resolve({ error: 'whisper_timeout' }); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', () => {});
    child.on('error', (err) => { clearTimeout(timer); resolve({ error: 'whisper_failed', detail: err.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve({ error: 'whisper_failed', detail: `exit ${code}` });
      resolve({ text: out.replace(/\s+/g, ' ').trim() });
    });
  });
}

// whisper-cli runs one at a time; a wake-word clip and a command never race.
let queue = Promise.resolve();

function transcribe(pcm) {
  if (!Buffer.isBuffer(pcm)) pcm = Buffer.from(pcm);
  if (pcm.length < MIN_BYTES || rms16(pcm) < RMS_GATE) return Promise.resolve({ text: '' });
  const exe = findBinary();
  const model = findModel();
  if (!exe) return Promise.resolve({ error: 'whisper_missing' });
  if (!model) return Promise.resolve({ error: 'model_missing' });
  const job = queue.then(async () => {
    const dir = path.join(userDataDir || os.tmpdir(), 'voice-tmp');
    fs.mkdirSync(dir, { recursive: true });
    const wavPath = path.join(dir, `utt-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wav`);
    // Whisper drops a first word that starts at sample 0 (the wake word included):
    // lead with a little silence.
    fs.writeFileSync(wavPath, pcmToWav(Buffer.concat([LEAD_SILENCE, pcm]), 16000, 1));
    try { return await runWhisper(exe, model, wavPath); } finally { try { fs.unlinkSync(wavPath); } catch {} }
  });
  queue = job.catch(() => {});
  return job;
}

module.exports = { init, status, ensureModel, transcribe };

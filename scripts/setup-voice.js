// Installs whisper.cpp (Homebrew) and downloads the base English model.
// Jager also downloads the model on first launch; this is for source setups.
// Usage: npm run setup:voice [-- --small]
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin';
const MODEL_SMALL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin';
const BREW_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];
const modelDir = path.join(__dirname, '..', 'vendor', 'whisper-models');

const firstExisting = (names) => {
  for (const dir of BREW_BIN_DIRS) for (const name of names) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
};

async function download(url, dest) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`  saved ${dest}`);
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('setup:voice supports macOS only.');
  let exe = firstExisting(['whisper-cli']);
  if (!exe) {
    const brew = firstExisting(['brew']);
    if (!brew) throw new Error('Homebrew not found. Install it from https://brew.sh, then run npm run setup:voice again.');
    execFileSync(brew, ['install', 'whisper-cpp'], { stdio: 'inherit' });
    exe = firstExisting(['whisper-cli']);
  }
  if (!exe) throw new Error('whisper-cli not found after brew install whisper-cpp');
  console.log(`Binary ready: ${exe}`);

  fs.mkdirSync(modelDir, { recursive: true });
  const url = process.argv.includes('--small') ? MODEL_SMALL_URL : MODEL_BASE_URL;
  const dest = path.join(modelDir, path.basename(new URL(url).pathname));
  if (!fs.existsSync(dest)) await download(url, dest);
  console.log(`Model ready: ${dest}`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });

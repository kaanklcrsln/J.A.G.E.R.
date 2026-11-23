// Sets up the Turkish voice: a private Python venv with ema-lightning, in the
// same folder the app reads it from. Usage: npm run setup:turkish
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const venv = path.join(os.homedir(), 'Library', 'Application Support', 'Jager', 'ema-venv');
const python = path.join(venv, 'bin', 'python');

function findPython() {
  for (const p of [process.env.JAGER_SETUP_PYTHON, '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/Library/Frameworks/Python.framework/Versions/Current/bin/python3', '/usr/bin/python3']) {
    if (!p || !fs.existsSync(p)) continue;
    try {
      const [major, minor] = execFileSync(p, ['-c', 'import sys; print(sys.version_info[0], sys.version_info[1])'], { encoding: 'utf8' }).trim().split(' ').map(Number);
      if (major === 3 && minor >= 11) return p;
    } catch {}
  }
  return null;
}

function main() {
  if (!fs.existsSync(python)) {
    const base = findPython();
    if (!base) throw new Error('Needs Python 3.11 or newer. brew install python, then run this again.');
    console.log(`Creating ${venv}`);
    execFileSync(base, ['-m', 'venv', venv], { stdio: 'inherit' });
  }
  execFileSync(python, ['-m', 'pip', 'install', '--upgrade', 'pip', 'ema-lightning'], { stdio: 'inherit' });
  console.log('Downloading the model and saying hello…');
  execFileSync(python, ['-I', '-c', 'from ema_lightning import EMA; s = EMA().say("Merhaba, ben Jager."); print("ok", round(s.duration, 2), "s of audio")'], { stdio: 'inherit' });
  console.log('Turkish voice ready. Pick "Türkçe" under Reply language in the Jager menu.');
}

try { main(); } catch (e) { console.error(e.message || e); process.exit(1); }

// Turkish speech with EMA Lightning (pip install ema-lightning), run as a
// long-lived Python worker so the model loads once (~10 s) and each sentence
// then takes ~0.1 s. Talks JSON lines over stdin/stdout.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// Kept as a string: a packaged app's src/ lives inside app.asar, which
// Python cannot read, so the worker is written out to userData at start.
const WORKER_PY = `
import json, sys, warnings
warnings.filterwarnings("ignore")
from ema_lightning import EMA

tts = EMA()
print(json.dumps({"ready": True, "device": str(tts.device)}), flush=True)
for line in sys.stdin:
    try:
        req = json.loads(line)
        speech = tts.say(req["text"], speed=float(req.get("speed", 1.0)), path=req["path"])
        print(json.dumps({"id": req["id"], "ok": True, "duration": speech.duration}), flush=True)
    except Exception as e:
        print(json.dumps({"id": req.get("id") if isinstance(req, dict) else None, "ok": False, "error": str(e)}), flush=True)
`;

let dataDir = os.tmpdir();
let worker = null;     // { child, ready: Promise<boolean>, pending: Map }
let nextId = 1;

function venvPython() {
  if (process.env.JAGER_EMA_PYTHON) return process.env.JAGER_EMA_PYTHON;
  return path.join(dataDir, 'ema-venv', 'bin', 'python');
}

function available() {
  try { return fs.statSync(venvPython()).isFile(); } catch { return false; }
}

function init({ userData }) { dataDir = userData; }

function start() {
  if (worker) return worker.ready;
  if (!available()) return Promise.resolve(false);
  const script = path.join(dataDir, 'ema_worker.py');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(script, WORKER_PY);
  const env = { ...process.env, PYTHONUNBUFFERED: '1', TOKENIZERS_PARALLELISM: 'false' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(venvPython(), ['-I', script], { cwd: dataDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });
  worker = { child, ready, pending };
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.ready) { console.log(`[ema] ready on ${msg.device}`); markReady(true); continue; }
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); p(msg); }
    }
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr = (stderr + d.toString('utf8')).slice(-2000); });
  const fail = () => {
    if (worker && worker.child === child) worker = null;
    markReady(false);
    for (const p of pending.values()) p({ ok: false, error: 'worker exited' });
    pending.clear();
    if (stderr.trim()) console.error('[ema] worker exited:', stderr.trim().split('\n').pop());
  };
  child.on('error', fail);
  child.on('close', fail);
  return ready;
}

// -> path of a WAV with the speech, or null when EMA is unavailable or failed.
async function synthesize(text, { speed = 1.0 } = {}) {
  if (!(await start())) return null;
  const w = worker;
  if (!w) return null;
  const id = nextId++;
  const out = path.join(dataDir, 'voice-tmp', `tr-${id}.wav`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const reply = await new Promise((resolve) => {
    w.pending.set(id, resolve);
    w.child.stdin.write(JSON.stringify({ id, text, speed, path: out }) + '\n');
    setTimeout(() => { if (w.pending.delete(id)) resolve({ ok: false, error: 'timeout' }); }, 30000);
  });
  if (!reply.ok) { console.error('[ema] synth failed:', reply.error); return null; }
  return out;
}

function stopWorker() {
  if (worker) { try { worker.child.kill(); } catch {} worker = null; }
}

module.exports = { init, start, synthesize, available, stopWorker };

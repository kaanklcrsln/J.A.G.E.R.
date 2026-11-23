// Jager: a voice agent that lives in a Dynamic Island style bar at the top of
// the screen and acts through Claude Code with full control of this Mac.
//
//   idle ──(⌥Space / "Jager")──> listening ──> transcribing ──> thinking ──> speaking
//    ^                                ^                                          │
//    └──────── no follow-up ──────────┴──────── follow-up window ────────────────┘
'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage, systemPreferences, session } = require('electron');
const claude = require('./claude');
const stt = require('./stt');
const tts = require('./tts');
const ema = require('./ema');
const { matchWake, classify } = require('./wake');
const { notchFor } = require('./notch');

const SMOKE = process.argv.includes('--smoke');
if (SMOKE && process.env.JAGER_SMOKE_DATA_DIR) app.setPath('userData', path.resolve(process.env.JAGER_SMOKE_DATA_DIR));

const HOTKEY = process.env.JAGER_HOTKEY || 'Alt+Space';
const CANCEL_KEY = process.env.JAGER_CANCEL_HOTKEY || 'Alt+Escape';
const LISTEN_TIMEOUT_MS = 8000;      // hotkey pressed, nothing said
const FOLLOW_UP_MS = 6000;           // after a reply, answer without the wake word
const SESSION_IDLE_MS = 20 * 60 * 1000; // conversation memory between requests
const WIN_W = 640;
const WIN_H = 440;

let win = null;
let tray = null;
let settings = { wake: true, voice: true, replyLanguage: 'en' };
let job = null;          // running Claude request
let sessionId = null;
let lastReplyAt = 0;
let speakToken = 0;
let rendererReady = false;
let listenMode = 'off';

const ui = { state: 'idle', line: '', transcript: '', reply: '', activity: [], error: '', hint: '' };

// ---------------------------------------------------------------- settings

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch {}
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsPath()), { recursive: true }); fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch (e) { console.error('[jager] settings save failed', e.message); }
}

// ---------------------------------------------------------------- ui plumbing

function send(channel, payload) {
  if (win && !win.isDestroyed() && rendererReady) win.webContents.send(channel, payload);
}
function setUi(patch) {
  Object.assign(ui, patch);
  send('ui', ui);
  updateTrayMenu();
}
function listen(mode, extra = {}) {
  listenMode = mode;
  send('listen', { mode, wake: settings.wake, ...extra });
}
function idleListenMode() { return settings.wake && !ui.error ? 'wake' : 'off'; }

function goIdle() {
  speakToken++;
  setUi({ state: 'idle', line: '', hint: '' });
  listen(idleListenMode());
}

function showError(message) {
  speakToken++;
  setUi({ state: 'error', line: message, error: message });
  listen('off');
}

// ---------------------------------------------------------------- flow

function startListening({ followUp = false } = {}) {
  speakToken++;
  tts.stop();
  setUi({ state: 'listening', line: followUp ? 'Go on…' : 'Listening…', transcript: '', hint: '' });
  listen('command', { noSpeechMs: followUp ? FOLLOW_UP_MS : LISTEN_TIMEOUT_MS, followUp });
}

function onHotkey() {
  switch (ui.state) {
    case 'idle': return startListening();
    case 'listening': return listen('flush');
    case 'speaking': return startListening();
    case 'thinking': return setUi({ hint: '⌥Esc cancels' });
    case 'error': return recheck();
    default: return undefined;
  }
}

function cancelAll() {
  if (job) { job.cancel(); job = null; }
  tts.stop();
  goIdle();
}

async function onUtterance(mode, pcm) {
  if (mode === 'command') {
    if (ui.state !== 'listening') return;
    setUi({ state: 'transcribing', line: '…' });
    listen('off');
    const r = await stt.transcribe(pcm);
    if (ui.state !== 'transcribing') return; // cancelled meanwhile
    if (r.error) return handleSttError(r.error);
    if (classify(r.text) === 'empty') {
      setUi({ line: 'I didn\'t catch that.' });
      return setTimeout(() => { if (ui.state === 'transcribing') goIdle(); }, 1400);
    }
    // Saying the wake word after pressing the hotkey is fine: drop it.
    const w = matchWake(r.text);
    return handleCommand(w ? w.command : r.text);
  }

  // Wake mode: only the idle bar and a running task listen for "Jager".
  if (ui.state !== 'idle' && ui.state !== 'thinking') return;
  const r = await stt.transcribe(pcm);
  if (r.error || !r.text) return;
  const w = matchWake(r.text);
  if (process.env.JAGER_DEBUG) console.log(`[wake] heard ${JSON.stringify(r.text)} -> ${w ? `wake, command ${JSON.stringify(w.command)}` : "no"}`);
  if (!w) return;
  if (ui.state === 'thinking') {
    if (classify(w.command) === 'stop') cancelAll();
    else setUi({ hint: 'Still on it. Say "Jager, stop" to cancel.' });
    return;
  }
  if (ui.state !== 'idle') return;
  if (classify(w.command) === 'empty') return startListening();
  handleCommand(w.command);
}

function handleCommand(text) {
  setUi({ transcript: text });
  const kind = classify(text);
  if (kind === 'empty' || kind === 'stop') return goIdle();
  if (kind === 'dismiss') {
    // "Appreciated, Jager": stop listening, end the conversation, close up.
    sessionId = null;
    tts.stop();
    setUi({ transcript: '', reply: '', activity: [] });
    return goIdle();
  }
  if (kind === 'reset') {
    sessionId = null;
    return speakReply('Fresh start. What do you need?');
  }
  think(text);
}

async function think(text, retried = false) {
  if (Date.now() - lastReplyAt > SESSION_IDLE_MS) sessionId = null;
  setUi({ state: 'thinking', line: 'Thinking…', activity: [], reply: '', hint: '' });
  listen(idleListenMode()); // "Jager, stop" still works while it runs
  const mine = claude.run(text, {
    sessionId,
    language: settings.replyLanguage,
    onEvent: (ev) => {
      if (job !== mine) return;
      if (ev.type === 'session') sessionId = ev.sessionId;
      if (ev.type === 'tool') setUi({ line: ev.text, activity: [...ui.activity, ev.text].slice(-4) });
    },
  });
  job = mine;
  const r = await mine.promise;
  if (job !== mine) return; // cancelled or replaced
  job = null;
  if (r.cancelled) return;
  if (r.sessionId) sessionId = r.sessionId;
  if (r.error === 'session_stale' && !retried) { sessionId = null; return think(text, true); }
  lastReplyAt = Date.now();
  if (r.error === 'claude_missing') return showError('Claude Code not found. Install it, sign in with `claude`, then click here.');
  if (r.error) {
    console.error('[jager] claude failed:', r.detail);
    setUi({ activity: [...ui.activity, String(r.detail || '').slice(0, 120)].slice(-4) });
    return speakReply('That didn\'t work. The details are on screen.');
  }
  speakReply(r.text || 'Done.');
}

async function speakReply(text) {
  const token = ++speakToken;
  setUi({ state: 'speaking', reply: text, line: '' });
  listen('off'); // never transcribe our own voice
  if (settings.voice) await tts.speak(text);
  else await new Promise((r) => setTimeout(r, Math.min(8000, 1500 + text.length * 45))); // muted: leave time to read
  if (token !== speakToken || ui.state !== 'speaking') return;
  startListening({ followUp: true });
}

function handleSttError(code) {
  if (code === 'whisper_missing') return showError('Voice engine missing. Run: brew install whisper-cpp, then click here.');
  if (code === 'model_missing') return downloadModel();
  setUi({ line: 'Couldn\'t transcribe that.' });
  setTimeout(() => { if (ui.state === 'transcribing') goIdle(); }, 1400);
}

// ---------------------------------------------------------------- setup checks

async function downloadModel() {
  setUi({ state: 'setup', line: 'Downloading voice model…', error: '' });
  listen('off');
  try {
    await stt.ensureModel((pct) => setUi({ line: `Downloading voice model ${pct}%` }));
    setUi({ error: '' });
    goIdle();
  } catch (e) {
    showError(`Voice model download failed (${e.message}). Click to retry.`);
  }
}

async function recheck() {
  setUi({ error: '' });
  const mic = systemPreferences.getMediaAccessStatus('microphone');
  if (mic !== 'granted') {
    const ok = await systemPreferences.askForMediaAccess('microphone').catch(() => false);
    if (!ok) return showError('Microphone access is off. Allow Jager in System Settings › Privacy & Security › Microphone.');
  }
  const s = stt.status();
  if (!s.binary) return showError('Voice engine missing. Run: brew install whisper-cpp, then click here.');
  if (!(await claude.detectCli())) return showError('Claude Code not found. Install it, sign in with `claude`, then click here.');
  if (!s.model) return downloadModel();
  goIdle();
}

// ---------------------------------------------------------------- window

function placeWindow() {
  if (!win || win.isDestroyed()) return;
  const d = screen.getPrimaryDisplay();
  const want = { x: Math.round(d.bounds.x + (d.bounds.width - WIN_W) / 2), y: d.bounds.y, width: WIN_W, height: WIN_H };
  win.setBounds(want);
  // macOS pushes ordinary windows below the menu bar; the island must sit at
  // y=0 inside the notch. enableLargerThanScreen lifts that constraint.
  const got = win.getBounds();
  if (got.y !== want.y) console.error(`[jager] window placed at y=${got.y}, wanted ${want.y}`);
}

async function createWindow() {
  const d = screen.getPrimaryDisplay();
  const menuBar = Math.max(24, d.workArea.y - d.bounds.y);
  const notch = await notchFor(d).catch(() => null);
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    enableLargerThanScreen: true,
    type: 'panel',
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  placeWindow();
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Click-through everywhere except the island; the renderer flips this on hover.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), {
    query: notch
      ? { menuBar: String(menuBar), notch: '1', notchW: String(notch.width), notchH: String(notch.height) }
      : { menuBar: String(menuBar), notch: '0' },
  });
  win.once('ready-to-show', () => win.showInactive());
  screen.on('display-metrics-changed', placeWindow);
  screen.on('display-added', placeWindow);
  screen.on('display-removed', placeWindow);
}

// ---------------------------------------------------------------- tray (text only)

const STATE_LABEL = { idle: 'Ready', listening: 'Listening', transcribing: 'Listening', thinking: 'Working', speaking: 'Speaking', setup: 'Setting up', error: 'Needs attention' };

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Jager: ${STATE_LABEL[ui.state] || ui.state}`, enabled: false },
    { label: `Talk (${HOTKEY.replace('Alt', '⌥').replace('+', '')})`, click: onHotkey },
    { label: 'Cancel', enabled: ui.state !== 'idle', click: cancelAll },
    { type: 'separator' },
    { label: 'Wake word "Jager"', type: 'checkbox', checked: settings.wake, click: (item) => { settings.wake = item.checked; saveSettings(); if (ui.state === 'idle') listen(idleListenMode()); } },
    { label: 'Spoken replies', type: 'checkbox', checked: settings.voice, click: (item) => { settings.voice = item.checked; saveSettings(); if (!settings.voice) tts.stop(); } },
    { label: 'Reply language', submenu: [
      { label: 'English', type: 'radio', checked: settings.replyLanguage !== 'tr', click: () => setReplyLanguage('en') },
      { label: ema.available() ? 'Türkçe (EMA Lightning)' : 'Türkçe (needs npm run setup:turkish)', type: 'radio', checked: settings.replyLanguage === 'tr', click: () => setReplyLanguage('tr') },
    ] },
    { label: 'New conversation', click: () => { sessionId = null; } },
    { type: 'separator' },
    { label: 'Quit Jager', role: 'quit' },
  ]));
}

function setReplyLanguage(lang) {
  settings.replyLanguage = lang;
  saveSettings();
  sessionId = null; // a fresh conversation picks up the new language cleanly
  if (lang === 'tr') ema.start();
  updateTrayMenu();
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('Jager');
  tray.setToolTip('Jager');
  updateTrayMenu();
}

// ---------------------------------------------------------------- ipc

function toBuffer(pcm) {
  if (Buffer.isBuffer(pcm)) return pcm;
  if (pcm instanceof ArrayBuffer) return Buffer.from(pcm);
  if (ArrayBuffer.isView(pcm)) return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return Buffer.alloc(0);
}

function wireIpc() {
  const fromUs = (e) => win && e.sender === win.webContents;
  ipcMain.on('ready', (e) => {
    if (!fromUs(e)) return;
    rendererReady = true;
    send('ui', ui);
    listen(listenMode === 'off' && ui.state === 'idle' ? idleListenMode() : listenMode);
  });
  ipcMain.on('utterance', (e, { mode, pcm } = {}) => {
    if (!fromUs(e) || (mode !== 'command' && mode !== 'wake')) return;
    onUtterance(mode, toBuffer(pcm)).catch((err) => { console.error('[jager] utterance failed', err); goIdle(); });
  });
  ipcMain.on('listen-timeout', (e) => { if (fromUs(e) && ui.state === 'listening') goIdle(); });
  ipcMain.on('interactive', (e, on) => { if (fromUs(e)) win.setIgnoreMouseEvents(!on, { forward: true }); });
  ipcMain.on('toggle', (e) => { if (fromUs(e)) onHotkey(); });
  ipcMain.on('cancel', (e) => { if (fromUs(e)) cancelAll(); });
  ipcMain.on('log', (e, msg) => { if (fromUs(e)) console.log('[renderer]', String(msg).slice(0, 500)); });
}

// ---------------------------------------------------------------- boot

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    if (app.dock) app.dock.hide();
    loadSettings();
    stt.init({ userData: app.getPath('userData') });
    ema.init({ userData: app.getPath('userData') });
    // Only the island's own page may use the microphone, and nothing else.
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' && win && wc === win.webContents));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media' && Boolean(win) && wc === win.webContents);
    wireIpc();
    await createWindow();
    createTray();
    if (!globalShortcut.register(HOTKEY, onHotkey)) console.error(`[jager] could not register ${HOTKEY}`);
    if (!globalShortcut.register(CANCEL_KEY, cancelAll)) console.error(`[jager] could not register ${CANCEL_KEY}`);

    if (SMOKE) {
      win.webContents.once('did-finish-load', () => {
        console.log('[jager] smoke ok: island loaded, stt', JSON.stringify(stt.status()));
        setTimeout(() => app.exit(0), 800);
      });
      return;
    }
    // Warm the Turkish voice in the background: the model takes ~10 s to load.
    if (ema.available()) ema.start();
    await recheck();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (job) job.cancel();
    tts.stop();
    ema.stopWorker();
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}

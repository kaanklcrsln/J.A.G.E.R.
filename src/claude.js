// Runs Claude Code (`claude -p`) as Jager's brain, with full permissions.
//
// Each request is one headless CLI run streaming JSON events. The session id
// from each run is passed back with --resume so the conversation continues.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const MODEL = process.env.JAGER_MODEL || 'sonnet';

// A GUI app on macOS starts with a bare PATH, so a plain `which claude` misses
// normal installs; these are checked directly and prepended to the CLI's PATH
// (an npm install needs node next to it).
const BIN_DIRS = [
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.claude', 'local'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(os.homedir(), '.npm-global', 'bin'),
  path.join(os.homedir(), '.volta', 'bin'),
  path.join(os.homedir(), '.bun', 'bin'),
];

const SYSTEM_PROMPT = [
  'You are Jager, a voice assistant in the style of JARVIS, running on the user\'s Mac.',
  'You have full control of this computer through your tools: the shell, files, `open`, `osascript` (AppleScript/JXA to drive apps, windows, System Events, Music, Safari, Finder, Mail, Calendar, Reminders, Notes), `defaults`, `pmset`, `networksetup` and anything else installed.',
  'To see the screen, run `screencapture -x /tmp/jager-screen.png` and read that image.',
  'The user speaks to you; their words come from speech recognition and may contain transcription errors, so infer the most likely intent.',
  'Act directly and finish the task. Only ask a question when the request is genuinely ambiguous, and confirm first only before something irreversible the user clearly did not ask for.',
  'Your final reply is read aloud by text to speech. Reply in {LANGUAGE}, in one to three short spoken sentences: no markdown, no lists, no code, no URLs or file paths unless the user needs them.',
  'Tone: calm, precise, lightly dry wit, like JARVIS. Say what you did or found, not how.',
].join(' ');

const LANGUAGES = { en: 'English', tr: 'Turkish' };
function systemPrompt(language = 'en') {
  return SYSTEM_PROMPT.replace('{LANGUAGE}', LANGUAGES[language] || LANGUAGES.en);
}

function cliEnv() {
  const env = { ...process.env };
  // Bill the user's Claude subscription, never a stray API key from the environment.
  delete env.ANTHROPIC_API_KEY;
  delete env.ELECTRON_RUN_AS_NODE;
  env.PATH = [...BIN_DIRS, env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'].join(':');
  return env;
}

function isExecutable(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; }
}

let cliPathCache;
async function detectCli() {
  if (cliPathCache) return cliPathCache;
  if (process.env.JAGER_CLAUDE_PATH && isExecutable(process.env.JAGER_CLAUDE_PATH)) return (cliPathCache = process.env.JAGER_CLAUDE_PATH);
  for (const dir of BIN_DIRS) {
    const full = path.join(dir, 'claude');
    if (isExecutable(full)) return (cliPathCache = full);
  }
  // Last resort: the login shell knows about unusual installs. It may print a
  // motd first, so the path is the last non-empty line, and it must exist.
  const found = await new Promise((resolve) => {
    execFile(process.env.SHELL || '/bin/zsh', ['-lc', 'command -v claude'], { timeout: 4000, env: cliEnv() }, (error, stdout) => {
      const lines = String(stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const candidate = error || !lines.length ? null : lines[lines.length - 1];
      resolve(candidate && isExecutable(candidate) ? candidate : null);
    });
  });
  if (found) cliPathCache = found;
  return found;
}

// One short line for the island: what Claude is doing right now.
function describeTool(name, input = {}) {
  const clip = (s, n = 60) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const base = (p) => path.basename(String(p || ''));
  switch (name) {
    case 'Bash': return input.description ? clip(input.description) : `Running ${clip(input.command, 50)}`;
    case 'Read': return `Reading ${base(input.file_path)}`;
    case 'Write': return `Writing ${base(input.file_path)}`;
    case 'Edit': case 'MultiEdit': return `Editing ${base(input.file_path)}`;
    case 'Glob': return `Finding ${clip(input.pattern, 40)}`;
    case 'Grep': return `Searching for ${clip(input.pattern, 40)}`;
    case 'WebSearch': return `Searching the web: ${clip(input.query, 44)}`;
    case 'WebFetch': { try { return `Reading ${new URL(input.url).hostname}`; } catch { return 'Reading a web page'; } }
    case 'Task': case 'Agent': return input.description ? clip(input.description) : 'Delegating a subtask';
    case 'TodoWrite': return 'Planning';
    default: return clip(name.replace(/^mcp__[^_]+__/, '').replace(/_/g, ' '));
  }
}

// Parses one stream-json line into Jager events. Unknown lines -> [].
function parseStreamLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return []; }
  if (!msg || typeof msg !== 'object') return [];
  const out = [];
  if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) out.push({ type: 'session', sessionId: msg.session_id });
  if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
    for (const block of msg.message.content) {
      if (block.type === 'tool_use') out.push({ type: 'tool', name: block.name, text: describeTool(block.name, block.input) });
      else if (block.type === 'text' && block.text && block.text.trim()) out.push({ type: 'text', text: block.text.trim() });
    }
  }
  if (msg.type === 'result') {
    out.push({
      type: 'result',
      sessionId: msg.session_id || null,
      text: typeof msg.result === 'string' ? msg.result.trim() : '',
      isError: Boolean(msg.is_error) || (msg.subtype && msg.subtype !== 'success'),
    });
  }
  return out;
}

// Runs one request. Returns { promise, cancel }. promise resolves to
// { text, sessionId, error?, cancelled? } and never rejects.
function run(prompt, { sessionId = null, onEvent = () => {}, cwd = os.homedir(), cliPath, language = 'en' } = {}) {
  let child = null;
  let cancelled = false;
  const promise = (async () => {
    const bin = cliPath || await detectCli();
    if (!bin) return { error: 'claude_missing', text: '' };
    if (cancelled) return { cancelled: true, text: '' };
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', MODEL,
      '--dangerously-skip-permissions', '--append-system-prompt', systemPrompt(language)];
    if (sessionId) args.push('--resume', sessionId);
    return new Promise((resolve) => {
      child = spawn(bin, args, { cwd, env: cliEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
      let buf = '';
      let stderr = '';
      let lastText = '';
      let result = null;
      let newSession = sessionId;
      const handle = (line) => {
        for (const ev of parseStreamLine(line)) {
          if (ev.type === 'session') newSession = ev.sessionId;
          if (ev.type === 'text') lastText = ev.text;
          if (ev.type === 'result') { result = ev; if (ev.sessionId) newSession = ev.sessionId; }
          try { onEvent(ev); } catch {}
        }
      };
      child.stdout.on('data', (d) => {
        buf += d.toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); }
      });
      child.stderr.on('data', (d) => { stderr = (stderr + d.toString('utf8')).slice(-4000); });
      child.on('error', (err) => resolve({ error: 'claude_spawn_failed', detail: err.message, text: '' }));
      child.on('close', (code) => {
        if (buf.trim()) handle(buf.trim());
        if (cancelled) return resolve({ cancelled: true, text: '', sessionId: newSession });
        if (result && !result.isError) return resolve({ text: result.text || lastText, sessionId: newSession });
        const detail = (result && result.text) || stderr.trim().split('\n').pop() || `exit ${code}`;
        // A stale --resume id fails the whole run; the caller retries fresh.
        const staleSession = sessionId && /session|conversation/i.test(detail) && /not found|no conversation|invalid/i.test(detail);
        resolve({ error: staleSession ? 'session_stale' : 'claude_failed', detail, text: '', sessionId: newSession });
      });
      child.stdin.end(prompt);
    });
  })();
  const cancel = () => {
    cancelled = true;
    if (child && child.exitCode === null) {
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { if (child.exitCode === null) child.kill('SIGKILL'); } catch {} }, 2000);
    }
  };
  return { promise, cancel };
}

module.exports = { run, detectCli, parseStreamLine, describeTool, systemPrompt };

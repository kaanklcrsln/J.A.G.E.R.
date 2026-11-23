const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseStreamLine, describeTool, run } = require('../src/claude');

test('stream-json lines become session, tool, text and result events', () => {
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' })), [{ type: 'session', sessionId: 's1' }]);
  const assistant = parseStreamLine(JSON.stringify({ type: 'assistant', message: { content: [
    { type: 'text', text: ' Opening it. ' },
    { type: 'tool_use', name: 'Bash', input: { command: 'open -a Safari', description: 'Open Safari' } },
  ] } }));
  assert.deepEqual(assistant, [{ type: 'text', text: 'Opening it.' }, { type: 'tool', name: 'Bash', text: 'Open Safari' }]);
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'Safari is open.', session_id: 's1', is_error: false })),
    [{ type: 'result', sessionId: 's1', text: 'Safari is open.', isError: false }]);
  assert.equal(parseStreamLine(JSON.stringify({ type: 'result', subtype: 'error_max_turns', session_id: 's1' }))[0].isError, true);
  assert.deepEqual(parseStreamLine('not json'), []);
});

test('tool lines are short and human', () => {
  assert.equal(describeTool('Read', { file_path: '/Users/me/notes/todo.md' }), 'Reading todo.md');
  assert.equal(describeTool('Bash', { command: 'ls -la ~/Downloads' }), 'Running ls -la ~/Downloads');
  assert.equal(describeTool('WebFetch', { url: 'https://example.com/a/b' }), 'Reading example.com');
  assert.equal(describeTool('mcp__browser__take_screenshot', {}), 'take screenshot');
  assert.ok(describeTool('Bash', { command: 'x'.repeat(200) }).length <= 60);
});

// A fake `claude` that echoes the flags it got as stream-json.
function fakeCli(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jager-cli-'));
  const file = path.join(dir, 'claude');
  fs.writeFileSync(file, `#!/usr/bin/env node\n${script}\n`, { mode: 0o755 });
  return file;
}

test('run passes full permissions, the voice persona and --resume, and returns the result', async () => {
  const cliPath = fakeCli(`
let input = ''; process.stdin.on('data', d => input += d); process.stdin.on('end', () => {
  const a = process.argv.slice(2);
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'system', subtype: 'init', session_id: 'new-session' });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { description: 'Checking battery' } }] } });
  out({ type: 'result', subtype: 'success', is_error: false, session_id: 'new-session',
    result: JSON.stringify({ input, skip: a.includes('--dangerously-skip-permissions'), resume: a[a.indexOf('--resume') + 1], persona: /JARVIS/.test(a[a.indexOf('--append-system-prompt') + 1]), lang: (a[a.indexOf('--append-system-prompt') + 1].match(/Reply in (\\w+)/) || [])[1], key: process.env.ANTHROPIC_API_KEY || null }) });
});`);
  const events = [];
  process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
  const { promise } = run('how much battery is left', { sessionId: 'old-session', cliPath, language: 'tr', onEvent: (e) => events.push(e.type) });
  const r = await promise;
  delete process.env.ANTHROPIC_API_KEY;
  const got = JSON.parse(r.text);
  assert.deepEqual(got, { input: 'how much battery is left', skip: true, resume: 'old-session', persona: true, lang: 'Turkish', key: null });
  assert.equal(r.sessionId, 'new-session');
  assert.deepEqual(events, ['session', 'tool', 'result']);
});

test('cancel ends the run as cancelled', async () => {
  const cliPath = fakeCli('setTimeout(() => {}, 60000);');
  const job = run('wait', { cliPath });
  setTimeout(job.cancel, 100);
  const r = await job.promise;
  assert.equal(r.cancelled, true);
});

test('a failing run reports the error detail', async () => {
  const cliPath = fakeCli(`process.stderr.write('Not logged in. Please run /login\\n'); process.exit(1);`);
  const r = await run('hi', { cliPath }).promise;
  assert.equal(r.error, 'claude_failed');
  assert.match(r.detail, /Not logged in/);
});

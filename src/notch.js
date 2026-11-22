// The built-in display's notch, read from NSScreen (macOS 12+): the gap
// between auxiliaryTopLeftArea and auxiliaryTopRightArea, and safeAreaInsets.top.
'use strict';

const { execFile } = require('child_process');

const JXA = `
ObjC.import('AppKit');
const screens = $.NSScreen.screens;
const out = [];
for (let n = 0; n < screens.count; n++) {
  const s = screens.objectAtIndex(n);
  const f = s.frame;
  let notch = null;
  if (s.respondsToSelector('auxiliaryTopLeftArea') && s.safeAreaInsets.top > 0) {
    const l = s.auxiliaryTopLeftArea, r = s.auxiliaryTopRightArea;
    notch = { x: l.size.width, width: r.origin.x - l.size.width, height: s.safeAreaInsets.top };
  }
  out.push({ x: f.origin.x, width: f.size.width, height: f.size.height, notch });
}
JSON.stringify(out);`;

// -> [{ x, width, height, notch: { x, width, height } | null }] in screen order
// (index 0 is the primary display). [] when it cannot be read.
function readScreens() {
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA], { timeout: 4000 }, (error, stdout) => {
      if (error) return resolve([]);
      try { resolve(JSON.parse(String(stdout).trim())); } catch { resolve([]); }
    });
  });
}

// Notch of the display matching this Electron display (by width), or null.
async function notchFor(display) {
  const screens = await readScreens();
  const match = screens.find((s) => s.notch && Math.round(s.width) === display.bounds.width) || null;
  if (!match) return null;
  const { width, height } = match.notch;
  if (!(width > 50 && width < 400 && height > 10 && height < 80)) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

module.exports = { notchFor, readScreens };

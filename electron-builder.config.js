// electron-builder configuration for the macOS build (npm run dist).
//
// Unsigned by default: the app is ad-hoc signed in afterPack so Gatekeeper
// offers "Open Anyway" instead of "app is damaged". With a Developer ID in the
// environment (CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID,
// APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID) it signs and notarizes instead.

const path = require('path');
const { execFileSync } = require('child_process');

const appleSigned = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
  .every((name) => Boolean(process.env[name]));

function adHocSignMac(context) {
  if (context.electronPlatformName !== 'darwin' || appleSigned) return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.jager.desktop',
  productName: 'Jager',
  copyright: 'Copyright 2026 Jager',
  directories: { output: 'dist' },
  files: ['src/**/*', 'renderer/**/*', 'package.json'],
  afterPack: adHocSignMac,
  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    category: 'public.app-category.productivity',
    artifactName: 'Jager-${arch}.${ext}',
    darkModeSupport: true,
    ...(appleSigned
      ? { hardenedRuntime: true, gatekeeperAssess: false, notarize: true }
      : { hardenedRuntime: false, gatekeeperAssess: false, identity: null }),
    extendInfo: {
      LSUIElement: true, // menu bar agent: no Dock icon
      NSMicrophoneUsageDescription: 'Jager listens for its name and for what you ask it, and transcribes on this Mac.',
      NSAppleEventsUsageDescription: 'Jager controls other apps when you ask it to.',
    },
  },
  dmg: {
    artifactName: 'Jager-${arch}.${ext}',
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },
  publish: null,
};

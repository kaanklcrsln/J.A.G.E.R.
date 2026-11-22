# J.A.G.E.R.

Just A Guy Executing Requests. Or Jager. Pronounced "JAY-ger", like the
German word for hunter, and absolutely not like the drink, although I won't
stop you.

It's a voice assistant that lives in the notch of my MacBook. I say "Jager,
do the thing" and it does the thing. Then it tells me about it in a calm voice,
like a butler who has seen things.

Yes, I watched Iron Man too many times. No, I don't have a suit. Yet.

```
me:     "Jager, how much battery do I have left?"
jager:  *drops out of the notch*
        "49 percent, about two hours forty. Plug in before the meeting."
me:     "Appreciated, Jager."
jager:  *goes back into the notch like nothing happened*
```

## What it actually does

1. Sits in the notch, pretending to be part of the hardware.
2. Listens for its name. Speech to text runs locally with whisper.cpp, so
   your mumbling never leaves the laptop.
3. Hands your request to [Claude Code](https://claude.com/claude-code), which
   has a shell, AppleScript and no fear.
4. Shows what it's doing in a little glass panel that slides out of the notch.
5. Reads the answer out loud with the macOS `say` voice.
6. Keeps listening for 6 seconds in case you have a follow-up, then goes back
   to sleep.

## Read this before you install it

Jager runs Claude Code with `--dangerously-skip-permissions`. The flag name
is not a joke. It can run any command, edit or delete any file and drive any
app on your Mac without asking you first. If it mishears "clean up my
desktop" as something worse, it will do the worse thing.

I use it on my own machine and I'm fine with that. Decide for yourself. If
the always-on wake word makes you nervous, turn it off from the menu bar and
use the hotkey only.

## Install

You need three things first:

- A Mac. Apple Silicon or Intel, both builds are on the releases page.
- Claude Code, installed and logged in. Run `claude` once in a terminal and
  sign in.
- whisper.cpp for the ears: `brew install whisper-cpp`

Then:

1. Grab `Jager-arm64.dmg` (M1 and newer) or `Jager-x64.dmg` (Intel) from
   [Releases](https://github.com/kaanklcrsln/J.A.G.E.R./releases).
2. Drag Jager into Applications.
3. Open it. macOS will say it can't verify the developer, because I didn't
   pay Apple $99 for the privilege. Go to System Settings, Privacy & Security,
   scroll down and press "Open Anyway". You only do this once.
4. Allow the microphone when it asks.

On first launch it downloads the speech model (about 57 MB) and then it's
ready. There's no Dock icon. Look for "Jager" in the menu bar, that's where
Quit lives.

## Talking to it

| You | Jager |
|---|---|
| "Jager, open Spotify and play something chill" | Does it |
| `⌥Space` | Listens without the name, for when people are watching |
| `⌥Space` again | "Ok I'm done talking" |
| "Jager, stop" or `⌥Esc` | Drops whatever it's doing |
| "Appreciated, Jager" | Stops listening, forgets the conversation, goes home |
| "New conversation" | Fresh context, same butler |

It remembers the conversation between requests (for 20 minutes of silence),
so "and is it charging?" after a battery question works.

The wake word matching is fuzzy on purpose. Whisper has never heard of a
Jager and writes it as "J. Jair", "Jai Jai", "J.J.R." and once, memorably,
"J.G.E.R.". Jager answers to all of them. It does not answer to "Jake",
"Just" or "Jay, call mom". If it ignores you, run it with `JAGER_DEBUG=1` and
look at what it thought you said. It's humbling.

## Knobs

Environment variables, if you run it from a terminal:

| Variable | Default | What |
|---|---|---|
| `JAGER_MODEL` | `sonnet` | Model alias passed to `claude --model` |
| `JAGER_VOICE` | `Yelda` | Any voice from `say -v '?'` |
| `JAGER_VOICE_RATE` | `195` | Words per minute |
| `JAGER_HOTKEY` | `Alt+Space` | Talk key |
| `JAGER_CANCEL_HOTKEY` | `Alt+Escape` | Panic key |
| `JAGER_CLAUDE_PATH` | auto | If it can't find `claude` |
| `JAGER_WHISPER_DIR` | Homebrew | Folder with `whisper-cli` |
| `JAGER_DEBUG` | off | Logs what the wake word listener heard |

It listens in English and answers in Turkish with the Yelda voice, because
that's how my brain works. Change the reply language in `src/claude.js` and
the voice with `JAGER_VOICE` if yours works differently.

## Building it yourself

```
npm install
npm start          # run from source
npm test           # wake word, stream parsing, voice detection
npm run dist       # dmgs land in dist/
```

The code is small. `src/main.js` is the state machine (idle, listening,
thinking, speaking), `src/claude.js` talks to Claude Code, `src/stt.js` and
`src/tts.js` are the ears and the mouth, `src/wake.js` decides whether you
said its name, and `renderer/` is the island.

## Known issues

- The glass doesn't blur what's behind it. Electron can't put the native blur
  on a rounded shape, so it's a very convincing dark tint. Squint.
- If you start talking while it's still talking, it doesn't hear you. Hit
  `⌥Space` to cut it off.
- The first transcription after install takes around 15 seconds while macOS
  compiles the GPU shaders. After that it's under half a second.

## License

MIT. Do whatever you want, just don't blame me when it empties your
Downloads folder because you said "download" with a weird accent.

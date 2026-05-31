# HeySure Agent — Linux Desktop Edition

An Electron desktop agent that connects to the HeySure server over Socket.IO,
registers itself as a **desktop** endpoint, and exposes a catalog of MCP tools
the AI can call to observe and control this Linux machine.

This is the Linux counterpart to `agent/windows`. It shares the same architecture
(socket runtime, tool registry, executor, IPC, renderer) and re-implements the
platform-specific tools against native Linux utilities instead of PowerShell.

## Tools

| Group | Tools | Implementation |
| --- | --- | --- |
| Filesystem | `fs.list` `fs.read` `fs.write` | Node `fs` (cross-platform) |
| Shell / Git | `shell.run` `git.diff` | `child_process` via `/bin/bash` |
| Keyboard | `keyboard.type` `keyboard.press` | robotjs (X11) |
| Mouse | `mouse.move` `mouse.click` `mouse.double_click` `mouse.right_click` `mouse.scroll` `mouse.drag` | robotjs (X11) |
| Screen / Vision | `screen.capture` `screen.capture_region` `screen.info` `vision.capture` `vision.capture_mouse` | Electron `desktopCapturer` + robotjs |
| Display overlay | `display.box` `display.clear` | Electron transparent `BrowserWindow` |
| Clipboard | `clipboard.get` `clipboard.set` | Electron `clipboard` |
| Windows | `window.list` `window.focus` `window.close` | `wmctrl`, falls back to `xdotool` |
| Processes | `process.list` `process.kill` | `ps`, `kill` / `pkill` |
| Speech (TTS) | `speech.speak` | `spd-say` → `espeak-ng` → `espeak` |
| Input monitor | `hands.start` `hands.stop` `hands.snapshot` `hands.events` `hands.mouse` | robotjs cursor + `xdotool` active window polling |
| Speech (STT) | `ear.start` `ear.stop` `ear.latest` | External recognizer via `HS_STT_CMD` |

## System requirements

- An **X11** session is recommended. robotjs and `xdotool` target X11; under
  Wayland, key/mouse injection and window control are limited (run the session
  in Xwayland/X11 for full functionality).
- Optional CLI helpers (the tools degrade gracefully and report a clear hint
  when one is missing):

  ```bash
  sudo apt install wmctrl xdotool speech-dispatcher espeak-ng
  ```

- Building the native `robotjs` module needs X11 dev headers:

  ```bash
  sudo apt install build-essential libxtst-dev libpng++-dev
  ```

- Speech-to-text (`ear.*`) has no built-in engine on Linux. Point `HS_STT_CMD`
  at any program that listens on the mic and prints one JSON object per line,
  e.g. `{"type":"recognized","text":"hello","confidence":0.9}`.

## Run (development)

```bash
cp .env.example .env   # edit SERVER_URL etc. as needed
./run.sh               # installs deps, rebuilds robotjs, starts the app
```

Or manually:

```bash
npm install
npm run rebuild        # rebuild robotjs against Electron's ABI
npm run dev
```

## Package

```bash
npm run package        # builds an AppImage + .deb into release/
```

## How it registers

On login + AI assignment the agent emits `agent:register` with
`platform: "linux-desktop (<hostname>)"` and `isLinuxDesktop: true`. The server
classifies any agent whose platform string contains `desktop`/`windows` (or
whose `isWindowsDesktop`/`isLinuxDesktop` flag is set) as a **desktop** endpoint,
so the reported `capabilities` and `toolDefs` surface through
`mcp.list_tools` / `mcp.describe_tool` for the bound AI.

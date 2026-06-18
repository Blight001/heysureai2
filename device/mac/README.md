# HeySure Agent - Mac Desktop Edition

An Electron desktop agent that connects to the HeySure server over Socket.IO,
registers itself as a desktop endpoint, and exposes the same desktop-agent
feature surface as `device/windows`.

This shell uses the shared desktop implementation from `device/shared/src`.
The build step runs `scripts/sync-shared.js`, copying shared modules into
`src/` before TypeScript compiles. Edit shared logic in `device/shared/src`,
not in the generated copies under this directory.

## Tools

| Group | Tools | Implementation |
| --- | --- | --- |
| Shell | `shell.run` | shared runtime shell runner |
| Keyboard | `keyboard.type` `keyboard.press` | robotjs |
| Mouse | `mouse.move` `mouse.click` `mouse.double_click` `mouse.right_click` `mouse.scroll` `mouse.drag` | robotjs |
| Clipboard | `clipboard.get` `clipboard.set` | Electron `clipboard` |
| Windows | `window.list` `window.focus` `window.close` | server-provided runtime tools / native bridge where available |
| Speech | `speech.speak` | server-provided runtime tools / native bridge where available |
| Screen / Vision | `vision.capture` `vision.capture_mouse` | Electron `desktopCapturer` + robotjs coordinates |
| Input monitor | `hands.start` `hands.stop` `hands.snapshot` `hands.events` `hands.mouse` | shared desktop bridge |
| Offline chat | local chat window and configured model settings | same UI/IPC flow as Windows |

## System Requirements

- macOS with Node.js and npm installed.
- Xcode Command Line Tools for native module compilation:

  ```bash
  xcode-select --install
  ```

- macOS may require granting the app or Terminal these permissions for full
  desktop control:
  - Accessibility
  - Screen Recording

## Run

```bash
cp .env.example .env
bash ./run.sh
```

Or manually:

```bash
npm install
npm run rebuild
npm run dev
```

## Package

```bash
npm run package
```

Or use the helper script:

```bash
bash ./build.sh
```

The packaged app is written to `release/`.

## How It Registers

On login, the agent emits `device:register` with
`platform: "mac-desktop (<hostname>)"` and `isMacDesktop: true`. The platform
string includes `desktop`, so existing server-side desktop routing continues to
treat it as a desktop endpoint.

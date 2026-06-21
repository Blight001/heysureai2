const STYLE_ID = 'gw-drawer-styles'

const DRAWER_CSS = `
  .gw-panel {
    position: fixed; left: 0; right: 0; bottom: 0; height: 300px; max-height: 52vh; z-index: 200;
    background: rgba(28, 30, 38, 0.97); border-top: 2px solid #4a4f5e;
    color: #d6dae2; font: 12px/1.7 ui-monospace, "Cascadia Mono", Consolas, monospace;
    display: none; flex-direction: row; pointer-events: auto;
  }
  .gw-panel.open { display: flex; }
  .gw-panel .gp-portrait {
    flex: none; width: 210px; padding: 12px 12px; border-right: 1px solid #3a3f4c;
    display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px;
    overflow-y: auto;
  }
  .gw-panel .gp-port-frame {
    width: 84px; height: 84px; flex: none; border: 2px solid #4a4f5e; border-radius: 6px;
    background: #20232b; display: flex; align-items: center; justify-content: center; overflow: hidden;
  }
  .gw-panel .gp-port-frame canvas { image-rendering: pixelated; }
  .gw-panel .gp-port-name { color: #f0c060; font-weight: bold; font-size: 13px; word-break: break-all; }
  .gw-panel .gp-port-sub { color: #9fc6ff; font-size: 11px; }
  .gw-panel .gp-port-info { width: 100%; margin-top: 2px; text-align: left; }
  .gw-panel .gp-port-info .d-row { gap: 6px; font-size: 11px; line-height: 1.45; }
  .gw-panel .gp-port-info .d-row .k { min-width: 32px; }
  .gw-panel .gp-port-info .d-bar { margin: 4px 0 6px; }
  .gw-panel .gp-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .gw-panel .gp-tabbar {
    display: flex; align-items: center; gap: 4px; padding: 8px 10px 0; border-bottom: 1px solid #3a3f4c;
  }
  .gw-panel .gp-tabs { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; min-width: 0; }
  .gw-panel button.gp-tab {
    cursor: pointer; border: 1px solid #4a4f5e; border-bottom: none; border-radius: 5px 5px 0 0;
    background: #2b2f3a; color: #9aa0b0; padding: 4px 12px; font: inherit;
  }
  .gw-panel button.gp-tab:hover { color: #d6dae2; }
  .gw-panel button.gp-tab.active { background: #343949; color: #f0c060; }
  .gw-panel .gp-close {
    cursor: pointer; border: 1px solid #4a4f5e; border-radius: 3px;
    background: none; color: #8a90a0; font: inherit; padding: 1px 8px; flex: none;
  }
  .gw-panel .gp-close:hover { color: #d6dae2; }
  .gw-panel .gp-body { padding: 12px 16px; overflow-y: auto; flex: 1; }
  .gw-panel .d-sec { margin-bottom: 14px; }
  .gw-panel .d-sec-title { color: #9fc6ff; margin-bottom: 4px; }
  .gw-panel .d-row { display: flex; gap: 8px; }
  .gw-panel .d-row .k { color: #8a90a0; flex: none; min-width: 36px; }
  .gw-panel .d-row .v { word-break: break-all; }
  .gw-panel .d-bar { height: 6px; background: #3a3f4c; border-radius: 3px; margin: 4px 0; overflow: hidden; }
  .gw-panel .d-bar > div { height: 100%; }
  .gw-panel button.d-btn {
    cursor: pointer; border: 1px solid #4a4f5e; border-radius: 3px;
    background: #343949; color: #d6dae2; font: inherit; padding: 3px 10px; margin: 2px 4px 2px 0;
  }
  .gw-panel button.d-btn:hover { background: #3f4558; }
  .gw-panel button.d-btn:disabled { opacity: 0.5; cursor: default; }
  .gw-panel button.d-btn.warn { border-color: #7a4a4a; color: #e0a0a0; }
  .gw-panel button.d-btn.ok { border-color: #4a7a55; color: #9fdcae; }
  .gw-panel select.d-sel, .gw-panel input.d-in, .gw-panel textarea.d-ta {
    width: 100%; box-sizing: border-box; background: #23262e; color: #d6dae2;
    border: 1px solid #4a4f5e; border-radius: 3px; font: inherit; padding: 3px 6px; margin: 2px 0;
  }
  .gw-panel textarea.d-ta { min-height: 60px; resize: vertical; }
  .gw-panel .d-err { color: #e08484; }
  .gw-panel .d-okmsg { color: #84d99a; }
  .gw-panel .d-item {
    border: 1px solid #3a3f4c; border-radius: 4px; padding: 6px 8px; margin-bottom: 6px;
  }
  .gw-panel .d-item.click { cursor: pointer; }
  .gw-panel .d-item.click:hover { border-color: #5a6175; }
  .gw-panel .d-dim { color: #8a90a0; }
  .gw-panel .d-pre {
    white-space: pre-wrap; word-break: break-word; max-height: 120px; overflow: auto;
    background: #20232b; border: 1px solid #343949; border-radius: 4px;
    padding: 6px 8px; margin-top: 4px; color: #cdd3dd;
  }
  .gw-panel label.d-check {
    display: flex; align-items: flex-start; gap: 6px; cursor: pointer;
    border: 1px solid #343949; border-radius: 4px; padding: 4px 6px; margin: 4px 0;
  }
  .gw-panel label.d-check:hover { border-color: #5a6175; }
  .gw-panel label.d-check input { margin-top: 3px; accent-color: #f0c060; }
  .gw-panel .d-sub { color: #8a90a0; margin: 6px 0 2px; }
  .gw-panel .d-swatches { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .gw-panel button.d-swatch {
    cursor: pointer; width: 22px; height: 22px; padding: 0;
    border: 2px solid #4a4f5e; border-radius: 4px;
  }
  .gw-panel button.d-swatch.sel { border-color: #f0c060; }
  .gw-panel button.d-swatch.none {
    background: #23262e; color: #8a90a0; font: 10px/1 inherit; width: auto; padding: 0 6px; height: 22px;
  }
  .gw-panel input.d-color {
    width: 28px; height: 22px; padding: 0; border: 2px solid #4a4f5e; border-radius: 4px;
    background: #23262e; cursor: pointer;
  }
  .gw-panel input.d-color.sel { border-color: #f0c060; }
  .gw-panel input.d-range { width: 100%; accent-color: #f0c060; }
  .gw-panel .gp-cols { column-width: 280px; column-gap: 18px; }
  .gw-panel .gp-cols > .d-item { break-inside: avoid; }
`

export const installDrawerStyles = () => {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = DRAWER_CSS
  document.head.appendChild(style)
}

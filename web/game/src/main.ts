/**
 * 游戏世界启动入口。
 *
 * 默认启动 Phaser 世界场景（P0 观察者）；`?preview=1` 进入资产预览页（调试工具）。
 * 同源 iframe 方案：直接复用主控制台的 localStorage token 与 /api、/socket.io。
 */

const boot = async () => {
  const params = new URLSearchParams(window.location.search)
  if (params.get('preview') === '1') {
    document.body.classList.add('preview-mode')
    await import('./preview')
    return
  }

  document.body.classList.add('world-mode')
  const [{ default: Phaser }, { WorldScene }, { WorldStore }, { Overlay }] = await Promise.all([
    import('phaser'),
    import('./scenes/WorldScene'),
    import('./world/store'),
    import('./ui/overlay'),
  ])

  const store = new WorldStore()
  const overlay = new Overlay(document.body)
  // 调试/测试句柄：控制台可注入世界事件（store.dispatchEvent({...})）
  ;(window as unknown as Record<string, unknown>).__worldStore = store

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'app',
    backgroundColor: '#3c5a40',
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: window.innerWidth,
      height: window.innerHeight,
    },
    scene: [],
  })
  game.scene.add('world', WorldScene, true, { store, overlay })

  // iframe 不可见时暂停渲染循环，避免后台烧 CPU
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.loop.sleep()
    else game.loop.wake()
  })

  document.getElementById('loading')?.remove()
}

void boot()

const assetUrls = import.meta.glob('../assets/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export const sfxUrls = import.meta.glob('../assets/sfx/*.wav', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const bgmUrls = import.meta.glob('../assets/bgm/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export interface BgmTrack {
  key: string
  url: string
  name: string
}

export const bgmTracks: BgmTrack[] = Object.entries(bgmUrls)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, url], index) => ({
    key: `bgm_${index}`,
    url,
    name: path.split('/').pop() ?? `bgm_${index}`,
  }))

export const urlForAsset = (file: string): string => {
  const url = assetUrls[`../assets/${file}`]
  if (!url) throw new Error(`资产缺失: ${file}`)
  return url
}

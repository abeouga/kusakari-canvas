export function AssetPreview({ assetId }) {
    if (assetId === 'tree_oak') {
        return <img className="asset-preview preview-tree_oak" src={canvasUrl('/icons/tree-oak.webp')} alt="" aria-hidden="true" width="160" height="160" loading="lazy"/>;
    }
    return <svg className={`asset-preview preview-${assetId}`} viewBox="0 0 80 70" aria-hidden="true">
    <ellipse cx="40" cy="59" rx="25" ry="5" fill="#1f352814"/>
    {assetId === 'shrub_boxwood' ? <>
      <path d="m40 21 24 11 5 19-28 12-28-13 4-20Z" fill="#8c9d6b"/>
      <path d="m40 21 1 23 23-12 5 19-28 12Z" fill="#6f8658"/>
      <path d="m17 30 24 14-28 6Z" fill="#a6b487"/>
    </> : assetId === 'brick_paver' ? <>
      <path d="m12 39 33-16 24 13-32 17Z" fill="#bd9680"/>
      <path d="m12 39 25 14v8L12 47Z" fill="#a77963"/><path d="m37 53 32-17v8L37 61Z" fill="#93694f"/>
    </> : <>
      <path d="M19 41v14m39-21v15M34 48v13m28-23v15" stroke="#66594d" strokeWidth="4"/>
      <path d="m15 40 29-15 24 12-31 15Z" fill="#b89974"/>
      <path d="m15 25 29-15v13L15 38Z" fill="#ae8c66"/><path d="m15 25 3 2v14l-3-2Z" fill="#866749"/>
      <path d="m23 36 23-12m-14 16 22-11" stroke="#8b6e4e" strokeWidth="1"/>
    </>}
  </svg>;
}
import { canvasUrl } from '../domain/urls';

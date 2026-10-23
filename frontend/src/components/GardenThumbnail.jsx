import { useState } from 'react';
import { canvasUrl } from '../domain/urls';
import { UiIcon } from './UiIcon';

// 保存済みの庭サムネイル（生成画像・3D撮影・配置図のいずれか）を表示し、取得できなければアイコンに戻す。
export function GardenThumbnail({ garden }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="garden-thumb" aria-hidden="true"><UiIcon name="polygon" size={30}/></span>;
  return <span className="garden-thumb garden-thumb-image">
    <img src={canvasUrl(`/api/gardens/${encodeURIComponent(garden.id)}/thumbnail`)}
      alt={`${garden.name}のサムネイル`} loading="lazy" decoding="async" onError={() => setFailed(true)}/>
  </span>;
}

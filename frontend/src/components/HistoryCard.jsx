import { useState } from 'react';
import { imageHistoryApi } from '../api/imageHistory';
import { UiIcon } from './UiIcon';

export function HistoryCard({ gardenId, item, disabled, onSelect, onDelete }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const date = new Date(item.createdAt).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  return <li className="history-card" data-testid={`history-item-${item.id}`}>
    <button type="button" className="history-card-open" aria-label="比較する" title={`${date}の生成結果を比較`}
      disabled={disabled} onClick={onSelect}>
      <span className="history-card-image">
        {failed ? <span className="history-thumbnail-missing"><UiIcon name="photo" size={28}/><span>画像を読み込めません</span></span>
          : <img src={`${imageHistoryApi.thumbnailUrl(gardenId, item.id)}${attempt ? `?retry=${attempt}` : ''}`}
            alt="生成結果のサムネイル" loading="lazy" decoding="async" onError={() => setFailed(true)}/>}
        <span className="history-card-overlay">比較する<UiIcon name="arrow" size={16}/></span>
      </span>
      <time dateTime={item.createdAt}>{date}</time>
    </button>
    <button type="button" className="history-card-delete" aria-label="この履歴を削除" title="この履歴を削除"
      disabled={disabled} onClick={onDelete}><UiIcon name="trash" size={15}/></button>
    {failed && <button type="button" className="history-thumbnail-retry" onClick={() => { setAttempt(attempt + 1); setFailed(false); }}>サムネイルを再取得</button>}
  </li>;
}

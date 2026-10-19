import { requiredReferencePhotoMessage } from '../domain/aiReferencePhoto';

export function AiPlantReference({ plant, product, photo, disabled, onUpload, onRemovePhoto }) {
  return <fieldset className="ai-reference" disabled={disabled} data-testid={`ai-reference-${plant.productId}`}>
    <legend>{plant.name}の参考写真</legend>
    {product && <>
      {product.requiresUpload && <p className="notice-error">{requiredReferencePhotoMessage(product)}</p>}
      <label>
        写真を選択
        <input key={plant.productId} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload(file);
          event.target.value = '';
        }}/>
      </label>
      {photo && <div>
        <img className="ai-reference-image" src={photo.dataUrl} alt={`${plant.name}の選択した参考写真`}/>
        <p>{photo.name}（{photo.width} × {photo.height} px）を使用します。</p>
        <button type="button" onClick={onRemovePhoto}>追加した参考写真を取り消す</button>
      </div>}
    </>}
  </fieldset>;
}

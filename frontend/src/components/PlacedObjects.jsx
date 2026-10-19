import { UiIcon } from './UiIcon';
import { assetForObject } from '../domain/productModels';
export function PlacedObjects({ document, assets, selectedObject, disabled, onSelectObject }) {
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    return (      <section className="placed-section">
        <div className="panel-heading panel-heading-row">
          <div>
            <h3>配置したもの</h3>
          </div>
          <span className="count-tag">{document.objects.length} / 200</span>
        </div>
        {document.objects.length === 0 ? (<div className="inspector-empty"><UiIcon name="leaf" size={30}/><strong>最初の商品を置く</strong><p>商品を庭へドラッグするか、<br />「庭に配置」を選んで地面をクリックします。</p></div>) : (<ul className="placed-list">
            {document.objects.map((object, index) => {
                const asset = assetForObject(object, assetMap);
                return (<li key={object.id}>
                  <button type="button" className={`placed-row${selectedObject?.id === object.id ? ' is-active' : ''}`} aria-pressed={selectedObject?.id === object.id} disabled={disabled} data-testid={`object-row-${index}`} data-object-id={object.id} onClick={() => onSelectObject(object.id)}>
                    <span className="placed-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="placed-copy">
                      <strong>{asset?.name ?? '不明なアセット'}</strong>
                      <small>X {object.position.x.toFixed(1)} · Z {object.position.z.toFixed(1)}</small>
                    </span>
                  </button>
                </li>);
            })}
          </ul>)}
      </section>);
}

import { useState } from 'react';
import { productImage, yen } from '../api/commerce';
import { ecUrl } from '../domain/shopping';
import { PlacedObjects } from './PlacedObjects';
import { ProductBrowser } from './ProductBrowser';
import { SidebarResize } from './SidebarResize';
import { placedProductAsset, productAsset, startProductDrag } from '../domain/productModels';
import { useEditorStore } from '../stores/editorStore';

export function CommercePanel({ document, assets, selectedObject, disabled, commerce, onSelectObject, onNavigate, width, onWidthChange }) {
  const [tab, setTab] = useState('products');
  const isDirty = useEditorStore((state) => state.isDirty);
  const isSaving = useEditorStore((state) => state.isSaving);
  const saveError = useEditorStore((state) => state.saveError);
  const count = commerce.rows.reduce((total, row) => total + row.quantity, 0);
  let status = 'ECへの反映済み';
  if (isDirty) status = 'ECへ未反映';
  if (isSaving) status = 'ECへ反映中…';
  if (saveError) status = 'ECへ未反映：保存を再試行してください。';
  function tabKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let next = tab === 'products' ? 'list' : 'products';
    if (event.key === 'Home') next = 'products';
    if (event.key === 'End') next = 'list';
    setTab(next);
    event.currentTarget.querySelector('#commerce-tab-' + next).focus();
  }
  return <aside id="properties-panel" className="properties-panel commerce-panel" aria-label="商品一覧と庭の買い物リスト"
    onKeyDown={(event) => event.stopPropagation()}>
    <SidebarResize width={width} onChange={onWidthChange}/>
    <div className="commerce-tabs" role="tablist" aria-label="商品一覧と買い物リストの切替" onKeyDown={tabKey}>
      <button id="commerce-tab-products" type="button" role="tab" aria-selected={tab === 'products'} aria-controls="commerce-products" tabIndex={tab === 'products' ? 0 : -1} onClick={() => setTab('products')}>商品一覧</button>
      <button id="commerce-tab-list" type="button" role="tab" aria-selected={tab === 'list'} aria-controls="commerce-list" tabIndex={tab === 'list' ? 0 : -1} onClick={() => setTab('list')}>買い物リスト（{count}）</button>
    </div>
    <div className="commerce-scroll">
      <section id="commerce-products" role="tabpanel" aria-labelledby="commerce-tab-products" hidden={tab !== 'products'}>
        <ProductBrowser assets={assets} commerce={commerce} disabled={disabled}/>
        <PlacedObjects document={document} assets={assets} selectedObject={selectedObject} disabled={disabled} onSelectObject={onSelectObject}/>
      </section>
      <section id="commerce-list" role="tabpanel" aria-labelledby="commerce-tab-list" hidden={tab !== 'list'}>
        <h3>{document.name}の買い物リスト</h3>
        <p className="form-hint">配置した商品とECで追加した商品の必要数です。ECで追加した商品は、配置しても1点のまま数えます。</p>
        <p role="status" data-testid="shopping-sync-status">{status}</p>
        {commerce.saved.isError && <div className="notice notice-error" role="alert">
          <p>ECで追加した商品を取得できません。{commerce.saved.error.message}</p>
          <button type="button" className="button button-secondary" disabled={commerce.saved.isFetching} onClick={() => commerce.saved.refetch()}>ECで追加した商品を再取得</button>
        </div>}
        {commerce.rows.length === 0 && <p>庭に商品を配置するか、ECで買い物リストに追加すると、このリストに表示されます。</p>}
        {commerce.rows.map((row) => {
          const object = document.objects.find((o) => row.productId ? o.productId === row.productId : !o.productId && o.assetId === row.assetId);
          const product = commerce.products.data?.find((p) => p.id === row.productId);
          let asset = null;
          if (object) asset = placedProductAsset(object, assets);
          else if (product) asset = productAsset(product, assets);
          return <article key={row.key} className="commerce-product" data-testid={'shopping-line-' + row.assetId}
            draggable={!!asset && !disabled} onDragStart={(event) => startProductDrag(event, asset)}>
            {product && <img src={productImage(product.imageUrl)} alt="" draggable={false}/>}
            <div><strong>{product?.name ?? row.name}</strong><p data-testid="needed-quantity">必要数 {row.quantity}点</p>
              {row.unplaced && <p data-testid="unplaced-ec-item">ECで追加（庭に未配置）</p>}
              {row.productId && commerce.products.isSuccess && !product && <p role="status">この店舗の販売対象ではないため購入できません。保存済みの配置は維持されます。</p>}
              {product && <p>商品小計の目安 {yen(product.priceYen * row.quantity)}</p>}
              <button type="button" disabled={disabled || !asset} onClick={() => useEditorStore.getState().selectAsset(asset.id)}>庭に配置</button>
            </div>
          </article>;
        })}
        <p className="form-hint">購入する商品はECで選択します。価格・在庫はECで確認してください。</p>
        <button className="button button-primary" type="button" disabled={disabled}
          onClick={() => onNavigate(new URL('/cart/gardens/' + document.id, ecUrl).href)}>ECで買い物リストを確認</button>
        <button className="button button-secondary" type="button" disabled={disabled}
          onClick={() => onNavigate(new URL('/cart', ecUrl).href)}>ECカートを見る</button>
      </section>
    </div>
  </aside>;
}

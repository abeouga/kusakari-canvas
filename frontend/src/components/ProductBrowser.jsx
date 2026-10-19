import { useState } from 'react';
import { productImage, yen } from '../api/commerce';
import { productAsset, startProductDrag } from '../domain/productModels';
import { useEditorStore } from '../stores/editorStore';

export function ProductBrowser({ assets, commerce, disabled }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const selected = useEditorStore((state) => state.selectedAssetId);
  const query = commerce.products;
  const products = query.data ?? [];
  const categories = [...new Set(products.map((product) => product.category))];
  return <section className="product-browser" aria-label="ECの商品一覧">
    <p className="form-hint">商品を庭へドラッグして配置できます。</p>
    <label>商品を検索<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="商品名・学名"/></label>
    <label>商品カテゴリ<select value={category} onChange={(event) => setCategory(event.target.value)}>
      <option value="">すべて</option>{categories.map((name) => <option key={name}>{name}</option>)}</select></label>
    {query.isPending && <p role="status">商品を読み込んでいます…</p>}
    {query.isError && <p role="alert">{query.error.message}<button onClick={() => query.refetch()}>商品を再取得</button></p>}
    {!query.isPending && !query.isError && products.length === 0 && <p>商品はありません。</p>}
    {products.filter((product) => (!category || product.category === category)
      && `${product.name} ${product.latinName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((product) => {
      const asset = productAsset(product, assets);
      const canPlace = !!asset && !disabled;
      return <article className={`browse-product${asset && selected === asset.id ? ' is-selected' : ''}`} key={product.id}
        data-testid={`browse-${product.id}`} draggable={canPlace} onDragStart={(event) => startProductDrag(event, asset)}>
        <img src={productImage(product.imageUrl)} alt="" loading="lazy" draggable={false}/>
        <div><strong>{product.name}</strong><small>{product.category}</small><p>{yen(product.priceYen)}</p>
          <small>{asset ? '庭に配置できます' : '3Dモデル未設定'}</small>
          <div className="browse-actions"><button type="button" disabled={!canPlace} aria-pressed={!!asset && selected === asset.id} data-testid={asset ? `asset-${asset.id}` : undefined}
            onClick={() => useEditorStore.getState().selectAsset(asset.id)}>庭に配置</button>
          </div>
        </div>
      </article>;
    })}
  </section>;
}

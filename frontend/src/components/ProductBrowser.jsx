import { useState } from 'react';
import { productImage, yen } from '../api/commerce';
import { productAsset, startProductDrag } from '../domain/productModels';
import { useEditorStore } from '../stores/editorStore';
import { InfoTip } from './InfoTip';
import { showDragPreview } from './ProductDragPreview';
import { UiIcon } from './UiIcon';

export function ProductBrowser({ assets, commerce, disabled }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const selected = useEditorStore((state) => state.selectedAssetId);
  const query = commerce.products;
  const cart = commerce.cart;
  const failedQuery = cart.isError ? cart : query.isError ? query : null;
  const products = query.data ?? [];
  const categories = [...new Set(products.map((product) => product.category))];
  return <section className="product-browser" aria-label="ECの商品一覧">
    <div className="browse-toolbar">
      <label className="browse-search"><UiIcon name="search" size={16}/>
        <input type="search" aria-label="商品を検索" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="商品名・学名"/>
      </label>
      <InfoTip label="商品一覧の使い方">商品を庭へドラッグして配置できます。</InfoTip>
    </div>
    <div className="category-chips" role="group" aria-label="商品カテゴリ">
      {['', ...categories].map((name) => <button key={name || 'all'} type="button" aria-pressed={category === name}
        onClick={() => setCategory(name)}>{name || 'すべて'}</button>)}
    </div>
    {!failedQuery && (cart.isPending || query.isPending) && <p role="status">商品を読み込んでいます…</p>}
    {failedQuery && <p role="alert">{failedQuery.error.message}<button type="button" onClick={() => failedQuery.refetch()}>商品を再取得</button></p>}
    {!failedQuery && !query.isPending && products.length === 0 && <p>商品はありません。</p>}
    {products.filter((product) => (!category || product.category === category)
      && `${product.name} ${product.latinName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((product) => {
      const asset = productAsset(product, assets);
      const canPlace = !!asset && !disabled;
      return <article className={`browse-product${asset && selected === asset.id ? ' is-selected' : ''}`} key={product.id}
        data-testid={`browse-${product.id}`} draggable={canPlace} onDragStart={(event) => {
          startProductDrag(event, asset);
          if (asset) showDragPreview(event, { name: product.name, imageUrl: productImage(product.imageUrl) });
        }}>
        <img src={productImage(product.imageUrl)} alt="" loading="lazy" draggable={false}/>
        <div><strong>{product.name}</strong><small>{product.category}</small>
          <p className="browse-price">{yen(product.priceYen)}</p>
          {!asset && <small>3Dモデル未設定</small>}
        </div>
      </article>;
    })}
  </section>;
}

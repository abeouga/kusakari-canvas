import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { aiImageApi } from '../api/aiImages';
import { imageHistoryApi } from '../api/imageHistory';
import { plantReferenceRows, readAiReferencePhoto, requiredReferencePhotoMessage } from '../domain/aiReferencePhoto';
import { AiPlantReference } from './AiPlantReference';
import { BeforeAfterComparison } from './BeforeAfterComparison';
import { GenerationMethodDetails } from './GenerationMethodDetails';
import { Dialog } from './Dialog';
import { UiIcon } from './UiIcon';
import '../ai-image.css';

export function AiImageGeneration({ image, onBusyChange, onUnsavedChange }) {
  const queryClient = useQueryClient();
  const storeId = image.storeId ?? 1;
  const [plants] = useState(() => plantReferenceRows(image.document, image.assets));
  const [photos, setPhotos] = useState({});
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const locked = useRef(false);
  const status = useQuery({ queryKey: ['ai-status'], queryFn: aiImageApi.status, retry: false });
  const unlinked = plants.filter((plant) => !plant.productId);
  const productIds = plants.filter((plant) => plant.productId).map((plant) => plant.productId);
  const candidates = useQuery({
    queryKey: ['ai-product-references', productIds],
    queryFn: () => aiImageApi.productReferences(productIds),
    enabled: productIds.length > 0,
    retry: false,
  });
  const inputImageCount = 1 + plants.length;
  const busy = pending || uploading || saving;
  const unsaved = result !== null && result.historySaved !== true;
  const formDisabled = busy || unsaved;

  useEffect(() => {
    if (!unsaved) return;
    function confirmUnload(event) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', confirmUnload);
    return () => window.removeEventListener('beforeunload', confirmUnload);
  }, [unsaved]);

  function removePhoto(productId) {
    if (locked.current || unsaved) return;
    setPhotos((current) => ({ ...current, [productId]: null }));
    setResult(null);
    setError('');
  }

  async function uploadPhoto(productId, file) {
    if (locked.current || unsaved) return;
    locked.current = true;
    setUploading(true);
    onBusyChange(true);
    setError('');
    try {
      const photo = await readAiReferencePhoto(file);
      setPhotos((current) => ({ ...current, [productId]: photo }));
      setResult(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '参考写真を読み込めませんでした。');
    } finally {
      locked.current = false;
      setUploading(false);
      onBusyChange(false);
    }
  }

  function generationRequest() {
    if (plants.length === 0) throw new Error('商品一覧から植物を配置してから撮影してください。');
    if (unlinked.length) throw new Error('商品に紐づいていない旧モデルがあります。商品一覧から配置し直してください。');
    if (inputImageCount > 16) throw new Error('入力画像が16枚を超えています。配置を見直して撮影し直してください。画像は自動省略しません。');
    if (!image.coverageDataUrl) throw new Error('配置範囲の画像がありません。完成イメージを撮影し直してください。');
    if (!candidates.data || candidates.isError) throw new Error('配置商品の自動取得に失敗しています。接続状態を確認して再取得してください。');
    const references = [];
    for (const plant of plants) {
      const photo = photos[plant.productId];
      const product = candidates.data.find((item) => item.productId === plant.productId);
      if (!product) throw new Error(`${plant.name}に紐づく商品の登録情報を取得できません。`);
      if (product.requiresUpload && !photo) {
        throw new Error(`${plant.name}：${requiredReferencePhotoMessage(product)}`);
      }
      const reference = { assetId: plant.assetId, productId: product.productId };
      if (photo) reference.photoDataUrl = photo.dataUrl;
      references.push(reference);
    }
    const request = {
      generationId: crypto.randomUUID(),
      document: structuredClone(image.document),
      beforeDataUrl: image.dataUrl,
      coverageDataUrl: image.coverageDataUrl,
      layout: image.layout,
      storeId,
      references,
    };
    if (new Blob([JSON.stringify(request)]).size > 48_000_000) {
      throw new Error('送信画像の合計容量が48,000,000バイトを超えています。写真の容量を見直して撮影し直してください。');
    }
    return request;
  }

  async function generate() {
    if (locked.current || unsaved) return;
    setError('');
    let request;
    try {
      request = generationRequest();
    } catch (reason) {
      setError(reason.message);
      return;
    }
    locked.current = true;
    setPending(true);
    onBusyChange(true);
    setResult(null);
    try {
      const generated = await aiImageApi.generate(image.document.id, request);
      const savePayload = {
        id: generated.historyId,
        document: structuredClone(request.document),
        beforeDataUrl: request.beforeDataUrl,
        afterDataUrl: generated.dataUrl,
        model: generated.model,
        quality: generated.quality,
        generationMethod: generated.generationMethod,
        inputImageCount: generated.inputImageCount,
        referenceSummary: structuredClone(generated.referenceSummary),
      };
      setResult({ ...generated, savePayload });
      onUnsavedChange(generated.historySaved !== true);
      if (generated.historySaved) {
        queryClient.invalidateQueries({ queryKey: ['garden-image-history', image.document.id] });
      }
    } catch (reason) {
      let message = 'AI画像を生成できませんでした。接続状態を確認し、手動で再試行してください。';
      if (reason instanceof Error) message = reason.message;
      setError(message);
    } finally {
      locked.current = false;
      setPending(false);
      onBusyChange(false);
    }
  }

  async function retrySave() {
    if (locked.current || !unsaved) return;
    locked.current = true;
    setSaving(true);
    onBusyChange(true);
    setError('');
    try {
      await imageHistoryApi.save(image.document.id, result.savePayload);
      setResult((current) => ({ ...current, historySaved: true, historyError: null }));
      onUnsavedChange(false);
      queryClient.invalidateQueries({ queryKey: ['garden-image-history', image.document.id] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '履歴に保存できませんでした。画像は保持されています。');
    } finally {
      locked.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  }

  function discardResult() {
    if (locked.current) return;
    setResult(null);
    setError('');
    setDiscardOpen(false);
    onUnsavedChange(false);
  }

  const photoInputs = plants.filter((plant) => plant.productId && (photos[plant.productId]
    || candidates.data?.find((item) => item.productId === plant.productId)?.requiresUpload));

  return <section className="ai-image-generation" aria-label="AI完成イメージ生成" aria-busy={busy}>
    {result ? <section className="ai-after-result" aria-label="AI生成結果">
      <div data-testid="after-image"><BeforeAfterComparison key={result.historyId} beforeDataUrl={result.savePayload.beforeDataUrl}
        afterDataUrl={result.dataUrl} width={image.width} height={image.height}/></div>
      <div className="ai-result-actions">
        {result.historySaved && <span role="status" data-testid="history-saved"><UiIcon name="check" size={16}/>履歴に保存済み</span>}
        <a className="button button-secondary" href={result.dataUrl} download="kusakari-after.png" aria-label="After画像をPNGで保存">
          <UiIcon name="download" size={16}/>画像を保存
        </a>
      </div>
      {unsaved && <div className="notice-error ai-save-warning" role="alert">
        <p>画像は生成済みですが、履歴への保存に失敗しました。画像は保持しています。</p>
        <button type="button" disabled={busy} onClick={retrySave}>{saving ? '保存中…' : '履歴へ再保存'}</button>
        <button type="button" disabled={busy} onClick={() => setDiscardOpen(true)}>未保存の画像を破棄</button>
        <small>再保存に生成料金はかかりません。</small>
      </div>}
    </section> : <div className="ai-preview-surface">
      <img className="ai-preview-image" src={image.dataUrl} alt="現在の庭の完成イメージ" data-testid="before-image"/>
      <span className="ai-preview-badge">生成前</span>
      {pending && <div className="ai-generating-state" role="status"><span className="ai-progress-ring" aria-hidden="true"/>完成イメージを生成中…</div>}
    </div>}
    {unlinked.length > 0 && <p className="notice-error" role="alert">商品に紐づいていない旧モデル（{unlinked.map((plant) => plant.name).join('、')}）があります。商品一覧から配置し直してください。</p>}
    {plants.length === 0 && <p className="notice-error">植物を配置すると生成できます。</p>}
    {inputImageCount > 16 && <p className="notice-error">画像が16枚を超えています。配置を減らしてください。</p>}
    {candidates.isError && <div className="notice-error ai-reference-error" role="alert">
      <span>植物の参考画像を取得できませんでした。</span>
      <button type="button" disabled={busy} onClick={() => candidates.refetch()}>登録画像を再取得</button>
    </div>}
    {!candidates.isError && photoInputs.map((plant) => <AiPlantReference
      key={plant.key} plant={plant} product={candidates.data.find((item) => item.productId === plant.productId)}
      photo={photos[plant.productId]} disabled={formDisabled || candidates.isFetching}
      onUpload={(file) => uploadPhoto(plant.productId, file)}
      onRemovePhoto={() => removePhoto(plant.productId)}
    />)}
    {error && <p className="notice-error" role="alert">{error}</p>}
    <div className="ai-studio-actions">
      <div className="ai-action-copy">
        <span>{pending ? 'この画面のままお待ちください' : candidates.isFetching ? '植物の参考画像を準備中…' : result ? '別の仕上がりを試す' : '配置した植物を、自然な仕上がりに'}</span>
        <small>OpenAIに画像を送信します。生成ごとに利用料が発生します。</small>
      </div>
      <button type="button" className="button button-primary ai-generate-button" aria-label="AIで生成（API利用料が発生します）"
        disabled={formDisabled || candidates.isFetching || candidates.isPending || candidates.isError || !plants.length || !!unlinked.length || inputImageCount > 16}
        onClick={generate}><UiIcon name="sparkles"/>{pending ? '生成中…' : 'AIで生成'}</button>
    </div>
    {status.data?.configured === false && <p className="ai-config-notice">AI画像生成の接続設定が未完了です。</p>}
    {status.isError && <p className="ai-config-notice">接続設定を確認できませんでした。</p>}
    {uploading && <p role="status">写真を確認中…</p>}
    <details className="ai-studio-details" data-testid="generation-details">
      <summary>詳細</summary>
      <div className="ai-studio-details-body">
        <p data-testid="ai-result-guidance">庭全体のAfter画像を生成します。背景や家具も含め、構図と配置を確認してください。</p>
        <p data-testid="ai-input-count">入力画像 {inputImageCount} / 16枚・植物参考 {plants.length}枚</p>
        {status.data && <p>モデル：{status.data.model}／品質：{status.data.quality}</p>}
        {result && <>
          <p>生成画像：{result.width} × {result.height} px</p>
          <GenerationMethodDetails generationMethod={result.generationMethod} width={image.width} height={image.height}/>
        </>}
        <a href={image.dataUrl} download="kusakari-before.png">Before画像をPNGで保存</a>
      </div>
    </details>
    {discardOpen && <Dialog title="未保存の画像を破棄" busy={busy} onClose={() => setDiscardOpen(false)} footer={<>
      <button type="button" className="button button-secondary" data-dialog-autofocus disabled={busy} onClick={() => setDiscardOpen(false)}>画像を保持する</button>
      <button type="button" className="button button-danger" disabled={busy} onClick={discardResult}>破棄する</button>
    </>}><p>履歴に保存されていない画像です。破棄すると元に戻せません。</p></Dialog>}
  </section>;
}

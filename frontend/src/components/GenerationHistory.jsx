import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { imageHistoryApi } from '../api/imageHistory';
import { ApiError } from '../api/http';
import { BeforeAfterComparison } from './BeforeAfterComparison';
import { GenerationMethodDetails } from './GenerationMethodDetails';
import { Dialog } from './Dialog';
import { HistoryCard } from './HistoryCard';
import { UiIcon } from './UiIcon';
import '../image-history.css';

function historyDate(value) {
  return new Date(value).toLocaleString('ja-JP');
}

export function GenerationHistory({ gardenId, onClose, returnFocus }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const deleteLocked = useRef(false);
  const contentRef = useRef(null);
  const backRef = useRef(null);
  const lastSelection = useRef(null);
  useEffect(() => {
    contentRef.current?.closest('.dialog-body')?.scrollTo(0, 0);
    if (selectedId) backRef.current?.focus();
    else if (lastSelection.current) {
      const card = contentRef.current?.querySelector(`[data-testid="history-item-${lastSelection.current}"] .history-card-open`);
      (card ?? contentRef.current?.querySelector('.history-card-open'))?.focus();
    }
  }, [selectedId]);
  const historyKey = ['garden-image-history', gardenId];
  const history = useInfiniteQuery({
    queryKey: historyKey,
    queryFn: ({ pageParam }) => imageHistoryApi.list(gardenId, pageParam),
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const detail = useQuery({
    queryKey: ['garden-image-history-detail', gardenId, selectedId],
    queryFn: () => imageHistoryApi.detail(gardenId, selectedId),
    enabled: selectedId !== null,
    retry: false,
    gcTime: 0,
  });
  const remove = useMutation({
    mutationFn: (historyId) => imageHistoryApi.remove(gardenId, historyId),
    onSuccess: async (_, historyId) => {
      if (selectedId === historyId) setSelectedId(null);
      setDeleteTarget(null);
      queryClient.removeQueries({ queryKey: ['garden-image-history-detail', gardenId, historyId] });
      await queryClient.invalidateQueries({ queryKey: historyKey });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 404) {
        queryClient.invalidateQueries({ queryKey: historyKey });
        queryClient.invalidateQueries({ queryKey: ['garden-image-history-detail', gardenId, selectedId] });
      }
    },
  });
  const items = [];
  for (const page of history.data?.pages ?? []) {
    for (const item of page.items) items.push(item);
  }
  const busy = history.isFetching || detail.isFetching || remove.isPending;
  const selected = detail.data;

  function confirmDelete(item) {
    remove.reset();
    setDeleteTarget(item);
  }

  function deleteHistory() {
    if (deleteLocked.current || !deleteTarget) return;
    deleteLocked.current = true;
    remove.mutate(deleteTarget.id, { onSettled: () => { deleteLocked.current = false; } });
  }

  return <>
    <Dialog title="生成履歴" className="generation-history-dialog" busy={remove.isPending} onClose={onClose} returnFocus={returnFocus}>
      <div ref={contentRef}>
      {!selectedId && <>
      {history.isPending && <p className="history-loading" role="status">履歴を読み込み中…</p>}
      {history.isError && <div className="notice-error" role="alert">
        <p>{history.error.message || '生成履歴を取得できませんでした。'}</p>
        <button type="button" disabled={busy} onClick={() => history.refetch()}>履歴を再取得</button>
      </div>}
      {!history.isPending && !history.isError && items.length === 0 && <div className="history-empty"><UiIcon name="photo" size={36}/><p>保存された生成履歴はありません。</p></div>}
      {items.length > 0 && <ol className="generation-history-list" aria-label="保存済み生成履歴">
        {items.map((item) => <HistoryCard key={item.id} gardenId={gardenId} item={item} disabled={busy}
          onSelect={() => { lastSelection.current = item.id; setSelectedId(item.id); }} onDelete={() => confirmDelete(item)}/>)}
      </ol>}
      {history.hasNextPage && <button type="button" className="button button-secondary history-load-more" disabled={busy} onClick={() => history.fetchNextPage()}>
        {history.isFetchingNextPage ? '読み込み中…' : 'さらに読み込む'}
      </button>}
      </>}
      {selectedId && <section className="generation-history-detail" aria-label="選択した生成履歴" aria-busy={detail.isFetching}>
        <div className="history-detail-toolbar">
          <button ref={backRef} type="button" className="history-back" disabled={remove.isPending} onClick={() => setSelectedId(null)}><UiIcon name="back" size={16}/>履歴一覧に戻る</button>
          {selected && !detail.isError && <button type="button" className="history-detail-delete" aria-label="この履歴を削除" title="この履歴を削除" disabled={busy} onClick={() => confirmDelete(selected)}><UiIcon name="trash" size={16}/></button>}
        </div>
        {detail.isFetching && <p role="status">比較画像を取得中…</p>}
        {detail.isError && <div className="notice-error" role="alert">
          <p>{detail.error.message || '比較画像を取得できませんでした。'}</p>
          <button type="button" disabled={busy} onClick={() => detail.refetch()}>比較画像を再取得</button>
        </div>}
        {selected && !detail.isError && !detail.isFetching && <>
          <BeforeAfterComparison key={selected.id} beforeDataUrl={selected.beforeDataUrl} afterDataUrl={selected.afterDataUrl}
            width={selected.document.photo.imageWidth} height={selected.document.photo.imageHeight}/>
          <div className="generation-history-downloads">
            <a className="button button-secondary" aria-label="Before画像をPNGで保存" href={selected.beforeDataUrl} download="kusakari-before.png"><UiIcon name="download" size={16}/>Before</a>
            <a className="button button-primary" aria-label="After画像をPNGで保存" href={selected.afterDataUrl} download="kusakari-after.png"><UiIcon name="download" size={16}/>Afterを保存</a>
          </div>
          <details className="ai-studio-details"><summary>詳細</summary>
            <GenerationMethodDetails generationMethod={selected.generationMethod} width={selected.document.photo.imageWidth} height={selected.document.photo.imageHeight}/>
            <p>モデル：{selected.model}／品質：{selected.quality}／入力画像：{selected.inputImageCount}枚</p>
          </details>
        </>}
      </section>}
      </div>
    </Dialog>
    {deleteTarget && <Dialog title="生成履歴を削除" busy={remove.isPending} onClose={() => setDeleteTarget(null)} footer={<>
      <button type="button" className="button button-secondary" disabled={remove.isPending} data-dialog-autofocus onClick={() => setDeleteTarget(null)}>取消</button>
      <button type="button" className="button button-danger" disabled={remove.isPending} onClick={deleteHistory}>{remove.isPending ? '削除中…' : '削除する'}</button>
    </>}>
      <p>{historyDate(deleteTarget.createdAt)}のBefore／Afterと撮影時の庭データを削除します。削除すると元に戻せません。</p>
      {remove.isError && <p className="notice-error" role="alert">{remove.error.message || '生成履歴を削除できませんでした。再試行してください。'}</p>}
    </Dialog>}
  </>;
}

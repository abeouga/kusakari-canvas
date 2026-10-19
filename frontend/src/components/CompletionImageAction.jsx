import { useRef, useState } from 'react';
import { captureImage } from '../capture/captureImage';
import { Dialog } from './Dialog';
import { AiImageGeneration } from './AiImageGeneration';
import { CompletionMenu } from './CompletionMenu';
import { GenerationHistory } from './GenerationHistory';
import { UiIcon } from './UiIcon';
import '../image-studio.css';

export function CompletionImageAction({ garden, assets, photoMode, captureRef, storeId, disabled }) {
  const [image, setImage] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const toggleRef = useRef(null);
  const captureLocked = useRef(false);
  const aiLocked = useRef(false);
  const unsavedResult = useRef(false);

  function closeImage() {
    if (aiLocked.current) return;
    if (unsavedResult.current) {
      setDiscardOpen(true);
      return;
    }
    setImage(null);
  }

  async function capture() {
    if (captureLocked.current) return;
    captureLocked.current = true;
    setError('');
    setCapturing(true);
    try {
      const document = structuredClone(garden);
      const capturedAssets = structuredClone(assets);
      const result = await captureImage(document, photoMode, captureRef.current, { includeCoverage: photoMode });
      setImage({ ...result, document, assets: capturedAssets, storeId });
    } catch (reason) {
      let message = '完成イメージを作成できません。再試行してください。';
      if (reason instanceof Error) message = reason.message;
      setError(message);
    } finally {
      captureLocked.current = false;
      setCapturing(false);
    }
  }

  return <>
    <CompletionMenu photoMode={photoMode} disabled={disabled} capturing={capturing} error={error} toggleRef={toggleRef}
      onCapture={capture} onHistory={() => setHistoryOpen(true)}/>
    {historyOpen && <GenerationHistory gardenId={garden.id} onClose={() => setHistoryOpen(false)} returnFocus={toggleRef}/>}
    {image && <Dialog title="庭の完成イメージ" className="completion-image-dialog" busy={aiBusy} onClose={closeImage} returnFocus={toggleRef}>
      {!image.hasPhoto && <>
        <div className="ai-preview-surface"><img className="ai-preview-image" src={image.dataUrl} alt="現在の庭の完成イメージ" data-testid="preview-image"/></div>
        <div className="ai-studio-actions"><span>現在の視点の3Dプレビュー</span><a className="button button-primary" href={image.dataUrl} download="kusakari-canvas.png"><UiIcon name="download"/>画像を保存</a></div>
      </>}
      {image.hasPhoto && <AiImageGeneration image={image} onUnsavedChange={(unsaved) => { unsavedResult.current = unsaved; }} onBusyChange={(busy) => {
        aiLocked.current = busy;
        setAiBusy(busy);
      }}/>}
    </Dialog>}
    {discardOpen && <Dialog title="未保存の画像を破棄して閉じますか？" busy={aiBusy} onClose={() => setDiscardOpen(false)} footer={<>
      <button type="button" className="button button-secondary" data-dialog-autofocus onClick={() => setDiscardOpen(false)}>画像を保持する</button>
      <button type="button" className="button button-danger" onClick={() => {
        unsavedResult.current = false;
        setDiscardOpen(false);
        setImage(null);
      }}>破棄して閉じる</button>
    </>}><p>After画像は生成履歴に保存されていません。閉じるとこの画像を失います。履歴へ再保存するか、PNGで保存してください。</p></Dialog>}
  </>;
}

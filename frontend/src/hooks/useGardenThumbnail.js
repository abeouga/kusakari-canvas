import { useEffect } from 'react';
import { captureImage } from '../capture/captureImage';
import { thumbnailImage } from '../capture/thumbnailImage';
import { requestJson } from '../api/http';

export function useGardenThumbnail(garden, ready, photoMode, captureRef) {
  useEffect(() => {
    if (!garden || !ready) return;
    let cancelled = false;
    let attempts = 0;
    let timer;
    async function save() {
      attempts++;
      try {
        const capture = await captureImage(garden, photoMode, captureRef.current);
        const dataUrl = await thumbnailImage(capture.dataUrl);
        if (cancelled) return;
        await requestJson(`/api/gardens/${garden.id}/thumbnail`, {
          method: 'POST', body: JSON.stringify({ revision: garden.revision, dataUrl }),
        });
      } catch {
        // A current placement plan remains available if capture is not ready or the upload fails.
        if (!cancelled && attempts < 3) timer = window.setTimeout(save, 1500);
      }
    }
    timer = window.setTimeout(save, 600);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [garden, ready, photoMode, captureRef]);
}

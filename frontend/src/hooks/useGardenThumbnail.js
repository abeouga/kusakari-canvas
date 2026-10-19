import { useEffect } from 'react';
import { captureImage } from '../capture/captureImage';
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
        const image = new Image();
        image.src = capture.dataUrl;
        await image.decode();
        if (cancelled) return;
        const scale = Math.min(640 / image.width, 400 / image.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        await requestJson(`/api/gardens/${garden.id}/thumbnail`, {
          method: 'POST', body: JSON.stringify({ revision: garden.revision, dataUrl: canvas.toDataURL('image/png') }),
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

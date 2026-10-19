import { requestJson } from './http';

function historyPath(gardenId) {
  return `/api/gardens/${encodeURIComponent(gardenId)}/image-history`;
}

export const imageHistoryApi = {
  list: (gardenId, cursor) => {
    const params = new URLSearchParams({ limit: '20' });
    if (cursor) params.set('cursor', cursor);
    return requestJson(`${historyPath(gardenId)}?${params}`);
  },
  detail: (gardenId, historyId) => requestJson(`${historyPath(gardenId)}/${encodeURIComponent(historyId)}`),
  thumbnailUrl: (gardenId, historyId) => `${historyPath(gardenId)}/${encodeURIComponent(historyId)}/thumbnail`,
  save: (gardenId, request) => requestJson(historyPath(gardenId), {
    method: 'POST', body: JSON.stringify(request),
  }),
  remove: (gardenId, historyId) => requestJson(`${historyPath(gardenId)}/${encodeURIComponent(historyId)}`, {
    method: 'DELETE',
  }),
};

import { requestJson } from './http';

export const aiImageApi = {
  status: () => requestJson('/api/ai/status'),
  stores: () => requestJson('/api/ai/stores'),
  candidates: (assetId) => requestJson(`/api/ai/candidates?${new URLSearchParams({ assetId })}`),
  productReferences: (productIds) => requestJson('/api/ai/product-references', {
    method: 'POST', body: JSON.stringify({ productIds }),
  }),
  generate: (gardenId, request) => requestJson(`/api/gardens/${encodeURIComponent(gardenId)}/ai-image`, {
    method: 'POST',
    body: JSON.stringify(request),
  }),
};

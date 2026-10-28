import { requestJson } from './http';
export const gardenApi = {
    listAssets: () => requestJson('/api/assets'),
    listGardens: () => requestJson('/api/gardens'),
    getGarden: (id) => requestJson(`/api/gardens/${encodeURIComponent(id)}`),
    /** @param {{name: string, width?: number, depth?: number}} request */
    createGarden: (request) => requestJson('/api/gardens', {
        method: 'POST',
        body: JSON.stringify(request),
    }),
    saveGarden: (document) => requestJson(`/api/gardens/${encodeURIComponent(document.id)}`, {
        method: 'PUT',
        body: JSON.stringify(document),
    }),
    /** 写真・輪郭・配置を含む庭を、サーバーの1トランザクションで複製します。 */
    duplicateGarden: (id) => requestJson(`/api/gardens/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
    deleteGarden: (id) => requestJson(`/api/gardens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

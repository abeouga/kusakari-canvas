import { ecUrl } from '../domain/shopping';
import { authHeaders, handleUnauthorized } from './auth';

export class CommerceError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
async function request(path, method = 'GET', payload) {
    let response;
    try {
        response = await fetch(new URL(`/api${path}`, ecUrl), {
            method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...await authHeaders(method) },
            body: payload === undefined ? undefined : JSON.stringify(payload),
        });
    } catch {
        throw new CommerceError('ECへ接続できません。ECの起動と接続設定を確認してください。', 0);
    }
    const data = await response.json();
    if (!response.ok) {
        if (response.status === 401) handleUnauthorized();
        throw new CommerceError(data.message || 'ECの処理に失敗しました。', response.status);
    }
    return data;
}
export const commerceApi = {
    cart: () => request('/cart'),
    products: (storeId) => request(`/products?storeId=${storeId}`),
    quote: (storeId, items) => request('/materials/quote', 'POST', { storeId, items }),
    savedItems: (gardenId) => request(`/shopping-lists/${encodeURIComponent(gardenId)}/saved-items`),
};
export function productImage(path) {
    return new URL(path, ecUrl).href;
}
export function yen(value) {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(value);
}

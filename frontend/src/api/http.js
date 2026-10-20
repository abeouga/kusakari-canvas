import { canvasUrl } from '../domain/urls';
import { authHeaders, login } from './auth';
export class ApiError extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'ApiError';
    }
}
export async function requestJson(path, init) {
    const response = await fetch(canvasUrl(path), {
        ...init,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...await authHeaders(init?.method), ...init?.headers },
    });
    if (!response.ok) {
        if (response.status === 401) login();
        const error = await response.json().catch(() => null);
        throw new ApiError(error?.message ?? 'サーバーへ接続できませんでした。', response.status, error?.code ?? 'REQUEST_FAILED');
    }
    if (response.status === 204)
        return undefined;
    return response.json();
}

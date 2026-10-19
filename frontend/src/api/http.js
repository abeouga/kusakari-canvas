import { canvasUrl } from '../domain/urls';
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
        headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new ApiError(error?.message ?? 'サーバーへ接続できませんでした。', response.status, error?.code ?? 'REQUEST_FAILED');
    }
    if (response.status === 204)
        return undefined;
    return response.json();
}

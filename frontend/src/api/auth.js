import { ecUrl } from '../domain/shopping';
import { canvasUrl } from '../domain/urls';

let modePromise;
export function authMode() {
  if (!modePromise) modePromise = fetch(canvasUrl('/api/auth/status')).then(async (response) => {
    if (!response.ok) throw new Error('認証設定を確認できません。');
    const data = await response.json();
    if (!['demo', 'cognito'].includes(data.mode)) throw new Error('認証設定が無効です。');
    return data.mode;
  }).catch((error) => { modePromise = undefined; throw error; });
  return modePromise;
}

export async function authHeaders(method) {
  if (['GET', 'HEAD', 'OPTIONS'].includes((method || 'GET').toUpperCase())) return {};
  if (await authMode() === 'demo') return {};
  const response = await fetch(new URL('/api/auth/csrf', ecUrl), { credentials: 'include' });
  if (!response.ok) throw new Error('操作の確認情報を取得できません。画面を再読み込みしてください。');
  const csrf = await response.json();
  return csrf.headerName && csrf.token ? { [csrf.headerName]: csrf.token } : {};
}

export function login() {
  const target = new URL('/api/auth/login', ecUrl);
  target.searchParams.set('returnTo', window.location.href.split('#')[0]);
  window.location.assign(target.href);
}

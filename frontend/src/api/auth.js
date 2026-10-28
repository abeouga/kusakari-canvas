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
  if (response.status === 401) {
    handleUnauthorized();
    throw Object.assign(new Error('ログインの有効期限が切れました。'), { status: 401 });
  }
  if (!response.ok) throw new Error('操作の確認情報を取得できません。画面を再読み込みしてください。');
  const csrf = await response.json();
  return csrf.headerName && csrf.token ? { [csrf.headerName]: csrf.token } : {};
}

function loginUrl(returnTo) {
  const target = new URL('/account/login', ecUrl);
  target.searchParams.set('returnTo', returnTo);
  return target.href;
}

export function login() {
  window.location.replace(loginUrl(window.location.href.split('#')[0]));
}

// 未保存の編集を持つ画面は、401で即座にログインへ遷移せず編集内容を保持する処理を登録します。
let unauthorizedHandler = null;
/** @param {() => boolean} handler 処理した場合にtrueを返します。 @returns {() => void} */
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
  return () => { if (unauthorizedHandler === handler) unauthorizedHandler = null; };
}
export function handleUnauthorized() {
  if (unauthorizedHandler?.()) return;
  login();
}

// 再ログインは別ウィンドウのECで行い、戻り先のCanvas画面が同じオリジンの編集画面へ完了を知らせます。
const loginChannel = 'kusakari-canvas-login';
export const loginCompleteParam = 'loginComplete';
export function openLoginWindow() {
  const returnTo = new URL(canvasUrl('/'), window.location.origin);
  returnTo.searchParams.set(loginCompleteParam, '1');
  window.open(loginUrl(returnTo.href), '_blank', 'noopener');
}
/** @param {() => void} callback @returns {() => void} */
export function onLoginCompleted(callback) {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(loginChannel);
  channel.onmessage = (event) => { if (event.data === 'completed') callback(); };
  return () => channel.close();
}
export function announceLoginCompleted() {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(loginChannel);
  channel.postMessage('completed');
  channel.close();
}

import { useEffect, useState } from 'react';
import { ecUrl } from '../domain/shopping';
import { login, authMode } from '../api/auth';

export function AuthGate({ children }) {
  const [state, setState] = useState('loading');
  useEffect(() => {
    let active = true;
    authMode().then(async (mode) => {
      if (mode === 'demo') { if (active) setState('ready'); return; }
      const response = await fetch(new URL('/api/auth/me', ecUrl), { credentials: 'include' });
      if (!response.ok) throw new Error();
      const session = await response.json();
      if (session.mode !== 'cognito') throw new Error();
      if (active) setState(session.authenticated ? 'ready' : 'login');
    }).catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, []);
  if (state === 'ready') return children;
  return <main className="workspace-card">
    <h1>Kusakari Canvas</h1>
    {state === 'loading' && <p>ログイン状態を確認しています。</p>}
    {state === 'login' && <><p>庭を作成・保存するにはログインしてください。</p><button onClick={login}>ログイン</button></>}
    {state === 'error' && <><p role="alert">ログイン状態を確認できません。ECの起動と接続設定を確認してください。</p><button onClick={() => window.location.reload()}>再試行</button></>}
  </main>;
}

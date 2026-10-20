import { useEffect, useState } from 'react';
import { ecUrl } from '../domain/shopping';
import { login, authMode } from '../api/auth';
import { AuthContext } from './AuthContext';

export function AuthGate({ children }) {
  const [state, setState] = useState('loading');
  const [authSession, setAuthSession] = useState(null);
  useEffect(() => {
    let active = true;
    authMode().then(async (mode) => {
      if (mode === 'demo') { if (active) setState('demo'); return; }
      const response = await fetch(new URL('/api/auth/me', ecUrl), { credentials: 'include' });
      if (response.status === 401) { if (active) login(); return; }
      if (!response.ok) throw new Error();
      const session = await response.json();
      if (session.mode !== 'cognito') throw new Error();
      if (!active) return;
      if (session.authenticated) { setAuthSession(session); setState('authenticated'); }
      else { setState('redirecting'); login(); }
    }).catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, []);
  if (state === 'authenticated' || state === 'demo') {
    return <AuthContext.Provider value={authSession}>{children}</AuthContext.Provider>;
  }
  return <main className="workspace-card">
    <h1>Kusakari Canvas</h1>
    {state === 'loading' && <p>ログイン状態を確認しています。</p>}
    {state === 'redirecting' && <p>ECのログイン画面へ移動しています。</p>}
    {state === 'error' && <><p role="alert">ログイン状態を確認できません。ECの起動と接続設定を確認してください。</p><button onClick={() => window.location.reload()}>再試行</button></>}
  </main>;
}

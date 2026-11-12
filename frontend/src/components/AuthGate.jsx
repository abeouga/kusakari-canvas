import { useEffect, useState } from 'react';
import { ecUrl } from '../domain/shopping';
import { login, authMode } from '../api/auth';
import { AuthContext } from './AuthContext';

// Shop-side and applicant accounts cannot buy, so Canvas stops before the garden list (the API also returns 403).
// The plant preview stays open to them: the EC seller's product form shows it in a frame.
const shopAccountTypes = ['SHOP_OWNER', 'SHOP_STAFF', 'SHOP_OWNER_APPLICANT'];

/** @param {{children: import('react').ReactNode, buyerOnly?: boolean}} props */
export function AuthGate({ children, buyerOnly = true }) {
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
      if (!session.authenticated) { setState('redirecting'); login(); }
      else if (buyerOnly && shopAccountTypes.includes(session.accountType)) setState('buyer-only');
      else { setAuthSession(session); setState('authenticated'); }
    }).catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [buyerOnly]);
  if (state === 'authenticated' || state === 'demo') {
    return <AuthContext.Provider value={authSession}>{children}</AuthContext.Provider>;
  }
  if (state === 'buyer-only') {
    return <main className="workspace-card" data-testid="buyer-only">
      <h1>Kusakari Canvas</h1>
      <p role="alert">Canvas は購入者のアカウントで使えます。</p>
      <a href={ecUrl}>EC のトップへ戻る</a>
    </main>;
  }
  if (state !== 'error') {
    return <main className="auth-loading" role="status" aria-label="ログイン状態を確認しています"><span /></main>;
  }
  return <main className="workspace-card">
    <h1>Kusakari Canvas</h1>
    <p role="alert">ログイン状態を確認できません。ECの起動と接続設定を確認してください。</p>
    <button onClick={() => window.location.reload()}>再試行</button>
  </main>;
}

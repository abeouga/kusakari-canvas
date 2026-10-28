import { useEffect } from 'react';
import { announceLoginCompleted } from '../api/auth';
import { canvasUrl } from '../domain/urls';

// 編集画面から開いたECログインの戻り先です。編集中の画面へ完了を知らせ、開いたウィンドウを閉じます。
export function LoginComplete() {
  useEffect(() => {
    announceLoginCompleted();
    window.close();
  }, []);
  return <main className="workspace-card">
    <h1>Kusakari Canvas</h1>
    <p role="status">ログインしました。編集中の画面に戻ると、保持している編集内容の保存を再試行します。</p>
    <a href={canvasUrl('/')}>庭一覧を開く</a>
  </main>;
}

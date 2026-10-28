import { EditorPage } from './EditorPage';
import { GardenListPage } from './GardenListPage';
import { PlantPreviewPage } from './PlantPreviewPage';
import { canvasPathname } from '../domain/urls';
import { AuthGate } from '../components/AuthGate';
import { LoginComplete } from '../components/LoginComplete';
import { loginCompleteParam } from '../api/auth';
export function App() {
    const path = canvasPathname();
    // 編集中の再ログイン用ウィンドウの戻り先。ログイン済みを確認してから編集画面へ知らせます。
    if (path === '/' && new URLSearchParams(window.location.search).has(loginCompleteParam)) return <AuthGate><LoginComplete/></AuthGate>;
    if (path === '/model-preview') return <AuthGate><PlantPreviewPage/></AuthGate>;
    const match = path.match(/^\/gardens\/([^/]+)\/?$/);
    const gardenId = match ? decodeURIComponent(match[1]) : null;
    return <AuthGate>{gardenId ? <EditorPage gardenId={gardenId}/> : <GardenListPage />}</AuthGate>;
}

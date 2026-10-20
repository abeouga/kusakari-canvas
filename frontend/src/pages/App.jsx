import { EditorPage } from './EditorPage';
import { GardenListPage } from './GardenListPage';
import { PlantPreviewPage } from './PlantPreviewPage';
import { canvasPathname } from '../domain/urls';
import { AuthGate } from '../components/AuthGate';
export function App() {
    const path = canvasPathname();
    if (path === '/model-preview') return <AuthGate><PlantPreviewPage/></AuthGate>;
    const match = path.match(/^\/gardens\/([^/]+)\/?$/);
    const gardenId = match ? decodeURIComponent(match[1]) : null;
    return <AuthGate>{gardenId ? <EditorPage gardenId={gardenId}/> : <GardenListPage />}</AuthGate>;
}

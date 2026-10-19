import { EditorPage } from './EditorPage';
import { GardenListPage } from './GardenListPage';
import { PlantPreviewPage } from './PlantPreviewPage';
import { canvasPathname } from '../domain/urls';
export function App() {
    const path = canvasPathname();
    if (path === '/model-preview') return <PlantPreviewPage/>;
    const match = path.match(/^\/gardens\/([^/]+)\/?$/);
    const gardenId = match ? decodeURIComponent(match[1]) : null;
    return gardenId ? <EditorPage gardenId={gardenId}/> : <GardenListPage />;
}

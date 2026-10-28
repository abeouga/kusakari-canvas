import {
    ArrowDownToLine, ArrowLeft, ArrowRight, Box, Camera, Check, ChevronDown, Clock, Copy, Download, Grid3x3, History, House,
    Image, ImageOff, ImageUp, Layers, Leaf, MousePointer2, Move, PanelRight, Pencil, PencilRuler, PenLine, Pentagon, Plus, RotateCw,
    Ruler, Scaling, SlidersHorizontal, Sparkles, Square, Trash2, TreeDeciduous, TriangleAlert, X,
} from 'lucide-react';

// 画面内の名前とlucide-reactのアイコンの対応。呼び出し側は用途の名前だけを指定します。
const icons = {
    leaf: Leaf, back: ArrowLeft, close: X, plus: Plus, photo: Image, cube: Box, panel: PanelRight, chevron: ChevronDown,
    camera: Camera, polygon: Pentagon, ruler: Ruler, top: ArrowDownToLine, home: House, trash: Trash2, copy: Copy, move: Move,
    rotate: RotateCw, scale: Scaling, check: Check, clock: Clock, alert: TriangleAlert, arrow: ArrowRight, sparkles: Sparkles,
    history: History, settings: SlidersHorizontal, download: Download, place: MousePointer2, outline: PencilRuler,
    redraw: PenLine, 'photo-change': ImageUp, 'photo-remove': ImageOff, layers: Layers, ground: Square, grid: Grid3x3,
    tree: TreeDeciduous, edit: Pencil,
};
export function UiIcon({ name, size = 18 }) {
    const Icon = icons[name];
    return <Icon size={size} strokeWidth={1.75} aria-hidden="true"/>;
}

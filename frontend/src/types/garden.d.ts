// JSON contracts shared by API verification and the garden editor.
export interface Vector {
    x: number;
    y: number;
    z: number;
}

export interface GardenObject {
    id: string;
    assetId: string;
    productId?: string;
    productName?: string;
    materialCode?: string;
    modelComposition?: PlantComposition;
    position: Vector;
    rotation: Vector;
    scale: Vector;
}

export interface PlantComposition {
    version: 1 | 2 | 3 | 4;
    catalogVersion: 1 | 2 | 3 | 4;
    profile: { plantType: 'tree' | 'shrub' | 'flower' | 'conifer' | 'multistem' | 'spreading' | 'grass' | 'rosette' | 'vine' | 'palm'; [key: string]: unknown };
    baseDimensions: { width: number; height: number; depth: number };
    fitScale?: number[];
    parts: { partId: string; position: number[]; quaternion: number[]; scale: number[]; color: string | null }[];
}

export interface ImagePoint {
    x: number;
    y: number;
}

export interface PhotoCalibration {
    version: 1;
    points: ImagePoint[];
    referenceWidth: number;
    referenceDepth: number;
    focalLengthPx: number;
    focalSource: 'estimated' | 'manual';
    rotation: number[];
    translation: number[];
    reprojectionErrorPx: number;
}

export interface GardenPhoto {
    dataUrl: string;
    imageWidth: number;
    imageHeight: number;
    corners: ImagePoint[];
    boundary: ImagePoint[];
    calibration?: PhotoCalibration | null;
    projectionSize?: { width: number; depth: number } | null;
}

export interface GardenDocument {
    schemaVersion: number;
    id: string;
    revision: number;
    name: string;
    width: number;
    depth: number;
    objects: GardenObject[];
    photo: GardenPhoto | null;
}

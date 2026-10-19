import { plantPresets } from './plant-library-presets.mjs';

export const referenceProfiles = {
  'maple-tree': { botanicalForm: 'maple', leafSizeCm: 9, branchCount: 14, trunkThicknessCm: 4,
    leafDensity: 'high', leafColor: '#467441', branchAngle: 65 },
  'split-leaf': { botanicalForm: 'monstera', leafSizeCm: 36, branchCount: 8, trunkThicknessCm: 2,
    leafDensity: 'medium', leafColor: '#376b43' },
  'white-spread': { botanicalForm: 'iberis', leafShape: 'narrow', leafSizeCm: 3.5,
    flowerShape: 'four', flowerSizeCm: 1.6, branchCount: 20, trunkThicknessCm: 1, leafColor: '#426441' },
  'soft-grass': { botanicalForm: 'hakone', leafSizeCm: 25, branchCount: 18, leafColor: '#739740' },
  'gold-conifer': { botanicalForm: 'goldcrest', leafShape: 'scale', leafSizeCm: 14,
    trunkThicknessCm: 3, branchAngle: 55, leafColor: '#a5b842' },
};
export const plantPresetsV3 = plantPresets.map((preset) => ({ ...preset,
  profile: { ...preset.profile, botanicalForm: null, ...referenceProfiles[preset.key] } }));

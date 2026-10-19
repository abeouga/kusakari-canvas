// Product-ready design presets. Prices and stock are local catalog values, not market quotations.
import { readFileSync } from 'node:fs';
const photoCatalog = JSON.parse(readFileSync(new URL('./plant-photo-catalog.json', import.meta.url), 'utf8'));
const base = { plantType: 'tree', heightCm: 180, widthCm: 110, crownShape: 'round', branchCount: 12,
  branchAngle: 60, trunkThicknessCm: 6, leafShape: 'oval', leafSizeCm: 18, leafDensity: 'high',
  leafColor: '#48754b', flowerEnabled: false, flowerShape: 'five', flowerSizeCm: 12,
  flowerColor: '#dca3bd', seed: 4100 };
const rows = [
  ['round-tree', 'ラウンドリーフツリー', '庭木', 6800, { leafShape: 'round', leafSizeCm: 22 }],
  ['narrow-tree', '細葉のシンボルツリー', '庭木', 7200, { leafShape: 'narrow', leafColor: '#718769', widthCm: 95 }],
  ['maple-tree', '掌状葉の庭木', '庭木', 7800, { leafShape: 'palmate', crownShape: 'spreading', widthCm: 160, leafSizeCm: 25 }],
  ['compound-tree', '複葉のガーデンツリー', '庭木', 8500, { leafShape: 'compound', heightCm: 240, widthCm: 170, leafSizeCm: 32 }],
  ['gold-conifer', 'ゴールドリーフ・コニファー', '庭木', 4800, { plantType: 'conifer', leafShape: 'needle', heightCm: 150, widthCm: 65, crownShape: 'conical', leafColor: '#b6ba47', leafSizeCm: 28, branchCount: 24 }],
  ['blue-conifer', 'ブルーリーフ・コニファー', '庭木', 5200, { plantType: 'conifer', leafShape: 'needle', heightCm: 180, widthCm: 95, crownShape: 'conical', leafColor: '#648e8d', leafSizeCm: 30, branchCount: 24 }],
  ['compact-conifer', 'コンパクト・コニファー', '庭木', 3200, { plantType: 'conifer', leafShape: 'needle', heightCm: 80, widthCm: 55, crownShape: 'conical', leafSizeCm: 18, branchCount: 20 }],
  ['grove-oval', '株立ちの庭木', '庭木', 9800, { plantType: 'multistem', heightCm: 230, widthCm: 170, branchCount: 21, leafSizeCm: 23 }],
  ['grove-round', '丸葉の株立ちツリー', '庭木', 8800, { plantType: 'multistem', leafShape: 'round', heightCm: 170, widthCm: 140, branchCount: 18, leafColor: '#779c80', leafSizeCm: 25 }],
  ['grove-cane', '細幹の株立ちグリーン', '庭木', 6300, { plantType: 'multistem', leafShape: 'narrow', heightCm: 210, widthCm: 100, trunkThicknessCm: 2, branchCount: 24, leafSizeCm: 27 }],
  ['round-shrub', '丸葉の低木', '庭木', 2800, { plantType: 'shrub', heightCm: 65, widthCm: 80, leafShape: 'round', leafSizeCm: 16, branchCount: 24 }],
  ['cluster-shrub', '房咲きの花木', '庭木', 3800, { plantType: 'shrub', heightCm: 90, widthCm: 100, leafSizeCm: 25, flowerEnabled: true, flowerShape: 'cluster', flowerSizeCm: 24, flowerColor: '#819dd4', branchCount: 10 }],
  ['pink-shrub', 'ピンクの花木', '庭木', 3400, { plantType: 'shrub', heightCm: 75, widthCm: 90, leafSizeCm: 15, flowerEnabled: true, flowerSizeCm: 12, flowerColor: '#d766a1', branchCount: 18 }],
  ['silver-spread', 'シルバーリーフの低木', '庭木', 2600, { plantType: 'spreading', heightCm: 40, widthCm: 110, leafShape: 'narrow', leafSizeCm: 22, leafColor: '#91a39a', branchCount: 22 }],
  ['gold-spread', '黄金葉のグラウンドシュラブ', '庭木', 2400, { plantType: 'spreading', heightCm: 30, widthCm: 90, leafShape: 'round', leafSizeCm: 16, leafColor: '#b6bd42', branchCount: 20 }],
  ['white-spread', '白花のローワイドシュラブ', '庭木', 2900, { plantType: 'spreading', heightCm: 40, widthCm: 100, flowerEnabled: true, flowerShape: 'eight', flowerSizeCm: 12, flowerColor: '#f4f0df', branchCount: 18 }],
  ['purple-spike', '紫の穂咲き草花', '草花', 1800, { plantType: 'flower', heightCm: 55, widthCm: 45, trunkThicknessCm: 0.8, leafShape: 'narrow', leafSizeCm: 9, flowerEnabled: true, flowerShape: 'spike', flowerSizeCm: 19, flowerColor: '#9172c3', branchCount: 14 }],
  ['white-daisy', '白いキク咲き草花', '草花', 1600, { plantType: 'flower', heightCm: 40, widthCm: 50, trunkThicknessCm: 0.5, leafShape: 'compound', leafSizeCm: 12, flowerEnabled: true, flowerShape: 'daisy', flowerSizeCm: 13, flowerColor: '#fff6df', branchCount: 9 }],
  ['blue-bell', '青いベル咲き草花', '草花', 1900, { plantType: 'flower', heightCm: 45, widthCm: 40, trunkThicknessCm: 0.5, leafShape: 'heart', leafSizeCm: 13, flowerEnabled: true, flowerShape: 'bell', flowerSizeCm: 10, flowerColor: '#7778c5', branchCount: 8 }],
  ['soft-grass', 'ソフトグリーン・グラス', '草花', 1800, { plantType: 'grass', heightCm: 60, widthCm: 70, leafShape: 'grass', branchCount: 20, leafColor: '#7a9d45' }],
  ['red-grass', 'レッドリーフ・グラス', '草花', 2100, { plantType: 'grass', heightCm: 80, widthCm: 60, leafShape: 'grass', branchCount: 18, leafColor: '#97534b' }],
  ['plume-grass', '白い穂のオーナメンタルグラス', '草花', 3200, { plantType: 'grass', heightCm: 130, widthCm: 90, leafShape: 'grass', branchCount: 20, flowerEnabled: true, flowerShape: 'plume', flowerSizeCm: 35, flowerColor: '#d8cfb7' }],
  ['green-rosette', 'グリーンロゼット', '観葉植物', 1500, { plantType: 'rosette', heightCm: 18, widthCm: 30, leafShape: 'succulent', branchCount: 16, leafColor: '#82ac8b' }],
  ['purple-rosette', 'パープルロゼット', '観葉植物', 1700, { plantType: 'rosette', heightCm: 20, widthCm: 34, leafShape: 'succulent', branchCount: 20, leafColor: '#9b7c9c' }],
  ['sword-rosette', '剣葉のロゼットプランツ', '観葉植物', 3900, { plantType: 'rosette', heightCm: 65, widthCm: 80, leafShape: 'narrow', branchCount: 12, leafColor: '#789a8f' }],
  ['heart-vine', 'ハートリーフのつる植物', '観葉植物', 2200, { plantType: 'vine', heightCm: 90, widthCm: 65, leafShape: 'heart', leafSizeCm: 22, trunkThicknessCm: 1, branchCount: 9 }],
  ['palmate-vine', '掌状葉のつる植物', '観葉植物', 2400, { plantType: 'vine', heightCm: 75, widthCm: 80, leafShape: 'palmate', leafSizeCm: 24, trunkThicknessCm: 1, branchCount: 12 }],
  ['split-leaf', '切れ込み葉の観葉植物', '観葉植物', 4200, { plantType: 'flower', heightCm: 80, widthCm: 90, leafShape: 'split', leafSizeCm: 65, leafDensity: 'low', trunkThicknessCm: 2, branchCount: 5 }],
  ['tall-palm', 'フェザーパーム', '観葉植物', 6800, { plantType: 'palm', heightCm: 180, widthCm: 160, leafShape: 'frond', branchCount: 10, trunkThicknessCm: 10 }],
  ['compact-palm', 'コンパクトパーム', '観葉植物', 4800, { plantType: 'palm', heightCm: 100, widthCm: 130, leafShape: 'frond', branchCount: 15, trunkThicknessCm: 7, leafColor: '#72924a' }],
];
export const plantPresets = rows.map(([key, legacyName, category, priceYen, values], index) => {
  const photo = photoCatalog.find((entry) => entry.key === key);
  if (!photo) throw new Error(`Missing plant identity: ${key}`);
  return { key, legacyName, name: photo.name, latinName: photo.latinName, description: photo.description,
    imageUrl: photo.imageUrl, category, priceYen, sku: `PLANT-V2-${key.toUpperCase()}`,
    profile: { ...base, ...values, seed: base.seed + index * 71 } };
});

export function productInput(preset, imageUrl) {
  const profile = preset.profile;
  return { storeId: 1, sku: preset.sku, name: preset.name, latinName: preset.latinName, category: preset.category,
    description: preset.description,
    sizeLabel: `高さ ${profile.heightCm}cm・幅 ${profile.widthCm}cm`, care: '', priceYen: preset.priceYen, stock: 20,
    imageUrl, badge: '', nurseryName: '', nurseryAddress: '', sunlight: '未設定', useCase: '庭の配置・組み合わせ',
    careLevel: 1, minTemperatureC: null, heatTolerant: false, droughtTolerant: false, ageYears: null,
    heightCm: profile.heightCm, potDiameterCm: null, familyName: '', floweringDescription: '', seasonalCare: '',
    styleDescription: '', images: [], plantModelProfile: profile };
}

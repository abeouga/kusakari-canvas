import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// kusakari-ec#223 で、昔の配置モデル（木・低木・レンガ・ベンチ）に合わせた EC の商品（canvas-oak・canvas-boxwood・
// canvas-brick・canvas-bench）は削除済みになった。昔の配置の買い物リストや AI の商品照合を確かめるテストは、
// テストで作った商品をその素材コードに結び付けて使い、終わったら外す。
export type LegacyMaterialCode = 'plant.oak' | 'plant.boxwood' | 'garden.brick' | 'garden.bench';

export function linkLegacyMaterial(materialCode: LegacyMaterialCode, productId: string, remove = false) {
  if (!/^[a-f0-9-]{36}$/.test(productId)) throw new Error('Only a newly-created test product is allowed');
  const statement = remove
    ? `DELETE FROM material_products WHERE material_code='${materialCode}' AND product_id='${productId}';`
    : `INSERT INTO material_products(material_code,product_id) VALUES('${materialCode}','${productId}');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { sql } from './e2e/database.js'; sql(process.argv[1]);", statement], {
    // The same EC checkout the suite starts (KUSAKARI_EC_DIRECTORY), so the fixture reaches that checkout's E2E database.
    cwd: resolve(process.env.KUSAKARI_EC_DIRECTORY || '../kusakari-ec'), encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error('Dedicated legacy material fixture failed: ' + result.stderr);
}

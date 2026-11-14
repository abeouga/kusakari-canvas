import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from './test.js';
import { api } from './api-url.js';
import { ecSql, prepareMember, sellerId, type AccountType } from './auth-session.js';

const ec = process.env.KUSAKARI_EC_E2E_WEB_URL!;
const evidence = 'artifacts/e2e/buyer-only';
// A valid plant profile, as the EC seller's product form sends it (same as e2e/shopping-lists.spec.ts).
const profile = { plantType: 'flower', heightCm: 55, widthCm: 65, crownShape: 'round', branchCount: 6,
  branchAngle: 45, trunkThicknessCm: 0.6, leafShape: 'narrow', leafSizeCm: 8, leafDensity: 'medium',
  leafColor: '#4f793b', flowerEnabled: true, flowerShape: 'five', flowerSizeCm: 8, flowerColor: '#9062ba', seed: 12345 };

// canvas#64: shop-side and applicant accounts cannot buy, so Canvas stops before the garden list and its API refuses
// them. The test seller's account type is changed in the dedicated EC E2E database and restored afterwards.
test('shop and applicant accounts see the buyer-only notice and get 403; an admin keeps using Canvas', async ({ request, seller, sellerPage }) => {
  await mkdir(evidence, { recursive: true });
  const garden = await (await request.post(`${api}/gardens`, { data: { name: `E2E buyer-only ${Date.now()}` } })).json();
  const owner = ecSql('SELECT owner_member_id FROM organizations WHERE id=1;');
  try {
    for (const type of ['SELLER', 'SHOP_OWNER', 'SHOP_OWNER_APPLICANT'] as AccountType[]) {
      prepareMember(sellerId(), type);
      const me = await seller.get(`${ec}/api/auth/me`).then((r) => r.json());
      expect(me.accountType).toBe(type === 'SELLER' ? 'SHOP_STAFF' : type);
      for (const path of ['/', `/gardens/${garden.id}`]) {
        await sellerPage.goto(path);
        await expect(sellerPage.getByTestId('buyer-only').getByRole('alert')).toHaveText('Canvas は購入者のアカウントで使えます。');
        await expect(sellerPage.getByRole('link', { name: 'EC のトップへ戻る', exact: true })).toHaveAttribute('href', `${ec}/`);
        await expect(sellerPage.getByRole('heading', { name: '保存した庭', exact: true })).toHaveCount(0);
        await expect(sellerPage.getByTestId('save-status')).toHaveCount(0);
      }
      await sellerPage.reload();
      await expect(sellerPage.getByTestId('buyer-only')).toBeVisible();
      await sellerPage.screenshot({ path: `${evidence}/${type}-after-reload.png` });
      // Reads (checked against /api/auth/me) and writes (checked against /api/auth/verify) are both refused.
      const refused = [await seller.get(`${api}/gardens`), await seller.get(`${api}/gardens/${garden.id}`),
        await seller.post(`${api}/gardens`, { data: { name: 'E2E shop account' } })];
      for (const response of refused) {
        expect(response.status()).toBe(403);
        expect(await response.json()).toEqual({ status: 403, code: 'BUYER_ACCOUNT_REQUIRED', message: 'Canvas は購入者のアカウントで使えます。' });
      }
      // The EC seller's product form still assembles plant models through Canvas.
      expect((await seller.post(`${api}/model-assemblies/resolve`, { data: profile })).status()).toBe(200);
    }
    prepareMember(sellerId(), 'ADMIN');
    await sellerPage.goto('/');
    await expect(sellerPage.getByRole('heading', { name: '保存した庭', exact: true })).toBeVisible();
    await expect(sellerPage.getByTestId('buyer-only')).toHaveCount(0);
    expect((await seller.get(`${api}/gardens`)).status()).toBe(200);
    // The buyer's garden is unchanged by the refused requests and still reads normally after reload.
    const stored = await request.get(`${api}/gardens/${garden.id}`);
    expect(stored.status()).toBe(200);
    expect(await stored.json()).toEqual(garden);
    await writeFile(`${evidence}/buyer-garden.json`, JSON.stringify(await stored.json(), null, 2));
  } finally {
    prepareMember(sellerId(), 'SELLER');
    if (/^[a-f0-9-]{36}$/.test(owner)) ecSql(`UPDATE organizations SET owner_member_id='${owner}' WHERE id=1;`);
    await request.delete(`${api}/gardens/${garden.id}`);
  }
});

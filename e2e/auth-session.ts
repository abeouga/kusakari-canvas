import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect, request } from '@playwright/test';

// Real Cognito through the EC login. The password is typed only here, never in a traced test.
export const authStatePath = resolve('artifacts/e2e/full-suite/.auth/test-seller.json');
const email = 'test.seller@example.com';

function ecWeb() {
  const url = process.env.KUSAKARI_EC_E2E_WEB_URL;
  if (!url) throw new Error('Run via npm run test:e2e -- --config e2e/configs/playwright.full.config.ts');
  return url;
}

function testPassword() {
  const file = readFileSync(resolve('../kusakari-terraform/.env.test-accounts'), 'utf8');
  const password = file.match(/^KUSAKARI_TEST_PASSWORD=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, '');
  if (!password) throw new Error('Test credentials are not configured.');
  return password;
}

// Only the dedicated EC E2E database is changed, as in the EC business fixtures.
function ecSql(statement: string) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { sql } from './e2e/database.js'; sql(process.argv[1]);", statement], {
    cwd: resolve(process.env.KUSAKARI_EC_DIRECTORY || '../kusakari-ec'), encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error('Test seller fixture failed: ' + result.stderr);
}

function memberId(id = process.env.KUSAKARI_E2E_MEMBER_ID) {
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid member id.');
  return id;
}

// Each test starts with an empty cart. A member has exactly one cart, so its lines are removed instead of the cart.
export function detachTestSellerCart() {
  ecSql(`DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE member_id='${memberId()}');`);
}

export async function signInTestSeller() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${ecWeb()}/account/login`);
    await page.getByLabel('メールアドレス', { exact: true }).fill(email);
    await page.getByLabel('パスワード', { exact: true }).fill(testPassword());
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await expect(page).toHaveURL(`${ecWeb()}/`);
    const member = await page.request.get(`${ecWeb()}/api/auth/me`).then((r) => r.json());
    expect(member.authenticated).toBe(true);
    process.env.KUSAKARI_E2E_MEMBER_ID = memberId(member.id);
    // The test seller runs sample store 1 as a staff account with the MANAGER role (it may register products).
    // The foreign keys accept an owner only as SHOP_OWNER and a staff row only as SHOP_STAFF, so old ties go first.
    ecSql(`UPDATE organizations SET owner_member_id=NULL WHERE owner_member_id='${memberId()}';
      DELETE FROM organization_members WHERE member_id='${memberId()}';
      UPDATE members SET account_type='SHOP_STAFF',enabled=TRUE,withdrawn_at=NULL WHERE id='${memberId()}';
      INSERT INTO organization_members(organization_id,member_id) VALUES(1,'${memberId()}');
      INSERT INTO store_members(store_id,member_id,organization_id,role) VALUES(1,'${memberId()}',1,'MANAGER');`);
    // Products created at store 1 by earlier runs are marked deleted, as a seller's delete does, so the catalog
    // that every editor load fetches does not grow with each run. Seed products have short ids and are kept;
    // products registered through the API have UUID ids.
    ecSql(`UPDATE inventory i JOIN products p ON p.id=i.product_id SET i.publication_status='DELETED'
      WHERE p.store_id=1 AND p.id REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-' AND i.publication_status<>'DELETED';`);
    await page.context().storageState({ path: authStatePath });
  } finally {
    await browser.close();
  }
}

// Ends the session so cookies left in failure traces cannot be reused.
export async function signOutTestSeller() {
  try {
    const context = await request.newContext({ storageState: authStatePath });
    const csrf = await context.get(`${ecWeb()}/api/auth/csrf`).then((r) => r.json());
    await context.post(`${ecWeb()}/api/auth/logout`, { headers: { [csrf.headerName]: csrf.token } });
    await context.dispose();
  } finally {
    rmSync(authStatePath, { force: true });
  }
}

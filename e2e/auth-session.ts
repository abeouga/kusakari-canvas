import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect, request } from '@playwright/test';

// Real Cognito through the EC login. The password is typed only here, never in a traced test.
// Canvas is a buyer feature, so every test runs as the buyer. The seller session only registers the test products.
export const authStatePath = resolve('artifacts/e2e/full-suite/.auth/test-buyer.json');
export const sellerStatePath = resolve('artifacts/e2e/full-suite/.auth/test-seller.json');
const buyerEmail = 'test.user@example.com';
const sellerEmail = 'test.seller@example.com';

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
export function ecSql(statement: string) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { sql } from './e2e/database.js'; console.log(sql(process.argv[1]));", statement], {
    cwd: resolve(process.env.KUSAKARI_EC_DIRECTORY || '../kusakari-ec'), encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error('Test account fixture failed: ' + result.stderr);
  return result.stdout.trim();
}

function memberId(id: string | undefined) {
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid member id.');
  return id;
}

export const buyerId = () => memberId(process.env.KUSAKARI_E2E_MEMBER_ID);
export const sellerId = () => memberId(process.env.KUSAKARI_E2E_SELLER_ID);

export type AccountType = 'USER' | 'ADMIN' | 'SELLER' | 'SHOP_OWNER' | 'SHOP_OWNER_APPLICANT';
const accountTypes: Record<AccountType, string> = {
  USER: 'USER', ADMIN: 'ADMIN', SELLER: 'SHOP_STAFF', SHOP_OWNER: 'SHOP_OWNER', SHOP_OWNER_APPLICANT: 'SHOP_OWNER_APPLICANT',
};

// The same statements as prepareMember in the EC e2e/business-helpers.js. 'SELLER' runs sample store 1 as a staff
// account with the MANAGER role. The foreign keys accept an owner only as SHOP_OWNER and a staff row only as
// SHOP_STAFF, so the old ties go first and the new ones are added after the account type changes.
export function prepareMember(id: string, type: AccountType) {
  memberId(id);
  const ties: Partial<Record<AccountType, string>> = {
    SELLER: `INSERT INTO organization_members(organization_id,member_id) VALUES(1,'${id}');
      INSERT INTO store_members(store_id,member_id,organization_id,role) VALUES(1,'${id}',1,'MANAGER');`,
    SHOP_OWNER: `UPDATE organizations SET owner_member_id='${id}' WHERE id=1;`,
    SHOP_OWNER_APPLICANT: `DELETE FROM organization_applications WHERE applicant_member_id='${id}';`,
  };
  ecSql(`UPDATE organizations SET owner_member_id=NULL WHERE owner_member_id='${id}';
    DELETE FROM organization_members WHERE member_id='${id}';
    UPDATE members SET account_type='${accountTypes[type]}',enabled=TRUE,withdrawn_at=NULL WHERE id='${id}';
    ${ties[type] || ''}
    DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE member_id='${id}');`);
}

// Each test starts with an empty cart. A member has exactly one cart, so its lines are removed instead of the cart.
export function detachTestBuyerCart() {
  ecSql(`DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE member_id='${buyerId()}');`);
}

async function signIn(email: string, path: string) {
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
    await page.context().storageState({ path });
    return memberId(member.id);
  } finally {
    await browser.close();
  }
}

export async function signInTestAccounts() {
  process.env.KUSAKARI_E2E_MEMBER_ID = await signIn(buyerEmail, authStatePath);
  prepareMember(buyerId(), 'USER');
  process.env.KUSAKARI_E2E_SELLER_ID = await signIn(sellerEmail, sellerStatePath);
  prepareMember(sellerId(), 'SELLER');
  // Products created at store 1 by earlier runs are marked deleted, as a seller's delete does, so the catalog
  // that every editor load fetches does not grow with each run. Seed products have short ids and are kept;
  // products registered through the API have UUID ids.
  ecSql(`UPDATE inventory i JOIN products p ON p.id=i.product_id SET i.publication_status='DELETED'
    WHERE p.store_id=1 AND p.id REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-' AND i.publication_status<>'DELETED';`);
}

// Ends the sessions so cookies left in failure traces cannot be reused.
export async function signOutTestAccounts() {
  const failures: unknown[] = [];
  for (const path of [authStatePath, sellerStatePath]) {
    try {
      const context = await request.newContext({ storageState: path });
      const csrf = await context.get(`${ecWeb()}/api/auth/csrf`).then((r) => r.json());
      await context.post(`${ecWeb()}/api/auth/logout`, { headers: { [csrf.headerName]: csrf.token } });
      await context.dispose();
    } catch (error) {
      failures.push(error); // The other session is still ended.
    } finally {
      rmSync(path, { force: true });
    }
  }
  if (failures.length) throw failures[0];
}

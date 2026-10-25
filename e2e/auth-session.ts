import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect, request } from '@playwright/test';

// Real Cognito through the EC login. The password is typed only here, never in a traced test.
export const authStatePath = resolve('artifacts/e2e/full-suite/.auth/test-seller.json');
const email = 'test.seller@example.com';

function ecWeb() {
  const url = process.env.KUSAKARI_EC_E2E_WEB_URL;
  if (!url) throw new Error('Run via npm run test:e2e -- --config playwright.full.config.ts');
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

// Each test starts with a new member cart, as separate guest carts did before sign-in was required.
export function detachTestSellerCart() {
  ecSql(`UPDATE carts SET member_id=NULL WHERE member_id='${memberId()}';`);
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
    ecSql(`UPDATE auth_members SET role='SELLER',store_id=1,enabled=TRUE,withdrawn_at=NULL WHERE id='${memberId()}';`);
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

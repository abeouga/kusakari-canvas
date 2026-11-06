import { expect, type Page } from './test.js';

/** 庭一覧の最後にある点線カードから庭を作成し、開いた編集画面の庭IDを返します。 */
export async function createGardenFromList(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: '新しい庭をつくる', exact: true }).click();
  await page.waitForURL(/\/gardens\//);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  if (!id) throw new Error('作成後に庭IDを取得できませんでした。');
  return id;
}

/** 編集画面の「庭の名前を変更」から名前を変更し、保存されるまで待ちます。 */
export async function renameGardenInEditor(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '庭の名前を変更', exact: true }).click();
  await page.getByRole('textbox', { name: '庭の名前', exact: true }).fill(name);
  await page.getByRole('button', { name: '名前を確定', exact: true }).click();
  await expect(page.locator('h1')).toHaveText(name);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
}

import { expect, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';

// The EC product wizard: 商品情報 → 画像 → 庭オブジェクト → 確認. The product number is assigned by the server, the
// plant height is entered in the garden step, and the preview follows the inputs without a button (EC #46, #49-#52).
export async function openPlantSettings(form: Locator, height: string) {
  await form.getByRole('button', { name: '次へ', exact: true }).click();
  await form.getByLabel('商品画像を追加', { exact: true }).setInputFiles(resolve('e2e/fixtures/ai-quality/boxwood.jpg'));
  await expect(form.getByAltText('商品画像1', { exact: true })).toBeVisible();
  await expect(form.getByLabel('商品画像を追加', { exact: true })).toBeEnabled();
  await form.getByRole('button', { name: '次へ', exact: true }).click();
  const garden = form.getByRole('region', { name: '庭オブジェクト', exact: true });
  await garden.getByLabel('植物の高さ', { exact: true }).fill(height);
  return garden;
}

// Opens the folded 「細かい調整」 of both the stem and the leaf groups.
export async function openFineTuning(form: Locator) {
  for (const details of await form.locator('details.plant-fine-tuning').all()) {
    if (await details.getAttribute('open') === null) await details.locator('summary').click();
  }
}

// Switches a fine-tuning control between automatic and manual.
export async function setManual(form: Locator, label: string, manual: boolean) {
  await form.getByRole('radiogroup', { name: `${label}の設定方法`, exact: true })
    .getByRole('radio', { name: manual ? '手動' : '自動', exact: true }).check();
}

// The preview reloads after the inputs settle (about half a second); wait for that reload to finish.
export async function expectPreviewLoaded(page: Page, form: Locator) {
  await page.waitForTimeout(1000);
  await expect(form.locator('iframe[title="植物の3Dプレビュー（更新中）"]')).toHaveCount(0, { timeout: 60000 });
  await form.locator('iframe[title="植物の3Dプレビュー"]').scrollIntoViewIfNeeded();
  await expect(page.frameLocator('iframe[title="植物の3Dプレビュー"]').getByTestId('preview-loaded'))
    .toHaveText('loaded', { timeout: 60000 });
}

export async function publishProduct(form: Locator) {
  await form.getByRole('button', { name: '次へ', exact: true }).click();
  await form.getByRole('button', { name: '出品する', exact: true }).click();
}

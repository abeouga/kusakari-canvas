import { expect, type Locator } from '@playwright/test';
import { resolve } from 'node:path';

export async function openPlantSettings(form: Locator, height: string) {
  await form.locator('.product-options').filter({ hasText: 'サイズ' }).locator('summary').click();
  await form.locator('[name="heightCm"]').fill(height);
  await form.getByLabel('商品画像を追加', { exact: true }).setInputFiles(resolve('e2e/fixtures/ai-quality/boxwood.jpg'));
  await expect(form.getByAltText('商品画像1', { exact: true })).toBeVisible();
  await form.getByRole('button', { name: '次へ', exact: true }).click();
  await form.getByLabel('この植物を庭に配置できるようにする', { exact: true }).check();
  await form.locator('.model-details > summary').click();
}

export async function publishProduct(form: Locator) {
  await form.getByRole('button', { name: '次へ', exact: true }).click();
  await form.getByRole('button', { name: '出品する', exact: true }).click();
}

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { imageBytes, type QualityCase, type QualityPayload } from './ai-quality-helpers.js';

// Compare the actual browser request before allowing the real generation POST to continue.
export async function verifyFixedInputs(payload: QualityPayload, name: QualityCase, baselineRun: string) {
  const directory = resolve('artifacts/e2e/ai-quality', baselineRun, name);
  const baseline = JSON.parse(await readFile(resolve(directory, 'request.json'), 'utf8'));
  const snapshot = JSON.parse(await readFile(resolve(directory, 'snapshot.json'), 'utf8'));
  expect(payload.document.photo).toEqual(snapshot.photo);
  expect(payload.document.width).toBe(snapshot.width);
  expect(payload.document.depth).toBe(snapshot.depth);
  expect(payload.document.objects).toEqual(snapshot.objects);
  expect(payload.layout).toEqual(baseline.layout);
  expect(payload.storeId).toBe(baseline.storeId);
  expect(imageBytes(payload.beforeDataUrl).equals(await readFile(resolve(directory, 'before.png')))).toBe(true);
  expect(imageBytes(payload.coverageDataUrl).equals(await readFile(resolve(directory, 'coverage.png')))).toBe(true);
  const references = baseline.inputOrder.filter((item: { kind: string }) => item.kind === 'uploaded-reference');
  expect(payload.references).toHaveLength(references.length);
  for (const [index, item] of payload.references.entries()) {
    const frozen = references[index];
    expect(item.assetId).toBe(frozen.assetId);
    expect(item.productId).toBe(frozen.productId);
    expect(imageBytes(item.photoDataUrl).equals(await readFile(resolve(directory, frozen.file)))).toBe(true);
  }
}

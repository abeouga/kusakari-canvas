import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect } from '@playwright/test';
import { imageBytes, saveJson } from './ai-quality-helpers.js';

export async function verifyProviderEvidence(directory: string, generationId: string, after: string) {
  const root = process.env.KUSAKARI_CANVAS_AI_EVIDENCE_DIR;
  expect(root, 'Paid evaluation requires an explicit evidence directory.').toBeTruthy();
  const evidence = resolve(root!, generationId);
  const raw = await readFile(resolve(evidence, 'provider.png'));
  const savedAfter = await readFile(resolve(evidence, 'after.png'));
  const metadata = JSON.parse(await readFile(resolve(evidence, 'metadata.json'), 'utf8'));
  const prompt = await readFile(resolve(evidence, 'prompt.txt'), 'utf8');
  const expectedMask = process.env.KUSAKARI_CANVAS_AI_MASKLESS !== '1';
  expect(metadata.maskSent).toBe(expectedMask);
  if (expectedMask) {
    const mask = await readFile(resolve(evidence, 'mask.png'));
    expect(mask.length).toBeGreaterThan(0);
  } else {
    expect(await readdir(evidence)).not.toContain('mask.png');
  }
  expect(prompt).toContain('Image 1 is the output canvas');
  expect(metadata.generationId).toBe(generationId);
  expect(metadata.generationMethod).toBe('full_frame_v3');
  expect(metadata.promptVersion).toBe(process.env.KUSAKARI_CANVAS_AI_EVAL_PROMPT_VERSION ?? 'scene_layout_v1');
  expect(metadata.maskMarginPx).toBe(Number(process.env.KUSAKARI_CANVAS_AI_EVAL_MASK_MARGIN_PX ?? '8'));
  const planPath = process.env.KUSAKARI_CANVAS_AI_EVAL_PLAN;
  if (planPath) {
    const plan = JSON.parse(await readFile(planPath, 'utf8'));
    expect(metadata.promptVersion).toBe(plan.promptVersion ?? 'scene_layout_v1');
    expect(metadata.promptSha256).toBe(plan.promptSha256);
  }
  expect(metadata.quality).toBe(process.env.KUSAKARI_CANVAS_AI_EVAL_QUALITY ?? 'medium');
  expect(metadata.promptSha256).toBe(createHash('sha256').update(prompt).digest('hex'));
  expect(metadata.providerSha256).toBe(createHash('sha256').update(raw).digest('hex'));
  expect(metadata.afterSha256).toBe(createHash('sha256').update(savedAfter).digest('hex'));
  expect(savedAfter.equals(imageBytes(after))).toBe(true);
  // Verify provider bytes and pixels offline; browser resampling is not a byte oracle.
  const python = resolve('backend/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const comparison = JSON.parse(execFileSync(python, ['-m', 'verification.compare_provider_frame', evidence],
    { cwd: resolve('backend'), encoding: 'utf8' }));
  await saveJson(directory, 'provider-comparison.json', { evidence, ...comparison, finalPngBytesMatch: true });
  expect(comparison.mismatchedPixels).toBe(0);
  expect(comparison.transparentPixels).toBe(0);
  expect([comparison.width, comparison.height]).toEqual(metadata.providerSize);
  return comparison;
}

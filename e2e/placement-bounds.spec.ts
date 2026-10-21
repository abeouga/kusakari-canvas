import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import type { GardenDocument } from '../frontend/src/types/garden';
import { mkdir, writeFile } from 'node:fs/promises';
import { Vector3 } from 'three';
import { api } from './api-url';
import { syntheticPhoto, createScene, openScene, readGarden, shrub } from './occlusion-helpers';
import { createPhotoCamera } from '../frontend/src/three/photoCamera.js';

function database(id:string, legacy=false) {
  const python=resolve('backend/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  return JSON.parse(execFileSync(python,['-m','verification.placement_fixture',id,...(legacy?['--legacy']:[])],
    {cwd:resolve('backend'),encoding:'utf8'}));
}
async function nameFixture(request:APIRequestContext, garden:GardenDocument):Promise<GardenDocument> {
  const saved=await request.put(`${api}/gardens/${garden.id}`,{data:{...garden,name:`E2E placement ${garden.id}`}});
  expect(saved.status()).toBe(200);
  return saved.json();
}
const directory = 'artifacts/e2e/placement-bounds';
test('concave construction boundary rejects API bypass and UI edits, then persists valid anchors', async ({ page, request }) => {
  await page.goto('/');
  const photo = await syntheticPhoto(page);
  // Ground outline: [-5,4], [5,4], [5,0], [0,0], [0,-4], [-5,-4].
  photo.boundary = [{x:.1,y:.9},{x:.9,y:.9},{x:.9,y:.5},{x:.5,y:.5},{x:.5,y:.1},{x:.1,y:.1}];
  let garden = await createScene(request, [], photo, [shrub(-1, -1)]);
  garden = await nameFixture(request,garden);
  const beforeDB = database(garden.id);
  for (const [x,z] of [[1,-1],[0.00001,-1],[5.00001,2]]) {
    const invalid = structuredClone(garden);
    invalid.objects[0].position = {x,y:0,z};
    const rejected = await request.put(`${api}/gardens/${garden.id}`, {data:invalid});
    expect(rejected.status()).toBe(400);
    expect((await rejected.json()).code).toBe('OBJECT_POSITION_OUT_OF_BOUNDS');
    expect(await readGarden(request, garden.id)).toEqual(garden);
    expect(database(garden.id)).toEqual(beforeDB);
  }
  for (const [x,z] of [[0,-1],[0,0],[5,4],[-5,-4],[-1,-1]]) {
    const next = structuredClone(garden);
    next.objects[0].position = {x,y:0,z};
    const saved = await request.put(`${api}/gardens/${garden.id}`, {data:next});
    expect(saved.status(), await saved.text()).toBe(200);
    garden = await saved.json();
  }
  await openScene(page, garden);
  await page.getByTestId('object-details-toggle').click();
  await page.getByTestId('position-x').fill('1');
  await expect(page.getByTestId('position-x')).toHaveValue('-1');
  await page.getByTestId('position-x').fill('0');
  await expect.poll(async () => (await readGarden(request, garden.id)).objects[0].position.x).toBe(0);
  await page.getByRole('button', {name:'複製', exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('複製先が施工範囲外');
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await page.getByTestId('uniform-scale').fill('3');
  await page.getByTestId('rotation-y').fill('45');
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await page.reload();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await mkdir(directory,{recursive:true});
  await page.screenshot({path:`${directory}/concave-reloaded.png`,fullPage:true});
  await writeFile(`${directory}/concave.json`,JSON.stringify(await readGarden(request,garden.id),null,2));
});

test('photo drag stops at its last valid anchor instead of accepting a concave cutout', async ({page,request}) => {
  await page.goto('/');
  const photo = await syntheticPhoto(page);
  photo.boundary = [{x:.1,y:.9},{x:.9,y:.9},{x:.9,y:.5},{x:.5,y:.5},{x:.5,y:.1},{x:.1,y:.1}];
  const garden = await createScene(request, [], photo, [shrub(-2,-1)]);
  await openScene(page,garden);
  const camera = createPhotoCamera(garden.photo!,garden.width,garden.depth)!;
  const box = (await page.getByTestId('photo-model-canvas').locator('canvas').boundingBox())!;
  const pixel = (x:number,y:number,z:number) => {
    const p = new Vector3(x,y,z).project(camera);
    return {x:box.x+(p.x+1)*box.width/2,y:box.y+(1-p.y)*box.height/2};
  };
  const start=pixel(-2,.8,-1), end=pixel(2,.8,-1);
  await page.mouse.move(start.x,start.y); await page.mouse.down();
  await page.mouse.move(end.x,end.y,{steps:40}); await page.mouse.up();
  await expect.poll(async()=> (await readGarden(request,garden.id)).objects[0].position.x).toBeGreaterThan(-2);
  const saved = await readGarden(request,garden.id);
  expect(saved.objects[0].position.x).toBeLessThanOrEqual(1e-6);
  await page.reload();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await mkdir(directory,{recursive:true});
  await page.screenshot({path:`${directory}/drag-reloaded.png`,fullPage:true});
  await writeFile(`${directory}/drag.json`,JSON.stringify(saved,null,2));
});


test('legacy invalid anchors remain readable and repair resumes autosave without migrating data', async ({page,request}) => {
  await page.goto('/');
  const photo=await syntheticPhoto(page);
  photo.boundary=[{x:.1,y:.9},{x:.9,y:.9},{x:.9,y:.5},{x:.5,y:.5},{x:.5,y:.1},{x:.1,y:.1}];
  let garden=await createScene(request,[],photo,[shrub(-1,-1)]);
  garden=await nameFixture(request,garden);
  database(garden.id,true);
  garden=await readGarden(request,garden.id);
  await openScene(page,garden);
  await expect(page.getByTestId('outside-placements')).toContainText('1個');
  await expect(page.getByTestId('save-status')).toHaveText('施工範囲の修正が必要');
  await page.getByTestId('outside-placements').getByRole('button').click();
  await page.getByTestId('object-details-toggle').click();
  await page.getByTestId('position-x').fill('-1');
  await expect(page.getByTestId('outside-placements')).toHaveCount(0);
  await expect.poll(async()=> (await readGarden(request,garden.id)).revision).toBe(garden.revision+1);
  await page.reload();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await expect(page.getByTestId('outside-placements')).toHaveCount(0);
  await mkdir(directory,{recursive:true});
  await page.screenshot({path:`${directory}/legacy-repaired.png`,fullPage:true});
  await writeFile(`${directory}/legacy-repaired.json`,JSON.stringify({garden:await readGarden(request,garden.id),database:database(garden.id)},null,2));
});


test('redrawing a smaller boundary pauses persistence until the excluded placement is deleted', async ({page,request}) => {
  await page.goto('/');
  const photo=await syntheticPhoto(page);
  const garden=await createScene(request,[],photo,[shrub(2,-1)]);
  await openScene(page,garden);
  await page.getByRole('button',{name:'輪郭と寸法'}).click();
  await page.getByRole('button',{name:'庭の領域を書き直す'}).click();
  for (const [x,y] of [[.1,.9],[.9,.9],[.9,.5],[.5,.5],[.5,.1],[.1,.1]]) {
    const point=await page.locator('.photo-stage').evaluate((element,p)=>{
      const q=new DOMPoint(p.x*1200,p.y*800).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
      return {x:q.x,y:q.y};
    },{x,y});
    await page.mouse.click(point.x,point.y);
  }
  await page.getByRole('button',{name:'始点につないで輪郭を確定',exact:true}).click();
  await expect(page.getByTestId('outside-placements')).toContainText('1個');
  await page.waitForTimeout(800); // Longer than autosave debounce: invalid snapshots must stay local.
  expect(await readGarden(request,garden.id)).toEqual(garden);
  await page.getByTestId('outside-placements').getByRole('button').click();
  await page.getByTestId('object-details-toggle').click();
  await page.getByRole('button',{name:'削除',exact:true}).click();
  await expect(page.getByTestId('outside-placements')).toHaveCount(0);
  await expect.poll(async()=> (await readGarden(request,garden.id)).objects.length).toBe(0);
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await mkdir(directory,{recursive:true});
  await page.screenshot({path:`${directory}/redrawn-repaired.png`,fullPage:true});
  await writeFile(`${directory}/redrawn-repaired.json`,JSON.stringify(await readGarden(request,garden.id),null,2));
});

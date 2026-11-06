import { test, expect } from './test.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { PerspectiveCamera, Vector3 } from 'three';
import { api } from './api-url';
import { syntheticPhoto, createScene, openScene, readGarden, shrub } from './occlusion-helpers';
import { createPhotoCamera } from '../frontend/src/three/photoCamera.js';
import { createTestProduct, showProductsTab } from './catalog-fixture';

const directory='artifacts/e2e/placement-bounds';
for (const mode of ['photo','3d']) test(`pointer drag and product drop reject the cutout (${mode})`, async ({page,request})=>{
  await page.goto('/');
  const photo=await syntheticPhoto(page);
  photo.boundary=[{x:.1,y:.9},{x:.9,y:.9},{x:.9,y:.5},{x:.5,y:.5},{x:.5,y:.1},{x:.1,y:.1}];
  const garden=await createScene(request,[],photo,[]);
  const product=await createTestProduct(request,`E2E placement ${mode}`);
  await openScene(page,garden);
  if(mode==='3d') {
    await page.getByRole('button',{name:'3D庭',exact:true}).click();
    await page.getByRole('button',{name:'上から見る',exact:true}).click();
  }
  const canvas=page.getByTestId(mode==='3d'?'garden-canvas':'photo-model-canvas').locator('canvas');
  const box=(await canvas.boundingBox())!;
  let camera=createPhotoCamera(photo,garden.width,garden.depth)!;
  if(mode==='3d') {
    camera=new PerspectiveCamera(42,box.width/box.height,.1,300);
    camera.up.set(0,0,-1); camera.position.set(0,36,.001); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
    await page.waitForTimeout(400); // Orbit controls settle after the explicit top-view command.
  }
  function pixel(x:number,z:number) {
    const p=new Vector3(x,0,z).project(camera);
    return {x:box.x+(p.x+1)*box.width/2,y:box.y+(1-p.y)*box.height/2};
  }
  await showProductsTab(page);
  const card=page.getByTestId(`browse-${product.id}`);
  // A product tile follows the pointer instead of the browser's ghost image and is gone after the drop.
  const tile=page.getByTestId('product-drag-tile');
  async function dragCard(point:{x:number,y:number}) {
    await card.hover({position:{x:35,y:35}}); await page.mouse.down();
    await page.mouse.move(point.x,point.y,{steps:8});
    await expect(tile).toContainText(product.name);
    await expect.poll(async()=>{ const at=(await tile.boundingBox())!; return Math.max(Math.abs(at.x+28-point.x),Math.abs(at.y+28-point.y)); }).toBeLessThan(2);
    await page.mouse.up();
    await expect(tile).toHaveCount(0);
  }
  const outside=pixel(2,-2),inside=pixel(-2,-2);
  await dragCard(outside);
  await expect(page.getByRole('alert')).toContainText('範囲内へドロップ');
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 0 / 0');
  await dragCard(inside);
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await expect.poll(async()=> (await readGarden(request,garden.id)).objects.length).toBe(1);
  const sidebar=(await page.getByRole('tab',{name:'商品一覧',exact:true}).boundingBox())!;
  await dragCard({x:sidebar.x+sidebar.width/2,y:sidebar.y+sidebar.height/2});
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  const transfer=await page.evaluateHandle((id)=>{
    const data=new DataTransfer(); data.setData('application/x-kusakari-product',`product:${id}`); return data;
  },product.id);
  await canvas.dispatchEvent('drop',{dataTransfer:transfer,clientX:outside.x,clientY:outside.y});
  await expect(page.getByRole('alert')).toContainText('範囲内へドロップ');
  expect((await readGarden(request,garden.id)).objects).toHaveLength(1);
  const second=pixel(-3,2);
  await canvas.dispatchEvent('drop',{dataTransfer:transfer,clientX:second.x,clientY:second.y});
  await expect.poll(async()=> (await readGarden(request,garden.id)).objects.length).toBe(2);
  await transfer.dispose();
  await page.reload();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 2 / 2');
  if(mode==='3d') await page.getByRole('button',{name:'3D庭',exact:true}).click();
  await mkdir(directory,{recursive:true});
  await page.screenshot({path:`${directory}/entrypoints-${mode}.png`,fullPage:true});
  await writeFile(`${directory}/entrypoints-${mode}.json`,JSON.stringify(await readGarden(request,garden.id),null,2));
});

for (const mode of ['rectangle','legacy','calibrated']) test(`API validates boundary edges and just-outside points (${mode})`,async({page,request})=>{
  await page.goto('/');
  const photo=await syntheticPhoto(page,1000,750);
  if(mode==='legacy') delete photo.projectionSize;
  if(mode==='calibrated') {
    const camera=new PerspectiveCamera(50,4/3,.01,1000);
    camera.position.set(5,8,13); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
    photo.corners=[[-5,4],[5,4],[5,-4],[-5,-4]].map(([x,z])=>{
      const p=new Vector3(x,0,z).project(camera);return {x:(p.x+1)/2,y:(1-p.y)/2};
    });
    photo.boundary=photo.corners;
    const calibration=await request.post(`${api}/photo-calibration`,{data:{imageWidth:1000,imageHeight:750,
      points:photo.corners,referenceWidth:10,referenceDepth:8}});
    expect(calibration.status()).toBe(200); photo.calibration=await calibration.json();
  }
  const initial=await request.post(`${api}/gardens`,{data:{name:`E2E placement ${mode}`,width:10,depth:8}});
  let garden=await initial.json();
  const first=await request.put(`${api}/gardens/${garden.id}`,{data:{...garden,photo:mode==='rectangle'?null:photo,objects:[shrub(0,0)]}});
  expect(first.status(),await first.text()).toBe(200);garden=await first.json();
  for(const [x,z] of [[5,0],[5,4],[-5,-4],[0,0]]) {
    const next=structuredClone(garden);next.objects[0].position={x,y:0,z};
    const result=await request.put(`${api}/gardens/${garden.id}`,{data:next});
    expect(result.status(),await result.text()).toBe(200);garden=await result.json();
  }
  const invalid=structuredClone(garden);invalid.objects[0].position.x=5.00001;
  const refused=await request.put(`${api}/gardens/${garden.id}`,{data:invalid});
  expect(refused.status()).toBe(400);expect(await readGarden(request,garden.id)).toEqual(garden);
  await page.goto(`/gardens/${garden.id}`);
  if(mode==='rectangle') await page.getByRole('button',{name:'3D庭',exact:true}).click();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await page.reload();
  if(mode==='rectangle') await page.getByRole('button',{name:'3D庭',exact:true}).click();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await mkdir(directory,{recursive:true});
  await page.screenshot({path:`${directory}/api-${mode}.png`,fullPage:true});
  await writeFile(`${directory}/api-${mode}.json`,JSON.stringify(garden,null,2));
});

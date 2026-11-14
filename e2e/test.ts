import { test as base, type APIRequestContext, type Page } from '@playwright/test';
import { detachTestBuyerCart, sellerStatePath } from './auth-session.js';
import { sellerRequest, withCsrf } from './seller-session.js';

export * from '@playwright/test';

// `page`, `context` and `request` are the buyer, who uses Canvas and the cart. `seller` and `sellerPage` are the
// store 1 MANAGER, who registers, changes and deletes the test products in the EC.
export const test = base.extend<{ freshCart: void, seller: APIRequestContext, sellerPage: Page }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures require a destructured first argument.
  freshCart: [async ({}, use) => {
    if (process.env.KUSAKARI_E2E_MEMBER_ID) detachTestBuyerCart();
    await use();
  }, { auto: true }],
  context: async ({ context }, use) => {
    withCsrf(context.request);
    await use(context);
  },
  request: async ({ request }, use) => {
    withCsrf(request);
    await use(request);
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures require a destructured first argument.
  seller: async ({}, use) => {
    await use(await sellerRequest());
  },
  sellerPage: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({ storageState: sellerStatePath, baseURL, viewport: { width: 1440, height: 960 } });
    withCsrf(context.request);
    await use(await context.newPage());
    await context.close();
  },
});

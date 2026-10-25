import { test as base, type APIRequestContext } from '@playwright/test';
import { detachTestSellerCart } from './auth-session.js';

export * from '@playwright/test';

const patched = new WeakSet<APIRequestContext>();

// Direct API writes carry the EC session's CSRF token, as the Canvas UI does. Browser traffic is untouched.
function withCsrf(context: APIRequestContext) {
  const ec = process.env.KUSAKARI_EC_E2E_WEB_URL;
  if (!ec || patched.has(context)) return;
  patched.add(context);
  const fetch = context.fetch.bind(context);
  context.fetch = async (urlOrRequest, options = {}) => {
    const method = (options.method ?? 'GET').toUpperCase();
    if (typeof urlOrRequest !== 'string' || method === 'GET' || method === 'HEAD') return fetch(urlOrRequest, options);
    const csrf = await fetch(`${ec}/api/auth/csrf`).then((r) => r.json());
    return fetch(urlOrRequest, { ...options, headers: { [csrf.headerName]: csrf.token, ...options.headers } });
  };
}

export const test = base.extend<{ freshCart: void }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures require a destructured first argument.
  freshCart: [async ({}, use) => {
    if (process.env.KUSAKARI_E2E_MEMBER_ID) detachTestSellerCart();
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
});

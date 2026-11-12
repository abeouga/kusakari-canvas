import { request, type APIRequestContext } from '@playwright/test';
import { sellerStatePath } from './auth-session.js';

const patched = new WeakSet<APIRequestContext>();

// Direct API writes carry the EC session's CSRF token, as the Canvas UI does. Browser traffic is untouched.
export function withCsrf(context: APIRequestContext) {
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

let seller: Promise<APIRequestContext> | undefined;

// The store 1 MANAGER registers, changes and deletes the test products in the EC. A shop account cannot use Canvas
// or a cart, so the buyer session (`page`, `request`) does everything else. One context serves the worker.
export function sellerRequest() {
  seller ??= request.newContext({ storageState: sellerStatePath }).then((context) => { withCsrf(context); return context; });
  return seller;
}

import { signOutTestAccounts } from './auth-session.js';

export default async function teardown() {
  await signOutTestAccounts();
}

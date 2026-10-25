import { signOutTestSeller } from './auth-session.js';

export default async function teardown() {
  await signOutTestSeller();
}

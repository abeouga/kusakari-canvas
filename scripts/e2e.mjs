import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const playwrightCli = resolve(root, 'node_modules', '@playwright', 'test', 'cli.js');

async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('E2E用のポートを取得できませんでした。');
  }

  const port = address.port;
  await new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
  return port;
}

async function getPorts() {
  const ports = new Set();
  while (ports.size < 4) ports.add(await getAvailablePort());
  const [apiPort, webPort, ecApiPort, ecWebPort] = [...ports];
  return { apiPort, webPort, ecApiPort, ecWebPort };
}

function runPlaywright(ports) {
  if (!existsSync(playwrightCli)) {
    throw new Error('Playwrightが見つかりません。先に npm ci を実行してください。');
  }

  const env = {
    ...process.env,
    KUSAKARI_CANVAS_E2E_API_PORT: String(ports.apiPort),
    KUSAKARI_CANVAS_E2E_WEB_PORT: String(ports.webPort),
    KUSAKARI_CANVAS_E2E_API_URL: `http://127.0.0.1:${ports.apiPort}`,
    KUSAKARI_EC_E2E_API_PORT: String(ports.ecApiPort),
    KUSAKARI_EC_E2E_WEB_PORT: String(ports.ecWebPort),
    KUSAKARI_EC_E2E_WEB_URL: `http://127.0.0.1:${ports.ecWebPort}`,
  };
  const child = spawn(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
    cwd: root,
    env,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    process.stderr.write(`Playwrightを起動できません: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

const ports = await getPorts();
runPlaywright(ports);

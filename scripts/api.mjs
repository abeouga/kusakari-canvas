import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const backend = resolve(root, 'backend');
function resolveProjectPath(value) {
  const expanded = value.replace(/%([^%]+)%/g, (match, name) => process.env[name] || match);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(root, expanded);
}

const configuredCanvasHome = process.env.KUSAKARI_CANVAS_HOME;
const canvasHome = configuredCanvasHome ? resolveProjectPath(configuredCanvasHome) :
  (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'KusakariCanvas') :
    process.platform === 'win32' ? join(homedir(), 'AppData', 'Local', 'KusakariCanvas') :
      join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'kusakari-canvas'));
const localUv = join(canvasHome, 'tools', 'uv', process.platform === 'win32' ? 'uv.exe' : 'uv');
const uvExecutable = process.env.KUSAKARI_CANVAS_UV || (existsSync(localUv) ? localUv : 'uv');
function findMySqlBin() {
  if (process.env.KUSAKARI_CANVAS_MYSQL_BIN) return resolveProjectPath(process.env.KUSAKARI_CANVAS_MYSQL_BIN);
  const statePath = join(canvasHome, 'mysql', 'instance.json');
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      if (typeof state.executable === 'string') {
        return resolve(state.executable, '..');
      }
    } catch (error) {
      process.stderr.write(`Kusakari Canvas MySQL設定を読み取れません: ${error.message}\n`);
      process.exit(1);
    }
  }
  if (process.platform === 'win32') {
    const pathEntries = (process.env.PATH || '').split(';');
    for (const candidate of pathEntries) {
      if (existsSync(join(candidate, 'mysqld.exe')) && existsSync(join(candidate, 'mysqldump.exe')) &&
          existsSync(join(candidate, 'mysql.exe'))) return candidate;
    }
    const programRoots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
    for (const programRoot of programRoots) {
      const mysqlRoot = join(programRoot, 'MySQL');
      if (!existsSync(mysqlRoot)) continue;
      for (const directory of readdirSync(mysqlRoot, { withFileTypes: true })) {
        if (!directory.isDirectory() || !directory.name.startsWith('MySQL Server ')) continue;
        const candidate = join(mysqlRoot, directory.name, 'bin');
        if (existsSync(join(candidate, 'mysqld.exe')) && existsSync(join(candidate, 'mysqldump.exe')) &&
            existsSync(join(candidate, 'mysql.exe'))) return candidate;
      }
    }
  }
  return '';
}
const mysqlBin = findMySqlBin();
if (mysqlBin) {
  const pathEntries = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
  if (!pathEntries.some((entry) => resolve(entry) === resolve(mysqlBin))) {
    process.env.PATH = `${mysqlBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}`;
  }
  process.env.KUSAKARI_CANVAS_MYSQL_BIN = mysqlBin;
}
const tasks = {
  dev: ['run', '--locked', '--project', backend, 'python', '-m', 'kusakari_canvas_api', 'serve'],
  migrate: ['run', '--locked', '--project', backend, 'python', '-m', 'kusakari_canvas_api', 'migrate'],
  compile: ['run', '--locked', '--project', backend, 'python', '-m', 'compileall', '-q', 'kusakari_canvas_api', 'alembic', 'verification'],
  lint: ['run', '--locked', '--project', backend, 'ruff', 'check', 'kusakari_canvas_api', 'alembic', 'verification'],
  verify: ['run', '--locked', '--project', backend, 'python', '-m', 'verification.verify_backend'],
  'verify-container': ['run', '--locked', '--project', backend, 'python', '-m', 'verification.serve_container'],
};
const task = process.argv[2];
if (!Object.hasOwn(tasks, task)) {
  process.stderr.write('Usage: node scripts/api.mjs <dev|migrate|compile|lint|verify|verify-container>\n');
  process.exit(2);
}
const child = spawn(uvExecutable, tasks[task], { cwd: backend, env: process.env, stdio: 'inherit' });
child.on('error', (error) => {
  process.stderr.write(`Python APIランナーを起動できません: ${error.message}\n`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });

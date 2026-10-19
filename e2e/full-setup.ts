import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Controlled pixels exercise the real image normalizer; no external AI request is made.
export default function setup() {
  const python = resolve('backend/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  execFileSync(python, ['-m', 'verification.verify_ai_frame', '--output-dir',
    resolve('artifacts/e2e/full-suite/pixels')], { cwd: resolve('backend'), stdio: 'pipe' });
}

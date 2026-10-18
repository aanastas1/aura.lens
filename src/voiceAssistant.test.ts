import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

it('stops speech and closes the answer bubble on tap', () => {
  const result = spawnSync(process.execPath, ['scripts/check-speech-dismiss.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
});

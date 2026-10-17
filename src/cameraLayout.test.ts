import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

describe('camera layout with notifications', () => {
  it('keeps the camera viewport fixed for short/long messages and fills live and frozen previews', () => {
    // Keep native/hook mocks isolated from the rest of the test suite.
    const result = spawnSync(process.execPath, ['scripts/check-camera-layout.mjs'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
  });
});

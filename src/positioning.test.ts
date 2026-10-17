import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoBanners } from './banners';
import {
  BANNER_DIMENSIONS, localOffset, offsetCoordinate, orientationQuaternion, projectBanner,
  reliableFix, rotate, smoothOrientation, type Fix,
} from './positioning';

import { GpsPosition } from './gpsPosition';

const origin = { latitude: 52.23, longitude: 21.01 };
const uprightNorth = orientationQuaternion({ alpha: 0, beta: Math.PI / 2, gamma: 0 });
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} != ${expected}`);
const fix = (east: number, north: number, timestamp: number, accuracy: number | null = 4): Fix => ({ ...offsetCoordinate(origin, east, north), accuracy, timestamp });

describe('camera orientation and projection', () => {
  it('maps an upright north-facing rear camera to north with world up', () => {
    const forward = rotate(uprightNorth, [0, 0, -1]);
    const up = rotate(uprightNorth, [0, 1, 0]);
    close(forward[0], 0); close(forward[1], 1); close(forward[2], 0);
    close(up[2], 1);
  });
  it('places an ahead banner at the centre and east to the right', () => {
    const ahead = projectBanner(origin, offsetCoordinate(origin, 0, 12), uprightNorth, 400, 800)!;
    close(ahead.x, 200); close(ahead.y, 400); close(ahead.roll, 0);
    const right = projectBanner(origin, offsetCoordinate(origin, 3, 12), uprightNorth, 400, 800)!;
    assert.ok(right.x > 200);
  });
  it('projects east ahead after turning east', () => {
    const east = orientationQuaternion({ alpha: -Math.PI / 2, beta: Math.PI / 2, gamma: 0 });
    const projected = projectBanner(origin, offsetCoordinate(origin, 12, 0), east, 400, 800)!;
    close(projected.x, 200); close(projected.y, 400);
  });
  it('moves the horizon down when the camera points up', () => {
    const up = orientationQuaternion({ alpha: 0, beta: Math.PI * 2 / 3, gamma: 0 });
    const projected = projectBanner(origin, offsetCoordinate(origin, 0, 12), up, 400, 800)!;
    assert.ok(projected.y > 400);
  });
  it('hides banners behind the user and outside the viewport', () => {
    assert.equal(projectBanner(origin, offsetCoordinate(origin, 0, -12), uprightNorth, 400, 800), null);
    assert.equal(projectBanner(origin, offsetCoordinate(origin, 100, 2), uprightNorth, 400, 800), null);
  });
  it('shows a moderate portrait banner at 12 metres', () => {
    const projected = projectBanner(origin, offsetCoordinate(origin, 0, 12), uprightNorth, 400, 800)!;
    const width = projected.scale * BANNER_DIMENSIONS.width;
    const height = projected.scale * BANNER_DIMENSIONS.height;
    assert.ok(width > 160 && width < 185);
    assert.ok(height > 300 && height < 330);
    close(height / width, 1.8);
  });
  it('keeps a portrait banner visible when only its lower edge intersects the camera viewport', () => {
    const downward = orientationQuaternion({ alpha: 0, beta: Math.PI / 3, gamma: 0 });
    const projected = projectBanner(origin, offsetCoordinate(origin, 0, 12), downward, 400, 200);
    assert.ok(projected);
    assert.ok(projected.y < 0);
    assert.ok(projected.y + projected.scale * BANNER_DIMENSIONS.height / 2 > 0);
  });
  it('doubles apparent size when distance halves', () => {
    const near = projectBanner(origin, offsetCoordinate(origin, 0, 6), uprightNorth, 400, 800)!;
    const far = projectBanner(origin, offsetCoordinate(origin, 0, 12), uprightNorth, 400, 800)!;
    close(near.scale, far.scale * 2);
  });
  it('smooths the short turn across the +/-180 degree boundary', () => {
    const current = orientationQuaternion({ alpha: Math.PI - 0.01, beta: Math.PI / 2, gamma: 0 });
    const target = orientationQuaternion({ alpha: -Math.PI + 0.01, beta: Math.PI / 2, gamma: 0 });
    const next = smoothOrientation(current, target, 0.05);
    const forward = rotate(next, [0, 0, -1]);
    assert.ok(forward[1] < -0.99);
    close(Math.hypot(...next), 1);
  });
  it('keeps equivalent opposite-sign quaternions stationary', () => {
    const next = smoothOrientation(uprightNorth, uprightNorth.map(n => -n) as typeof uprightNorth, 0.05);
    next.forEach((n, i) => close(n, uprightNorth[i]!));
  });
});

describe('geographic demo and stable GPS movement', () => {
  it('preserves metre offsets near Warsaw', () => {
    const offset = localOffset(origin, offsetCoordinate(origin, 14, -20));
    close(offset.east, 14); close(offset.north, -20);
  });
  it('places the first demo banner ahead of the initial camera heading', () => {
    const first = createDemoBanners(origin, 90)[0]!;
    const offset = localOffset(origin, first);
    close(offset.east, 12); close(offset.north, 0);
  });
  it('rejects stale, unknown-accuracy, poor and out-of-order GPS readings', () => {
    assert.equal(reliableFix(fix(0, 0, 1000), 8000), false);
    assert.equal(reliableFix(fix(0, 0, 8000, null), 8000), false);
    assert.equal(reliableFix(fix(0, 0, 8000, 40), 8000), false);
    const position = new GpsPosition();
    position.observeGps(fix(0, 0, 10000), 10000);
    assert.equal(position.observeGps(fix(20, 0, 9000), 10000), false);
  });
  it('keeps small GPS noise stationary', () => {
    const position = new GpsPosition();
    position.observeGps(fix(0, 0, 10000), 10000);
    for (const [i, east] of [1, -1, 1.5, -1.5].entries()) {
      const now = 11000 + i * 1000;
      position.observeGps(fix(east, 0, now), now);
      close(localOffset(origin, position.advance(0.1)!).east, 0);
    }
  });
  it('ignores an isolated GPS spike', () => {
    const position = new GpsPosition();
    position.observeGps(fix(0, 0, 10000), 10000);
    position.observeGps(fix(20, 0, 11000), 11000);
    position.observeGps(fix(0, 0, 12000), 12000);
    close(localOffset(origin, position.advance(0.1)!).east, 0);
  });
  it('smooths a confirmed GPS correction without snapping the phone position', () => {
    const position = new GpsPosition();
    position.observeGps(fix(0, 0, 10000), 10000);
    position.observeGps(fix(5, 0, 11000), 11000);
    position.observeGps(fix(6, 0, 12000), 12000);
    const first = localOffset(origin, position.advance(1 / 60)!);
    assert.ok(first.east > 0 && first.east <= 3 / 60 + 1e-6);
    for (let i = 0; i < 120; i++) position.advance(1 / 60);
    const moved = localOffset(origin, position.advance(0)!);
    assert.ok(moved.east > 0.3 && moved.east < 5.5);
  });
  it('caps movement even if a render is delayed', () => {
    const position = new GpsPosition();
    position.observeGps(fix(0, 0, 10000), 10000);
    position.observeGps(fix(8, 0, 11000), 11000);
    position.observeGps(fix(9, 0, 12000), 12000);
    const moved = localOffset(origin, position.advance(60)!);
    assert.ok(moved.east <= 0.3 + 1e-6);
  });
});

describe('smooth camera tracking', () => {
  it('responds to a sudden turn within 100 ms instead of slowly catching up', () => {
    const target = orientationQuaternion({ alpha: -Math.PI / 2, beta: Math.PI / 2, gamma: 0 });
    let current = uprightNorth;
    for (let i = 0; i < 6; i++) current = smoothOrientation(current, target, 1 / 60);
    const forward = rotate(current, [0, 0, -1]);
    const progress = Math.atan2(forward[0], forward[1]) / (Math.PI / 2);
    assert.ok(progress > 0.95);
  });
  it('ignores small hand tremors', () => {
    const tremor = orientationQuaternion({ alpha: 0.0015, beta: Math.PI / 2, gamma: 0 });
    assert.deepEqual(smoothOrientation(uprightNorth, tremor, 1 / 60), uprightNorth);
  });
  it('damps small sensor noise without making large turns sluggish', () => {
    const noise = orientationQuaternion({ alpha: -0.4 * Math.PI / 180, beta: Math.PI / 2, gamma: 0 });
    const next = smoothOrientation(uprightNorth, noise, 1 / 60);
    const forward = rotate(next, [0, 0, -1]);
    assert.ok(Math.atan2(forward[0], forward[1]) < 0.15 * Math.PI / 180);
  });
  it('settles promptly when a moving phone stops', () => {
    let current = uprightNorth;
    let target = uprightNorth;
    for (let i = 1; i <= 30; i++) {
      target = orientationQuaternion({ alpha: -i * 1.5 * Math.PI / 180, beta: Math.PI / 2, gamma: 0 });
      current = smoothOrientation(current, target, 1 / 60);
    }
    for (let i = 0; i < 9; i++) current = smoothOrientation(current, target, 1 / 60);
    const forward = rotate(current, [0, 0, -1]);
    const error = Math.PI / 4 - Math.atan2(forward[0], forward[1]);
    assert.ok(error >= 0 && error < 0.3 * Math.PI / 180);
  });
});

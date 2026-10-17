import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TENDUR_KEBAB } from '@/src/banners';
import {
  type CameraBasis,
  cameraHeading,
  compassCameraBasis,
  destination,
  localOffset,
  MARKER_DIMENSIONS,
  medianHeading,
  offsetCoordinate,
  projectWaypoint,
  reliableFix,
  smoothHeading,
  smoothSensor,
  type Vec3,
  waypointHud,
} from '@/src/positioning';

const origin = { latitude: 52.23, longitude: 21.01 };
const close = (actual: number, expected: number, tolerance = 0.0001) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const north = compassCameraBasis([0, 1, 0], [0, -45, -20], 0)!;
const dot = (a: Vec3, b: Vec3) => a.reduce((sum, value, i) => sum + value * b[i]!, 0);

function sensorSamples(heading: number, pitch = 0, roll = 0, declination = 0) {
  const h = (heading * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  const r = (roll * Math.PI) / 180;
  const d = (declination * Math.PI) / 180;
  const forward: Vec3 = [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)];
  const right: Vec3 = [Math.cos(h), -Math.sin(h), 0];
  const up: Vec3 = [-Math.sin(h) * Math.sin(p), -Math.cos(h) * Math.sin(p), Math.cos(p)];
  const rolledRight = right.map((v, i) => v * Math.cos(r) + up[i]! * Math.sin(r)) as Vec3;
  const rolledUp = up.map((v, i) => v * Math.cos(r) - right[i]! * Math.sin(r)) as Vec3;
  const magneticWorld: Vec3 = [20 * Math.sin(d), 20 * Math.cos(d), -45];
  return {
    gravity: [rolledRight[2], rolledUp[2], -forward[2]] as Vec3,
    magnetic: [
      dot(magneticWorld, rolledRight),
      dot(magneticWorld, rolledUp),
      -dot(magneticWorld, forward),
    ] as Vec3,
    expected: { right: rolledRight, up: rolledUp, forward } as CameraBasis,
  };
}

describe('compass and accelerometer camera orientation without a gyro', () => {
  it('uses rear camera -Z rather than the top edge of a vertical phone', () => {
    assert.deepEqual(north, { right: [1, 0, 0], up: [0, 0, 1], forward: [-0, 1, -0] });
    const east = compassCameraBasis([0, 1, 0], [-20, -45, 0], 0)!;
    close(east.forward[0], 1);
    close(east.forward[1], 0);
  });
  it('handles all compass directions, pitch, roll and magnetic declination', () => {
    for (const heading of [0, 45, 90, 180, 270, 359]) {
      for (const pitch of [-40, 0, 30]) {
        for (const roll of [-25, 0, 25]) {
          const sample = sensorSamples(heading, pitch, roll, 7);
          const actual = compassCameraBasis(sample.gravity, sample.magnetic, 7)!;
          for (const axis of ['right', 'up', 'forward'] as const) {
            actual[axis].forEach((v, i) => close(v, sample.expected[axis][i]!));
          }
        }
      }
    }
  });
  it('rejects free fall, missing fields and degenerate readings', () => {
    assert.equal(compassCameraBasis([0, 0, 0], [0, -45, -20], 0), null);
    assert.equal(compassCameraBasis([0, 1, 0], [0, 0, 0], 0), null);
    assert.equal(compassCameraBasis([0, 1, 0], [0, 45, 0], 0), null);
    assert.equal(compassCameraBasis([NaN, 1, 0], [0, -45, -20], 0), null);
  });
  it('accepts the real Pixel samples rejected during gentle movement', () => {
    const basis = compassCameraBasis(
      [-0.07492198758056225, 0.7685142848330715, 0.6188296881270384],
      [4.486693528286315, -29.18488210072598, -27.689274165718242],
      7.29150390625,
    );
    assert.ok(
      basis,
      'A valid sample must not be labelled compass interference just because its horizontal field is below 5 µT',
    );
  });
  it('filters sensor noise and follows a changed direction promptly', () => {
    let magnetic: Vec3 = [0, -45, -20];
    for (let i = 0; i < 6; i++) magnetic = smoothSensor(magnetic, [-20, -45, 0], 0.05);
    const basis = compassCameraBasis([0, 1, 0], magnetic, 0)!;
    assert.ok(basis.forward[0] > 0.99);
  });
});

describe('fixed Tendur Kebab destination and FPS marker', () => {
  it('keeps the exact requested coordinates independent of user position', () => {
    assert.equal(TENDUR_KEBAB.latitude, 52.2402694);
    assert.equal(TENDUR_KEBAB.longitude, 20.9815395);
    assert.ok(Object.isFrozen(TENDUR_KEBAB));
    const targetBefore = { ...TENDUR_KEBAB };
    projectWaypoint(origin, TENDUR_KEBAB, cameraHeading(north).heading, 400, 700);
    projectWaypoint(
      offsetCoordinate(origin, 20, 20),
      TENDUR_KEBAB,
      cameraHeading(north).heading,
      400,
      700,
    );
    assert.deepEqual(TENDUR_KEBAB, targetBefore);
  });
  it('calculates geographic bearings and distances for cardinal directions', () => {
    for (const [east, north, bearing] of [
      [0, 100, 0],
      [100, 0, 90],
      [0, -100, 180],
      [-100, 0, 270],
    ]) {
      const target = destination(origin, offsetCoordinate(origin, east!, north!));
      close(target.distance, 100, 0.01);
      close(target.bearing, bearing!, 0.01);
    }
  });
  it('centres the real destination when looking at it from the south', () => {
    const user = offsetCoordinate(TENDUR_KEBAB, 0, -100);
    const marker = projectWaypoint(user, TENDUR_KEBAB, cameraHeading(north).heading, 400, 700)!;
    close(marker.x, 200);
    close(marker.y, 196);
    assert.equal(marker.inView, true);
    assert.ok(MARKER_DIMENSIONS.width < 300);
  });
  it('moves an eastward target to the right and centres it after turning east', () => {
    const target = offsetCoordinate(origin, 10, 100);
    assert.ok(projectWaypoint(origin, target, cameraHeading(north).heading, 400, 700)!.x > 200);
    const sample = sensorSamples(90);
    const east = compassCameraBasis(sample.gravity, sample.magnetic, 0)!;
    const marker = projectWaypoint(
      origin,
      offsetCoordinate(origin, 100, 0),
      cameraHeading(east).heading,
      400,
      700,
    )!;
    close(marker.x, 200, 0.02);
    assert.equal(marker.inView, true);
  });
  it('shows edge arrows for off-screen and rear destinations', () => {
    const right = projectWaypoint(
      origin,
      offsetCoordinate(origin, 100, 0),
      cameraHeading(north).heading,
      400,
      700,
    )!;
    assert.equal(right.inView, false);
    assert.equal(right.arrow, '→');
    const left = projectWaypoint(
      origin,
      offsetCoordinate(origin, -100, 0),
      cameraHeading(north).heading,
      400,
      700,
    )!;
    assert.equal(left.inView, false);
    assert.equal(left.arrow, '←');
    const behind = projectWaypoint(
      origin,
      offsetCoordinate(origin, 0, -100),
      cameraHeading(north).heading,
      400,
      700,
    )!;
    assert.equal(behind.inView, false);
    assert.ok(behind.x > 0 && behind.x < 400);
  });
  it('handles north wraparound without telling the user to turn the long way', () => {
    const sample = sensorSamples(359);
    const basis = compassCameraBasis(sample.gravity, sample.magnetic, 0)!;
    const marker = projectWaypoint(
      origin,
      offsetCoordinate(origin, 0, 100),
      cameraHeading(basis).heading,
      400,
      700,
    )!;
    close(marker.relativeBearing, 1);
  });
  it('uses the top edge when the phone is flat instead of hiding the marker', () => {
    const sample = sensorSamples(90, -90);
    const basis = compassCameraBasis(sample.gravity, sample.magnetic, 0)!;
    assert.equal(cameraHeading(basis).topEdge, true);
    close(cameraHeading(basis).heading, 90);
    assert.ok(projectWaypoint(origin, TENDUR_KEBAB, cameraHeading(basis).heading, 400, 700));
  });
  it('keeps the HUD height and azimuth unchanged when tilting the phone', () => {
    const target = offsetCoordinate(origin, 10, 100);
    const points = [-65, -30, 0, 30, 65].map((pitch) => {
      const sample = sensorSamples(0, pitch, 20);
      const basis = compassCameraBasis(sample.gravity, sample.magnetic, 0)!;
      return projectWaypoint(origin, target, cameraHeading(basis).heading, 400, 700)!;
    });
    for (const point of points) {
      close(point.x, points[0]!.x);
      close(point.y, points[0]!.y);
    }
  });
  it('filters an isolated compass spike and tiny heading jitter across north', () => {
    close(medianHeading([359, 0, 140, 1, 0], 0), 0);
    close(smoothHeading(0, 0.5, 0.05), 0);
    const next = smoothHeading(359, 1, 0.05);
    assert.ok(next > 359 && next < 360);
  });
  it('recovers a filter with non-finite state and never renders a false left marker', () => {
    const target = medianHeading([NaN, 20, 21, 22], NaN);
    assert.ok(Number.isFinite(target));
    const heading = smoothHeading(NaN, target, 0.05);
    assert.ok(Number.isFinite(heading));
    assert.ok(projectWaypoint(origin, TENDUR_KEBAB, heading, 400, 700));
    assert.equal(projectWaypoint(origin, TENDUR_KEBAB, NaN, 400, 700), null);
  });
  it('keeps rear targets centred so north wraparound cannot flip screen edges', () => {
    const target = offsetCoordinate(origin, 0, -100);
    const left = projectWaypoint(origin, target, 1, 400, 700)!;
    const right = projectWaypoint(origin, target, 359, 400, 700)!;
    close(left.x, 200);
    close(right.x, 200);
    assert.equal(left.arrow, '↶');
    assert.equal(right.arrow, '↶');
  });
  it('preserves metre offsets and rejects inaccurate or stale GPS', () => {
    const offset = localOffset(origin, offsetCoordinate(origin, 14, -20));
    close(offset.east, 14);
    close(offset.north, -20);
    assert.equal(reliableFix({ ...origin, timestamp: 1000, accuracy: 4 }, 8000), false);
    assert.equal(reliableFix({ ...origin, timestamp: 8000, accuracy: null }, 8000), false);
    assert.equal(reliableFix({ ...origin, timestamp: 8000, accuracy: 40 }, 8000), false);
  });
});

describe('persistent destination HUD', () => {
  it('keeps the last known direction visible when a turn temporarily invalidates sensor or GPS freshness', () => {
    const sample = { coordinate: origin, heading: 90, current: true };
    const before = waypointHud(sample, TENDUR_KEBAB, 400, 700)!;
    const duringTurn = waypointHud({ ...sample, current: false }, TENDUR_KEBAB, 400, 700);
    assert.ok(duringTurn, 'A temporary bad sample must not remove the HUD');
    close(duringTurn.x, before.x);
    close(duringTurn.y, before.y);
    assert.equal(duringTurn.stale, true);
  });
  it('shows a named waiting marker before GPS or heading is ready', () => {
    const pending = waypointHud(
      { coordinate: null, heading: null, current: false },
      TENDUR_KEBAB,
      400,
      700,
    );
    assert.ok(pending);
    assert.equal(pending.pending, true);
    close(pending.x, 200);
  });
});

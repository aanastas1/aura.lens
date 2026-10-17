import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TENDUR_KEBAB } from '@/src/banners';
import { GpsPosition } from '@/src/gpsPosition';
import { localOffset, offsetCoordinate } from '@/src/positioning';

const origin = { latitude: 52.23, longitude: 21.01 };
const initialized = () => {
  const position = new GpsPosition();
  position.observeGps({ ...origin, accuracy: 4, timestamp: 10000 }, 10000);
  return position;
};
const fix = (east: number, timestamp: number, accuracy = 4) => ({
  ...offsetCoordinate(origin, east, 0),
  accuracy,
  timestamp,
});
const east = (position: GpsPosition) => localOffset(origin, position.advance(0)!).east;

describe('GPS-only position', () => {
  it('waits for a valid GPS origin and never creates movement from render frames', () => {
    const position = new GpsPosition();
    assert.equal(position.advance(0.1), null);
    position.observeGps(fix(0, 10000), 10000);
    for (let i = 0; i < 1000; i++) position.advance(1 / 60);
    assert.ok(Math.abs(east(position)) < 1e-5);
  });
  it('rejects coarse measurements and repeated implausible jumps', () => {
    const position = initialized();
    for (const timestamp of [11000, 12000]) position.observeGps(fix(20, timestamp, 30), timestamp);
    for (const timestamp of [13000, 14000]) position.observeGps(fix(80, timestamp), timestamp);
    for (let i = 0; i < 100; i++) position.advance(0.1);
    assert.ok(Math.abs(east(position)) < 1e-5);
    assert.equal(position.latestFix?.timestamp, 10000);
  });
  it('confirms frequent GPS callbacks and converges without jumping', () => {
    const position = initialized();
    for (let timestamp = 11000; timestamp <= 12000; timestamp += 250)
      position.observeGps(fix(6, timestamp), timestamp);
    assert.ok(Math.abs(east(position)) < 1e-5);
    position.advance(1 / 60);
    assert.ok(east(position) > 0 && east(position) <= 3 / 60 + 1e-5);
    for (let i = 0; i < 200; i++) position.advance(0.1);
    assert.ok(Math.abs(east(position) - 6) < 0.002);
  });
  it('follows walking using GPS alone instead of the former slow drift correction', () => {
    const position = initialized();
    for (let second = 1; second <= 12; second++) {
      const timestamp = 10000 + second * 1000;
      position.observeGps(fix(second * 1.5, timestamp), timestamp);
      for (let frame = 0; frame < 60; frame++) position.advance(1 / 60);
    }
    assert.ok(east(position) > 10 && east(position) < 18, `moved ${east(position)} m`);
  });
  it('keeps Tendur Kebab fixed through GPS movement', () => {
    const position = initialized();
    const banners = [TENDUR_KEBAB];
    const saved = structuredClone(banners);
    position.observeGps(fix(6, 11000), 11000);
    position.observeGps(fix(6, 12000), 12000);
    for (let i = 0; i < 100; i++) position.advance(0.1);
    assert.ok(east(position) > 5);
    assert.deepEqual(banners, saved);
  });
});

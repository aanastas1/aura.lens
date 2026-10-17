export type Coordinate = { latitude: number; longitude: number };
export type Fix = Coordinate & { accuracy: number | null; timestamp: number };
export type Vec3 = [number, number, number];
export type CameraBasis = { right: Vec3; up: Vec3; forward: Vec3 };
export const MAX_GPS_ACCURACY = 15;
export const MARKER_DIMENSIONS = { width: 240, height: 150 };
const EARTH_RADIUS = 6_371_000;
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (angle: number) => (angle * 180) / Math.PI;

export function offsetCoordinate(origin: Coordinate, east: number, north: number): Coordinate {
  return {
    latitude: origin.latitude + ((north / EARTH_RADIUS) * 180) / Math.PI,
    longitude:
      origin.longitude +
      ((east / (EARTH_RADIUS * Math.cos(radians(origin.latitude)))) * 180) / Math.PI,
  };
}

export function localOffset(origin: Coordinate, coordinate: Coordinate) {
  return {
    east:
      radians(coordinate.longitude - origin.longitude) *
      EARTH_RADIUS *
      Math.cos(radians(origin.latitude)),
    north: radians(coordinate.latitude - origin.latitude) * EARTH_RADIUS,
  };
}

export function reliableFix(fix: Fix, now: number): boolean {
  return (
    Number.isFinite(fix.latitude) &&
    Math.abs(fix.latitude) <= 90 &&
    Number.isFinite(fix.longitude) &&
    Math.abs(fix.longitude) <= 180 &&
    fix.accuracy !== null &&
    fix.accuracy >= 0 &&
    fix.accuracy <= MAX_GPS_ACCURACY &&
    now - fix.timestamp >= -1000 &&
    now - fix.timestamp <= 5000
  );
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: Vec3): Vec3 => v.map((value) => value / Math.hypot(...v)) as Vec3;

// Android accelerometer gives upward gravity in device coordinates. Magnetic
// field × up gives east; up × east gives magnetic north. No gyro integration.
export function compassCameraBasis(
  gravity: Vec3,
  magnetic: Vec3,
  declination: number,
): CameraBasis | null {
  if (![...gravity, ...magnetic, declination].every(Number.isFinite)) return null;
  const acceleration = Math.hypot(...gravity);
  const field = Math.hypot(...magnetic);
  if (acceleration < 0.5 || acceleration > 1.5 || field < 1) return null;
  const up = unit(gravity);
  const eastField = cross(magnetic, up);
  // Reject numerical degeneracy, not a guessed magnetic-strength threshold.
  // Calibration quality comes from Android's compass accuracy instead.
  if (Math.hypot(...eastField) / field < 0.001) return null;
  const magneticEast = unit(eastField);
  const magneticNorth = cross(up, magneticEast);
  const d = radians(declination);
  const east = magneticEast.map(
    (value, i) => value * Math.cos(d) + magneticNorth[i]! * Math.sin(d),
  ) as Vec3;
  const north = magneticNorth.map(
    (value, i) => value * Math.cos(d) - magneticEast[i]! * Math.sin(d),
  ) as Vec3;
  return {
    right: [east[0], north[0], up[0]],
    up: [east[1], north[1], up[1]],
    forward: [-east[2], -north[2], -up[2]],
  };
}

export function smoothSensor(previous: Vec3 | null, next: Vec3, seconds: number): Vec3 {
  if (!previous) return next;
  const amount = 1 - Math.exp(-Math.max(0, Math.min(seconds, 0.2)) / 0.08);
  return next.map((value, i) => previous[i]! + (value - previous[i]!) * amount) as Vec3;
}

export function destination(user: Coordinate, target: Coordinate) {
  const lat1 = radians(user.latitude);
  const lat2 = radians(target.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(target.longitude - user.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  const distance = 2 * EARTH_RADIUS * Math.asin(Math.sqrt(Math.min(1, a)));
  const bearing = Math.atan2(
    Math.sin(deltaLon) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon),
  );
  return { distance, bearing: (degrees(bearing) + 360) % 360 };
}

const signedAngle = (angle: number) => (((angle % 360) + 540) % 360) - 180;
const normalHeading = (heading: number) => ((heading % 360) + 360) % 360;

export function cameraHeading(basis: CameraBasis, useTopEdge = false) {
  const horizontal = Math.hypot(basis.forward[0], basis.forward[1]);
  // Hysteresis prevents switching back and forth when the phone is nearly flat.
  const topEdge = horizontal < (useTopEdge ? 0.5 : 0.25);
  const direction = topEdge ? basis.up : basis.forward;
  return { heading: normalHeading(degrees(Math.atan2(direction[0], direction[1]))), topEdge };
}

export function medianHeading(samples: number[], reference: number) {
  const valid = samples.filter(Number.isFinite);
  const anchor = Number.isFinite(reference) ? reference : valid[0]!;
  const offsets = valid.map((heading) => signedAngle(heading - anchor)).sort((a, b) => a - b);
  return normalHeading(anchor + offsets[Math.floor(offsets.length / 2)]!);
}

export function smoothHeading(current: number | null, target: number, seconds: number) {
  if (current === null || !Number.isFinite(current)) return target;
  const delta = signedAngle(target - current);
  if (Math.abs(delta) < 0.8) return current;
  const timeConstant = Math.abs(delta) < 10 ? 0.35 : 0.18;
  const amount = 1 - Math.exp(-Math.max(0, Math.min(seconds, 0.1)) / timeConstant);
  return normalHeading(current + delta * amount);
}

// A compass HUD, not a world-space object: pitch/roll must not move the label.
export function projectWaypoint(
  user: Coordinate,
  target: Coordinate,
  heading: number,
  width: number,
  height: number,
) {
  if (!Number.isFinite(heading)) return null;
  if (width <= MARKER_DIMENSIONS.width + 24 || height <= MARKER_DIMENSIONS.height + 24) return null;
  const { distance, bearing } = destination(user, target);
  const relativeBearing = signedAngle(bearing - heading);
  const margin = MARKER_DIMENSIONS.width / 2 + 12;
  const inView = Math.abs(relativeBearing) <= 60;
  const behind = Math.abs(relativeBearing) > 150;
  const offset = Math.max(-1, Math.min(1, relativeBearing / 60));
  const x = behind ? width / 2 : width / 2 + offset * (width / 2 - margin);
  const y = height * 0.28;
  const arrow = inView ? '◇' : behind ? '↶' : relativeBearing >= 0 ? '→' : '←';
  return { x, y, distance, bearing, relativeBearing, inView, arrow, behind };
}

export type HudSample = { coordinate: Coordinate | null; heading: number | null; current: boolean };

export function waypointHud(sample: HudSample, target: Coordinate, width: number, height: number) {
  if (width <= 0 || height <= 0) return null;
  const projected =
    sample.coordinate && sample.heading !== null
      ? projectWaypoint(sample.coordinate, target, sample.heading, width, height)
      : null;
  if (projected) return { ...projected, pending: false, stale: !sample.current };
  // Keep the destination visible without inventing a direction before the first fix.
  return {
    x: width / 2,
    y: height * 0.28,
    distance: null,
    bearing: null,
    relativeBearing: null,
    inView: false,
    behind: false,
    arrow: '…',
    pending: true,
    stale: true,
  };
}

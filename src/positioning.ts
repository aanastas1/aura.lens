export type Coordinate = { latitude: number; longitude: number };
export type Fix = Coordinate & { accuracy: number | null; timestamp: number };
export type Vec3 = [number, number, number];
export type Quaternion = [number, number, number, number];
export type Rotation = { alpha: number; beta: number; gamma: number };
export const MAX_GPS_ACCURACY = 15;
export const BANNER_DIMENSIONS = { width: 300, height: 540, worldWidth: 6 };
const EARTH_RADIUS = 6_371_000;
const radians = (degrees: number) => degrees * Math.PI / 180;

export function offsetCoordinate(origin: Coordinate, east: number, north: number): Coordinate {
  return {
    latitude: origin.latitude + north / EARTH_RADIUS * 180 / Math.PI,
    longitude: origin.longitude + east / (EARTH_RADIUS * Math.cos(radians(origin.latitude))) * 180 / Math.PI,
  };
}

export function localOffset(origin: Coordinate, coordinate: Coordinate) {
  return {
    east: radians(coordinate.longitude - origin.longitude) * EARTH_RADIUS * Math.cos(radians(origin.latitude)),
    north: radians(coordinate.latitude - origin.latitude) * EARTH_RADIUS,
  };
}

export function reliableFix(fix: Fix, now: number): boolean {
  return Number.isFinite(fix.latitude) && Math.abs(fix.latitude) <= 90
    && Number.isFinite(fix.longitude) && Math.abs(fix.longitude) <= 180
    && fix.accuracy !== null && fix.accuracy >= 0 && fix.accuracy <= MAX_GPS_ACCURACY
    && now - fix.timestamp >= -1000 && now - fix.timestamp <= 5000;
}

// Expo DeviceMotion's Android rotation follows the Z-X-Y convention. This
// maps device axes to east/north/up. The rear camera looks along device -Z.
function multiply(a: Quaternion, b: Quaternion): Quaternion {
  const [x, y, z, w] = a;
  const [u, v, s, t] = b;
  return [w * u + x * t + y * s - z * v, w * v - x * s + y * t + z * u,
    w * s + x * v - y * u + z * t, w * t - x * u - y * v - z * s];
}

export function orientationQuaternion({ alpha, beta, gamma }: Rotation): Quaternion {
  return multiply(multiply([0, 0, Math.sin(alpha / 2), Math.cos(alpha / 2)],
    [Math.sin(beta / 2), 0, 0, Math.cos(beta / 2)]),
  [0, Math.sin(gamma / 2), 0, Math.cos(gamma / 2)]);
}

export function rotate(q: Quaternion, vector: Vec3): Vec3 {
  const v = multiply(multiply(q, [...vector, 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [v[0], v[1], v[2]];
}

// Follow large turns quickly and damp small sensor noise. A fixed speed cap
// would leave the overlay catching up after the physical phone has stopped.
export function smoothOrientation(current: Quaternion, target: Quaternion, seconds: number): Quaternion {
  const product = current.reduce((sum, value, index) => sum + value * target[index]!, 0);
  const sign = product < 0 ? -1 : 1;
  const halfAngle = Math.acos(Math.min(1, Math.abs(product)));
  const angle = halfAngle * 2;
  if (angle <= radians(0.12)) return current;
  const dt = Math.max(0, Math.min(seconds, 0.1));
  const timeConstant = 0.015 + 0.065 * Math.exp(-((angle / radians(1.5)) ** 2));
  const amount = 1 - Math.exp(-dt / timeConstant);
  const denominator = Math.sin(halfAngle);
  const from = Math.sin((1 - amount) * halfAngle) / denominator;
  const to = Math.sin(amount * halfAngle) / denominator;
  const next = current.map((value, i) => value * from + target[i]! * sign * to) as Quaternion;
  const length = Math.hypot(...next);
  return next.map(value => value / length) as Quaternion;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function projectBanner(user: Coordinate, banner: Coordinate, orientation: Quaternion, width: number, height: number) {
  const { east, north } = localOffset(user, banner);
  const relative: Vec3 = [east, north, 0];
  const right = rotate(orientation, [1, 0, 0]);
  const up = rotate(orientation, [0, 1, 0]);
  const forward = rotate(orientation, [0, 0, -1]);
  const depth = dot(relative, forward);
  if (depth <= 0.5) return null;
  // Approximate horizontal field of view: camera hardware varies. Each panel
  // represents a 6 x 10.8 metre portrait rectangle, facing the viewer.
  const focalLength = width / (2 * Math.tan(radians(60) / 2));
  const x = width / 2 + focalLength * dot(relative, right) / depth;
  const y = height / 2 - focalLength * dot(relative, up) / depth;
  const scale = focalLength * BANNER_DIMENSIONS.worldWidth / depth / BANNER_DIMENSIONS.width;
  const roll = Math.atan2(right[2], up[2]);
  const panelWidth = BANNER_DIMENSIONS.width * scale;
  const panelHeight = BANNER_DIMENSIONS.height * scale;
  const halfWidth = (Math.abs(Math.cos(roll)) * panelWidth + Math.abs(Math.sin(roll)) * panelHeight) / 2;
  const halfHeight = (Math.abs(Math.sin(roll)) * panelWidth + Math.abs(Math.cos(roll)) * panelHeight) / 2;
  if (x + halfWidth < 0 || x - halfWidth > width || y + halfHeight < 0 || y - halfHeight > height) return null;
  return { x, y, scale, distance: Math.hypot(east, north), roll };
}

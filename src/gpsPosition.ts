import { localOffset, offsetCoordinate, reliableFix, type Coordinate, type Fix } from './positioning';

type Offset = { east: number; north: number };
type Candidate = Offset & { timestamp: number };

// Position comes exclusively from GPS. Render frames only smooth the latest
// confirmed target; orientation never contributes to displacement.
export class GpsPosition {
  origin: Coordinate | null = null;
  latestFix: Fix | null = null;
  private position: Offset = { east: 0, north: 0 };
  private target: Offset = { east: 0, north: 0 };
  private pending: Candidate | null = null;

  observeGps(fix: Fix, now: number): boolean {
    if (!reliableFix(fix, now)) { this.pending = null; return false; }
    if (this.latestFix && fix.timestamp <= this.latestFix.timestamp) return false;
    if (this.latestFix) {
      const seconds = (fix.timestamp - this.latestFix.timestamp) / 1000;
      const step = localOffset(this.latestFix, fix);
      const allowed = this.latestFix.accuracy! + fix.accuracy! + 2 * seconds;
      if (Math.hypot(step.east, step.north) > allowed) {
        this.pending = null;
        return false;
      }
    }
    this.latestFix = fix;
    if (!this.origin) {
      this.origin = { latitude: fix.latitude, longitude: fix.longitude };
      return true;
    }
    const measured = localOffset(this.origin, fix);
    const distance = (offset: Offset) => Math.hypot(measured.east - offset.east, measured.north - offset.north);
    const deadband = Math.max(2, fix.accuracy! * 0.75);
    if (distance(this.position) <= deadband && distance(this.target) <= deadband) {
      this.pending = null;
      return false;
    }
    const previous = this.pending;
    if (!previous) {
      this.pending = { ...measured, timestamp: fix.timestamp };
      return false;
    }
    const seconds = (fix.timestamp - previous.timestamp) / 1000;
    if (seconds > 5 || distance(previous) > Math.max(4, 2 * seconds)) {
      this.pending = { ...measured, timestamp: fix.timestamp };
      return false;
    }
    if (seconds < 0.8) return false;
    this.target = { east: (measured.east + previous.east) / 2, north: (measured.north + previous.north) / 2 };
    this.pending = null;
    return true;
  }

  advance(seconds: number): Coordinate | null {
    if (!this.origin) return null;
    const dt = Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, 0.1)) : 0;
    const east = this.target.east - this.position.east;
    const north = this.target.north - this.position.north;
    const distance = Math.hypot(east, north);
    if (distance > 0.001) {
      // Follow walking GPS promptly while spreading each update over frames.
      const step = Math.min(distance * (1 - Math.exp(-dt / 1.5)), 3 * dt);
      this.position.east += east / distance * step;
      this.position.north += north / distance * step;
    }
    return offsetCoordinate(this.origin, this.position.east, this.position.north);
  }
}

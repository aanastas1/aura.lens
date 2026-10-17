import { offsetCoordinate, type Coordinate } from './positioning';

// These positions are generated once per placement, then stay geographic.
// Edit the text, colours and metre offsets here to change the demo.
export type Banner = Coordinate & { id: string; title?: string; text: string; color: string };
const DEMO_BANNERS: (Omit<Banner, keyof Coordinate> & { east: number; north: number })[] = [
  { id: 'hello', title: 'Hello, Warsaw!', text: 'A banner in your world.', color: '#2457C5', east: 0, north: 12 },
  { id: 'walk', title: 'Walk around', text: 'I stay here as you move.', color: '#16624B', east: 14, north: 10 },
  { id: 'look', text: 'Look around to find all three.', color: '#803D91', east: -12, north: -16 },
];

export function createDemoBanners(origin: Coordinate, heading = 0): Banner[] {
  const radians = heading * Math.PI / 180;
  return DEMO_BANNERS.map(({ east, north, ...banner }) => ({
    ...banner,
    ...offsetCoordinate(origin, east * Math.cos(radians) + north * Math.sin(radians),
      north * Math.cos(radians) - east * Math.sin(radians)),
  }));
}


# Nearby AR — Expo Go prototype

A minimal Android camera overlay using TypeScript, React Native and Expo. Three hardcoded banners contain text, colour and an optional title. Their screen positions and sizes respond to phone orientation and smoothed GPS position.

**Runs in Expo Go by scanning a QR code.** Uses only Expo Go modules: `expo-camera`, `expo-location` and `expo-sensors`. No custom development client, native AR library, prebuild, EAS build, Android SDK or Gradle commands are needed. No backend, database, API keys or login.

## Run

Install the current Expo Go from Google Play on your Android phone. This project uses **Expo SDK 57**, matching the store release; SDK 58's Expo Go is not yet available in the stores. Then:

```sh
bun install
bun run start
```

Connect your phone and computer to the same network. Open **Expo Go → Scan QR code** and scan the terminal QR code. Edit the TypeScript files and save to use Fast Refresh.

If the local network blocks the connection:

```sh
bun run start --tunnel
```

Expo may prompt to install its tunnel helper. If Expo Go reports an SDK mismatch, use the compatible Android Expo Go release from [expo.dev/go](https://expo.dev/go).

After changing SDK versions, stop the old Metro server with Ctrl+C and run `bun run start --clear` before scanning the new QR code.

## Try it

1. Tap **Start demo** and allow Expo Go camera and precise foreground location access. Turn on phone location services.
2. Test outdoors. Wait for a recent GPS reading with accuracy of 15 metres or better and motion sensor data. The phone needs accelerometer, gyroscope and rotation-vector support; ARCore is not required.
3. Hold the phone upright at eye level and facing the horizon, then tap **Place banners**.
4. One banner appears about 12 metres ahead. Another is ahead/right, and the third is behind/left, about 17–20 metres away. Look around and take a short walk.
5. **Restart demo** generates new demo coordinates relative to your current position and viewing direction. Returning from the background starts a fresh session.

Edit `src/banners.ts` to change the titles, text, colours or metre offsets. Coordinates stay fixed until you place the banners again or restart the session.

## How it behaves

This is an approximate camera overlay. Panels are drawn as viewer-facing rectangles, with a perspective projection that makes them grow as you approach. Eye level is a flat horizontal plane; altitude, floors, stairs and physical occlusion are ignored.

Android's fused DeviceMotion orientation uses gyroscope and compass data. Adaptive quaternion smoothing reacts quickly to large turns (15 ms time constant), damps small sensor noise (up to 80 ms) and ignores changes below 0.12 degrees. There is no artificial angular speed cap, avoiding a long catch-up after the phone stops. We use an approximate 60-degree horizontal camera field of view and magnetic north, so placement can be offset from physical objects.

Position comes exclusively from GPS. Accelerometer displacement and step counting have been removed, along with the temporary strategy panel and physical activity permission. DeviceMotion is used only for viewing direction.

The first reliable fix establishes the origin. Later GPS targets require two mutually consistent readings outside an accuracy-dependent deadband (75% of reported accuracy, at least 2 metres). Readings worse than ±15 m, stale/out-of-order measurements and jumps exceeding both fixes’ combined accuracy plus a 2 m/s walking envelope are ignored. Confirmed targets are followed with a 1.5-second smoothing time constant and a maximum speed of 3 m/s. This replaces the old 0.35 m/s correction limit, which was too slow to follow walking using GPS alone. During GPS loss the displayed position settles at the last confirmed target; no other sensor invents displacement.

Banners represent 6 × 10.8 metre portrait rectangles (5:9 proportions), 40% smaller in each dimension than the previous version. Tap a banner to select it: a white border marks the selection. The permanent panel below the camera offers **Ukryj baner**, **Odznacz** and **Pokaż ukryte**. Hidden banners stay hidden for this session, including when you place the scene again; restore them with **Pokaż ukryte** or restart the demo. Hiding changes visibility only, not coordinates. The controls occupy their own area below the camera so they do not cover banner touch targets.

**Ustaw bannery ponownie przed sobą** places the scene ahead again. GPS movement never changes the existing banner coordinates. GPS filtering lives in `src/gpsPosition.ts`; orientation and projection, including banner dimensions, live in `src/positioning.ts`.

**This is an approximate overlay without camera-based world tracking.** GPS still has metre-scale errors and smoothing adds lag. Physical-device testing is needed to assess stability outdoors.

## Checks

```sh
bun run typecheck
bun test
bunx expo-doctor
bunx expo export --platform android
```

Tests cover camera direction, perspective projection, heading wraparound, GPS-only movement, noise/spike rejection and smoothing. JavaScript export checks bundling; it does not verify camera or sensor behaviour on a phone.

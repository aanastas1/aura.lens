import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';
import * as Location from 'expo-location';
import { createDemoBanners, type Banner } from './banners';
import {
  BANNER_DIMENSIONS, MAX_GPS_ACCURACY, orientationQuaternion, projectBanner, reliableFix, rotate, smoothOrientation,
  type Coordinate, type Quaternion,
} from './positioning';
import { GpsPosition } from './gpsPosition';

type Projected = NonNullable<ReturnType<typeof projectBanner>> & { banner: Banner };
type Display = { panels: Projected[]; ready: boolean; placed: boolean; hiddenCount: number; message: string };

export function CameraSession({ restart }: { restart: () => void }) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState('');
  const [gpsError, setGpsError] = useState('');
  const [selectedBanner, setSelectedBanner] = useState<Banner | null>(null);
  const [display, setDisplay] = useState<Display>({ panels: [], ready: false, placed: false, hiddenCount: 0, message: 'Starting camera and sensors…' });
  const model = useRef({
    position: new GpsPosition(),
    coordinate: null as Coordinate | null,
    orientation: null as Quaternion | null,
    targetOrientation: null as Quaternion | null,
    motionTimestamp: 0,
    banners: [] as Banner[],
    hiddenBannerIds: new Set<string>(),
  });

  useEffect(() => {
    let disposed = false;
    const subscriptions: { remove: () => void }[] = [];
    const own = (subscription: { remove: () => void }) => {
      if (disposed) subscription.remove();
      else subscriptions.push(subscription);
    };
    const fail = (message: string) => { if (!disposed) setError(message); };
    const gpsFailed = (message: string) => { if (!disposed) setGpsError(message); };
    const start = async () => {
      try {
        if (!await DeviceMotion.isAvailableAsync()) throw new Error('This phone does not provide the motion sensors needed for this demo.');
        if (disposed) return;
        DeviceMotion.setUpdateInterval(16);
        own(DeviceMotion.addListener(({ rotation }) => {
          if (disposed || !rotation || ![rotation.alpha, rotation.beta, rotation.gamma].every(Number.isFinite)) return;
          const q = orientationQuaternion(rotation);
          model.current.targetOrientation = q;
          model.current.orientation ??= q;
          model.current.motionTimestamp = Date.now();
        }));
        try {
          own(await Location.watchPositionAsync({
            accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0,
          }, location => {
            if (disposed) return;
            setGpsError('');
            const fix = { ...location.coords, timestamp: location.timestamp };
            model.current.position.observeGps(fix, Date.now());
          }, gpsFailed));
        } catch (reason) {
          gpsFailed(reason instanceof Error ? reason.message : 'GPS unavailable.');
        }
      } catch (reason) {
        fail(reason instanceof Error ? reason.message : 'Could not start sensors. Restart the demo.');
      }
    };
    void start();
    return () => {
      disposed = true;
      subscriptions.forEach(subscription => subscription.remove());
    };
  }, []);

  useEffect(() => {
    let frame: number;
    let previous = performance.now();
    let lastRender = 0;
    const animate = (time: number) => {
      const state = model.current;
      const seconds = (time - previous) / 1000;
      previous = time;
      const now = Date.now();
      const fix = state.position.latestFix;
      const gpsReady = !gpsError && !!fix && reliableFix(fix, now);
      const motionReady = !!state.orientation && now - state.motionTimestamp < 2000;
      // GPS is the only position source; orientation controls viewing direction.
      state.coordinate = state.position.advance(seconds);
      if (state.orientation && state.targetOrientation && motionReady) {
        state.orientation = smoothOrientation(state.orientation, state.targetOrientation, seconds);
      }
      if (time - lastRender >= 1000 / 30) {
        lastRender = time;
        const forward = state.orientation ? rotate(state.orientation, [0, 0, -1]) : null;
        const horizonReady = !!forward && Math.hypot(forward[0], forward[1]) > 0.5;
        const placed = state.banners.length > 0;
        let message = 'Look around and walk slowly to find the banners.';
        if (error) message = error;
        else if (!cameraReady) message = 'Starting camera…';
        else if (!motionReady) message = 'Waiting for motion sensors. Move the phone slowly.';
        else if (!gpsReady) message = placed ? 'Brak świeżego GPS · pozycja pozostaje przy ostatnim potwierdzonym pomiarze.'
          : gpsError ? `GPS unavailable: ${gpsError}. Restart after enabling location.`
            : `Waiting for GPS accuracy of ${MAX_GPS_ACCURACY} m or better. Try outdoors.`;
        else if (!placed && !horizonReady) message = 'Hold the phone upright and point towards the horizon.';
        else if (!placed) message = 'Look ahead, then place three demo banners around you.';
        else message = `${state.banners.length - state.hiddenBannerIds.size} z ${state.banners.length} banerów · GPS ±${Math.round(fix!.accuracy!)} m`;
        const panels: Projected[] = [];
        if (cameraReady && motionReady && state.coordinate && state.orientation && !error) {
          for (const banner of state.banners) {
            if (state.hiddenBannerIds.has(banner.id)) continue;
            const projected = projectBanner(state.coordinate, banner, state.orientation, viewport.width, viewport.height);
            if (projected) panels.push({ ...projected, banner });
          }
          // Nearer panels paint over farther panels.
          panels.sort((a, b) => b.distance - a.distance);
        }
        setDisplay({ panels, placed, hiddenCount: state.hiddenBannerIds.size, ready: cameraReady && motionReady && gpsReady && horizonReady && !error, message });
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [viewport, cameraReady, error, gpsError]);

  const place = () => {
    const state = model.current;
    if (!display.ready || !state.coordinate || !state.orientation) return;
    const forward = rotate(state.orientation, [0, 0, -1]);
    const heading = Math.atan2(forward[0], forward[1]) * 180 / Math.PI;
    state.banners = createDemoBanners(state.coordinate, heading);
    setSelectedBanner(null);
  };

  const hideSelected = () => {
    if (!selectedBanner) return;
    model.current.hiddenBannerIds.add(selectedBanner.id);
    setSelectedBanner(null);
  };

  return (
    <View style={styles.root}>
      <View style={styles.cameraArea} onLayout={({ nativeEvent }) => setViewport({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}>
      <CameraView
        style={StyleSheet.absoluteFill} facing="back" mode="picture" animateShutter={false}
        onCameraReady={() => setCameraReady(true)} onMountError={({ message }) => setError(message)}
      />
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {display.panels.filter(panel => !model.current.hiddenBannerIds.has(panel.banner.id)).map(panel => (
          <Pressable key={panel.banner.id}
            accessibilityRole="button" accessibilityLabel={`Wybierz baner: ${panel.banner.title || panel.banner.text}`}
            accessibilityState={{ selected: selectedBanner?.id === panel.banner.id }}
            onPress={() => setSelectedBanner(panel.banner)}
            style={[
            styles.banner,
            selectedBanner?.id === panel.banner.id && styles.selectedBanner,
            {
              backgroundColor: panel.banner.color,
              left: panel.x - BANNER_DIMENSIONS.width / 2, top: panel.y - BANNER_DIMENSIONS.height / 2,
              transform: [{ rotate: `${panel.roll}rad` }, { scale: panel.scale }],
            },
          ]}>
            {!!panel.banner.title && <Text numberOfLines={2} style={styles.bannerTitle}>{panel.banner.title}</Text>}
            <Text numberOfLines={6} style={styles.bannerText}>{panel.banner.text}</Text>
            <Text style={styles.bannerHint}>{selectedBanner?.id === panel.banner.id ? 'Wybrany baner' : 'Dotknij, aby wybrać'}</Text>
          </Pressable>
        ))}
      </View>
      </View>
      <View style={styles.controls}>
        <Text style={styles.title}>Nearby AR · Expo Go</Text>
        <Text numberOfLines={2} style={[styles.text, styles.statusText]}>{display.message}</Text>
        {display.placed && <>
          <Text numberOfLines={2} style={styles.selectionText}>
            {selectedBanner ? `Wybrano: ${selectedBanner.title || selectedBanner.text}`
              : `Dotknij banera, aby wybrać opcje.${display.hiddenCount ? ` Ukryte: ${display.hiddenCount}.` : ''}`}
          </Text>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" disabled={!selectedBanner} onPress={hideSelected}
              style={[styles.actionButton, styles.hideButton, !selectedBanner && styles.disabled]}>
              <Text style={styles.actionText}>Ukryj baner</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={!selectedBanner} onPress={() => setSelectedBanner(null)}
              style={[styles.actionButton, !selectedBanner && styles.disabled]}>
              <Text style={styles.actionText}>Odznacz</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={!display.hiddenCount} onPress={() => model.current.hiddenBannerIds.clear()}
              style={[styles.actionButton, !display.hiddenCount && styles.disabled]}>
              <Text style={styles.actionText}>Pokaż ukryte</Text>
            </Pressable>
          </View>
        </>}
        {!display.placed && <Text style={styles.hint}>The first banner appears ahead; the others are to the right and behind you. They remain at those demo coordinates.</Text>}
        {display.placed && <Pressable accessibilityRole="button" disabled={!display.ready}
          style={[styles.button, !display.ready && styles.disabled]} onPress={place}>
          <Text style={styles.buttonText}>Ustaw bannery ponownie przed sobą</Text>
        </Pressable>}
        {display.placed || error || gpsError ? (
          <Pressable accessibilityRole="button" style={styles.restartButton} onPress={restart}><Text style={styles.buttonText}>Restart demo</Text></Pressable>
        ) : (
          <Pressable accessibilityRole="button" disabled={!display.ready} style={[styles.button, !display.ready && styles.disabled]} onPress={place}>
            <Text style={styles.buttonText}>Place banners</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#11151B' },
  cameraArea: { flex: 1, overflow: 'hidden' },
  banner: { position: 'absolute', width: BANNER_DIMENSIONS.width, height: BANNER_DIMENSIONS.height, borderRadius: 16, padding: 24, borderWidth: 4, borderColor: '#FFFFFF40', justifyContent: 'center', alignItems: 'center', gap: 28 },
  selectedBanner: { borderColor: '#FFFFFF' },
  bannerTitle: { color: '#FFFFFF', fontSize: 38, fontWeight: '700', textAlign: 'center' },
  bannerText: { color: '#FFFFFF', fontSize: 30, textAlign: 'center' },
  bannerHint: { position: 'absolute', bottom: 24, color: '#FFFFFF', fontSize: 16 },
  controls: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, backgroundColor: '#11151B', gap: 8 },
  selectionText: { color: '#FFFFFF', fontSize: 14, minHeight: 36 },
  actions: { flexDirection: 'row', gap: 8 },
  actionButton: { flex: 1, minHeight: 48, padding: 8, borderRadius: 8, backgroundColor: '#28364D', justifyContent: 'center', alignItems: 'center' },
  hideButton: { backgroundColor: '#A33340' },
  actionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  title: { color: '#FFFFFF', fontSize: 21, fontWeight: '700' },
  text: { color: '#FFFFFF', fontSize: 15, lineHeight: 21 },
  statusText: { height: 42 },
  hint: { color: '#C1C9D6', fontSize: 13, lineHeight: 18 },
  restartButton: { padding: 6, alignItems: 'center' },
  button: { backgroundColor: '#3677E8', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.4 },
});

import { useEffect, useRef, useState } from 'react';
import { Image, TurboModuleRegistry, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { CameraView } from 'expo-camera';
import { Accelerometer, Magnetometer } from 'expo-sensors';
import * as Location from 'expo-location';
import { TENDUR_KEBAB } from './banners';
import {
  MARKER_DIMENSIONS, cameraHeading, compassCameraBasis, medianHeading, waypointHud, reliableFix, smoothHeading, smoothSensor,
  type CameraBasis, type Vec3,
} from './positioning';
import { GpsPosition } from './gpsPosition';
import { assistantConversation, type AssistantPhoto } from './assistant';
import { createTripleTap, INVITATION_DESTINATIONS, randomInvitation, type Invitation } from './invitations';
import type { Place } from './navigation';
import { VoiceAssistant } from './VoiceAssistant';
import { colors, radius, space, type } from './theme';

type Projected = NonNullable<ReturnType<typeof waypointHud>>;
const DEFAULT_TARGET: Place = { id: TENDUR_KEBAB.id, name: TENDUR_KEBAB.title, address: '', location: TENDUR_KEBAB };
type SceneSnapshot = { target: Place; uri: string; panels: Projected[]; started: number; resolve: (photo: AssistantPhoto) => void; reject: (error: Error) => void };
type Display = { target: Place; panels: Projected[]; message: string; warning: string };

const distanceParts = (d: number) => {
  if (d >= 1000) return { value: (Math.round(d / 100) / 10).toFixed(1).replace('.', ','), unit: 'km' };
  const m = Math.max(1, Math.round(d)), last = m % 10, tens = m % 100;
  return { value: String(m), unit: m === 1 ? 'metr' : last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? 'metry' : 'metrów' };
};
const formatDistance = (d: number) => { const p = distanceParts(d); return `${p.value} ${p.unit}`; };
const turn = (panel: Projected) => panel.relativeBearing === null ? { glyph: '…', text: 'Szukam kierunku' } : panel.inView
  ? { glyph: '↑', text: 'Idź prosto' }
  : panel.behind ? { glyph: '↶', text: 'Odwróć się' }
  : panel.relativeBearing >= 0 ? { glyph: '→', text: 'Skręć w prawo' } : { glyph: '←', text: 'Skręć w lewo' };

export function CameraSession({ restart }: { restart: () => void }) {
  const [conversation] = useState(() => assistantConversation);
  const [registerHeaderTap] = useState(createTripleTap);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const showInvitation = () => {
    if (!registerHeaderTap(performance.now())) return;
    const next = randomInvitation();
    conversation.rememberInvitation(next);
    setInvitation(next);
  };
  const acceptInvitation = () => {
    if (!invitation) return;
    conversation.navigation.pointTo(INVITATION_DESTINATIONS[invitation.sender]);
    setInvitation(null);
  };
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [cameraReady, setCameraReady] = useState(false);
  const camera = useRef<CameraView>(null);
  const sceneView = useRef<View>(null);
  const pendingSnapshot = useRef<SceneSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<SceneSnapshot | null>(null);

  useEffect(() => () => {
    pendingSnapshot.current?.reject(new Error('Przechwytywanie widoku przerwane.'));
    pendingSnapshot.current = null;
  }, []);
  const [error, setError] = useState('');
  const [gpsError, setGpsError] = useState('');
  const [display, setDisplay] = useState<Display>({ target: DEFAULT_TARGET, panels: [], message: 'Włączam aparat. Chwileczkę.', warning: '' });
  const model = useRef({
    position: new GpsPosition(),
    gravity: null as Vec3 | null,
    magnetic: null as Vec3 | null,
    gravityTimestamp: 0,
    magneticTimestamp: 0,
    declination: null as number | null,
    compassAccuracy: 0,
    lastBasis: null as CameraBasis | null,
    basisTimestamp: 0,
    heading: null as number | null,
    targetHeading: 0,
    headings: [] as number[],
    headingTimestamp: 0,
    useTopEdge: false,
  });

  useEffect(() => {
    let disposed = false;
    const subscriptions: { remove: () => void }[] = [];
    const own = (subscription: { remove: () => void }) => {
      if (disposed) subscription.remove();
      else subscriptions.push(subscription);
    };
    const fail = (message: string) => { if (!disposed) setError(message); };
    const start = async () => {
      try {
        const [accelerationAvailable, magneticAvailable] = await Promise.all([
          Accelerometer.isAvailableAsync(), Magnetometer.isAvailableAsync(),
        ]);
        if (!accelerationAvailable || !magneticAvailable) throw new Error('Ten telefon nie ma kompasu, więc nie pokażę kierunku.');
        if (disposed) return;
        Accelerometer.setUpdateInterval(50);
        Magnetometer.setUpdateInterval(50);
        own(Accelerometer.addListener(({ x, y, z }) => {
          if (disposed || ![x, y, z].every(Number.isFinite)) return;
          const s = model.current;
          const now = Date.now();
          s.gravity = smoothSensor(s.gravity, [x, y, z], (now - s.gravityTimestamp) / 1000);
          s.gravityTimestamp = now;
        }));
        own(Magnetometer.addListener(({ x, y, z }) => {
          if (disposed || ![x, y, z].every(Number.isFinite)) return;
          const s = model.current;
          const now = Date.now();
          s.magnetic = smoothSensor(s.magnetic, [x, y, z], (now - s.magneticTimestamp) / 1000);
          s.magneticTimestamp = now;
        }));
        // Only use the platform heading API for declination and calibration.
        // Our camera basis comes directly from accelerometer + magnetometer,
        // so it also works with a vertical phone, without a gyroscope.
        own(await Location.watchHeadingAsync(heading => {
          if (disposed) return;
          model.current.compassAccuracy = heading.accuracy;
          if (Number.isFinite(heading.trueHeading) && heading.trueHeading >= 0 && Number.isFinite(heading.magHeading)) {
            model.current.declination = ((heading.trueHeading - heading.magHeading + 540) % 360) - 180;
          }
        }, message => fail('Nie działa kompas w telefonie. Spróbuj ponownie.')));

      } catch (reason) {
        fail(reason instanceof Error ? reason.message : 'Nie udało się uruchomić kompasu. Spróbuj ponownie.');
      }
    };
    void start();
    return () => {
      disposed = true;
      subscriptions.forEach(subscription => subscription.remove());
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let subscription: Location.LocationSubscription | undefined;
    void Location.watchPositionAsync({
      accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0,
    }, location => {
      if (disposed) return;
      setGpsError('');
      const fix = { ...location.coords, timestamp: location.timestamp };
      model.current.position.observeGps(fix, Date.now());
      // Reject GPS teleports using the existing filter; expose poor accuracy rather than hiding it.
      if (model.current.position.latestFix?.timestamp === fix.timestamp || !reliableFix(fix, Date.now())) {
        conversation.navigation.updateLocation(fix);
      }
    }, () => { if (!disposed) setGpsError('Nie mam sygnału GPS. Włącz lokalizację i wyjdź na zewnątrz.'); })
      .then(value => { if (disposed) value.remove(); else subscription = value; })
      .catch(() => { if (!disposed) setGpsError('Nie mam sygnału GPS. Włącz lokalizację i wyjdź na zewnątrz.'); });
    return () => { disposed = true; subscription?.remove(); };
  }, [conversation]);

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
      const sensorsReady = state.gravity && state.magnetic && state.declination !== null
        && now - state.gravityTimestamp < 2000 && now - state.magneticTimestamp < 2000;
      const measuredBasis = sensorsReady ? compassCameraBasis(state.gravity!, state.magnetic!, state.declination!) : null;
      if (measuredBasis) {
        state.lastBasis = measuredBasis;
        state.basisTimestamp = now;
        if (state.headingTimestamp !== state.magneticTimestamp) {
          const next = cameraHeading(measuredBasis, state.useTopEdge);
          if (next.topEdge !== state.useTopEdge) state.headings = [];
          state.useTopEdge = next.topEdge;
          state.headings.push(next.heading);
          if (state.headings.length > 5) state.headings.shift();
          state.targetHeading = medianHeading(state.headings, state.heading ?? next.heading);
          state.headingTimestamp = state.magneticTimestamp;
        }
        state.heading = smoothHeading(state.heading, state.targetHeading, seconds);
      }
      // Brief motion spikes must not make the marker blink or label motion as interference.
      const basis = sensorsReady && now - state.basisTimestamp < 750 ? state.lastBasis : null;
      const coordinate = state.position.advance(seconds);
      if (basis && state.heading !== null && !state.useTopEdge && state.compassAccuracy >= 2) {
        conversation.navigation.updateHeading(state.heading, state.headingTimestamp);
      }

      if (time - lastRender >= 1000 / 30) {
        lastRender = time;
        let message = '', warning = '';
        if (error) message = error;
        else if (!cameraReady) message = 'Włączam aparat. Chwileczkę.';
        else if (!sensorsReady) message = 'Szukam kierunku. Trzymaj telefon przed sobą.';
        else if (!basis) message = 'Trzymaj telefon spokojnie.';
        else if (!gpsReady) message = gpsError || 'Szukam sygnału GPS. Wyjdź na zewnątrz.';
        else if (state.compassAccuracy < 2) warning = 'Kompas się gubi. Zatocz telefonem ósemkę w powietrzu.';
        const navigationState = conversation.navigation.hudState();
        const target = navigationState.directionTarget ?? DEFAULT_TARGET;
        const followingRoute = navigationState.followingRoute;
        const projected = followingRoute ? null : waypointHud({
          coordinate, heading: state.heading,
          current: cameraReady && gpsReady && !!basis && !error,
        }, target.location, viewport.width, viewport.height);
        setDisplay({ target, panels: projected ? [projected] : [], message: followingRoute ? (error || conversation.navigation.displayStatus()) : message || (projected ? '' : 'Trzymaj telefon spokojnie.'), warning });

      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [viewport, cameraReady, error, gpsError, conversation]);

  const capturePhoto = async (): Promise<AssistantPhoto> => {
    if (!cameraReady || error || !camera.current || !viewport.width || !viewport.height) {
      throw new Error('Aparat nie jest jeszcze gotowy. Spróbuj ponownie.');
    }
    if (!TurboModuleRegistry.get('RNViewShot')) {
      throw new Error('Zainstalowana wersja aplikacji nie obsługuje zapisu widoku z banerami. Potrzebna aktualizacja APK.');
    }
    const started = performance.now();
    const panels = display.panels;
    // Capture a camera frame, then compose it with the same banner views used on screen.
    // Capturing the camera SurfaceView directly can paint over the banner layer on Android.
    const photo = await camera.current.takePictureAsync({ quality: 0.8, exif: false });
    if (!camera.current) throw new Error('Przechwytywanie widoku przerwane.');
    return new Promise((resolve, reject) => {
      const scene = { target: display.target, uri: photo.uri, panels, started, resolve, reject };
      pendingSnapshot.current = scene;
      setSnapshot(scene);
    });
  };

  const finishSnapshot = async (scene: SceneSnapshot) => {
    if (pendingSnapshot.current !== scene || !sceneView.current) return;
    try {
      const { captureRef } = await import('react-native-view-shot');
      const scale = 1280 / Math.max(viewport.width, viewport.height);
      const width = Math.max(1, Math.round(viewport.width * scale));
      const height = Math.max(1, Math.round(viewport.height * scale));
      const dataUrl = await captureRef(sceneView, { width, height, format: 'jpg', quality: 0.6, result: 'data-uri' });
      if (dataUrl.length > 512 * 1024) throw new Error('Zrzut widoku przekracza limit 512 KB. Nie został wysłany.');
      scene.resolve({ dataUrl, width, height, captureMs: performance.now() - scene.started });
    } catch (reason) {
      scene.reject(reason instanceof Error ? reason : new Error('Nie udało się zapisać widoku z banerami.'));
    } finally {
      if (pendingSnapshot.current === scene) {
        pendingSnapshot.current = null;
        setSnapshot(null);
      }
    }
  };

  const renderPanels = (panels: Projected[], target: Place) => panels.map(panel => (
    <View key={target.id} style={[styles.marker, {
      left: panel.x - MARKER_DIMENSIONS.width / 2,
      top: panel.y - MARKER_DIMENSIONS.height + 12,
    }]}>
      <View style={styles.markerPlate}>
        <Text style={styles.markerTitle}>{target.name}</Text>
        <Text style={styles.markerDistance}>{panel.distance === null ? '…' : formatDistance(panel.distance)}</Text>
      </View>
      <Text style={styles.markerAnchor}>{panel.inView ? '▼' : turn(panel).glyph}</Text>
    </View>
  ));

  const panel = display.panels[0];
  const known = panel?.distance != null;
  const distance = known ? distanceParts(panel!.distance!) : null;
  const instruction = known && !display.message ? turn(panel!) : null;
  const failed = !!error || !!gpsError;
  const spoken = instruction ? `${instruction.text}. ${formatDistance(panel!.distance!)} do celu: ${display.target.name}.` : display.message;

  return (
    <View style={styles.root}>
      <Pressable accessible={false} onPress={showInvitation} style={styles.topBar}>
        <Text style={styles.brand}>ProwadźMnie</Text>
        <View accessible accessibilityLiveRegion="polite" accessibilityLabel={spoken} style={styles.instructionRow}>
          {instruction && <Text style={styles.glyph}>{instruction.glyph}</Text>}
          <View style={styles.instructionText}>
            <Text style={instruction ? styles.instruction : styles.message}>{instruction ? instruction.text : display.message}</Text>
          </View>
          {instruction && distance && <View style={styles.distanceCard}>
            <Text style={styles.distanceValue}>{distance.value}</Text>
            <Text style={styles.distanceUnit}>{distance.unit}</Text>
          </View>}
        </View>
        {!!display.warning && !display.message && <Text style={styles.warning}>{display.warning}</Text>}
        {failed && <Pressable accessibilityRole="button" accessibilityLabel="Spróbuj ponownie" style={styles.retry} onPress={restart}>
          <Text style={styles.retryText}>Spróbuj ponownie</Text>
        </Pressable>}
      </Pressable>
      {invitation && <View style={styles.notification}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Ustaw kierunek do ${invitation.sender}`}
          onPress={acceptInvitation} style={styles.invitationContent}>
          <Text style={styles.notificationTitle}>Zaproszenie od {invitation.sender}</Text>
          <Text accessibilityLiveRegion="polite" style={styles.notificationText}>{invitation.text}</Text>
          <Text style={styles.notificationText}>Dotknij, aby ustawić kierunek.</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Zamknij powiadomienie"
          onPress={() => setInvitation(null)} style={styles.dismissNotification}>
          <Text style={styles.dismissNotificationText}>Zamknij</Text>
        </Pressable>
      </View>}
      <View style={styles.cameraArea} onLayout={({ nativeEvent }) => setViewport({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}>
      <CameraView ref={camera}
        style={StyleSheet.absoluteFill} facing="back" mode="picture" pictureSize="1920x1080" ratio="16:9" animateShutter={false}
        onCameraReady={() => setCameraReady(true)} onMountError={({ message }) => setError(message)}
      />
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {renderPanels(display.panels, display.target)}
      </View>
      {snapshot && <View ref={sceneView} collapsable={false} pointerEvents="none" style={styles.snapshot}>
        <Image source={{ uri: snapshot.uri }} resizeMode="contain" style={StyleSheet.absoluteFill}
          onLoad={() => void finishSnapshot(snapshot)}
          onError={() => {
            snapshot.reject(new Error('Nie udało się wczytać kadru do zrzutu.'));
            if (pendingSnapshot.current === snapshot) {
              pendingSnapshot.current = null;
              setSnapshot(null);
            }
          }} />
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {renderPanels(snapshot.panels, snapshot.target)}
        </View>
      </View>}
      </View>
      <VoiceAssistant capturePhoto={capturePhoto} conversation={conversation} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navyDeep },
  snapshot: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden', backgroundColor: '#000000' },
  cameraArea: { flex: 1, overflow: 'hidden' },
  marker: { position: 'absolute', width: MARKER_DIMENSIONS.width, height: MARKER_DIMENSIONS.height, alignItems: 'center' },
  markerPlate: { alignSelf: 'stretch', alignItems: 'center', backgroundColor: colors.yellow, borderColor: colors.navyDeep, borderWidth: 6, borderRadius: radius.sign, paddingVertical: space.s, paddingHorizontal: space.s },
  markerTitle: { color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  markerDistance: { color: colors.ink, fontSize: 24, lineHeight: 30, fontWeight: '800' },
  markerAnchor: { color: colors.yellow, fontSize: 48, lineHeight: 52, fontWeight: '900', textShadowColor: colors.navyDeep, textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } },
  topBar: { paddingTop: (StatusBar.currentHeight ?? 40) + space.s, paddingBottom: space.m, paddingHorizontal: space.m, backgroundColor: colors.navy, borderBottomWidth: 6, borderBottomColor: colors.yellow, gap: space.s },
  notification: { padding: space.m, gap: space.s, backgroundColor: colors.paper, borderBottomWidth: 4, borderBottomColor: colors.yellow },
  invitationContent: { gap: space.s },
  notificationTitle: { ...type.title, color: colors.ink },
  notificationText: { ...type.body, color: colors.ink },
  dismissNotification: { alignSelf: 'flex-end', minHeight: 48, justifyContent: 'center', paddingHorizontal: space.m, backgroundColor: colors.navy, borderRadius: radius.button },
  dismissNotificationText: { ...type.small, color: colors.white },
  brand: { color: colors.yellow, ...type.small, fontWeight: '900' },
  instructionRow: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  glyph: { color: colors.yellow, fontSize: 80, lineHeight: 88, fontWeight: '900', minWidth: 80, textAlign: 'center' },
  instructionText: { flex: 1 },
  instruction: { color: colors.white, ...type.hero },
  distanceCard: { backgroundColor: colors.paper, borderRadius: radius.card, paddingHorizontal: space.m, paddingVertical: space.s, alignItems: 'center', minWidth: 96 },
  distanceValue: { color: colors.ink, fontSize: 40, lineHeight: 46, fontWeight: '900' },
  distanceUnit: { color: colors.ink, ...type.small },
  message: { color: colors.white, ...type.title },
  warning: { color: colors.yellow, ...type.small },
  retry: { backgroundColor: colors.yellow, minHeight: 72, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: colors.ink, ...type.title },
});

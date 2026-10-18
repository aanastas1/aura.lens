import { CameraView } from 'expo-camera';
import * as Location from 'expo-location';
import { Accelerometer, Magnetometer } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TurboModuleRegistry,
  View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { type AssistantPhoto, assistantConversation } from '@/src/assistant';
import { TENDUR_KEBAB } from '@/src/banners';
import { GpsPosition } from '@/src/gpsPosition';
import {
  createTripleTap,
  getInvitationDestination,
  type Invitation,
  randomInvitation,
} from '@/src/invitations';
import type { Place } from '@/src/navigation';
import {
  type CameraBasis,
  cameraHeading,
  compassCameraBasis,
  destination,
  MARKER_DIMENSIONS,
  medianHeading,
  reliableFix,
  smoothHeading,
  smoothSensor,
  usableFix,
  type Vec3,
  waypointHud,
} from '@/src/positioning';
import { colors, radius, space, type } from '@/src/theme';
import { VoiceAssistant } from '@/src/VoiceAssistant';

type Projected = NonNullable<ReturnType<typeof waypointHud>>;
const DEFAULT_TARGET: Place = {
  id: TENDUR_KEBAB.id,
  name: TENDUR_KEBAB.title,
  address: '',
  location: TENDUR_KEBAB,
};
type SceneSnapshot = {
  target: Place;
  uri: string;
  panels: Projected[];
  started: number;
  resolve: (photo: AssistantPhoto) => void;
  reject: (error: Error) => void;
};
type Display = { target: Place; panels: Projected[]; message: string };

const distanceParts = (d: number) => {
  if (d >= 1000)
    return { value: (Math.round(d / 100) / 10).toFixed(1).replace('.', ','), unit: 'km' };
  const m = Math.max(1, Math.round(d)),
    last = m % 10,
    tens = m % 100;
  return {
    value: String(m),
    unit:
      m === 1 ? 'metr' : last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? 'metry' : 'metrów',
  };
};
const formatDistance = (d: number) => {
  const p = distanceParts(d);
  return `${p.value} ${p.unit}`;
};
const turn = (panel: Projected) =>
  panel.relativeBearing === null
    ? { glyph: '…', text: 'Szukam kierunku' }
    : panel.inView
      ? { glyph: '↑', text: 'Idź prosto' }
      : panel.behind
        ? { glyph: '↶', text: 'Odwróć się' }
        : panel.relativeBearing >= 0
          ? { glyph: '→', text: 'Skręć w prawo' }
          : { glyph: '←', text: 'Skręć w lewo' };

export function CameraSession({ restart }: { restart: () => void }) {
  const [conversation] = useState(() => assistantConversation);
  const [registerHeaderTap] = useState(createTripleTap);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [pendingAnnouncements, setPendingAnnouncements] = useState<Invitation[]>([]);
  const finishAnnouncement = useCallback((read: Invitation, completed: boolean) => {
    setPendingAnnouncements((pending) => pending.filter((item) => item !== read));
    if (completed) setInvitation((current) => (current === read ? null : current));
  }, []);
  const showInvitation = () => {
    if (!registerHeaderTap(performance.now())) return;
    const next = randomInvitation();
    conversation.rememberInvitation(next);
    setInvitation(next);
    setPendingAnnouncements((pending) => [...pending, next]);
  };
  const invitationTarget = invitation ? getInvitationDestination(invitation) : null;
  const acceptInvitation = () => {
    if (!invitationTarget) return;
    conversation.navigation.pointTo(invitationTarget);
    setInvitation(null);
  };
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [cameraReady, setCameraReady] = useState(false);
  const camera = useRef<CameraView>(null);
  const sceneView = useRef<View>(null);
  const pendingSnapshot = useRef<SceneSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<SceneSnapshot | null>(null);

  useEffect(
    () => () => {
      pendingSnapshot.current?.reject(new Error('Przechwytywanie widoku przerwane.'));
      pendingSnapshot.current = null;
    },
    [],
  );
  const [error, setError] = useState('');
  const [gpsError, setGpsError] = useState('');
  const [display, setDisplay] = useState<Display>({
    target: DEFAULT_TARGET,
    panels: [],
    message: 'Włączam aparat. Chwileczkę.',
  });
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
    const fail = (message: string) => {
      if (!disposed) setError(message);
    };
    const start = async () => {
      try {
        const [accelerationAvailable, magneticAvailable] = await Promise.all([
          Accelerometer.isAvailableAsync(),
          Magnetometer.isAvailableAsync(),
        ]);
        if (!accelerationAvailable || !magneticAvailable)
          throw new Error('Ten telefon nie ma kompasu, więc nie pokażę kierunku.');
        if (disposed) return;
        Accelerometer.setUpdateInterval(50);
        Magnetometer.setUpdateInterval(50);
        own(
          Accelerometer.addListener(({ x, y, z }) => {
            if (disposed || ![x, y, z].every(Number.isFinite)) return;
            const s = model.current;
            const now = Date.now();
            s.gravity = smoothSensor(s.gravity, [x, y, z], (now - s.gravityTimestamp) / 1000);
            s.gravityTimestamp = now;
          }),
        );
        own(
          Magnetometer.addListener(({ x, y, z }) => {
            if (disposed || ![x, y, z].every(Number.isFinite)) return;
            const s = model.current;
            const now = Date.now();
            s.magnetic = smoothSensor(s.magnetic, [x, y, z], (now - s.magneticTimestamp) / 1000);
            s.magneticTimestamp = now;
          }),
        );
        // Only use the platform heading API for declination and calibration.
        // Our camera basis comes directly from accelerometer + magnetometer,
        // so it also works with a vertical phone, without a gyroscope.
        own(
          await Location.watchHeadingAsync(
            (heading) => {
              if (disposed) return;
              model.current.compassAccuracy = heading.accuracy;
              if (
                Number.isFinite(heading.trueHeading) &&
                heading.trueHeading >= 0 &&
                Number.isFinite(heading.magHeading)
              ) {
                model.current.declination =
                  ((heading.trueHeading - heading.magHeading + 540) % 360) - 180;
              }
            },
            (message) => fail('Nie działa kompas w telefonie. Spróbuj ponownie.'),
          ),
        );
      } catch (reason) {
        fail(
          reason instanceof Error
            ? reason.message
            : 'Nie udało się uruchomić kompasu. Spróbuj ponownie.',
        );
      }
    };
    void start();
    return () => {
      disposed = true;
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let subscription: Location.LocationSubscription | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    const observe = (location: Location.LocationObject) => {
      if (disposed) return;
      const now = Date.now();
      const fix = { ...location.coords, timestamp: location.timestamp };
      if (!usableFix(fix, now)) return;
      model.current.position.observeGps(fix, now);
      if (model.current.position.latestFix?.timestamp === fix.timestamp || !reliableFix(fix, now)) {
        conversation.navigation.updateLocation(fix);
      }
    };
    const startWatching = () => {
      const attempt = ++generation;
      const retry = () => {
        if (disposed || generation !== attempt) return;
        generation++;
        setGpsError('Szukam lokalizacji. Ponawiam odczyt GPS.');
        retryTimer = setTimeout(() => {
          subscription?.remove();
          subscription = undefined;
          startWatching();
        }, 3000);
      };
      void Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Highest,
          timeInterval: 1000,
          distanceInterval: 0,
        },
        (location) => {
          if (disposed || generation !== attempt) return;
          setGpsError('');
          observe(location);
        },
        retry,
      )
        .then((value) => {
          if (disposed || generation !== attempt) value.remove();
          else subscription = value;
        })
        .catch(retry);
    };
    void Location.getLastKnownPositionAsync({ maxAge: 60000 })
      .then((location) => {
        if (location) observe(location);
      })
      .catch(() => {});
    startWatching();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      subscription?.remove();
    };
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
      const sensorsReady =
        state.gravity &&
        state.magnetic &&
        state.declination !== null &&
        now - state.gravityTimestamp < 2000 &&
        now - state.magneticTimestamp < 2000;
      const measuredBasis = sensorsReady
        ? compassCameraBasis(state.gravity!, state.magnetic!, state.declination!)
        : null;
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
        let message = '';
        if (error) message = error;
        else if (!cameraReady) message = 'Włączam aparat. Chwileczkę.';
        else if (!sensorsReady) message = 'Szukam kierunku. Trzymaj telefon przed sobą.';
        else if (!basis) message = 'Trzymaj telefon spokojnie.';
        const navigationState = conversation.navigation.hudState();
        const target = navigationState.directionTarget ?? DEFAULT_TARGET;
        const hudCoordinate = gpsReady
          ? coordinate
          : (navigationState.approximateLocation ?? coordinate);
        if (!message && !gpsReady) {
          message = hudCoordinate ? `Cel: ${target.name}.` : 'Szukam kierunku.';
        }
        const followingRoute = navigationState.followingRoute;
        const projected = navigationState.suspended
          ? null
          : waypointHud(
              {
                coordinate: hudCoordinate,
                heading: state.heading,
                current: cameraReady && gpsReady && !!basis && !error,
              },
              navigationState.waypoint ?? target.location,
              viewport.width,
              viewport.height,
            );
        if (projected && hudCoordinate && followingRoute && !projected.pending) {
          projected.distance = destination(hudCoordinate, target.location).distance;
        }
        setDisplay({
          target,
          panels: projected ? [projected] : [],
          message: navigationState.suspended
            ? conversation.navigation.displayStatus()
            : followingRoute
              ? error || conversation.navigation.displayStatus()
              : message || (projected ? '' : 'Trzymaj telefon spokojnie.'),
        });
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
      throw new Error(
        'Zainstalowana wersja aplikacji nie obsługuje zapisu widoku z banerami. Potrzebna aktualizacja APK.',
      );
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
      const scale = 1280 / Math.max(viewport.width, viewport.height);
      const width = Math.max(1, Math.round(viewport.width * scale));
      const height = Math.max(1, Math.round(viewport.height * scale));
      const dataUrl = await captureRef(sceneView, {
        width,
        height,
        format: 'jpg',
        quality: 0.6,
        result: 'data-uri',
      });
      if (dataUrl.length > 512 * 1024)
        throw new Error('Zrzut widoku przekracza limit 512 KB. Nie został wysłany.');
      scene.resolve({ dataUrl, width, height, captureMs: performance.now() - scene.started });
    } catch (reason) {
      scene.reject(
        reason instanceof Error ? reason : new Error('Nie udało się zapisać widoku z banerami.'),
      );
    } finally {
      if (pendingSnapshot.current === scene) {
        pendingSnapshot.current = null;
        setSnapshot(null);
      }
    }
  };

  const renderPanels = (panels: Projected[], target: Place) =>
    panels.map((panel) => (
      <View
        key={target.id}
        style={[
          styles.marker,
          {
            left: panel.x - MARKER_DIMENSIONS.width / 2,
            top: panel.y - MARKER_DIMENSIONS.height + 12,
          },
        ]}
      >
        <View style={styles.markerPlate}>
          <Text style={styles.markerTitle}>{target.name}</Text>
          <Text style={styles.markerDistance}>
            {panel.distance === null ? '…' : formatDistance(panel.distance)}
          </Text>
        </View>
        <Text style={styles.markerAnchor}>{panel.inView ? '▼' : turn(panel).glyph}</Text>
      </View>
    ));

  const panel = display.panels[0];
  const known = panel?.distance != null;
  const distance = known ? distanceParts(panel!.distance!) : null;
  const direction = panel ? turn(panel) : null;
  const instruction = known && !panel!.stale && !display.message ? direction : null;
  const failed = !!error || !!gpsError;
  const spoken = instruction
    ? `${instruction.text}. ${formatDistance(panel!.distance!)} do celu: ${display.target.name}.`
    : display.message;

  return (
    <View style={styles.root}>
      <Pressable accessible={false} onPress={showInvitation} style={styles.topBar}>
        <Text style={styles.brand}>ProwadźMnie</Text>
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={spoken}
          style={styles.instructionRow}
        >
          {direction && <Text style={styles.glyph}>{direction.glyph}</Text>}
          <View style={styles.instructionText}>
            <Text style={instruction ? styles.instruction : styles.message}>
              {instruction ? instruction.text : display.message}
            </Text>
          </View>
          {instruction && distance && (
            <View style={styles.distanceCard}>
              <Text style={styles.distanceValue}>{distance.value}</Text>
              <Text style={styles.distanceUnit}>{distance.unit}</Text>
            </View>
          )}
        </View>
        {failed && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Spróbuj ponownie"
            style={styles.retry}
            onPress={restart}
          >
            <Text style={styles.retryText}>Spróbuj ponownie</Text>
          </Pressable>
        )}
      </Pressable>

      <View
        style={styles.cameraArea}
        onLayout={({ nativeEvent }) =>
          setViewport({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })
        }
      >
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          pictureSize="1920x1080"
          animateShutter={false}
          onCameraReady={() => setCameraReady(true)}
          onMountError={({ message }) => setError(message)}
        />
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {renderPanels(display.panels, display.target)}
        </View>
        {snapshot && (
          <View ref={sceneView} collapsable={false} pointerEvents="none" style={styles.snapshot}>
            <Image
              source={{ uri: snapshot.uri }}
              resizeMode="cover"
              style={StyleSheet.absoluteFill}
              onLoad={() => void finishSnapshot(snapshot)}
              onError={() => {
                snapshot.reject(new Error('Nie udało się wczytać kadru do zrzutu.'));
                if (pendingSnapshot.current === snapshot) {
                  pendingSnapshot.current = null;
                  setSnapshot(null);
                }
              }}
            />
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {renderPanels(snapshot.panels, snapshot.target)}
            </View>
          </View>
        )}
        {/* Overlay notifications without resizing the camera or including them in snapshots. */}
        {invitation && (
          <View style={[styles.notification, { maxHeight: viewport.height * 0.45 }]}>
            <ScrollView contentContainerStyle={styles.notificationContent}>
              <Pressable
                disabled={!invitationTarget}
                accessibilityRole={invitationTarget ? 'button' : undefined}
                accessibilityLabel={
                  invitationTarget ? `Ustaw kierunek do ${invitation.sender}` : undefined
                }
                onPress={acceptInvitation}
                style={styles.invitationContent}
              >
                <Text style={styles.notificationTitle}>
                  {invitation.sender === 'Maria'
                    ? 'Wiadomość od córki Marii'
                    : `Zaproszenie od ${invitation.sender}`}
                </Text>
                <Text accessibilityLiveRegion="polite" style={styles.notificationText}>
                  {invitation.text}
                </Text>
                {invitationTarget && (
                  <Text style={styles.notificationText}>Dotknij, aby ustawić kierunek.</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Zamknij powiadomienie"
                onPress={() => setInvitation(null)}
                style={styles.dismissNotification}
              >
                <Text style={styles.dismissNotificationText}>Zamknij</Text>
              </Pressable>
            </ScrollView>
          </View>
        )}
      </View>
      <VoiceAssistant
        capturePhoto={capturePhoto}
        conversation={conversation}
        announcement={pendingAnnouncements[0] ?? null}
        onAnnouncementRead={finishAnnouncement}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navyDeep },
  snapshot: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  cameraArea: { flex: 1, overflow: 'hidden' },
  marker: {
    position: 'absolute',
    width: MARKER_DIMENSIONS.width,
    height: MARKER_DIMENSIONS.height,
    alignItems: 'center',
  },
  markerPlate: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: colors.yellow,
    borderColor: colors.navyDeep,
    borderWidth: 6,
    borderRadius: radius.sign,
    paddingVertical: space.s,
    paddingHorizontal: space.s,
  },
  markerTitle: { color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  markerDistance: { color: colors.ink, fontSize: 24, lineHeight: 30, fontWeight: '800' },
  markerAnchor: {
    color: colors.yellow,
    fontSize: 48,
    lineHeight: 52,
    fontWeight: '900',
    textShadowColor: colors.navyDeep,
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 0 },
  },
  topBar: {
    paddingTop: (StatusBar.currentHeight ?? 40) + space.s,
    paddingBottom: space.m,
    paddingHorizontal: space.m,
    backgroundColor: colors.navy,
    borderBottomWidth: 6,
    borderBottomColor: colors.yellow,
    gap: space.s,
  },
  notification: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    elevation: 4,
    backgroundColor: colors.paper,
    borderBottomWidth: 4,
    borderBottomColor: colors.yellow,
  },
  notificationContent: { padding: space.m, gap: space.s },
  invitationContent: { gap: space.s },
  notificationTitle: { ...type.title, color: colors.ink },
  notificationText: { ...type.body, color: colors.ink },
  dismissNotification: {
    alignSelf: 'flex-end',
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.m,
    backgroundColor: colors.navy,
    borderRadius: radius.button,
  },
  dismissNotificationText: { ...type.small, color: colors.white },
  brand: { color: colors.yellow, ...type.small, fontWeight: '900' },
  instructionRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 88 },
  glyph: {
    color: colors.yellow,
    fontSize: 80,
    lineHeight: 88,
    fontWeight: '900',
    minWidth: 80,
    textAlign: 'center',
  },
  instructionText: { flex: 1 },
  instruction: { color: colors.white, ...type.hero },
  distanceCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    alignItems: 'center',
    minWidth: 96,
  },
  distanceValue: { color: colors.ink, fontSize: 40, lineHeight: 46, fontWeight: '900' },
  distanceUnit: { color: colors.ink, ...type.small },
  message: { color: colors.white, ...type.title },
  retry: {
    backgroundColor: colors.yellow,
    minHeight: 72,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: colors.ink, ...type.title },
});

import { useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule as Recognition } from 'expo-speech-recognition';
import { useEffect, useState } from 'react';
import {
  AppState,
  Linking,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { assistantConversation } from '@/src/assistant';
import { CameraSession } from '@/src/CameraSession';
import { HelpPanel } from '@/src/HelpPanel';
import { colors, radius, space, type } from '@/src/theme';

export default function App() {
  const [, requestCameraPermission] = useCameraPermissions();
  const [allowed, setAllowed] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [session, setSession] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = () => {
    assistantConversation.interrupt();
    try {
      Recognition.abort();
    } catch {}
    void Speech.stop().catch(() => {});
    setHelpOpen(true);
  };

  const requestAccess = async () => {
    setRequesting(true);
    setError('');
    try {
      if (Platform.OS !== 'android')
        throw new Error('Ta aplikacja działa tylko na telefonach z Androidem.');
      const camera = await requestCameraPermission();
      if (!camera.granted) throw new Error('Zezwól na aparat w ustawieniach telefonu.');
      const location = await Location.requestForegroundPermissionsAsync();
      if (!location.granted) throw new Error('Zezwól na lokalizację w ustawieniach telefonu.');
      if (!(await Location.hasServicesEnabledAsync()))
        throw new Error('Włącz lokalizację (GPS) w telefonie.');
      setAllowed(true);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Coś poszło nie tak. Spróbuj jeszcze raz.',
      );
    } finally {
      setRequesting(false);
    }
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) =>
      setActive(next === 'active'),
    );
    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.navy} />
      {helpOpen ? null : allowed && active ? (
        <CameraSession key={session} restart={() => setSession((value) => value + 1)} />
      ) : (
        <View style={styles.waiting}>
          <View
            style={styles.plate}
            accessible
            accessibilityRole="header"
            accessibilityLabel="ProwadźMnie"
          >
            <Text style={styles.wordmark}>ProwadźMnie</Text>
          </View>
          {error ? (
            <View style={styles.errorCard} accessibilityLiveRegion="assertive">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : (
            <Text style={styles.text}>
              {allowed
                ? 'Wróć do aplikacji, aby kontynuować rozmowę i drogę.'
                : 'Pomogę Ci dojść na miejsce. Powiedz na przykład: „Zaprowadź mnie do apteki”.'}
            </Text>
          )}
          <View style={styles.actions}>
            {!allowed && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={error ? 'Spróbuj ponownie' : 'Zaczynamy'}
                disabled={requesting}
                style={[styles.button, requesting && styles.busy]}
                onPress={() => void requestAccess()}
              >
                <Text style={styles.buttonText}>
                  {requesting ? 'Chwileczkę…' : error ? 'Spróbuj ponownie' : 'Zaczynamy'}
                </Text>
              </Pressable>
            )}
            {!!error && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Otwórz ustawienia"
                style={styles.settings}
                onPress={() => void Linking.openSettings()}
              >
                <Text style={styles.settingsText}>Otwórz ustawienia</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
      {!helpOpen && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pomoc. Zatrzymaj nawigację i wybierz pomoc"
          onPress={openHelp}
          style={styles.helpButton}
        >
          <Text style={styles.helpIcon}>SOS</Text>
          <Text style={styles.helpLabel}>Pomoc</Text>
        </Pressable>
      )}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navy },
  helpButton: {
    position: 'absolute',
    left: space.m,
    bottom: 96,
    width: 88,
    minHeight: 96,
    padding: space.s,
    borderRadius: radius.card,
    borderWidth: 3,
    borderColor: colors.white,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },
  helpIcon: { ...type.title, color: colors.white },
  helpLabel: { ...type.small, color: colors.white },
  waiting: { flex: 1, justifyContent: 'center', padding: space.l, gap: space.l },
  plate: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: colors.yellow,
    borderColor: colors.navyDeep,
    borderWidth: 6,
    borderRadius: radius.sign,
    paddingVertical: space.l,
    paddingHorizontal: space.m,
  },
  wordmark: { color: colors.ink, fontSize: 40, lineHeight: 48, fontWeight: '900' },
  text: { color: colors.white, ...type.title },
  errorCard: { backgroundColor: colors.errorBg, borderRadius: radius.card, padding: space.l },
  errorText: { color: colors.ink, ...type.title },
  actions: { gap: space.m },
  button: {
    backgroundColor: colors.yellow,
    minHeight: 88,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busy: { backgroundColor: colors.white },
  buttonText: { color: colors.ink, fontSize: 32, lineHeight: 38, fontWeight: '900' },
  settings: {
    borderColor: colors.white,
    borderWidth: 4,
    minHeight: 72,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsText: { color: colors.white, ...type.title },
});

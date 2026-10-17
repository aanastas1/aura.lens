import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { CameraSession } from './src/CameraSession';

export default function App() {
  const [, requestCameraPermission] = useCameraPermissions();
  const [allowed, setAllowed] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [session, setSession] = useState(0);

  const requestAccess = async () => {
    setRequesting(true);
    setError('');
    try {
      if (Platform.OS !== 'android') throw new Error('This prototype targets Android in Expo Go.');
      const camera = await requestCameraPermission();
      if (!camera.granted) throw new Error('Allow Expo Go to use the camera, then retry.');
      const location = await Location.requestForegroundPermissionsAsync();
      if (!location.granted) throw new Error('Allow Expo Go to use precise foreground location, then retry.');
      if (!await Location.hasServicesEnabledAsync()) throw new Error('Turn on your phone’s location services, then retry.');
      setAllowed(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start the demo.');
    } finally {
      setRequesting(false);
    }
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => setActive(next === 'active'));
    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      {allowed && active ? (
        <CameraSession key={session} restart={() => setSession(value => value + 1)} />
      ) : (
        <View style={styles.waiting}>
          <Text style={styles.title}>Nearby AR · Expo Go</Text>
          <Text style={styles.text}>{error || (allowed ? 'Return to the app to start a new session.' : 'A camera overlay with three geographic text banners. Allow camera and precise location access to begin.')}</Text>
          {!allowed && <Pressable accessibilityRole="button" disabled={requesting} style={styles.button} onPress={() => void requestAccess()}>
            <Text style={styles.buttonText}>{requesting ? 'Requesting access…' : error ? 'Retry permissions' : 'Start demo'}</Text>
          </Pressable>}
          {!!error && <Pressable onPress={() => void Linking.openSettings()}><Text style={styles.text}>Open Expo Go settings</Text></Pressable>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#11151B' },
  waiting: { flex: 1, justifyContent: 'center', padding: 28, gap: 18 },
  title: { color: '#FFFFFF', fontSize: 23, fontWeight: '700' },
  text: { color: '#FFFFFF', fontSize: 16, lineHeight: 23 },
  button: { backgroundColor: '#3677E8', padding: 15, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});

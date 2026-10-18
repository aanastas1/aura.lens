import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import * as React from 'react';

const react = { ...React };
let states = [];
let stateIndex = 0;
let locationGranted = false;
let servicesEnabled = false;
let permissionError = false;
let cameraGranted = true;
mock.module('react', () => ({
  ...react,
  useEffect: () => {},
  useState: (initial) => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = initial;
    return [
      states[index],
      (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value;
      },
    ];
  },
}));
mock.module('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  StatusBar: 'StatusBar',
  AppState: { currentState: 'active' },
  Linking: {},
  Platform: { OS: 'android' },
  StyleSheet: { create: (styles) => styles },
}));
mock.module('expo-camera', () => ({
  useCameraPermissions: () => [null, async () => ({ granted: cameraGranted })],
}));
mock.module('expo-location', () => ({
  requestForegroundPermissionsAsync: async () => {
    if (permissionError) throw new Error('Location unavailable');
    return { granted: locationGranted };
  },
  hasServicesEnabledAsync: async () => servicesEnabled,
}));
mock.module('expo-speech', () => ({}));
mock.module('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {} }));
mock.module('@/src/assistant', () => ({ assistantConversation: {} }));
mock.module('@/src/CameraSession', () => ({ CameraSession: 'CameraSession' }));
mock.module('@/src/HelpPanel', () => ({ HelpPanel: 'HelpPanel' }));
const { default: App } = await import('@/App');
const elements = (element) => [
  element,
  ...react.Children.toArray(element.props.children).filter(react.isValidElement).flatMap(elements),
];
const render = () => {
  stateIndex = 0;
  return elements(App());
};

for (const scenario of [
  { granted: false, enabled: true, error: false },
  { granted: true, enabled: false, error: false },
  { granted: false, enabled: false, error: true },
  { granted: true, enabled: true, error: false },
]) {
  states = [];
  locationGranted = scenario.granted;
  servicesEnabled = scenario.enabled;
  permissionError = scenario.error;
  const start = render().find((element) => element.props.accessibilityLabel === 'Zaczynamy');
  start.props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(
    render().some((element) => element.type === 'CameraSession'),
    `Camera and destination must remain accessible: ${JSON.stringify(scenario)}`,
  );
}
states = [];
cameraGranted = false;
render()
  .find((element) => element.props.accessibilityLabel === 'Zaczynamy')
  .props.onPress();
await new Promise((resolve) => setImmediate(resolve));
assert.ok(
  !render().some((element) => element.type === 'CameraSession'),
  'Camera permission is still required',
);
console.log('PASS: GPS failures do not block the camera; camera permission is still required.');

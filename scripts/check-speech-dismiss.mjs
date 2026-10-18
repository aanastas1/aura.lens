import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import * as React from 'react';

const react = { ...React };
const hooks = [];
let cursor = 0;
let mounted = false;
let effects = [];
let reminder;
let stopped = 0;
const utterances = [];
mock.module('react', () => ({
  ...react,
  useState: (initial) => {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = initial;
    return [
      hooks[index],
      (value) => {
        hooks[index] = typeof value === 'function' ? value(hooks[index]) : value;
      },
    ];
  },
  useRef: (initial) => {
    const index = cursor++;
    hooks[index] ??= { current: initial };
    return hooks[index];
  },
  useEffect: (effect) => {
    if (!mounted) effects.push(effect);
  },
}));
mock.module('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Linking: {},
  useWindowDimensions: () => ({ height: 800 }),
  StyleSheet: { create: (styles) => styles },
  AccessibilityInfo: {
    isReduceMotionEnabled: async () => false,
    addEventListener: () => ({ remove() {} }),
  },
  Animated: {
    Value: class {
      setValue() {}
    },
  },
}));
mock.module('expo/fetch', () => ({ fetch() {} }));
mock.module('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {},
  useSpeechRecognitionEvent() {},
}));
mock.module('expo-speech', () => ({
  speak: (text, options) => utterances.push({ text, options }),
  stop: async () => {
    stopped++;
  },
}));
globalThis.setInterval = (callback) => {
  reminder = callback;
  return 1;
};
const { VoiceAssistant } = await import('@/src/VoiceAssistant');
const props = {
  capturePhoto: async () => ({}),
  conversation: {
    navigation: { sources: () => [], reminder: () => 'Idź do następnego skrzyżowania.' },
  },
  announcement: null,
  onAnnouncementRead() {},
};
const elements = (element) => [
  element,
  ...react.Children.toArray(element.props.children).filter(react.isValidElement).flatMap(elements),
];
const render = () => {
  cursor = 0;
  const tree = elements(VoiceAssistant(props));
  const pending = effects;
  effects = [];
  mounted = true;
  for (const effect of pending) effect();
  return tree;
};
render();
reminder();
const first = utterances[0];
assert.ok(first, 'The phone must actually be speaking before the tap');
const bubble = render().find(
  (element) => element.props.accessibilityLabel === 'Przerwij czytanie i zamknij dymek',
);
assert.ok(bubble?.props.onPress, 'The spoken answer bubble must accept a tap');
bubble.props.onPress();
assert.equal(stopped, 1, 'Tapping must immediately stop speech');
assert.ok(
  !render().some((element) => element.props.children === first.text),
  'Tapping must close the bubble',
);
reminder();
assert.equal(utterances.length, 2, 'The assistant must be available after dismissal');
first.options.onDone();
first.options.onStopped();
first.options.onError();
assert.ok(
  render().some((element) => element.props.children === first.text),
  'Late speech callbacks must not close a newer bubble',
);
console.log(
  'PASS: tapping a speaking bubble stops speech and closes it; late callbacks preserve the next answer.',
);

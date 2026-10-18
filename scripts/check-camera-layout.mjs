// Render the actual session JSX and lay it out with React Native's Yoga engine.
// Native hardware and side effects are replaced only in this isolated process.

import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import Yoga from 'yoga-layout';

const react = { ...React };
let stateIndex = 0;
let statusMessage = null;
let notification = null;
let frozenFrame = null;
let viewport = { width: 412, height: 700 };
let liveSample = false;
let liveGpsAge = 0;
let liveGpsAvailable = true;
let sessionEffects = [];
let renderedDisplay;
let nextFrame;
const routeOrigin = { latitude: 52.2, longitude: 21 };
globalThis.requestAnimationFrame = (callback) => {
  nextFrame = callback;
  return 1;
};
globalThis.cancelAnimationFrame = () => {};
mock.module('react', () => ({
  ...react,
  useCallback: (fn) => fn,
  useEffect: (effect) => {
    sessionEffects.push(effect);
  },
  useRef: (current) => {
    if (liveSample && current?.position) {
      const now = Date.now();
      if (liveGpsAvailable)
        current.position.observeGps(
          { ...routeOrigin, accuracy: 4, timestamp: now - liveGpsAge },
          now - liveGpsAge,
        );
      Object.assign(current, {
        gravity: [0, 1, 0],
        magnetic: [0, -45, -20],
        declination: 0,
        gravityTimestamp: now,
        magneticTimestamp: now,
      });
    }
    return { current };
  },
  useState: (initial) => {
    const index = stateIndex++;
    const value = typeof initial === 'function' ? initial() : initial;
    return [
      index === 2
        ? notification
        : index === 4
          ? viewport
          : index === 5 && liveSample
            ? true
            : index === 6
              ? frozenFrame
              : index === 9 && statusMessage
                ? {
                    ...value,
                    ...(typeof statusMessage === 'string'
                      ? { message: statusMessage }
                      : statusMessage),
                  }
                : value,
      (next) => {
        if (index === 9) renderedDisplay = next;
      },
    ];
  },
}));
const absoluteFill = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 };
mock.module('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StatusBar: { currentHeight: 24 },
  TurboModuleRegistry: { get: () => null },
  StyleSheet: { create: (styles) => styles, absoluteFill, absoluteFillObject: absoluteFill },
}));
mock.module('expo-camera', () => ({ CameraView: 'CameraView' }));
const locationWatchers = [];
let cachedLocation = null;
mock.module('expo-location', () => ({
  Accuracy: { Highest: 6 },
  getLastKnownPositionAsync: async () => cachedLocation,
  watchPositionAsync: async (_options, onLocation, onError) => {
    const watcher = {
      onLocation,
      onError,
      removed: false,
      remove() {
        this.removed = true;
      },
    };
    locationWatchers.push(watcher);
    return watcher;
  },
}));
mock.module('expo-sensors', () => ({ Accelerometer: {}, Magnetometer: {} }));
mock.module('@/src/VoiceAssistant', () => ({ VoiceAssistant: 'VoiceAssistant' }));
const { createNavigation } = await import('@/src/navigation');
const cefarm = {
  id: 'cefarm',
  name: 'Cefarm',
  address: '',
  location: { latitude: 52.2, longitude: 21.003 },
};
const bend = { latitude: 52.201, longitude: 21 };
let navigationClock = Date.now();
const navigation = createNavigation(
  {
    search: async () => [cefarm],
    route: async () => ({
      steps: [
        {
          instruction: 'Idź na północ, potem skręć w prawo.',
          distance: 300,
          path: [routeOrigin, bend, cefarm.location],
        },
      ],
      distance: 300,
      durationSeconds: 240,
      warnings: [],
    }),
  },
  () => navigationClock,
);
mock.module('@/src/assistant', () => ({ assistantConversation: { navigation } }));
const { CameraSession } = await import('@/src/CameraSession');
const { waypointHud } = await import('@/src/positioning');
const { TENDUR_KEBAB } = await import('@/src/banners');

const childrenOf = (element) =>
  react.Children.toArray(element.props.children).filter(react.isValidElement);
const flatStyle = (style) =>
  Object.assign(
    {},
    ...[style].flat(Infinity).filter((value) => value && typeof value === 'object'),
  );
const textOf = (element) =>
  react.Children.toArray(element.props.children)
    .map((child) =>
      typeof child === 'object' && react.isValidElement(child) ? textOf(child) : String(child),
    )
    .join('');

function layout(notificationText, snapshot, width, height, status = null) {
  statusMessage = status;
  notification = notificationText
    ? { sender: 'Maria', text: notificationText, createdAt: 1 }
    : null;
  frozenFrame = snapshot
    ? { uri: 'fixture.jpg', panels: [], target: { id: 'fixture', name: 'Fixture' } }
    : null;
  stateIndex = 0;
  viewport = { width, height: height - 160 };
  const tree = CameraSession({ restart() {} });
  const nodes = [];
  function build(element, parent = null) {
    const node = Yoga.Node.create();
    const style = flatStyle(element.props.style);
    const record = { element, node, parent };
    nodes.push(record);
    if (style.position === 'absolute') node.setPositionType(Yoga.POSITION_TYPE_ABSOLUTE);
    if (style.flexDirection)
      node.setFlexDirection(
        style.flexDirection === 'row' ? Yoga.FLEX_DIRECTION_ROW : Yoga.FLEX_DIRECTION_COLUMN,
      );
    for (const key of [
      'width',
      'height',
      'minWidth',
      'minHeight',
      'maxWidth',
      'maxHeight',
      'flex',
      'flexGrow',
      'flexShrink',
    ]) {
      if (typeof style[key] === 'number')
        node[`set${key[0].toUpperCase()}${key.slice(1)}`](style[key]);
    }
    for (const [edgeName, edge] of [
      ['Top', Yoga.EDGE_TOP],
      ['Right', Yoga.EDGE_RIGHT],
      ['Bottom', Yoga.EDGE_BOTTOM],
      ['Left', Yoga.EDGE_LEFT],
    ]) {
      if (typeof style[edgeName.toLowerCase()] === 'number')
        node.setPosition(edge, style[edgeName.toLowerCase()]);
      for (const prop of ['padding', 'margin']) {
        const value =
          style[`${prop}${edgeName}`] ??
          style[
            `${prop}${edgeName === 'Top' || edgeName === 'Bottom' ? 'Vertical' : 'Horizontal'}`
          ] ??
          style[prop];
        if (typeof value === 'number')
          node[`set${prop[0].toUpperCase()}${prop.slice(1)}`](edge, value);
      }
      const border = style[`border${edgeName}Width`] ?? style.borderWidth;
      if (typeof border === 'number') node.setBorder(edge, border);
    }
    if (typeof style.gap === 'number') node.setGap(Yoga.GUTTER_ALL, style.gap);
    if (element.type === 'Text') {
      const fontSize = style.fontSize ?? 20;
      const lineHeight = style.lineHeight ?? fontSize * 1.2;
      const naturalWidth = textOf(element).length * fontSize * 0.5;
      node.setMeasureFunc((availableWidth) => ({
        width: Math.min(
          naturalWidth,
          Number.isFinite(availableWidth) ? availableWidth : naturalWidth,
        ),
        height:
          Math.max(1, Math.ceil(naturalWidth / Math.max(1, availableWidth || naturalWidth))) *
          lineHeight,
      }));
    } else if (element.type !== 'VoiceAssistant') {
      for (const child of childrenOf(element))
        node.insertChild(build(child, record), node.getChildCount());
    }
    return node;
  }
  const root = build(tree);
  root.setWidth(width);
  root.setHeight(height);
  root.calculateLayout(width, height, Yoga.DIRECTION_LTR);
  const camera = nodes.find((record) => record.element.type === 'CameraView');
  assert.ok(camera, 'actual CameraSession must render a camera');
  const rect = (record) => {
    const box = record.node.getComputedLayout();
    const offset = record.parent ? rect(record.parent) : { left: 0, top: 0 };
    return {
      left: box.left + offset.left,
      top: box.top + offset.top,
      width: box.width,
      height: box.height,
    };
  };
  if (notificationText) {
    const card = nodes.find(
      (record) =>
        record.element.type === 'View' &&
        flatStyle(record.element.props.style).borderBottomWidth === 4 &&
        textOf(record.element).includes(notificationText),
    );
    assert.ok(
      card && rect(card).height > 0,
      'the notification must actually be visible during the layout test',
    );
  }
  const result = {
    glyph: nodes.find(
      (record) =>
        record.element.type === 'Text' && flatStyle(record.element.props.style).fontSize === 80,
    )?.element.props.children,
    text: textOf(tree),
    camera: rect(camera),
    ratio: camera.element.props.ratio,
    snapshotMode: nodes.find((record) => record.element.type === 'Image')?.element.props.resizeMode,
  };
  root.freeRecursive();
  return result;
}

const scenarios = [
  ['short notification', 'Krótka wiadomość.'],
  ['long notification', 'Jadwigo, chcę Cię odwiedzić z Kajetanem. '.repeat(5)],
];
const errors = [];
cachedLocation = { coords: { ...routeOrigin, accuracy: 80 }, timestamp: Date.now() - 2000 };
sessionEffects = [];
layout(null, false, 412, 892);
const actualSetTimeout = globalThis.setTimeout;
const actualClearTimeout = globalThis.clearTimeout;
let retry;
globalThis.setTimeout = (callback, delay) => {
  retry = { callback, delay };
  return 1;
};
globalThis.clearTimeout = () => {};
const stopGps = sessionEffects.at(-2)();
await Promise.resolve();
assert.equal(
  navigation.context().location.accuracy,
  80,
  'Use the cached coarse location before live GPS starts',
);
locationWatchers[0].onError();
assert.equal(retry.delay, 3000, 'Location errors must schedule a new attempt');
retry.callback();
await Promise.resolve();
assert.equal(locationWatchers.length, 2, 'Retry must actually restart the native location watcher');
assert.equal(locationWatchers[0].removed, true);
locationWatchers[1].onLocation({
  coords: { ...routeOrigin, accuracy: 60 },
  timestamp: Date.now() - 1000,
});
assert.equal(
  navigation.context().location.accuracy,
  60,
  'Keep consuming coarse live location updates',
);
stopGps();
const stoppedFix = navigation.context().location;
locationWatchers[1].onLocation({ coords: { ...routeOrigin, accuracy: 40 }, timestamp: Date.now() });
assert.deepEqual(
  navigation.context().location,
  stoppedFix,
  'Unmounting must ignore late native callbacks',
);
assert.equal(locationWatchers[1].removed, true);
globalThis.setTimeout = actualSetTimeout;
globalThis.clearTimeout = actualClearTimeout;
navigation.updateLocation({ ...routeOrigin, accuracy: 4, timestamp: navigationClock });
await navigation.execute({ action: 'search', query: 'Cefarm' }, new AbortController().signal);
await navigation.execute({ action: 'start', placeId: cefarm.id }, new AbortController().signal);
liveSample = true;
sessionEffects = [];
layout(null, false, 412, 892);
const stopAnimation = sessionEffects.at(-1)();
nextFrame(100);
stopAnimation();
assert.equal(
  renderedDisplay.target.name,
  'Cefarm',
  'An active route must show its selected destination instead of Tendur',
);
assert.equal(renderedDisplay.panels.length, 1, 'An active route must show a direction arrow');
assert.ok(
  Math.abs(renderedDisplay.panels[0].relativeBearing) < 1,
  'The arrow must follow the northward street segment, rather than point east directly at Cefarm',
);
navigationClock += 6000;
liveGpsAge = 6000;
for (const hasPreviousFix of [true, false]) {
  if (!hasPreviousFix) navigationClock += 60000;
  liveGpsAvailable = hasPreviousFix;
  sessionEffects = [];
  layout(null, false, 412, 892);
  const stopWaitingAnimation = sessionEffects.at(-1)();
  nextFrame(100);
  stopWaitingAnimation();
  assert.equal(renderedDisplay.target.name, 'Cefarm');
  assert.equal(
    renderedDisplay.panels.length,
    1,
    'An active route must retain its marker while GPS is unavailable',
  );
  assert.equal(renderedDisplay.panels[0].stale, true);
  assert.equal(renderedDisplay.panels[0].pending, !hasPreviousFix);
  assert.match(
    renderedDisplay.message,
    /GPS|przybliżona/,
    'Stale route directions must report their location quality',
  );
}
navigationClock += 1000;
navigation.updateLocation({ ...routeOrigin, accuracy: 80, timestamp: navigationClock });
sessionEffects = [];
layout(null, false, 412, 892);
const stopApproximateAnimation = sessionEffects.at(-1)();
nextFrame(100);
stopApproximateAnimation();
assert.equal(renderedDisplay.target.name, 'Cefarm');
assert.equal(
  renderedDisplay.panels[0].pending,
  false,
  'Coarse location must orient a real arrow even before the first precise fix',
);
assert.ok(Math.abs(renderedDisplay.panels[0].relativeBearing) < 1);
assert.match(renderedDisplay.message, /przybliżona/);
navigation.stopAll();
sessionEffects = [];
layout(null, false, 412, 892);
const stopSuspendedAnimation = sessionEffects.at(-1)();
nextFrame(100);
stopSuspendedAnimation();
assert.equal(renderedDisplay.panels.length, 0, 'SOS must still hide navigation arrows');
liveSample = false;
const lastDirection = waypointHud(
  { coordinate: { latitude: 52.23, longitude: 21.01 }, heading: 90, current: false },
  TENDUR_KEBAB,
  412,
  700,
);
const ready = layout(null, false, 412, 892, {
  panels: [{ ...lastDirection, stale: false }],
  message: '',
});
for (const message of [
  'Szukam sygnału GPS. Wyjdź na zewnątrz.',
  'Trzymaj telefon spokojnie.',
  'Nie działa kompas w telefonie. Spróbuj ponownie.',
]) {
  const waiting = layout(null, false, 412, 892, { panels: [lastDirection], message });
  assert.equal(
    waiting.glyph,
    ready.glyph,
    'Losing GPS or sensors must keep the last direction visible beside the status',
  );
  assert.ok(waiting.text.includes(message), 'The stale direction must retain its warning');
  assert.ok(
    !waiting.text.includes('Idź prosto'),
    'Stale readings must not issue walking instructions',
  );
}
const pending = waypointHud(
  { coordinate: null, heading: null, current: false },
  TENDUR_KEBAB,
  412,
  700,
);
assert.equal(
  layout(null, false, 412, 892, { panels: [pending], message: 'Szukam sygnału GPS.' }).glyph,
  '…',
  'Before the first fix, show a waiting indicator without inventing a direction',
);
for (const [width, height] of [
  [412, 892],
  [360, 800],
]) {
  const before = layout(null, false, width, height);
  const shortStatus = layout(null, false, width, height, 'Czekam na GPS.');
  const longStatus = layout(null, false, width, height, 'Szukam sygnału GPS. Wyjdź na zewnątrz.');
  try {
    assert.deepEqual(shortStatus.camera, longStatus.camera);
  } catch {
    errors.push(`${width}×${height}: GPS status text resized the camera viewport`);
  }

  for (const [name, message] of scenarios) {
    const after = layout(message, false, width, height);
    try {
      assert.deepEqual(after.camera, before.camera);
    } catch {
      errors.push(
        `${width}×${height}, ${name}: camera changed from ${JSON.stringify(before.camera)} to ${JSON.stringify(after.camera)}`,
      );
    }
  }
  // Expo's explicit 16:9 / 4:3 ratio selects FIT_CENTER on Android, causing bars.
  if (before.ratio && before.ratio !== '1:1')
    errors.push(
      `${width}×${height}: ratio=${before.ratio} selects FIT_CENTER rather than filling the camera viewport`,
    );
  if (layout('Snapshot', true, width, height).snapshotMode !== 'cover')
    errors.push(`${width}×${height}: frozen camera image must fill the same viewport with cover`);
}
assert.deepEqual(errors, [], errors.join('\n'));
console.log(
  'PASS: notification changes do not move or resize the camera; live and frozen previews fill the viewport.',
);

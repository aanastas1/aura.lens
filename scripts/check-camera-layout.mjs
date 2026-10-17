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
mock.module('react', () => ({
  ...react,
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: (current) => ({ current }),
  useState: (initial) => {
    const index = stateIndex++;
    const value = typeof initial === 'function' ? initial() : initial;
    return [
      index === 2
        ? notification
        : index === 4
          ? viewport
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
      () => {},
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
mock.module('expo-location', () => ({}));
mock.module('expo-sensors', () => ({ Accelerometer: {}, Magnetometer: {} }));
mock.module('@/src/VoiceAssistant', () => ({ VoiceAssistant: 'VoiceAssistant' }));
const { CameraSession } = await import('@/src/CameraSession');

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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTripleTap, randomInvitation } from './invitations';

describe('invitation trigger', () => {
  it('requires three taps within 1.2 seconds and starts counting again after firing', () => {
    const tap = createTripleTap();
    assert.equal(tap(0), false);
    assert.equal(tap(600), false);
    assert.equal(tap(1200), true);
    assert.equal(tap(1300), false);
    assert.equal(tap(1400), false);
    assert.equal(tap(1500), true);
  });

  it('discards taps outside the time window', () => {
    const tap = createTripleTap();
    assert.equal(tap(0), false);
    assert.equal(tap(1000), false);
    assert.equal(tap(1300), false);
    assert.equal(tap(2000), true);
  });

  it('generates invitations addressed to Jadwiga from both friends, with the expected places', () => {
    const notifications = [0, 0.25, 0.5, 0.999].map(value => randomInvitation(() => value, 123));
    assert.deepEqual(notifications.map(item => item.sender), ['Basia', 'Basia', 'Danka', 'Danka']);
    for (const notification of notifications) {
      assert.equal(notification.createdAt, 123);
      assert.match(notification.text, /Jadwigo/);
      assert.match(notification.text, notification.sender === 'Basia' ? /parku Morskie Oko na Starym Mokotowie/ : /ciast/);
      if (notification.sender === 'Danka') assert.match(notification.text, /bloku/);
    }
  });
});

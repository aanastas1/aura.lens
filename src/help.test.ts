import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type HelpContact,
  type HelpState,
  helpReducer,
  INITIAL_HELP_STATE,
  openHelpNumber,
} from '@/src/help';

describe('simplified help choices', () => {
  it('opens no phone from SOS, describing a problem, going back or cancelling', async () => {
    const calls: string[] = [];
    const openPhone = async (url: string) => {
      calls.push(url);
    };
    let state: HelpState = INITIAL_HELP_STATE;
    assert.equal(await openHelpNumber(state, 'ambulance', openPhone), false);
    state = helpReducer(state, { type: 'dialerOpened', contact: 'ambulance' });
    assert.deepEqual(state, INITIAL_HELP_STATE);
    state = helpReducer(state, { type: 'describeSelected' });
    assert.equal(state.step, 'describe');
    assert.equal(await openHelpNumber(state, 'maria', openPhone), false);
    state = helpReducer(state, { type: 'back' });
    assert.equal(state.step, 'question');
    assert.equal(await openHelpNumber(state, 'emergency', openPhone), false);
    assert.equal(calls.length, 0);
  });

  it('prepares the selected number immediately after choosing Zadzwoń, without a further confirmation screen', async () => {
    for (const [contact, number] of [
      ['maria', '111111111'],
      ['ambulance', '999'],
      ['emergency', '112'],
    ] as [HelpContact, string][]) {
      const calls: string[] = [];
      let state = helpReducer(INITIAL_HELP_STATE, { type: 'callSelected' });
      assert.equal(state.step, 'contacts');
      assert.equal(calls.length, 0, 'Zadzwoń only shows contacts');
      assert.equal(
        await openHelpNumber(state, contact, async (url) => {
          calls.push(url);
        }),
        true,
      );
      assert.deepEqual(calls, [`tel:${number}`]);
      state = helpReducer(state, { type: 'dialerOpened', contact });
      assert.equal(state.step, 'opened');
      assert.equal(
        await openHelpNumber(state, contact, async (url) => {
          calls.push(url);
        }),
        false,
      );
      assert.equal(calls.length, 1);
    }
  });

  it('keeps the written or dictated description available when choosing a contact', () => {
    let state = helpReducer(INITIAL_HELP_STATE, { type: 'describeSelected' });
    state = helpReducer(state, {
      type: 'descriptionChanged',
      text: 'Potrzebuję wsparcia. Czekam przy przystanku.',
    });
    state = helpReducer(state, { type: 'callSelected' });
    assert.equal(state.step, 'contacts');
    assert.equal(state.description, 'Potrzebuję wsparcia. Czekam przy przystanku.');
    state = helpReducer(state, { type: 'back' });
    state = helpReducer(state, { type: 'describeSelected' });
    assert.equal(state.description, 'Potrzebuję wsparcia. Czekam przy przystanku.');
  });

  it('does not report that the phone opened on failure or retry automatically', async () => {
    let calls = 0;
    const state = helpReducer(INITIAL_HELP_STATE, { type: 'callSelected' });
    await assert.rejects(
      openHelpNumber(state, 'emergency', async () => {
        calls++;
        throw new Error('No dialer');
      }),
      /No dialer/,
    );
    assert.equal(state.step, 'contacts');
    assert.equal(calls, 1);
  });
});

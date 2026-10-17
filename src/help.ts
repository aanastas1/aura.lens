export const HELP_CONTACTS = {
  maria: { name: 'Maria — córka', number: '111-111-111' },
  ambulance: { name: 'Pogotowie ratunkowe', number: '999' },
  emergency: { name: 'Numer alarmowy', number: '112' },
} as const;

export type HelpContact = keyof typeof HELP_CONTACTS;
export type HelpState =
  | { step: 'question' | 'contacts' | 'describe'; description: string }
  | { step: 'opened'; description: string; contact: HelpContact };
export type HelpAction =
  | { type: 'callSelected' }
  | { type: 'describeSelected' }
  | { type: 'descriptionChanged'; text: string }
  | { type: 'dialerOpened'; contact: HelpContact }
  | { type: 'back' };

export const INITIAL_HELP_STATE: HelpState = { step: 'question', description: '' };

export function helpReducer(state: HelpState, action: HelpAction): HelpState {
  if (action.type === 'callSelected' && (state.step === 'question' || state.step === 'describe')) {
    return { step: 'contacts', description: state.description };
  }
  if (action.type === 'describeSelected' && state.step === 'question') {
    return { step: 'describe', description: state.description };
  }
  if (action.type === 'descriptionChanged' && state.step === 'describe') {
    return { ...state, description: action.text };
  }
  if (action.type === 'dialerOpened' && state.step === 'contacts') {
    return { step: 'opened', description: state.description, contact: action.contact };
  }
  if (action.type === 'back') {
    return state.step === 'opened'
      ? { step: 'contacts', description: state.description }
      : { step: 'question', description: state.description };
  }
  return state;
}

// Contact selection after "Zadzwoń" prepares the number in the phone app; never places a call.
export async function openHelpNumber(
  state: HelpState,
  contact: HelpContact,
  openDialer: (url: string) => Promise<unknown>,
): Promise<boolean> {
  if (state.step !== 'contacts') return false;
  await openDialer(`tel:${HELP_CONTACTS[contact].number.replace(/-/g, '')}`);
  return true;
}

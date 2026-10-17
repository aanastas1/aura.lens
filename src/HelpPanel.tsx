import { fetch as expoFetch } from 'expo/fetch';
import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule as Recognition,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useEffect, useReducer, useRef, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { assistantConversation } from '@/src/assistant';
import {
  HELP_CONTACTS,
  type HelpContact,
  helpReducer,
  INITIAL_HELP_STATE,
  openHelpNumber,
} from '@/src/help';
import { createHelpConversation, type HelpVoicePhase } from '@/src/helpConversation';
import { colors, radius, space, type } from '@/src/theme';

export function HelpPanel({ onClose }: { onClose: () => void }) {
  const [state, dispatch] = useReducer(helpReducer, INITIAL_HELP_STATE);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [phase, setPhase] = useState<HelpVoicePhase>('idle');
  const [answer, setAnswer] = useState('');
  const listening = phase === 'listening' || phase === 'stopping';
  const current = useRef(state);
  current.current = state;
  const pending = useRef(false);
  const mounted = useRef(true);
  const voice = useRef<ReturnType<typeof createHelpConversation> | null>(null);
  if (!voice.current)
    voice.current = createHelpConversation({
      async prepare() {
        const permission = await Recognition.requestPermissionsAsync();
        if (!permission.granted)
          throw new Error('Włącz mikrofon w ustawieniach telefonu albo wpisz opis.');
        if (!Recognition.isRecognitionAvailable())
          throw new Error('Nie mogę włączyć mikrofonu. Możesz wpisać opis.');
      },
      start: () =>
        Recognition.start({
          lang: 'pl-PL',
          interimResults: true,
          continuous: true,
          maxAlternatives: 1,
        }),
      stop: () => {
        try {
          Recognition.stop();
        } catch {
          voice.current?.end();
        }
      },
      abort: () => {
        try {
          Recognition.abort();
        } catch {}
      },
      stopSpeaking: () => Speech.stop(),
      speak: (text, onDone, onError) =>
        Speech.speak(text, { language: 'pl-PL', rate: 0.85, onDone, onError }),
      answer: (text, signal) =>
        assistantConversation.answerForHelp(
          text,
          process.env.EXPO_PUBLIC_OPENROUTER_API_KEY || '',
          signal,
          () => {},
          expoFetch as typeof fetch,
        ),
      phase: (value) => {
        if (mounted.current) setPhase(value);
      },
      transcript: (text) => {
        if (mounted.current) dispatch({ type: 'descriptionChanged', text });
      },
      response: (text) => {
        if (mounted.current) setAnswer(text);
      },
      error: (text) => {
        if (mounted.current) setError(text);
      },
    });
  useEffect(() => {
    mounted.current = true;
    void Speech.stop()
      .then(() => {
        if (mounted.current && current.current.step === 'question')
          Speech.speak('Co się stało, Jadwigo? Czy potrzebujesz pomocy?', {
            language: 'pl-PL',
            rate: 0.85,
          });
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      voice.current?.cancel();
    };
  }, []);
  useEffect(() => {
    if (state.step === 'describe') voice.current?.start();
    return () => voice.current?.cancel();
  }, [state.step]);
  const stopDictation = () => voice.current?.cancel();
  useSpeechRecognitionEvent('result', (event) =>
    voice.current?.result(event.results[0]?.transcript || '', event.isFinal),
  );
  useSpeechRecognitionEvent('speechstart', () => voice.current?.speechStart());
  useSpeechRecognitionEvent('speechend', () => voice.current?.speechEnd());
  useSpeechRecognitionEvent('end', () => voice.current?.end());
  useSpeechRecognitionEvent('error', (event) => voice.current?.error(event.error));
  const close = () => {
    if (pending.current) return;
    stopDictation();
    onClose();
  };
  const back = () => {
    if (pending.current) return;
    stopDictation();
    setError('');
    if (state.step === 'question') onClose();
    else dispatch({ type: 'back' });
  };
  const selectContact = async (contact: HelpContact) => {
    if (pending.current || state.step !== 'contacts') return;
    pending.current = true;
    setOpening(true);
    setError('');
    try {
      void Speech.stop().catch(() => {});
      if (!mounted.current) return;
      if (await openHelpNumber(state, contact, (url) => Linking.openURL(url))) {
        if (mounted.current) dispatch({ type: 'dialerOpened', contact });
      }
    } catch {
      if (mounted.current)
        setError(
          `Nie udało się otworzyć telefonu. Wybierz ręcznie numer ${HELP_CONTACTS[contact].number}.`,
        );
    } finally {
      pending.current = false;
      if (mounted.current) setOpening(false);
    }
  };

  return (
    <Modal visible animationType="none" onRequestClose={back}>
      <View style={styles.screen} accessibilityViewIsModal>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text accessibilityRole="header" style={styles.title}>
            {state.step === 'question'
              ? 'Co się stało, Jadwigo?'
              : state.step === 'contacts'
                ? 'Do kogo chcesz zadzwonić?'
                : state.step === 'describe'
                  ? 'Opisz, co się stało'
                  : 'Telefon został otwarty'}
          </Text>
          <Text style={styles.text}>Nawigacja jest wstrzymana.</Text>
          {state.step === 'question' && (
            <>
              <Pressable
                accessibilityRole="button"
                style={styles.button}
                onPress={() => dispatch({ type: 'callSelected' })}
              >
                <Text style={styles.buttonText}>Zadzwoń</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.button}
                onPress={() => dispatch({ type: 'describeSelected' })}
              >
                <Text style={styles.buttonText}>Opisz / opowiedz</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.secondary} onPress={close}>
                <Text style={styles.secondaryText}>Pomyłka</Text>
              </Pressable>
            </>
          )}
          {state.step === 'describe' && (
            <>
              <Text style={styles.text}>
                Powiedz, co się stało. Po trzech sekundach ciszy asystent odpowie. Możesz też wpisać
                opis.
              </Text>
              {!!answer && (
                <Text accessibilityLiveRegion="polite" style={styles.text}>
                  {answer}
                </Text>
              )}
              <TextInput
                multiline
                editable={phase === 'idle'}
                value={state.description}
                style={styles.description}
                accessibilityLabel="Opis sytuacji"
                placeholder="Co się stało?"
                placeholderTextColor={colors.navy}
                onChangeText={(text) => dispatch({ type: 'descriptionChanged', text })}
                textAlignVertical="top"
              />
              {phase === 'idle' && !!state.description.trim() && (
                <Pressable
                  accessibilityRole="button"
                  style={styles.button}
                  onPress={() => voice.current?.submit(state.description)}
                >
                  <Text style={styles.buttonText}>Wyślij opis</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                style={styles.button}
                disabled={phase !== 'idle' && !listening}
                onPress={() => (listening ? voice.current?.stop() : voice.current?.start())}
              >
                <Text style={styles.buttonText}>
                  {listening
                    ? 'Słucham… zakończ wypowiedź'
                    : phase === 'thinking'
                      ? 'Czekam na odpowiedź…'
                      : phase === 'speaking'
                        ? 'Asystent odpowiada…'
                        : phase === 'permission'
                          ? 'Włączam mikrofon…'
                          : 'Opowiedz — włącz mikrofon'}
                </Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.secondary} onPress={back}>
                <Text style={styles.secondaryText}>Wróć</Text>
              </Pressable>
            </>
          )}
          {state.step === 'contacts' && (
            <>
              <Text style={styles.text}>
                Wybierz kontakt. Otworzę telefon z numerem; połączenie zatwierdzisz w telefonie.
              </Text>
              {!!state.description && (
                <Text selectable style={styles.text}>
                  {state.description}
                </Text>
              )}
              {(
                Object.entries(HELP_CONTACTS) as [HelpContact, { name: string; number: string }][]
              ).map(([contact, details]) => (
                <Pressable
                  key={contact}
                  accessibilityRole="button"
                  style={styles.button}
                  disabled={opening}
                  onPress={() => void selectContact(contact)}
                >
                  <Text style={styles.buttonText}>{details.name}</Text>
                  <Text style={styles.number}>{details.number}</Text>
                </Pressable>
              ))}
              <Pressable accessibilityRole="button" style={styles.secondary} onPress={back}>
                <Text style={styles.secondaryText}>Wróć</Text>
              </Pressable>
            </>
          )}
          {state.step === 'opened' && (
            <>
              <Text style={styles.text}>
                Numer: {HELP_CONTACTS[state.contact].number}. Samo otwarcie telefonu nie potwierdza
                połączenia ani wezwania pomocy.
              </Text>
              <Pressable accessibilityRole="button" style={styles.button} onPress={back}>
                <Text style={styles.buttonText}>Wybierz inną pomoc</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.secondary} onPress={close}>
                <Text style={styles.secondaryText}>Zamknij pomoc</Text>
              </Pressable>
            </>
          )}
          {!!error && (
            <Text accessibilityLiveRegion="assertive" style={styles.error}>
              {error}
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy },
  content: {
    padding: space.l,
    paddingTop: space.xl,
    paddingBottom: space.xl,
    gap: space.m,
    flexGrow: 1,
    justifyContent: 'center',
  },
  title: { ...type.hero, color: colors.white },
  text: { ...type.body, color: colors.white },
  description: {
    ...type.body,
    color: colors.ink,
    backgroundColor: colors.paper,
    borderRadius: radius.card,
    padding: space.m,
    minHeight: 150,
    maxHeight: 260,
  },
  button: {
    minHeight: 72,
    padding: space.m,
    borderRadius: radius.card,
    backgroundColor: colors.yellow,
    justifyContent: 'center',
  },
  buttonText: { ...type.title, color: colors.ink },
  number: { ...type.body, color: colors.ink },
  secondary: {
    minHeight: 64,
    padding: space.m,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.white,
    justifyContent: 'center',
  },
  secondaryText: { ...type.body, color: colors.white },
  error: {
    ...type.body,
    color: colors.ink,
    backgroundColor: colors.errorBg,
    padding: space.m,
    borderRadius: radius.card,
  },
});

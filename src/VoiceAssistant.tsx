import { fetch as expoFetch } from 'expo/fetch';
import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule as Recognition,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { type AssistantConversation, type AssistantPhoto } from '@/src/assistant';
import type { Invitation } from '@/src/invitations';
import type { MapSource } from '@/src/navigation';
import { BUTTON_SIZE, colors, radius, space, type } from '@/src/theme';

type Phase =
  | 'idle'
  | 'permission'
  | 'listening'
  | 'stopping'
  | 'answering'
  | 'speaking'
  | 'announcing';
const labels: Record<Phase, string> = {
  idle: 'Przytrzymaj i mów',
  permission: 'Zezwól na mikrofon',
  listening: 'Słucham… puść, gdy skończysz',
  stopping: 'Myślę…',
  answering: 'Myślę…',
  speaking: 'Mówię odpowiedź…',
  announcing: 'Czytam powiadomienie…',
};

type CaptureResult = { photo: AssistantPhoto } | { error: string };

export function VoiceAssistant({
  capturePhoto,
  conversation,
  announcement,
  onAnnouncementRead,
}: {
  capturePhoto: () => Promise<AssistantPhoto>;
  conversation: AssistantConversation;
  announcement: Invitation | null;
  onAnnouncementRead: (announcement: Invitation, completed: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [mapSources, setMapSources] = useState<MapSource[]>([]);
  const refreshMapSources = () =>
    setMapSources([
      ...new Map(conversation.navigation.sources().map((source) => [source.uri, source])).values(),
    ]);
  const state = useRef({
    phase: 'idle' as Phase,
    held: false,
    disposed: false,
    started: false,
    segments: [] as string[],
    partial: '',
    failed: false,
    photo: null as Promise<CaptureResult> | null,
    request: null as AbortController | null,
    stopTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  const { height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (phase !== 'listening' || reduceMotion) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, reduceMotion, pulse]);
  const transition = (next: Phase) => {
    state.current.phase = next;
    if (!state.current.disposed) setPhase(next);
  };
  const text = () =>
    [...state.current.segments, state.current.partial].filter(Boolean).join(' ').trim();

  const finish = async () => {
    const s = state.current;
    if (s.disposed || !['listening', 'stopping'].includes(s.phase)) return;
    clearTimeout(s.stopTimer);
    s.started = false;
    s.held = false;
    const recognized = text();
    if (s.failed || !recognized) {
      if (!s.failed) setError('Nie usłyszałem. Przytrzymaj przycisk i powiedz jeszcze raz.');
      transition('idle');
      return;
    }
    setTranscript(recognized);
    transition('answering');
    const request = new AbortController();
    s.request = request;
    const timeout = setTimeout(() => request.abort(), 60000);
    try {
      const captured = await Promise.race([
        s.photo,
        new Promise<never>((_, reject) => {
          request.signal.addEventListener(
            'abort',
            () => reject(new Error('Przerwano. Spróbuj jeszcze raz.')),
            { once: true },
          );
        }),
      ]);
      if (s.disposed || request.signal.aborted) {
        if (!s.disposed) throw new Error('Zdjęcie trwa za długo. Spróbuj jeszcze raz.');
        return;
      }
      if (!captured || 'error' in captured)
        throw new Error(captured?.error || 'Nie udało się zrobić zdjęcia. Spróbuj jeszcze raz.');
      const response = await conversation.answerWithPhoto(
        recognized,
        captured.photo.dataUrl,
        process.env.EXPO_PUBLIC_OPENROUTER_API_KEY || '',
        request.signal,
        (value) => {
          if (!s.disposed && !request.signal.aborted) setAnswer(value);
        },
        expoFetch as typeof fetch,
      );
      if (s.disposed || request.signal.aborted) return;
      refreshMapSources();
      transition('speaking');
      Speech.speak(response, {
        language: 'pl-PL',
        rate: 0.85,
        onDone: () => {
          if (s.disposed) return;
          setAnswer('');
          setTranscript('');
          setMapSources([]);
          transition('idle');
        },
        onStopped: () => {
          if (!s.disposed) transition('idle');
        },
        onError: () => {
          if (s.disposed) return;
          setError(
            'Nie mogę przeczytać odpowiedzi na głos. Włącz „Syntezator mowy Google” w ustawieniach telefonu.',
          );
          transition('idle');
        },
      });
    } catch (reason) {
      if (!s.disposed) {
        setError(
          request.signal.aborted
            ? 'Odpowiedź trwa za długo. Sprawdź internet i spróbuj jeszcze raz.'
            : reason instanceof Error
              ? reason.message
              : 'Nie udało się dostać odpowiedzi. Spróbuj jeszcze raz.',
        );
        transition('idle');
      }
    } finally {
      clearTimeout(timeout);
      s.photo = null;
      if (s.request === request) s.request = null;
    }
  };

  useSpeechRecognitionEvent('start', () => {
    const s = state.current;
    if (s.disposed || !['listening', 'stopping'].includes(s.phase)) return;
    s.started = true;
    if (!s.held) Recognition.stop();
  });
  useSpeechRecognitionEvent('result', (event) => {
    const s = state.current;
    if (s.disposed || !['listening', 'stopping'].includes(s.phase)) return;
    const value = event.results[0]?.transcript.trim() || '';
    if (event.isFinal) {
      if (value) s.segments.push(value);
      s.partial = '';
    } else s.partial = value;
    setTranscript(text());
  });
  useSpeechRecognitionEvent('error', (event) => {
    const s = state.current;
    if (s.disposed || !['listening', 'stopping'].includes(s.phase)) return;
    // Google's continuous recognizer can return ERROR_CLIENT on stop; keep its last partial.
    if (s.phase === 'stopping' && event.error === 'client' && text()) return;
    s.failed = true;
    setError(
      event.error === 'not-allowed'
        ? 'Aplikacja nie może używać mikrofonu. Włącz mikrofon w ustawieniach telefonu.'
        : event.error === 'no-speech'
          ? 'Nie usłyszałem. Przytrzymaj przycisk i powiedz jeszcze raz.'
          : 'Nie udało się zrozumieć mowy. Przytrzymaj przycisk i spróbuj jeszcze raz.',
    );
  });
  useSpeechRecognitionEvent('end', () => {
    void finish();
  });

  useEffect(() => {
    const s = state.current;
    s.disposed = false;
    return () => {
      s.disposed = true;
      s.held = false;
      clearTimeout(s.stopTimer);
      s.request?.abort();
      s.photo = null;
      Recognition.abort();
      void Speech.stop();
    };
  }, []);

  useEffect(() => {
    const s = state.current;
    // Announcements wait for recognition, requests and other speech to finish.
    // The queue lives beside the notification card, so closing it never skips the reading.
    if (!announcement || s.disposed || s.phase !== 'idle') return;
    transition('announcing');
    const finishReading = (completed: boolean) => {
      if (s.disposed) return;
      onAnnouncementRead(announcement, completed);
      transition('idle');
    };
    Speech.speak(announcement.text, {
      language: 'pl-PL',
      rate: 0.85,
      onDone: () => finishReading(true),
      onStopped: () => finishReading(false),
      onError: () => {
        if (s.disposed) return;
        setError('Nie mogę przeczytać powiadomienia na głos. Jego treść znajdziesz na ekranie.');
        finishReading(false);
      },
    });
  }, [announcement, phase, onAnnouncementRead]);

  useEffect(() => {
    const timer = setInterval(() => {
      const s = state.current;
      // Never interrupt listening, an answer, or speech. This check makes no network request.
      if (s.disposed || s.phase !== 'idle' || announcement) return;
      const message = conversation.navigation.reminder();
      if (!message) return;
      setAnswer(message);
      setTranscript('');
      refreshMapSources();
      transition('speaking');
      Speech.speak(message, {
        language: 'pl-PL',
        rate: 0.85,
        onDone: () => {
          if (s.disposed) return;
          setAnswer('');
          setTranscript('');
          setMapSources([]);
          transition('idle');
        },
        onStopped: () => {
          if (!s.disposed) transition('idle');
        },
        onError: () => {
          if (!s.disposed) transition('idle');
        },
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [conversation, announcement]);

  const begin = async () => {
    const s = state.current;
    if (s.phase !== 'idle') return;
    s.held = true;
    s.failed = false;
    s.started = false;
    s.segments = [];
    s.partial = '';
    setTranscript('');
    setAnswer('');
    setMapSources([]);
    setError('');
    transition('permission');
    try {
      if (!process.env.EXPO_PUBLIC_OPENROUTER_API_KEY?.trim()) {
        throw new Error('Ustaw EXPO_PUBLIC_OPENROUTER_API_KEY w .env i uruchom ponownie Metro.');
      }
      // Start capture on press, independently of microphone permission and recognition.
      const capture = capturePhoto().then<CaptureResult, CaptureResult>(
        (photo) => ({ photo }),
        (reason) => ({
          error:
            reason instanceof Error
              ? reason.message
              : 'Nie udało się zrobić zdjęcia. Spróbuj jeszcze raz.',
        }),
      );
      s.photo = capture;
      void capture.then((result) => {
        if (s.disposed || s.photo !== capture) return;
        if ('error' in result) {
          s.failed = true;
          setError(result.error);
        }
      });
      const permission = await Recognition.requestPermissionsAsync();
      if (s.disposed) return;
      if (!permission.granted)
        throw new Error(
          'Aplikacja nie może używać mikrofonu. Włącz mikrofon w ustawieniach telefonu.',
        );
      if (!s.held) {
        transition('idle');
        return;
      }
      if (!Recognition.isRecognitionAvailable())
        throw new Error('Włącz „Usługi mowy Google” w ustawieniach telefonu.');
      transition('listening');
      Recognition.start({
        lang: 'pl-PL',
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: false,
      });
    } catch (reason) {
      if (!s.disposed) {
        s.held = false;
        s.photo = null;
        setError(
          reason instanceof Error
            ? reason.message
            : 'Nie udało się włączyć mikrofonu. Spróbuj jeszcze raz.',
        );
        transition('idle');
      }
    }
  };

  const release = () => {
    const s = state.current;
    s.held = false;
    if (s.phase !== 'listening') return;
    transition('stopping');
    // If release beats native start, its event will immediately call stop().
    if (s.started) Recognition.stop();
    s.stopTimer = setTimeout(() => {
      Recognition.abort();
      void finish();
    }, 5000);
  };

  const listening = phase === 'listening';
  const busy = ['stopping', 'answering', 'speaking', 'announcing'].includes(phase);
  const iconColor = listening ? colors.white : colors.navy;
  const showCard = !!transcript || !!answer || !!error;
  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      {showCard && (
        <View style={[styles.card, !!error && styles.cardError]}>
          <ScrollView style={{ maxHeight: height * 0.4 }}>
            {!!transcript && <Text style={styles.question}>Pytasz: {transcript}</Text>}
            {!!answer && (
              <Text accessibilityLiveRegion="polite" selectable style={styles.answer}>
                {answer}
              </Text>
            )}
            {!!answer && mapSources.length > 0 && (
              <View style={styles.sources}>
                <Text style={styles.attribution}>Google Maps</Text>
                {mapSources.map((source) => (
                  <Pressable
                    key={source.uri}
                    accessibilityRole="link"
                    accessibilityLabel={`Źródło Google Maps: ${source.title}`}
                    style={styles.sourceLink}
                    onPress={() => {
                      void Linking.openURL(source.uri).catch(() =>
                        setError('Nie mogę otworzyć źródła Google Maps.'),
                      );
                    }}
                  >
                    <Text style={styles.sourceText}>{source.title}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {!!error && (
              <Text accessibilityLiveRegion="assertive" style={styles.answer}>
                {error}
              </Text>
            )}
          </ScrollView>
        </View>
      )}
      <View pointerEvents="box-none" style={styles.buttonWrap}>
        {listening && !reduceMotion && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pulse,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
                transform: [
                  { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) },
                ],
              },
            ]}
          />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Przytrzymaj i mów, aby poprosić o drogę lub zadać pytanie"
          accessibilityState={{ busy: phase !== 'idle' }}
          onPressIn={() => void begin()}
          onPressOut={release}
          style={[styles.button, listening && styles.recording, busy && styles.busy]}
        >
          <View style={[styles.capsule, { backgroundColor: iconColor }]} />
          <View style={[styles.cradle, { borderColor: iconColor }]} />
          <View style={[styles.stem, { backgroundColor: iconColor }]} />
        </Pressable>
      </View>
      <View style={styles.plate}>
        <Text accessibilityLiveRegion="polite" style={styles.label}>
          {labels[phase]}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.m,
    paddingBottom: space.l + space.s,
    alignItems: 'center',
    gap: space.m,
  },
  card: {
    width: '100%',
    padding: space.m,
    borderRadius: radius.card,
    backgroundColor: colors.paper,
    borderWidth: 2,
    borderColor: colors.paper,
    elevation: 6,
  },
  cardError: { backgroundColor: colors.errorBg, borderColor: colors.red },
  sources: { marginTop: space.m, gap: space.s },
  attribution: { fontSize: 16, fontWeight: '400', color: '#1F1F1F' },
  sourceLink: { minHeight: 48, justifyContent: 'center' },
  sourceText: { ...type.small, color: colors.navy, textDecorationLine: 'underline' },
  question: { ...type.small, color: colors.ink, marginBottom: space.s },
  answer: { ...type.title, color: colors.ink },
  buttonWrap: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    position: 'absolute',
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: radius.button,
    backgroundColor: colors.red,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: radius.button,
    backgroundColor: colors.yellow,
    borderWidth: 8,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recording: { backgroundColor: colors.red, borderColor: colors.white },
  busy: { backgroundColor: colors.yellow, borderColor: colors.navyDeep, opacity: 0.7 },
  capsule: { width: 30, height: 48, borderRadius: 15 },
  cradle: {
    position: 'absolute',
    top: 42,
    width: 52,
    height: 36,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    borderWidth: 6,
    borderTopWidth: 0,
    marginTop: 6,
  },
  stem: { position: 'absolute', top: 88, width: 6, height: 12 },
  plate: {
    backgroundColor: colors.navy,
    borderRadius: radius.sign,
    paddingVertical: space.s,
    paddingHorizontal: space.l,
    borderWidth: 2,
    borderColor: colors.yellow,
  },
  label: { ...type.body, color: colors.white, textAlign: 'center' },
});

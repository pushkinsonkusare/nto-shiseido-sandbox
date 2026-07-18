import { useCallback, useEffect, useRef, useState } from "react";
import { getOpenAIClient } from "../../lib/openaiClient";

/**
 * Hybrid voice-to-text hook for the Wingman input.
 *
 * Strategy: run Web Speech API and MediaRecorder in parallel while the
 * user is talking, AND poll OpenAI Whisper at a fixed cadence with the
 * audio captured so far. This gives the "live transcribe" feel — the
 * input field updates every ~1.5s with high-accuracy Whisper text
 * instead of relying solely on the (often poor) Web Speech interim
 * results. Web Speech still drives the very first 0–1500ms of feedback
 * so the user gets *some* text immediately; once Whisper produces its
 * first result, Whisper "wins" and Web Speech updates are suppressed.
 *
 * On stop, we issue one final Whisper call against the full recording
 * so the committed text is the cleanest possible version.
 *
 * Graceful degradation:
 *   - No SpeechRecognition (Firefox)        → record-only, Whisper drives everything
 *   - No MediaRecorder / getUserMedia       → SpeechRecognition only, no Whisper
 *   - No proxy + no VITE_OPENAI_API_KEY     → SpeechRecognition only, no Whisper
 *   - Neither available                     → `isSupported: false`, mic disabled
 *
 * The hook never throws. All errors surface via the `error` field so the
 * caller can decide whether to show a toast / inline message.
 */

const WHISPER_MODEL = "whisper-1";

/* English-only by design. The Wingman demo content is English copy and
 * the Whisper `language` hint dramatically reduces latency + improves
 * accuracy versus auto-detect. Mirror the same lock onto Web Speech via
 * `recognition.lang`. Change both if you ever localize the prototype. */
const RECOGNITION_LANG = "en-US";
const WHISPER_LANGUAGE = "en";

/* How often the recorder emits a chunk via `dataavailable`. Smaller
 * values mean fresher audio for each live Whisper poll, at the cost of
 * slightly more chunk overhead. 500ms strikes a good balance. */
const RECORDER_TIMESLICE_MS = 500;

/* Cadence of the live Whisper poll. Each tick concatenates ALL chunks
 * recorded so far into a single blob and sends it to Whisper, then the
 * next tick is scheduled only AFTER the previous response settles
 * (chained setTimeout, not setInterval). This naturally serializes
 * calls and prevents pile-ups when Whisper is slow.
 *
 * 1500ms = roughly one Whisper round-trip on a 2-3s audio clip, so
 * subsequent ticks have fresh audio waiting without overlapping. */
const LIVE_POLL_MS = 1500;

/* Hoisted singleton — creating an OpenAI client per request is
 * wasteful when we're firing one every 1.5s. Returns `null` when
 * neither a proxy nor a direct key is configured. */
const openaiClient = getOpenAIClient();

export type SpeechRecognitionState =
  | "idle"
  | "requesting"
  | "listening"
  | "transcribing"
  | "error";

export type UseSpeechRecognitionResult = {
  /** Lifecycle state — drives the mic button's visual treatment. */
  state: SpeechRecognitionState;
  /**
   * Live partial transcript (Web Speech API). Replaces itself as the
   * user keeps talking. Empty when not listening.
   */
  interim: string;
  /**
   * The most recent final transcript — set once on stop. Whisper result
   * if available, otherwise the Web Speech final string. Cleared when
   * the user starts a new recording.
   */
  finalTranscript: string;
  /** Surface for hard errors (mic permission denied, network failure, etc.). */
  error: string | null;
  /** True when at least one of the two backends is usable in this browser. */
  isSupported: boolean;
  /** True when Whisper finalization is available (key present + recorder available). */
  hasWhisper: boolean;
  /** Real-time mic energy in [0,1], useful for tiny waveform UIs. */
  audioLevel: number;
  start: () => void;
  stop: () => void;
};

function pickSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  /* Whisper accepts webm/ogg/wav/mp3/mp4. webm/opus is the most widely
   * supported in modern browsers; let MediaRecorder pick the default
   * if neither option is available. */
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return undefined;
}

function fileExtensionForMime(mime: string | undefined): string {
  if (!mime) return "webm";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

export function useSpeechRecognition(): UseSpeechRecognitionResult {
  const [state, setState] = useState<SpeechRecognitionState>("idle");
  const [interim, setInterim] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  /* Refs so the start/stop closures stay stable and we can null them out
   * deterministically on stop without racing against React re-renders. */
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const webSpeechFinalRef = useRef<string>("");
  const stoppedManuallyRef = useRef<boolean>(false);
  /* Live-poll plumbing — see LIVE_POLL_MS. */
  const livePollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livePollInFlightRef = useRef<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  /* Once Whisper produces ANY result for the current session, suppress
   * subsequent Web Speech interim updates so the user doesn't watch
   * their high-quality transcript flicker back to the lower-quality
   * Web Speech text on every onresult event. */
  const whisperWonRef = useRef<boolean>(false);
  /* Monotonic session token. Bumped on every start() and stop() so that
   * any in-flight live-poll Whisper response from a previous session
   * can detect it's stale and discard itself instead of clobbering the
   * current transcript. */
  const sessionIdRef = useRef<number>(0);

  const speechCtor = pickSpeechRecognitionCtor();
  const hasWebSpeech = !!speechCtor;
  const hasMediaRecorder =
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;
  const hasWhisper = hasMediaRecorder && !!openaiClient;
  const isSupported = hasWebSpeech || hasMediaRecorder;

  const clearLivePoll = useCallback(() => {
    if (livePollTimeoutRef.current !== null) {
      clearTimeout(livePollTimeoutRef.current);
      livePollTimeoutRef.current = null;
    }
  }, []);

  const stopLevelMeter = useCallback(() => {
    if (levelFrameRef.current !== null) {
      cancelAnimationFrame(levelFrameRef.current);
      levelFrameRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        void audioContextRef.current.close();
      } catch {
        /* ignore */
      }
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  const cleanupStreams = useCallback(() => {
    clearLivePoll();
    stopLevelMeter();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch {
        /* ignore — recognition may already be stopped */
      }
      recognitionRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, [clearLivePoll, stopLevelMeter]);

  useEffect(() => () => cleanupStreams(), [cleanupStreams]);

  const transcribeWithWhisper = useCallback(
    async (audioBlob: Blob, mimeType: string | undefined): Promise<string | null> => {
      if (!openaiClient || audioBlob.size === 0) return null;
      try {
        const ext = fileExtensionForMime(mimeType);
        const file = new File([audioBlob], `wingman-utterance.${ext}`, {
          type: mimeType || "audio/webm",
        });
        const result = await openaiClient.audio.transcriptions.create({
          file,
          model: WHISPER_MODEL,
          language: WHISPER_LANGUAGE,
        });
        const text = (result?.text ?? "").trim();
        return text || null;
      } catch (err) {
        /* Whisper failed (rate-limit, network, bad key, etc.). Don't
         * surface as a hard error — the Web Speech transcript is still
         * good enough to use. Console-log for debug. */
        console.warn("[Wingman] Whisper transcription failed:", err);
        return null;
      }
    },
    [],
  );

  const start = useCallback(async () => {
    if (state === "listening" || state === "requesting") return;
    if (!isSupported) {
      setError("Voice input isn't supported in this browser.");
      setState("error");
      return;
    }
    setError(null);
    setInterim("");
    setFinalTranscript("");
    setAudioLevel(0);
    webSpeechFinalRef.current = "";
    chunksRef.current = [];
    stoppedManuallyRef.current = false;
    whisperWonRef.current = false;
    /* Bump the session token. Any in-flight live-poll Whisper response
     * from the previous session will see the mismatch and discard. */
    sessionIdRef.current += 1;
    const mySessionId = sessionIdRef.current;
    setState("requesting");

    /* --- MediaRecorder branch (for Whisper) --- */
    let recordingMimeType: string | undefined;
    if (hasMediaRecorder && hasWhisper) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        try {
          const AudioContextCtor =
            window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AudioContextCtor) {
            const ctx = new AudioContextCtor();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.75;
            const source = ctx.createMediaStreamSource(stream);
            source.connect(analyser);
            audioContextRef.current = ctx;
            analyserRef.current = analyser;
            const data = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
              const activeRecording =
                recorderRef.current?.state === "recording" && !stoppedManuallyRef.current;
              if (!activeRecording || !analyserRef.current) {
                setAudioLevel(0);
                levelFrameRef.current = null;
                return;
              }
              analyserRef.current.getByteTimeDomainData(data);
              let sum = 0;
              for (let i = 0; i < data.length; i += 1) {
                const sample = (data[i] - 128) / 128;
                sum += sample * sample;
              }
              const rms = Math.sqrt(sum / data.length);
              const normalized = Math.min(1, rms * 4.5);
              setAudioLevel((prev) => prev * 0.7 + normalized * 0.3);
              levelFrameRef.current = requestAnimationFrame(tick);
            };
            levelFrameRef.current = requestAnimationFrame(tick);
          }
        } catch (err) {
          console.warn("[Wingman] Audio level meter setup failed:", err);
        }
        recordingMimeType = pickRecorderMimeType();
        const recorder = recordingMimeType
          ? new MediaRecorder(stream, { mimeType: recordingMimeType })
          : new MediaRecorder(stream);
        recordingMimeType = recorder.mimeType || recordingMimeType;
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = async () => {
          /* Build the blob and try Whisper. */
          const blob = new Blob(chunksRef.current, {
            type: recordingMimeType || "audio/webm",
          });
          chunksRef.current = [];
          if (hasWhisper && blob.size > 0) {
            setState("transcribing");
            const whisperText = await transcribeWithWhisper(
              blob,
              recordingMimeType,
            );
            if (whisperText) {
              setFinalTranscript(whisperText);
              setInterim("");
              setAudioLevel(0);
              setState("idle");
              return;
            }
          }
          /* Whisper unavailable or returned nothing — fall back to the
           * Web Speech final string we accumulated. */
          const fallback = webSpeechFinalRef.current.trim();
          if (fallback) setFinalTranscript(fallback);
          setInterim("");
          setAudioLevel(0);
          setState("idle");
        };
        recorder.onerror = (event) => {
          console.warn("[Wingman] MediaRecorder error:", event);
        };
        recorderRef.current = recorder;
        /* Start with a timeslice so chunks accumulate continuously
         * (rather than only on stop). The live-poll loop below reads
         * `chunksRef.current` on each tick to assemble a growing blob. */
        recorder.start(RECORDER_TIMESLICE_MS);

        /* Live Whisper poll. Chained setTimeout (not setInterval) so a
         * slow Whisper response naturally throttles the next tick
         * instead of stacking up parallel in-flight requests. Each
         * tick sends ALL audio captured so far — necessary because
         * each MediaRecorder chunk depends on the WebM header in the
         * first chunk and is not individually decodable. */
        const scheduleLivePoll = () => {
          if (sessionIdRef.current !== mySessionId) return;
          if (
            !recorderRef.current ||
            recorderRef.current.state !== "recording"
          ) {
            return;
          }
          livePollTimeoutRef.current = setTimeout(async () => {
            if (sessionIdRef.current !== mySessionId) return;
            if (
              !recorderRef.current ||
              recorderRef.current.state !== "recording"
            ) {
              return;
            }
            if (livePollInFlightRef.current || chunksRef.current.length === 0) {
              scheduleLivePoll();
              return;
            }
            livePollInFlightRef.current = true;
            const liveBlob = new Blob([...chunksRef.current], {
              type: recordingMimeType || "audio/webm",
            });
            const liveText = await transcribeWithWhisper(
              liveBlob,
              recordingMimeType,
            );
            livePollInFlightRef.current = false;
            /* Discard if the user stopped or restarted while we were
             * waiting for Whisper. */
            if (sessionIdRef.current !== mySessionId) return;
            if (liveText) {
              whisperWonRef.current = true;
              setInterim(liveText);
            }
            scheduleLivePoll();
          }, LIVE_POLL_MS);
        };
        scheduleLivePoll();
      } catch (err) {
        console.warn("[Wingman] getUserMedia failed:", err);
        cleanupStreams();
        if (!hasWebSpeech) {
          setError(
            "Microphone permission was denied. Enable it in browser settings to use voice input.",
          );
          setState("error");
          return;
        }
        /* Mic permission denied but Web Speech can sometimes work
         * without explicit getUserMedia (it asks separately). Continue
         * to the SpeechRecognition branch. */
      }
    }

    /* --- SpeechRecognition branch (for live interim) --- */
    if (hasWebSpeech && speechCtor) {
      try {
        const recognition = new speechCtor();
        recognition.lang = RECOGNITION_LANG;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.onresult = (event) => {
          let liveInterim = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const r = event.results[i];
            const text = r[0]?.transcript ?? "";
            if (r.isFinal) {
              webSpeechFinalRef.current =
                (webSpeechFinalRef.current
                  ? webSpeechFinalRef.current + " "
                  : "") + text.trim();
            } else {
              liveInterim += text;
            }
          }
          /* Once Whisper has produced a result, it owns the interim
           * field — Web Speech updates would only flicker the higher-
           * quality text back to lower-quality. We still accumulate
           * `webSpeechFinalRef` above so the no-Whisper fallback path
           * (network failure, missing key) keeps working. */
          if (whisperWonRef.current) return;
          setInterim(
            (
              webSpeechFinalRef.current +
              (webSpeechFinalRef.current && liveInterim ? " " : "") +
              liveInterim
            ).trim(),
          );
        };
        recognition.onerror = (event) => {
          if (event.error === "no-speech" || event.error === "aborted") return;
          console.warn("[Wingman] SpeechRecognition error:", event.error);
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            setError(
              "Microphone permission was denied. Enable it in browser settings to use voice input.",
            );
            setState("error");
          }
        };
        recognition.onend = () => {
          /* Chrome's Web Speech engine often fires `onend` after a
           * short pause (~1s) even with `continuous: true`, long
           * before the user is actually done talking. If we treated
           * that as a real "stop" we'd kill the recorder and cut the
           * sentence in half — which is exactly the bug the user hit.
           *
           * As long as the user hasn't pressed the mic button AND the
           * recorder is still capturing audio, transparently restart
           * recognition so the low-latency interim primer keeps
           * flowing. The recorder + Whisper poll are unaffected and
           * keep producing the high-quality transcript regardless. */
          if (
            !stoppedManuallyRef.current &&
            recorderRef.current &&
            recorderRef.current.state === "recording"
          ) {
            try {
              recognition.start();
              return;
            } catch (err) {
              /* Some Chromium builds throw `InvalidStateError` if the
               * engine hasn't fully released yet. That's OK — the
               * recorder + live Whisper poll keep the session alive,
               * we just lose the Web Speech primer for the rest of
               * this utterance. */
              console.warn(
                "[Wingman] SpeechRecognition auto-restart failed:",
                err,
              );
              recognitionRef.current = null;
              return;
            }
          }

          /* User-initiated stop OR recorder already stopped — drive
           * the real terminal transition. If the recorder is still
           * running (silence-driven end after manual stop), trigger
           * its onstop so Whisper finalizes; otherwise commit the
           * Web Speech fallback and go idle. */
          if (recorderRef.current && recorderRef.current.state === "recording") {
            try {
              recorderRef.current.stop();
            } catch {
              /* ignore */
            }
            return;
          }
          const fallback = webSpeechFinalRef.current.trim();
          if (fallback) setFinalTranscript(fallback);
          setInterim("");
          setAudioLevel(0);
          setState((prev) =>
            prev === "transcribing" || prev === "error" ? prev : "idle",
          );
        };
        recognitionRef.current = recognition;
        recognition.start();
        setState("listening");
        return;
      } catch (err) {
        console.warn("[Wingman] SpeechRecognition.start failed:", err);
      }
    }

    /* No SpeechRecognition — but recorder is going if we got here. */
    if (recorderRef.current) {
      setState("listening");
      return;
    }

    setError("Voice input couldn't be started.");
    setState("error");
  }, [
    state,
    isSupported,
    hasMediaRecorder,
    hasWhisper,
    hasWebSpeech,
    speechCtor,
    transcribeWithWhisper,
    cleanupStreams,
  ]);

  const stop = useCallback(() => {
    stoppedManuallyRef.current = true;
    /* Bump session + tear down the live poll so any in-flight Whisper
     * response from the live loop discards itself and doesn't race
     * with the final-Whisper call kicked off by recorder.onstop. */
    sessionIdRef.current += 1;
    clearLivePoll();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* ignore */
      }
    } else if (recorderRef.current && recorderRef.current.state !== "inactive") {
      /* No SpeechRecognition path — drive the recorder stop directly. */
      try {
        recorderRef.current.stop();
      } catch {
        /* ignore */
      }
    } else {
      setAudioLevel(0);
      setState("idle");
    }
  }, [clearLivePoll]);

  return {
    state,
    interim,
    finalTranscript,
    error,
    isSupported,
    hasWhisper,
    audioLevel,
    start,
    stop,
  };
}

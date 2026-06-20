import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Camera,
  Download,
  MessageCircle,
  Mic,
  Minus,
  Phone,
  PhoneOff,
  Pin,
  PinOff,
  Send,
  Settings,
  Shield,
  Sparkles,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { FairyAvatar } from "./components/FairyAvatar";
import { SettingsPanel } from "./components/SettingsPanel";

type StatusTone = "idle" | "thinking" | "speaking" | "listening" | "watching" | "error";

const VOICE_THRESHOLD = 0.012;
const SILENCE_MS = 620;
const MIN_RECORDING_MS = 420;
const MAX_RECORDING_MS = 8500;
const STT_SAMPLE_RATE = 24000;
const PRE_ROLL_MS = 550;
const START_VOICE_FRAMES = 1;
const INTERRUPT_VOICE_FRAMES = 4;
const SPEECH_PLAYBACK_RATE = 1.18;

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() || `fairy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function downsamplePcm(chunks: Float32Array[], sampleCount: number, sourceRate: number, targetRate: number) {
  const pcm = new Float32Array(sampleCount);
  let offset = 0;
  for (const chunk of chunks) {
    pcm.set(chunk, offset);
    offset += chunk.length;
  }

  if (sourceRate === targetRate) return pcm;

  const ratio = sourceRate / targetRate;
  const length = Math.max(1, Math.floor(sampleCount / ratio));
  const result = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const sourceIndex = index * ratio;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(lower + 1, pcm.length - 1);
    const fraction = sourceIndex - lower;
    result[index] = pcm[lower] + (pcm[upper] - pcm[lower]) * fraction;
  }
  return result;
}

function encodeWav(chunks: Float32Array[], sampleCount: number, sourceRate: number, targetRate = sourceRate) {
  const samples = downsamplePcm(chunks, sampleCount, sourceRate, targetRate);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function cloneAudioChunk(input: Float32Array) {
  const copy = new Float32Array(input.length);
  copy.set(input);
  return copy;
}

function containsAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function shouldAttachScreenContext(text: string) {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?]/g, "");
  const screenTerms = [
    "屏幕",
    "桌面",
    "窗口",
    "画面",
    "截图",
    "截屏",
    "右上角",
    "左上角",
    "右下角",
    "左下角",
    "上面",
    "下面",
    "左边",
    "右边",
  ];
  const lookTerms = ["看看", "看一下", "看一眼", "帮我看", "你看", "看下", "瞅瞅", "瞧瞧", "识别", "分析"];
  const deicticTerms = [
    "这个",
    "这东西",
    "这里",
    "那里",
    "那边",
    "这边",
    "我在干什么",
    "我在干嘛",
    "我在干啥",
    "我在做什么",
    "我在弄什么",
    "在干什么",
    "在干嘛",
    "在干啥",
    "怎么办",
    "咋办",
    "怎么弄",
    "怎么处理",
    "是什么",
  ];
  const activityQuestion = /(?:看|看看|看下|看一下|看一眼|瞅瞅|瞧瞧|帮我看|你看)?我(?:现在)?在(?:干|做|弄)(?:什么|啥|嘛|啥呢)/.test(
    normalized,
  );
  const deicticQuestion = /(?:这个|这东西|这里|那里|那边|这边|右上角|左上角|右下角|左下角).*(?:怎么办|咋办|怎么弄|怎么处理|是什么)/.test(
    normalized,
  );

  return (
    containsAny(normalized, screenTerms) ||
    (containsAny(normalized, lookTerms) && containsAny(normalized, deicticTerms)) ||
    activityQuestion ||
    deicticQuestion
  );
}

function buildScreenContext(result: Awaited<ReturnType<FairyBridge["observeScreen"]>>) {
  if (result.sensitive) {
    return `Screen context request: fairy skipped capture for privacy. Reason: ${result.reason || result.analysis || "sensitive screen detected"}. Tell the user this briefly and do not guess visual details.`;
  }

  if (!result.saved && !result.analysis) {
    return `Screen context request: fairy could not inspect the screen. Reason: ${result.reason || "unknown"}. Ask the user for a little more detail.`;
  }

  return [
    "Screen context request: the user asked fairy to look at the current desktop screen.",
    "Important: the following text is fairy's current visual analysis of a real desktop screenshot. Use it as grounded screen perception.",
    "Do not say you are a text-only model, do not say you cannot see the screen, and do not ask the user to describe the screen unless the analysis is empty or explicitly says vision is disabled.",
    "Answer the user's question directly in Chinese. If the user refers to this/that or a screen corner, map your answer to the visual analysis.",
    `Analysis: ${result.analysis || result.message || "No visual analysis was returned."}`,
    result.filePath ? `Local screenshot path: ${result.filePath}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function App() {
  const [messages, setMessages] = useState<FairyMessage[]>([]);
  const [settings, setSettings] = useState<FairySettings | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [status, setStatus] = useState<StatusTone>("idle");
  const [notice, setNotice] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sendRef = useRef<((text: string) => Promise<void>) | null>(null);
  const settingsRef = useRef<FairySettings | null>(null);
  const busyRef = useRef(false);
  const statusRef = useRef<StatusTone>("idle");
  const pendingVoiceTextRef = useRef("");
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechTokenRef = useRef(0);
  const activeRequestIdRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);

  const lastAssistantMessage = useMemo(() => {
    return [...messages].reverse().find((message) => message.role === "assistant");
  }, [messages]);

  const refresh = useCallback(async () => {
    const [nextMessages, nextSettings, nextStats] = await Promise.all([
      window.fairy.loadMessages(),
      window.fairy.loadSettings(),
      window.fairy.getMemoryStats(),
    ]);
    setMessages(nextMessages);
    setSettings(nextSettings);
    setMemoryStats(nextStats);
    settingsRef.current = nextSettings;
  }, []);

  useEffect(() => {
    refresh().catch((error) => setNotice(error.message));
  }, [refresh]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const updateStatus = useCallback((next: StatusTone) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const stopSpeaking = useCallback(() => {
    speechTokenRef.current += 1;
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.removeAttribute("src");
      activeAudioRef.current.load();
      activeAudioRef.current = null;
    }
    window.speechSynthesis.cancel();
    if (statusRef.current === "speaking") updateStatus("idle");
  }, [updateStatus]);

  const cancelActiveRequest = useCallback(async () => {
    cancelRequestedRef.current = true;
    pendingVoiceTextRef.current = "";
    stopSpeaking();
    const requestId = activeRequestIdRef.current;
    try {
      await window.fairy.cancelRequest(requestId || undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
    setBusy(false);
    busyRef.current = false;
    updateStatus("idle");
  }, [stopSpeaking, updateStatus]);

  const speak = useCallback(async (text: string) => {
    const current = settingsRef.current;
    if (!text.trim()) return;

    const speechToken = speechTokenRef.current + 1;
    speechTokenRef.current = speechToken;
    activeAudioRef.current?.pause();
    activeAudioRef.current = null;
    window.speechSynthesis.cancel();

    const finishSpeaking = () => {
      if (speechTokenRef.current !== speechToken) return;
      activeAudioRef.current = null;
      updateStatus("idle");
    };

    const playGeneratedAudio = async () => {
      const audio = await window.fairy.synthesizeSpeech(text);
      if (speechTokenRef.current !== speechToken) return;
      const player = new Audio(`data:${audio.mimeType};base64,${audio.audioBase64}`);
      player.playbackRate = SPEECH_PLAYBACK_RATE;
      (player as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
      activeAudioRef.current = player;
      player.onended = finishSpeaking;
      player.onerror = finishSpeaking;
      updateStatus("speaking");
      await player.play();
    };

    try {
      if (current?.ttsProvider === "custom" && current.ttsEndpoint) {
        await playGeneratedAudio();
        return;
      }

      if (current?.modelRoutes?.tts?.enabled && current.modelRoutes.tts.provider === "mimo") {
        await playGeneratedAudio();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = SPEECH_PLAYBACK_RATE;
      utterance.pitch = 1.04;
      const voices = window.speechSynthesis.getVoices();
      const wantedVoice = current?.ttsVoiceName
        ? voices.find((voice) => voice.name === current.ttsVoiceName)
        : undefined;
      if (wantedVoice) utterance.voice = wantedVoice;
      utterance.onend = finishSpeaking;
      utterance.onerror = finishSpeaking;
      updateStatus("speaking");
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      updateStatus("idle");
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [updateStatus]);

  const sendMessage = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content) return;
      if (busyRef.current) {
        pendingVoiceTextRef.current = content;
        return;
      }

      busyRef.current = true;
      setBusy(true);
      updateStatus("thinking");
      setNotice("");
      setDraft("");
      const requestId = createRequestId();
      activeRequestIdRef.current = requestId;
      cancelRequestedRef.current = false;
      try {
        let screenContext = "";
        if (shouldAttachScreenContext(content)) {
          updateStatus("watching");
          const screenResult = await window.fairy.observeScreen(requestId);
          await refresh();
          if (cancelRequestedRef.current) throw new Error("Request canceled.");
          screenContext = buildScreenContext(screenResult);
          updateStatus("thinking");
        }

        const assistant = await window.fairy.sendChat(content, screenContext, requestId);
        await refresh();
        if (cancelRequestedRef.current) return;
        await speak(assistant.content);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (cancelRequestedRef.current || /canceled/i.test(message)) {
          updateStatus("idle");
          setNotice("Canceled.");
        } else {
          updateStatus("error");
          setNotice(message);
        }
      } finally {
        const pending = pendingVoiceTextRef.current;
        const wasCanceled = cancelRequestedRef.current;
        pendingVoiceTextRef.current = "";
        if (activeRequestIdRef.current === requestId) activeRequestIdRef.current = null;
        cancelRequestedRef.current = false;
        busyRef.current = false;
        setBusy(false);
        if (statusRef.current !== "speaking") updateStatus("idle");
        if (pending && !wasCanceled) {
          window.setTimeout(() => {
            void sendRef.current?.(pending);
          }, 0);
        }
      }
    },
    [refresh, speak, updateStatus],
  );

  useEffect(() => {
    sendRef.current = sendMessage;
  }, [sendMessage]);

  const saveSettings = useCallback(
    async (partial: Partial<FairySettings>) => {
      const next = await window.fairy.saveSettings(partial);
      setSettings(next);
      settingsRef.current = next;
      setMemoryStats(await window.fairy.getMemoryStats());
    },
    [],
  );

  useEffect(() => {
    if (!callActive) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let animationId = 0;
    let processor: ScriptProcessorNode | null = null;
    let recording = false;
    let recordingChunks: Float32Array[] = [];
    let recordingSampleCount = 0;
    let preRollChunks: Float32Array[] = [];
    let preRollSampleCount = 0;
    let maxPreRollSamples = 0;
    let recordingStart = 0;
    let lastVoiceAt = 0;
    let processing = false;
    let lastLevelUpdateAt = 0;
    let noiseFloor = 0.006;
    let voiceFrames = 0;
    let interruptFrames = 0;

    const stopRecording = () => {
      if (!recording || !audioContext) return;
      recording = false;
      if (recordingSampleCount < Math.floor(audioContext.sampleRate * 0.25)) {
        recordingChunks = [];
        recordingSampleCount = 0;
        return;
      }

      const wav = encodeWav(recordingChunks, recordingSampleCount, audioContext.sampleRate, STT_SAMPLE_RATE);
      recordingChunks = [];
      recordingSampleCount = 0;
      processing = true;

      void (async () => {
        try {
          updateStatus("thinking");
          const text = (await window.fairy.transcribeAudio(wav, "audio/wav")).text.trim();
          if (text) {
            await sendRef.current?.(text);
          } else if (statusRef.current === "thinking") {
            updateStatus("idle");
          }
        } catch (error) {
          setNotice(error instanceof Error ? error.message : String(error));
          updateStatus("error");
        } finally {
          processing = false;
        }
      })();
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        audioContext = new AudioContext();
        maxPreRollSamples = Math.floor((audioContext.sampleRate * PRE_ROLL_MS) / 1000);
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        processor = audioContext.createScriptProcessor(2048, 1, 1);
        source.connect(processor);
        processor.connect(audioContext.destination);
        processor.onaudioprocess = (event) => {
          const output = event.outputBuffer.getChannelData(0);
          output.fill(0);
          const input = event.inputBuffer.getChannelData(0);
          const copy = cloneAudioChunk(input);

          if (recording) {
            recordingChunks.push(copy);
            recordingSampleCount += copy.length;
            return;
          }

          preRollChunks.push(copy);
          preRollSampleCount += copy.length;
          while (preRollSampleCount > maxPreRollSamples && preRollChunks.length > 1) {
            const removed = preRollChunks.shift();
            preRollSampleCount -= removed?.length || 0;
          }
        };
        const data = new Uint8Array(analyser.fftSize);

        const beginRecording = () => {
          if (processing) return;
          recordingChunks = preRollChunks.map((chunk) => cloneAudioChunk(chunk));
          recordingSampleCount = preRollSampleCount;
          recordingStart = Date.now();
          lastVoiceAt = recordingStart;
          preRollChunks = [];
          preRollSampleCount = 0;
          recording = true;
        };

        const tick = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const value of data) {
            const normalized = (value - 128) / 128;
            sum += normalized * normalized;
          }
          const rms = Math.sqrt(sum / data.length);
          const now = Date.now();
          if (!recording && !processing && statusRef.current !== "speaking") {
            noiseFloor = noiseFloor * 0.96 + Math.min(rms, 0.08) * 0.04;
          }
          const startThreshold = Math.max(VOICE_THRESHOLD, noiseFloor * 2.4 + 0.003);
          const continueThreshold = Math.max(VOICE_THRESHOLD * 0.7, noiseFloor * 1.5 + 0.0025);
          const interruptThreshold = Math.max(0.026, startThreshold * 1.25);
          const strongVoice = rms > startThreshold;
          const continuingVoice = rms > continueThreshold;

          if (now - lastLevelUpdateAt > 100) {
            lastLevelUpdateAt = now;
            setMicLevel(Math.min(1, rms / 0.09));
          }

          if (statusRef.current === "speaking" && !recording) {
            interruptFrames = rms > interruptThreshold ? interruptFrames + 1 : 0;
            if (interruptFrames >= INTERRUPT_VOICE_FRAMES && !processing) {
              stopSpeaking();
              voiceFrames = 0;
              beginRecording();
              updateStatus("listening");
            }
            animationId = window.requestAnimationFrame(tick);
            return;
          }

          interruptFrames = 0;

          if (!recording && !processing) {
            voiceFrames = strongVoice ? voiceFrames + 1 : 0;
            if (voiceFrames >= START_VOICE_FRAMES) {
              beginRecording();
              updateStatus("listening");
            }
          }

          if (recording) {
            if (continuingVoice) {
              lastVoiceAt = now;
              updateStatus("listening");
            }
            const longEnough = now - recordingStart > MIN_RECORDING_MS;
            const silentEnough = now - lastVoiceAt > SILENCE_MS;
            const tooLong = now - recordingStart > MAX_RECORDING_MS;
            if ((longEnough && silentEnough) || tooLong) stopRecording();
          } else if (!processing && statusRef.current === "listening") {
            updateStatus("idle");
          }

          animationId = window.requestAnimationFrame(tick);
        };

        tick();
      } catch (error) {
        setCallActive(false);
        updateStatus("error");
        setNotice(error instanceof Error ? error.message : String(error));
      }
    };

    start();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationId);
      stopRecording();
      processor?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      audioContext?.close();
      setMicLevel(0);
      updateStatus("idle");
    };
  }, [callActive, stopSpeaking, updateStatus]);

  const togglePin = async () => {
    await window.fairy.setAlwaysOnTop(!alwaysOnTop);
    setAlwaysOnTop(!alwaysOnTop);
  };

  const statusLabel = {
    idle: "ready",
    thinking: "thinking",
    speaking: "speaking",
    listening: "listening",
    watching: "watching",
    error: "needs attention",
  }[status];

  return (
    <main className="shell">
      <header className="titlebar">
        <div className="identity">
          <Sparkles size={18} />
          <span>fairy</span>
        </div>
        <div className={`status-pill ${status}`}>{statusLabel}</div>
        <button className="icon-button" type="button" title="Always on top" onClick={togglePin}>
          {alwaysOnTop ? <Pin size={16} /> : <PinOff size={16} />}
        </button>
        <button className="icon-button" type="button" title="Minimize" onClick={() => window.fairy.minimize()}>
          <Minus size={16} />
        </button>
        <button className="icon-button danger" type="button" title="Close" onClick={() => window.fairy.close()}>
          <X size={16} />
        </button>
      </header>

      <section className="avatar-band">
        <FairyAvatar mood={status} speaking={status === "speaking"} listening={callActive} />
        <div className="signal-strip">
          <button
            className={`tool-button ${callActive ? "active" : ""}`}
            type="button"
            onClick={() => setCallActive((value) => !value)}
            title="Call mode"
          >
            {callActive ? <PhoneOff size={17} /> : <Phone size={17} />}
            <span>Wake</span>
          </button>
          <button className="tool-button" type="button" onClick={() => speak(lastAssistantMessage?.content || "I'm here.")}>
            <Volume2 size={17} />
            <span>Voice</span>
          </button>
          <button className="tool-button" type="button" onClick={() => setSettingsOpen(true)}>
            <Settings size={17} />
            <span>Set</span>
          </button>
        </div>
        {callActive ? (
          <div className="mic-meter" title="Microphone input level">
            <span style={{ width: `${Math.round(micLevel * 100)}%` }} />
          </div>
        ) : null}
      </section>

      <section className="memory-row" aria-label="memory status">
        <div>
          <Brain size={15} />
          <span>{memoryStats?.messages ?? 0} messages</span>
        </div>
        <div>
          <Camera size={15} />
          <span>{memoryStats?.screenshots ?? 0} captures</span>
        </div>
        <div>
          <Shield size={15} />
          <span>{settings?.visionUploadEnabled ? "vision route on" : "local vision lock"}</span>
        </div>
      </section>

      {notice ? <div className="notice">{notice}</div> : null}

      <section className="conversation" ref={listRef}>
        {messages.length === 0 ? (
          <div className="empty-state">
            <MessageCircle size={22} />
            <span>fairy is awake.</span>
          </div>
        ) : (
          messages
            .filter((message) => message.role !== "observation")
            .map((message) => (
              <article key={message.id} className={`bubble ${message.role}`}>
                <div className="bubble-role">{message.role === "user" ? "you" : "fairy"}</div>
                <div>{message.content}</div>
              </article>
            ))
        )}
      </section>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) {
            void cancelActiveRequest();
          } else {
            void sendMessage(draft);
          }
        }}
      >
        <button className={`round-button ${callActive ? "active" : ""}`} type="button" onClick={() => setCallActive((value) => !value)}>
          <Mic size={19} />
        </button>
        <textarea
          value={draft}
          rows={1}
          placeholder="Talk to fairy..."
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendMessage(draft);
            }
          }}
        />
        <button className={`round-button send ${busy ? "active" : ""}`} type="submit" disabled={!busy && !draft.trim()} title={busy ? "Cancel" : "Send"}>
          {busy ? <Square size={18} /> : <Send size={18} />}
        </button>
      </form>

      {settingsOpen && settings && (
        <SettingsPanel
          settings={settings}
          stats={memoryStats}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
          onExport={() => window.fairy.exportMemory()}
        />
      )}
    </main>
  );
}

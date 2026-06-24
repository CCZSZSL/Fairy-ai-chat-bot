import { ChangeEvent, ReactNode, useEffect, useState } from "react";
import { Download, Eye, KeyRound, Mic, Monitor, Volume2, X } from "lucide-react";

interface SettingsPanelProps {
  settings: FairySettings;
  stats: MemoryStats | null;
  onClose: () => void;
  onSave: (settings: Partial<FairySettings>) => Promise<void>;
  onExport: () => Promise<{ exportedPath: string; manifestPath?: string }>;
}

type RouteKey = keyof FairyModelRoutes;

interface RoutePreset {
  id: string;
  label: string;
  routes: RouteKey[];
  route: Pick<FairyModelRoute, "provider" | "label" | "baseUrl" | "model" | "endpoint" | "enabled">;
}

const routeIcons: Record<RouteKey, ReactNode> = {
  chat: <KeyRound size={15} />,
  vision: <Eye size={15} />,
  stt: <Mic size={15} />,
  tts: <Volume2 size={15} />,
};

const mimoPresetVoices = ["茉莉", "冰糖", "苏打", "白桦", "Mia", "Chloe", "Milo", "Dean", "mimo_default"];

const routePresets: RoutePreset[] = [
  {
    id: "ollama-qwen35-4b",
    label: "Ollama Qwen3.5 4B",
    routes: ["chat", "vision"],
    route: {
      provider: "ollama",
      label: "Local Ollama Qwen3.5 4B",
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3.5:4b",
      endpoint: "",
      enabled: true,
    },
  },
  {
    id: "ollama-qwen35-9b",
    label: "Ollama Qwen3.5 9B",
    routes: ["chat", "vision"],
    route: {
      provider: "ollama",
      label: "Local Ollama Qwen3.5 9B",
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3.5:9b",
      endpoint: "",
      enabled: true,
    },
  },
  {
    id: "ollama-qwen36-27b",
    label: "Ollama Qwen3.6 27B",
    routes: ["chat", "vision"],
    route: {
      provider: "ollama",
      label: "Local Ollama Qwen3.6 27B",
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3.6:27b",
      endpoint: "",
      enabled: true,
    },
  },
  {
    id: "ollama-qwen36-35b",
    label: "Ollama Qwen3.6 35B",
    routes: ["chat", "vision"],
    route: {
      provider: "ollama",
      label: "Local Ollama Qwen3.6 35B",
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3.6:35b",
      endpoint: "",
      enabled: true,
    },
  },
  {
    id: "lmstudio-local",
    label: "LM Studio local",
    routes: ["chat", "vision"],
    route: {
      provider: "local-openai",
      label: "Local OpenAI-compatible chat",
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "local-model",
      endpoint: "",
      enabled: true,
    },
  },
  {
    id: "deepseek-flash",
    label: "DeepSeek V4 Flash",
    routes: ["chat"],
    route: {
      provider: "deepseek",
      label: "DeepSeek V4 Flash",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      endpoint: "",
      enabled: true,
    },
  },
  {
    id: "deepseek-pro",
    label: "DeepSeek V4 Pro",
    routes: ["chat"],
    route: {
      provider: "deepseek",
      label: "DeepSeek V4 Pro",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      endpoint: "",
      enabled: true,
    },
  },
  {
    id: "mimo-pro",
    label: "MiMo V2.5 Pro",
    routes: ["chat"],
    route: {
      provider: "mimo",
      label: "MiMo V2.5 Pro",
      baseUrl: "https://api.xiaomimimo.com/v1",
      model: "mimo-v2.5-pro",
      endpoint: "",
      enabled: true,
    },
  },
  {
    id: "mimo-vision",
    label: "MiMo Vision",
    routes: ["vision"],
    route: {
      provider: "mimo",
      label: "MiMo multimodal vision",
      baseUrl: "https://api.xiaomimimo.com/v1",
      model: "mimo-v2.5",
      endpoint: "",
      enabled: true,
    },
  },
  {
    id: "mimo-asr",
    label: "MiMo ASR",
    routes: ["stt"],
    route: {
      provider: "mimo",
      label: "MiMo speech recognition",
      baseUrl: "https://api.xiaomimimo.com/v1",
      model: "mimo-v2.5-asr",
      endpoint: "",
      enabled: true,
    },
  },
  {
    id: "mimo-tts",
    label: "MiMo TTS 茉莉",
    routes: ["tts"],
    route: {
      provider: "mimo",
      label: "MiMo speech synthesis - 茉莉",
      baseUrl: "https://api.xiaomimimo.com/v1",
      model: "mimo-v2.5-tts",
      endpoint: "",
      enabled: true,
    },
  },
];

export function SettingsPanel({ settings, stats, onClose, onSave, onExport }: SettingsPanelProps) {
  const [draft, setDraft] = useState(settings);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [exportedPath, setExportedPath] = useState("");

  useEffect(() => {
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const setField = <K extends keyof FairySettings>(key: K, value: FairySettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const setRoute = <K extends keyof FairyModelRoute>(routeKey: RouteKey, field: K, value: FairyModelRoute[K]) => {
    setDraft((current) => ({
      ...current,
      modelRoutes: {
        ...current.modelRoutes,
        [routeKey]: {
          ...current.modelRoutes[routeKey],
          [field]: value,
        },
      },
    }));
  };

  const applyPreset = (routeKey: RouteKey, preset: RoutePreset) => {
    setDraft((current) => ({
      ...current,
      ...(routeKey === "tts" && preset.id === "mimo-tts"
        ? {
            ttsProvider: "custom" as const,
            ttsVoiceId: "茉莉",
            ttsVoiceName: "茉莉",
            ttsVoiceSamplePath: "",
          }
        : {}),
      modelRoutes: {
        ...current.modelRoutes,
        [routeKey]: {
          ...current.modelRoutes[routeKey],
          ...preset.route,
        },
      },
    }));
  };

  const changeString = (handler: (value: string) => void) => {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => handler(event.target.value);
  };

  const changeNumber = (key: "recentContextMessages" | "chatMaxTokens", min: number, max: number) => {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) return;
      setDraft((current) => ({ ...current, [key]: Math.min(max, Math.max(min, Math.round(value))) }));
    };
  };

  const save = async () => {
    await onSave(draft);
    onClose();
  };

  const exportMemory = async () => {
    const result = await onExport();
    setExportedPath(result.exportedPath);
  };

  return (
    <div className="settings-backdrop">
      <section className="settings-panel">
        <header className="settings-header">
          <div>
            <strong>fairy settings</strong>
            <span>local-first memory and model routes</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="settings-scroll">
          <section className="setting-section">
            <h2>Model Routes</h2>
            {(["chat", "vision", "stt", "tts"] as RouteKey[]).map((routeKey) => {
              const route = draft.modelRoutes[routeKey];
              return (
                <div className="route-editor" key={routeKey}>
                  <div className="route-title">
                    {routeIcons[routeKey]}
                    <span>{routeKey}</span>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={route.enabled}
                        onChange={(event) => setRoute(routeKey, "enabled", event.target.checked)}
                      />
                      <span />
                    </label>
                  </div>
                  <div className="preset-grid">
                    {routePresets
                      .filter((preset) => preset.routes.includes(routeKey))
                      .map((preset) => (
                        <button className="preset-chip" type="button" key={preset.id} onClick={() => applyPreset(routeKey, preset)}>
                          {preset.label}
                        </button>
                      ))}
                  </div>
                  <input value={route.label} onChange={changeString((value) => setRoute(routeKey, "label", value))} />
                  <select
                    value={route.provider}
                    onChange={changeString((value) => setRoute(routeKey, "provider", value as FairyModelRoute["provider"]))}
                  >
                    <option value="openai-compatible">OpenAI compatible</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="mimo">MiMo</option>
                    <option value="local-openai">Local OpenAI</option>
                    <option value="ollama">Ollama</option>
                    <option value="custom">Custom</option>
                  </select>
                  <input value={route.baseUrl} placeholder="Base URL" onChange={changeString((value) => setRoute(routeKey, "baseUrl", value))} />
                  <input value={route.model} placeholder="Model" onChange={changeString((value) => setRoute(routeKey, "model", value))} />
                  <input value={route.endpoint} placeholder="Custom endpoint" onChange={changeString((value) => setRoute(routeKey, "endpoint", value))} />
                  <input
                    value={route.apiKey}
                    type="password"
                    placeholder="API key"
                    onChange={changeString((value) => setRoute(routeKey, "apiKey", value))}
                  />
                </div>
              );
            })}
          </section>

          <section className="setting-section two-col">
            <h2>Screen</h2>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.screenshotSaveImages}
                onChange={(event) => setField("screenshotSaveImages", event.target.checked)}
              />
              <span>Save images locally</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.visionUploadEnabled}
                onChange={(event) => setField("visionUploadEnabled", event.target.checked)}
              />
              <span>Use vision on request</span>
            </label>
          </section>

          <section className="setting-section">
            <h2>Voice</h2>
            <label className="field">
              <span>Output</span>
              <select value={draft.ttsProvider} onChange={changeString((value) => setField("ttsProvider", value as FairySettings["ttsProvider"]))}>
                <option value="browser">Browser voice</option>
                <option value="custom">Model route voice</option>
              </select>
            </label>
            <label className="field">
              <span>Browser voice</span>
              <select value={draft.ttsVoiceName} onChange={changeString((value) => setField("ttsVoiceName", value))}>
                <option value="">System default</option>
                {voices.map((voice) => (
                  <option value={voice.name} key={voice.name}>
                    {voice.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>MiMo preset voice</span>
              <select
                value={draft.ttsVoiceId || "茉莉"}
                onChange={changeString((value) =>
                  setDraft((current) => ({
                    ...current,
                    ttsVoiceId: value,
                    ttsVoiceName: value,
                    ttsVoiceSamplePath: "",
                  })),
                )}
              >
                {!mimoPresetVoices.includes(draft.ttsVoiceId) && draft.ttsVoiceId ? (
                  <option value={draft.ttsVoiceId}>{draft.ttsVoiceId}</option>
                ) : null}
                {mimoPresetVoices.map((voice) => (
                  <option value={voice} key={voice}>
                    {voice}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Voice sample</span>
              <input value={draft.ttsVoiceSamplePath ?? ""} onChange={changeString((value) => setField("ttsVoiceSamplePath", value))} />
            </label>
          </section>

          <section className="setting-section">
            <h2>Personality</h2>
            <textarea value={draft.personality} rows={5} onChange={changeString((value) => setField("personality", value))} />
            <label className="field">
              <span>Proactive mode</span>
              <select
                value={draft.proactiveMode}
                onChange={changeString((value) => setField("proactiveMode", value as FairySettings["proactiveMode"]))}
              >
                <option value="adaptive">adaptive</option>
                <option value="quiet">quiet</option>
                <option value="balanced">balanced</option>
                <option value="active">active</option>
              </select>
            </label>
            <label className="field">
              <span>Recent context</span>
              <input
                type="number"
                min={8}
                max={40}
                value={draft.recentContextMessages ?? 14}
                onChange={changeNumber("recentContextMessages", 8, 40)}
              />
            </label>
            <label className="field">
              <span>Reply token cap</span>
              <input
                type="number"
                min={80}
                max={2000}
                value={draft.chatMaxTokens ?? 280}
                onChange={changeNumber("chatMaxTokens", 80, 2000)}
              />
            </label>
          </section>

          <section className="setting-section">
            <h2>Memory</h2>
            <div className="memory-path">
              <Monitor size={15} />
              <span>{stats?.dbPath || "not initialized"}</span>
            </div>
            <div className="memory-path">
              <Download size={15} />
              <span>{exportedPath || stats?.screenshotDir || "backup pending"}</span>
            </div>
            <button className="wide-button" type="button" onClick={exportMemory}>
              <Download size={16} />
              <span>Backup memory</span>
            </button>
          </section>
        </div>

        <footer className="settings-actions">
          <button className="text-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="text-button primary" type="button" onClick={save}>
            Save
          </button>
        </footer>
      </section>
    </div>
  );
}

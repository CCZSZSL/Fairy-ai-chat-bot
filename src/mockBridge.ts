const memoryKey = "fairy.mock.messages";
const settingsKey = "fairy.mock.settings";
const apiBase = "http://127.0.0.1:5174/api";

const defaultSettings: FairySettings = {
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  chatModel: "gpt-4.1-mini",
  modelRoutes: {
    chat: {
      provider: "openai-compatible",
      label: "Default chat model",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4.1-mini",
      endpoint: "",
      enabled: true,
    },
    vision: {
      provider: "openai-compatible",
      label: "Strong multimodal vision model",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4.1-mini",
      endpoint: "",
      enabled: false,
    },
    stt: {
      provider: "openai-compatible",
      label: "External speech recognition",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "whisper-1",
      endpoint: "",
      enabled: true,
    },
    tts: {
      provider: "custom",
      label: "Custom cloned voice",
      baseUrl: "",
      apiKey: "",
      model: "",
      endpoint: "",
      enabled: false,
    },
  },
  sttProvider: "openai-compatible",
  sttModel: "whisper-1",
  sttEndpoint: "",
  ttsProvider: "browser",
  ttsEndpoint: "",
  ttsVoiceId: "",
  ttsVoiceName: "",
  ttsVoiceSamplePath: "",
  screenshotEnabled: false,
  screenshotIntervalMs: 20000,
  screenshotSaveImages: true,
  screenSensitiveKeywords: [
    "password",
    "passcode",
    "login",
    "bank",
    "payment",
    "checkout",
    "wallet",
    "secret",
    "token",
    "api key",
    "private key",
    "seed phrase",
    "incognito",
  ],
  visionUploadEnabled: false,
  visionModel: "gpt-4.1-mini",
  personality:
    "You are fairy, a local-first AI companion and code-life partner. Speak warmly, naturally, and directly.",
  proactiveMode: "adaptive",
  contextTokenBudget: 8000,
  recentContextMessages: 14,
  chatMaxTokens: 280,
};

function loadMessages(): FairyMessage[] {
  return JSON.parse(localStorage.getItem(memoryKey) || "[]");
}

function saveMessages(messages: FairyMessage[]) {
  localStorage.setItem(memoryKey, JSON.stringify(messages));
}

function loadSettings(): FairySettings {
  return {
    ...defaultSettings,
    ...JSON.parse(localStorage.getItem(settingsKey) || "{}"),
  };
}

function saveMessage(role: FairyRole, content: string, metadata?: Record<string, unknown>): FairyMessage {
  const messages = loadMessages();
  const message: FairyMessage = {
    id: Date.now(),
    role,
    content,
    createdAt: new Date().toISOString(),
    metadata,
  };
  saveMessages([...messages, message]);
  return message;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `Local fairy server failed (${response.status})`;
    try {
      const json = await response.json();
      message = json.error || message;
    } catch {
      message = await response.text();
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function installMockBridge() {
  if (window.fairy) return;

  window.fairy = {
    async loadMessages() {
      try {
        return await apiFetch<FairyMessage[]>("/messages");
      } catch {
        return loadMessages();
      }
    },
    async sendChat(content: string, context?: string, requestId?: string) {
      try {
        return await apiFetch<FairyMessage>("/chat", {
          method: "POST",
          body: JSON.stringify({ content, context, requestId }),
        });
      } catch (error) {
        if (error instanceof Error && !error.message.includes("Failed to fetch")) throw error;
      }

      saveMessage("user", content, { source: "mock" });
      return saveMessage(
        "assistant",
        "I'm running in web preview mode. The Electron bridge will connect my local memory, screenshots, and model routes when the desktop shell is available.",
        { source: "mock" },
      );
    },
    async sendChatStream(content: string, context?: string, requestId?: string) {
      return this.sendChat(content, context, requestId);
    },
    async saveMessage(role, content, metadata) {
      try {
        return await apiFetch<FairyMessage>("/messages", {
          method: "POST",
          body: JSON.stringify({ role, content, metadata }),
        });
      } catch {
        // Fall through to browser-local preview storage.
      }
      return saveMessage(role, content, metadata);
    },
    async loadSettings() {
      try {
        return await apiFetch<FairySettings>("/settings");
      } catch {
        return loadSettings();
      }
    },
    async saveSettings(settings) {
      try {
        return await apiFetch<FairySettings>("/settings", {
          method: "POST",
          body: JSON.stringify(settings),
        });
      } catch {
        // Fall through to browser-local preview storage.
      }

      const next = {
        ...loadSettings(),
        ...settings,
        modelRoutes: {
          ...loadSettings().modelRoutes,
          ...(settings.modelRoutes || {}),
        },
      };
      localStorage.setItem(settingsKey, JSON.stringify(next));
      return next;
    },
    async getMemoryStats() {
      try {
        return await apiFetch<MemoryStats>("/memory/stats");
      } catch {
        // Fall through to browser-local preview stats.
      }

      return {
        dbPath: "web preview localStorage",
        screenshotDir: "web preview",
        messages: loadMessages().length,
        summaries: 0,
        screenshots: 0,
      };
    },
    async exportMemory() {
      try {
        return await apiFetch<{ exportedPath: string }>("/memory/export", { method: "POST", body: "{}" });
      } catch {
        return { exportedPath: "web preview export unavailable" };
      }
    },
    async transcribeAudio(audio, mimeType) {
      try {
        return await apiFetch<{ text: string }>("/speech/transcribe", {
          method: "POST",
          body: JSON.stringify({ audioBase64: arrayBufferToBase64(audio), mimeType }),
        });
      } catch {
        // Fall through to preview error.
      }
      throw new Error("External speech recognition is available in the desktop bridge.");
    },
    async synthesizeSpeech(text) {
      try {
        return await apiFetch<{ audioBase64: string; mimeType: string }>("/speech/synthesize", {
          method: "POST",
          body: JSON.stringify({ text }),
        });
      } catch {
        // Fall through to browser speech synthesis.
      }
      throw new Error("Custom TTS is available in the desktop bridge.");
    },
    async synthesizeSpeechStream(text) {
      return { streamed: false, ...(await this.synthesizeSpeech(text)) };
    },
    async observeScreen(requestId?: string) {
      try {
        return await apiFetch<{
          saved: boolean;
          sensitive: boolean;
          analysis?: string;
          message?: string;
          filePath?: string;
          reason?: string;
        }>("/screen/observe", { method: "POST", body: JSON.stringify({ requestId }) });
      } catch {
        // Fall through to preview response.
      }

      return {
        saved: false,
        sensitive: false,
        reason: "Screen observation is available in the desktop bridge.",
      };
    },
    onScreenObserved() {
      return () => {};
    },
    onChatStream() {
      return () => {};
    },
    onSpeechStream() {
      return () => {};
    },
    async cancelRequest() {
      return { canceled: 0 };
    },
    async setAlwaysOnTop() {},
    async minimize() {},
    async close() {},
  };
}

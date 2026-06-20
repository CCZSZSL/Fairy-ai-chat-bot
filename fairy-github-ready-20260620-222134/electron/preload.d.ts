export {};

declare global {
  interface Window {
    fairy: FairyBridge;
  }

  type FairyRole = "user" | "assistant" | "system" | "observation";

  interface FairyMessage {
    id: number;
    role: FairyRole;
    content: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }

  interface FairySettings {
    apiBaseUrl: string;
    apiKey: string;
    chatModel: string;
    modelRoutes: FairyModelRoutes;
    sttProvider: "openai-compatible" | "custom";
    sttModel: string;
    sttEndpoint: string;
    ttsProvider: "browser" | "custom";
    ttsEndpoint: string;
    ttsVoiceId: string;
    ttsVoiceName: string;
    ttsVoiceSamplePath: string;
    screenshotEnabled: boolean;
    screenshotIntervalMs: number;
    screenshotSaveImages: boolean;
    screenSensitiveKeywords: string[];
    visionUploadEnabled: boolean;
    visionModel: string;
    personality: string;
    proactiveMode: "quiet" | "balanced" | "active" | "adaptive";
    contextTokenBudget: number;
    recentContextMessages: number;
    chatMaxTokens: number;
  }

  interface FairyModelRoute {
    provider: "openai-compatible" | "deepseek" | "mimo" | "custom";
    label: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    endpoint: string;
    enabled: boolean;
  }

  interface FairyModelRoutes {
    chat: FairyModelRoute;
    vision: FairyModelRoute;
    stt: FairyModelRoute;
    tts: FairyModelRoute;
  }

  interface MemoryStats {
    dbPath: string;
    screenshotDir: string;
    messages: number;
    summaries: number;
    screenshots: number;
  }

  interface FairyBridge {
    loadMessages(): Promise<FairyMessage[]>;
    sendChat(content: string, context?: string, requestId?: string): Promise<FairyMessage>;
    saveMessage(role: FairyRole, content: string, metadata?: Record<string, unknown>): Promise<FairyMessage>;
    loadSettings(): Promise<FairySettings>;
    saveSettings(settings: Partial<FairySettings>): Promise<FairySettings>;
    getMemoryStats(): Promise<MemoryStats>;
    exportMemory(): Promise<{ exportedPath: string; manifestPath?: string }>;
    transcribeAudio(audio: ArrayBuffer, mimeType: string): Promise<{ text: string }>;
    synthesizeSpeech(text: string): Promise<{ audioBase64: string; mimeType: string }>;
    observeScreen(requestId?: string): Promise<{
      saved: boolean;
      sensitive: boolean;
      analysis?: string;
      message?: string;
      filePath?: string;
      reason?: string;
    }>;
    cancelRequest(requestId?: string): Promise<{ canceled: number }>;
    onScreenObserved(
      callback: (result: {
        saved: boolean;
        sensitive: boolean;
        analysis?: string;
        message?: string;
        filePath?: string;
        reason?: string;
      }) => void,
    ): () => void;
    setAlwaysOnTop(enabled: boolean): Promise<void>;
    minimize(): Promise<void>;
    close(): Promise<void>;
  }
}

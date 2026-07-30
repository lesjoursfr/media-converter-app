import type { ConversionEvent, ConversionRequest, MediaInfo, ToolingStatus } from "../shared";

declare global {
  interface Window {
    mediaConverter: {
      cancelConversion(): Promise<{ canceled: boolean }>;
      getEnvironmentVariables(): Promise<Record<string, string>>;
      getToolingStatus(): Promise<ToolingStatus>;
      onConversionEvent(listener: (event: ConversionEvent) => void): void;
      selectFile(): Promise<MediaInfo | null>;
      startConversion(request: ConversionRequest): Promise<{ started: boolean }>;
    };
  }
}

export {};

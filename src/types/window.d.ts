import type { ConversionEvent, ConversionRequest, MediaInfo } from "../shared/media";

declare global {
  interface Window {
    mediaConverter: {
      cancelConversion(): Promise<{ canceled: boolean }>;
      onConversionEvent(listener: (event: ConversionEvent) => void): void;
      selectFile(): Promise<MediaInfo | null>;
      startConversion(request: ConversionRequest): Promise<{ started: boolean }>;
    };
  }
}

export {};

export type MediaKind = "audio" | "video";

export type AudioInfo = {
  bitrateKbps: number | null;
  channels: number | null;
  codec: string;
  sampleRateHz: number | null;
};

export type VideoInfo = {
  bitrateKbps: number | null;
  codec: string;
  frameRate: string | null;
  height: number;
  width: number;
};

export type MediaInfo = {
  audio: AudioInfo | null;
  durationSeconds: number;
  format: string;
  kind: MediaKind;
  path: string;
  suggestedAudioBitrateKbps: number;
  suggestedVideoBitrateKbps: number;
  video: VideoInfo | null;
};

export type ConversionRequest = {
  audioBitrateKbps: number;
  inputPath: string;
  kind: MediaKind;
  videoBitrateKbps: number;
};

export type ConversionEvent =
  | { percent: number; type: "started" }
  | { jobIndex: number; outputPath: string; totalJobs: number; type: "job-started" }
  | {
      currentJobPercent: number;
      jobIndex: number;
      outputPath: string;
      percent: number;
      totalJobs: number;
      type: "progress";
    }
  | { outputPaths: Array<string>; percent: number; type: "completed" }
  | { percent: number; type: "aborted" }
  | { message: string; percent: number; type: "error" };

export type HostOs = "macos" | "linux" | "windows" | "unknown";

export type ToolBinaryName = "ffmpeg" | "ffprobe";

export type ToolBinaryStatus = {
  available: boolean;
  error: string | null;
  meetsMinimum: boolean;
  name: ToolBinaryName;
  version: string | null;
};

export type ToolingStatus = {
  allMeetMinimum: boolean;
  ffmpeg: ToolBinaryStatus;
  ffprobe: ToolBinaryStatus;
  minimumRequiredVersion: string;
  os: HostOs;
};

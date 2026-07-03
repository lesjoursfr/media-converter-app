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
  mediaInfo: MediaInfo;
  videoBitrateKbps: number;
};

export type ConversionJob = {
  args: Array<string>;
  outputPath: string;
};

export type ConversionEvent =
  | { percent: number; type: "started" }
  | { jobIndex: number; outputPath: string; totalJobs: number; type: "job-started" }
  | { currentJobPercent: number; jobIndex: number; outputPath: string; percent: number; totalJobs: number; type: "progress" }
  | { outputPaths: Array<string>; percent: number; type: "completed" }
  | { percent: number; type: "aborted" }
  | { message: string; percent: number; type: "error" };

type ProbeStream = {
  avg_frame_rate?: string;
  bit_rate?: string;
  channels?: number;
  codec_name?: string;
  codec_type?: string;
  height?: number;
  r_frame_rate?: string;
  sample_rate?: string;
  tags?: Record<string, string | undefined>;
  width?: number;
};

type ProbeFormat = {
  bit_rate?: string;
  duration?: string;
  format_name?: string;
};

type ProbeOutput = {
  format?: ProbeFormat;
  streams?: Array<ProbeStream>;
};

const DEFAULT_AUDIO_BITRATE_KBPS = 256;
const DEFAULT_VIDEO_BITRATE_KBPS = 4000;

function parseNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toKbps(bitsPerSecond: number | null) {
  if (bitsPerSecond === null || bitsPerSecond <= 0) {
    return null;
  }

  return Math.max(1, Math.round(bitsPerSecond / 1000));
}

function readBitrateKbps(stream: ProbeStream | undefined, fallbackBps?: number | null) {
  const values = [stream?.bit_rate, stream?.tags?.BPS, fallbackBps];

  for (const value of values) {
    const parsed = parseNumber(value);
    const kbps = toKbps(parsed);

    if (kbps !== null) {
      return kbps;
    }
  }

  return null;
}

function formatFrameRate(value: string | undefined) {
  if (value === undefined || value.length === 0 || value === "0/0") {
    return null;
  }

  const [numeratorText, denominatorText] = value.split("/", 2);
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);

  if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
    return `${(numerator / denominator).toFixed(2)} fps`;
  }

  return value;
}

function replaceExtension(filePath: string, extension: string) {
  return /\.[^./\\]+$/u.test(filePath) ? filePath.replace(/\.[^./\\]+$/u, `.${extension}`) : `${filePath}.${extension}`;
}

function createAudioOnlyArgs(audioBitrateKbps: number, format: "m4a" | "weba") {
  if (format === "m4a") {
    return [
      "-vn",
      "-f",
      "mp4",
      "-c:a",
      "aac",
      "-b:a",
      `${audioBitrateKbps}k`,
      "-ac",
      "2",
      "-aac_coder",
      "twoloop",
      "-profile:a",
      "aac_low",
      "-movflags",
      "+faststart",
    ];
  }

  return [
    "-vn",
    "-f",
    "webm",
    "-c:a",
    "libopus",
    "-b:a",
    `${audioBitrateKbps}k`,
    "-ac",
    "2",
    "-vbr",
    "constrained",
    "-compression_level",
    "10",
  ];
}

function createVideoArgs(
  mediaInfo: MediaInfo,
  audioBitrateKbps: number,
  videoBitrateKbps: number,
  format: "mp4" | "webm"
) {
  const args =
    format === "mp4"
      ? [
          "-f",
          "mp4",
          "-c:v",
          "libx264",
          "-b:v",
          `${videoBitrateKbps}k`,
          "-preset",
          "veryslow",
          "-minrate",
          `${Math.floor(videoBitrateKbps / 8)}k`,
          "-maxrate",
          `${Math.floor(videoBitrateKbps * 1.5)}k`,
          "-force_key_frames",
          "expr:eq(n,0)",
          "-movflags",
          "+faststart",
        ]
      : [
          "-f",
          "webm",
          "-c:v",
          "libvpx-vp9",
          "-b:v",
          `${videoBitrateKbps}k`,
          "-deadline",
          "good",
          "-minrate",
          `${Math.floor(videoBitrateKbps / 8)}k`,
          "-maxrate",
          `${Math.floor(videoBitrateKbps * 1.5)}k`,
          "-cpu-used",
          "0",
          "-keyint_min",
          "0",
          "-g",
          "360",
          "-slices",
          "4",
          "-static-thresh",
          "0",
          "-qmin",
          "0",
          "-qmax",
          "60",
          "-force_key_frames",
          "expr:eq(n,0)",
        ];

  if (mediaInfo.audio === null) {
    args.push("-an");
    return args;
  }

  if (format === "mp4") {
    args.push("-c:a", "aac", "-b:a", `${audioBitrateKbps}k`, "-ac", "2", "-aac_coder", "twoloop", "-profile:a", "aac_low");
    return args;
  }

  args.push("-c:a", "libopus", "-b:a", `${audioBitrateKbps}k`, "-ac", "2", "-vbr", "constrained", "-compression_level", "10");
  return args;
}

export function parseProbeOutput(filePath: string, rawProbeOutput: string): MediaInfo {
  const parsed = JSON.parse(rawProbeOutput) as ProbeOutput;
  const streams = parsed.streams ?? [];
  const format = parsed.format;
  const formatBitRate = parseNumber(format?.bit_rate);
  const audioStream = streams.find((stream) => stream.codec_type === "audio");
  const videoStream = streams.find((stream) => stream.codec_type === "video");

  if (audioStream === undefined && videoStream === undefined) {
    throw new Error("The selected file does not contain an audio or a video stream.");
  }

  const audioBitrateKbps = readBitrateKbps(audioStream, formatBitRate);
  const videoBitrateKbps = readBitrateKbps(videoStream, formatBitRate);

  return {
    audio:
      audioStream === undefined
        ? null
        : {
            bitrateKbps: audioBitrateKbps,
            channels: audioStream.channels ?? null,
            codec: audioStream.codec_name ?? "unknown",
            sampleRateHz: parseNumber(audioStream.sample_rate),
          },
    durationSeconds: Math.max(parseNumber(format?.duration) ?? 0, 0),
    format: format?.format_name ?? "unknown",
    kind: videoStream === undefined ? "audio" : "video",
    path: filePath,
    suggestedAudioBitrateKbps: audioBitrateKbps ?? DEFAULT_AUDIO_BITRATE_KBPS,
    suggestedVideoBitrateKbps: videoStream === undefined ? 0 : videoBitrateKbps ?? DEFAULT_VIDEO_BITRATE_KBPS,
    video:
      videoStream === undefined
        ? null
        : {
            bitrateKbps: videoBitrateKbps,
            codec: videoStream.codec_name ?? "unknown",
            frameRate: formatFrameRate(videoStream.avg_frame_rate ?? videoStream.r_frame_rate),
            height: videoStream.height ?? 0,
            width: videoStream.width ?? 0,
          },
  };
}

export function buildConversionJobs(request: ConversionRequest): Array<ConversionJob> {
  if (request.mediaInfo.kind === "audio") {
    return [
      {
        args: createAudioOnlyArgs(request.audioBitrateKbps, "m4a"),
        outputPath: replaceExtension(request.inputPath, "m4a"),
      },
      {
        args: createAudioOnlyArgs(request.audioBitrateKbps, "weba"),
        outputPath: replaceExtension(request.inputPath, "weba"),
      },
    ];
  }

  return [
    {
      args: createVideoArgs(request.mediaInfo, request.audioBitrateKbps, request.videoBitrateKbps, "mp4"),
      outputPath: replaceExtension(request.inputPath, "mp4"),
    },
    {
      args: createVideoArgs(request.mediaInfo, request.audioBitrateKbps, request.videoBitrateKbps, "webm"),
      outputPath: replaceExtension(request.inputPath, "webm"),
    },
  ];
}

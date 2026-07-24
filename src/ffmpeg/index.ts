import ffmpeg from "fluent-ffmpeg";
import { extname } from "node:path";
import type { ConversionRequest, MediaInfo, ToolBinaryName } from "../shared";
import { Codecs, ffmpegWithCodec } from "./presets";

export const MINIMUM_REQUIRED_TOOL_VERSION = "6.1.1";

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

export type ConversionJob = {
  ffmpegCommand: ffmpeg.FfmpegCommand;
  outputPath: string;
};

export type ConversionController = {
  aborted: boolean;
  currentProcess: ffmpeg.FfmpegCommand | null;
};

function parseVersionParts(version: string) {
  const match = version.match(/^(?<major>\d+)\.(?<minor>\d+)(?:\.(?<patch>\d+))?$/u);

  if (match?.groups === undefined) {
    return null;
  }

  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch ?? "0"),
  };
}

export function compareToolVersions(left: string, right: string) {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);

  if (leftParts === null || rightParts === null) {
    return null;
  }

  if (leftParts.major !== rightParts.major) {
    return leftParts.major > rightParts.major ? 1 : -1;
  }

  if (leftParts.minor !== rightParts.minor) {
    return leftParts.minor > rightParts.minor ? 1 : -1;
  }

  if (leftParts.patch !== rightParts.patch) {
    return leftParts.patch > rightParts.patch ? 1 : -1;
  }

  return 0;
}

export function extractVersionFromBanner(toolName: ToolBinaryName, output: string) {
  const line = output.split(/\r?\n/u).find((candidate) => candidate.startsWith(`${toolName} version `));

  if (line === undefined) {
    return null;
  }

  const token = line.split(/\s+/u)[2];

  if (token === undefined) {
    return null;
  }

  const match = token.match(/(?<major>\d+)\.(?<minor>\d+)(?:\.(?<patch>\d+))?/u);

  if (match?.groups === undefined) {
    return null;
  }

  return `${match.groups.major}.${match.groups.minor}.${match.groups.patch ?? "0"}`;
}

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
    suggestedVideoBitrateKbps: videoStream === undefined ? 0 : (videoBitrateKbps ?? DEFAULT_VIDEO_BITRATE_KBPS),
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
  const timestamp = Date.now();
  const inputExtname = extname(request.inputPath);

  const codecs = request.mediaInfo.kind === "audio" ? [Codecs.m4a, Codecs.weba] : [Codecs.mp4, Codecs.webm];
  return codecs.map((codec) => {
    const outputPath = request.inputPath.replace(new RegExp(`${inputExtname}$`), `-${timestamp}.${codec}`);

    return {
      ffmpegCommand: ffmpegWithCodec(ffmpeg(request.inputPath), codec, {
        audioBitrate: request.audioBitrateKbps,
        videoBitrate: request.videoBitrateKbps,
      }).output(outputPath),
      outputPath,
    };
  });
}

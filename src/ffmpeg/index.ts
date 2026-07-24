import ffmpeg from "fluent-ffmpeg";
import { spawn } from "node:child_process";
import { extname } from "node:path";
import type { ConversionRequest, HostOs, MediaInfo, ToolBinaryName, ToolBinaryStatus, ToolingStatus } from "../shared";
import { Codecs, ffmpegWithCodec } from "./presets";

export const MINIMUM_REQUIRED_TOOL_VERSION = "6.1.1";

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

function resolveHostOs(): HostOs {
  if (process.platform === "darwin") {
    return "macos";
  }

  if (process.platform === "linux") {
    return "linux";
  }

  if (process.platform === "win32") {
    return "windows";
  }

  return "unknown";
}

function collectCommandOutput(command: string, args: Array<string>) {
  return new Promise<string>((resolve, reject) => {
    const process = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    process.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    process.on("error", (error) => {
      reject(error);
    });

    process.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function detectToolStatus(name: ToolBinaryName): Promise<ToolBinaryStatus> {
  try {
    const banner = await collectCommandOutput(name, ["-version"]);
    const version = extractVersionFromBanner(name, banner);

    if (version === null) {
      return {
        available: true,
        error: `Unable to parse the ${name} version.`,
        meetsMinimum: false,
        name,
        version: null,
      };
    }

    const comparison = compareToolVersions(version, MINIMUM_REQUIRED_TOOL_VERSION);

    if (comparison === null) {
      return {
        available: true,
        error: `Detected an invalid ${name} version string (${version}).`,
        meetsMinimum: false,
        name,
        version,
      };
    }

    if (comparison < 0) {
      return {
        available: true,
        error: `${name} ${version} is too old. Minimum required is ${MINIMUM_REQUIRED_TOOL_VERSION}.`,
        meetsMinimum: false,
        name,
        version,
      };
    }

    return {
      available: true,
      error: null,
      meetsMinimum: true,
      name,
      version,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : `Unable to run ${name}.`,
      meetsMinimum: false,
      name,
      version: null,
    };
  }
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

function readBitrateKbps(stream: ffmpeg.FfprobeStream | undefined): number | null {
  const bitsPerSecond = parseNumber(stream?.bit_rate);

  if (bitsPerSecond === null || bitsPerSecond <= 0) {
    return null;
  }

  return Math.max(1, Math.round(bitsPerSecond / 1000));
}

function formatFrameRate(value: string | undefined): string | null {
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

function parseProbeOutput(filePath: string, metadata: ffmpeg.FfprobeData): MediaInfo {
  const streams = metadata.streams ?? [];
  const format = metadata.format;
  const audioStream = streams.find((stream) => stream.codec_type === "audio");
  const videoStream = streams.find((stream) => stream.codec_type === "video");

  if (audioStream === undefined && videoStream === undefined) {
    throw new Error("The selected file does not contain an audio or a video stream.");
  }

  const audioBitrateKbps = readBitrateKbps(audioStream);
  const videoBitrateKbps = readBitrateKbps(videoStream);

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

export async function getToolingStatus(): Promise<ToolingStatus> {
  const [ffmpeg, ffprobe] = await Promise.all([detectToolStatus("ffmpeg"), detectToolStatus("ffprobe")]);

  return {
    allMeetMinimum: ffmpeg.meetsMinimum && ffprobe.meetsMinimum,
    ffmpeg,
    ffprobe,
    minimumRequiredVersion: MINIMUM_REQUIRED_TOOL_VERSION,
    os: resolveHostOs(),
  };
}

export function readFileMetadata(filePath: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      try {
        resolve(parseProbeOutput(filePath, metadata));
      } catch (err) {
        reject(err);
      }
    });
  });
}

export function createConversionJobs(request: ConversionRequest): Array<ConversionJob> {
  const timestamp = Date.now();
  const inputExtname = extname(request.inputPath);

  const codecs = request.kind === "audio" ? [Codecs.m4a, Codecs.weba] : [Codecs.mp4, Codecs.webm];
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

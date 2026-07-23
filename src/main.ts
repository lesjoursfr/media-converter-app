import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import {
  buildConversionJobs,
  parseProbeOutput,
  type ConversionEvent,
  type ConversionJob,
  type ConversionRequest,
  type MediaInfo,
} from "./shared/media";

type ConversionController = {
  aborted: boolean;
  currentProcess: ChildProcessWithoutNullStreams | null;
};

let mainWindow: BrowserWindow | null = null;
let currentConversion: ConversionController | null = null;

function sendConversionEvent(event: ConversionEvent) {
  mainWindow?.webContents.send("media:conversion-event", event);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 760,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(app.getAppPath(), "dist", "preload.js"),
    },
  });

  // Windows
  if (process.platform === "win32") {
    mainWindow.setIcon(join(app.getAppPath(), "dist", "/icons/windows/icon.ico"));
  }

  // Linux
  if (process.platform === "linux") {
    mainWindow.setIcon(join(app.getAppPath(), "dist", "/icons/linux/icons/512x512.png"));
  }

  void mainWindow.loadFile(join(app.getAppPath(), "dist", "renderer", "index.html"));
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

async function probeMedia(filePath: string): Promise<MediaInfo> {
  const raw = await collectCommandOutput("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format:stream",
    "-of",
    "json",
    filePath,
  ]);

  return parseProbeOutput(filePath, raw);
}

function parseProgressTime(line: string) {
  const [key, value] = line.split("=", 2);

  if (value === undefined) {
    return null;
  }

  if (key === "out_time_us" || key === "out_time_ms") {
    const numericValue = Number(value);

    if (Number.isFinite(numericValue) && numericValue >= 0) {
      return numericValue / 1_000_000;
    }
  }

  if (key !== "out_time") {
    return null;
  }

  const match = value.match(/(?<hours>\d+):(?<minutes>\d+):(?<seconds>\d+(?:\.\d+)?)/u);

  if (match?.groups === undefined) {
    return null;
  }

  const hours = Number(match.groups.hours);
  const minutes = Number(match.groups.minutes);
  const seconds = Number(match.groups.seconds);

  if (![hours, minutes, seconds].every((part) => Number.isFinite(part))) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

function runFfmpegJob(
  inputPath: string,
  job: ConversionJob,
  durationSeconds: number,
  controller: ConversionController,
  onProgress: (percent: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const ffmpegProcess = spawn(
      "ffmpeg",
      ["-y", "-i", inputPath, ...job.args, "-progress", "pipe:1", "-nostats", job.outputPath],
      {
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    controller.currentProcess = ffmpegProcess;
    let stderr = "";
    let buffer = "";

    ffmpegProcess.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const progressTime = parseProgressTime(line);

        if (progressTime !== null) {
          const percent = Math.max(0, Math.min(100, (progressTime / durationSeconds) * 100));
          onProgress(percent);
          continue;
        }

        if (line === "progress=end") {
          onProgress(100);
        }
      }
    });

    ffmpegProcess.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    ffmpegProcess.on("error", (error) => {
      controller.currentProcess = null;
      reject(error);
    });

    ffmpegProcess.on("close", (code) => {
      controller.currentProcess = null;

      if (controller.aborted) {
        reject(new Error("Conversion aborted."));
        return;
      }

      if (code === 0) {
        onProgress(100);
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function runConversion(request: ConversionRequest, controller: ConversionController) {
  const jobs = buildConversionJobs(request);
  const safeDuration = Math.max(request.mediaInfo.durationSeconds, 1);

  sendConversionEvent({ type: "started", percent: 0 });

  try {
    for (const [index, job] of jobs.entries()) {
      if (controller.aborted) {
        throw new Error("Conversion aborted.");
      }

      sendConversionEvent({
        type: "job-started",
        outputPath: job.outputPath,
        jobIndex: index,
        totalJobs: jobs.length,
      });

      await runFfmpegJob(request.inputPath, job, safeDuration, controller, (jobPercent) => {
        const percent = ((index + jobPercent / 100) / jobs.length) * 100;

        sendConversionEvent({
          type: "progress",
          percent,
          currentJobPercent: jobPercent,
          outputPath: job.outputPath,
          jobIndex: index,
          totalJobs: jobs.length,
        });
      });
    }

    sendConversionEvent({
      type: "completed",
      percent: 100,
      outputPaths: jobs.map((job) => job.outputPath),
    });
  } catch (error) {
    if (controller.aborted) {
      sendConversionEvent({ type: "aborted", percent: 0 });
      return;
    }

    sendConversionEvent({
      type: "error",
      percent: 0,
      message: error instanceof Error ? error.message : "Unknown conversion error.",
    });
  }
}

ipcMain.handle("media:select-file", async () => {
  if (mainWindow === null) {
    return null;
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      {
        name: "Media files",
        extensions: [
          "aac",
          "avi",
          "m4a",
          "mkv",
          "mov",
          "mp3",
          "mp4",
          "mts",
          "m2ts",
          "oga",
          "ogg",
          "wav",
          "weba",
          "webm",
        ],
      },
    ],
  });

  if (result.canceled || result.filePaths[0] === undefined) {
    return null;
  }

  return probeMedia(result.filePaths[0]);
});

ipcMain.handle("media:start-conversion", async (_event, request: ConversionRequest) => {
  if (currentConversion !== null) {
    throw new Error("A conversion is already in progress.");
  }

  currentConversion = {
    aborted: false,
    currentProcess: null,
  };

  void runConversion(request, currentConversion).finally(() => {
    currentConversion = null;
  });

  return { started: true };
});

ipcMain.handle("media:cancel-conversion", async () => {
  if (currentConversion === null) {
    return { canceled: false };
  }

  currentConversion.aborted = true;
  currentConversion.currentProcess?.kill("SIGTERM");

  return { canceled: true };
});

void app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

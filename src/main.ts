import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { ConversionController, ConversionJob } from "./ffmpeg";
import {
  buildConversionJobs,
  compareToolVersions,
  extractVersionFromBanner,
  MINIMUM_REQUIRED_TOOL_VERSION,
  parseProbeOutput,
} from "./ffmpeg";
import type {
  ConversionEvent,
  ConversionRequest,
  HostOs,
  MediaInfo,
  ToolBinaryName,
  ToolBinaryStatus,
  ToolingStatus,
} from "./shared";

let mainWindow: BrowserWindow | null = null;
let currentConversion: ConversionController | null = null;

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

async function getToolingStatus(): Promise<ToolingStatus> {
  const [ffmpeg, ffprobe] = await Promise.all([detectToolStatus("ffmpeg"), detectToolStatus("ffprobe")]);

  return {
    allMeetMinimum: ffmpeg.meetsMinimum && ffprobe.meetsMinimum,
    ffmpeg,
    ffprobe,
    minimumRequiredVersion: MINIMUM_REQUIRED_TOOL_VERSION,
    os: resolveHostOs(),
  };
}

function assertToolingReady(toolingStatus: ToolingStatus) {
  if (toolingStatus.allMeetMinimum) {
    return;
  }

  const issues = [toolingStatus.ffmpeg, toolingStatus.ffprobe]
    .filter((tool) => !tool.meetsMinimum)
    .map((tool) => `${tool.name}: ${tool.error ?? "not available"}`)
    .join("; ");

  throw new Error(
    `FFmpeg and FFprobe ${MINIMUM_REQUIRED_TOOL_VERSION}+ are required before converting files. ${issues}`
  );
}

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

function runFfmpegJob(job: ConversionJob, controller: ConversionController, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    job.ffmpegCommand
      .on("start", (commandLine) => {
        console.log(`Spawn with the command ${commandLine}`);
      })
      .on("progress", function (progress) {
        onProgress(progress.percent ?? 0);
      })
      .on("error", function (err) {
        controller.currentProcess = null;
        reject(err);
      })
      .on("end", function (_stdout, stderr) {
        controller.currentProcess = null;
        if (controller.aborted) {
          reject(new Error("Conversion aborted."));
          return;
        }

        if (stderr === null || stderr.trim() === "") {
          onProgress(100);
          resolve();
          return;
        }

        reject(new Error(stderr.trim() || `ffmpeg exited with an error.`));
      })
      .run();

    controller.currentProcess = job.ffmpegCommand;
  });
}

async function runConversion(request: ConversionRequest, controller: ConversionController) {
  const jobs = buildConversionJobs(request);

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

      await runFfmpegJob(job, controller, (jobPercent) => {
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

  const toolingStatus = await getToolingStatus();
  assertToolingReady(toolingStatus);

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

ipcMain.handle("media:get-tooling-status", async () => {
  return getToolingStatus();
});

ipcMain.handle("media:start-conversion", async (_event, request: ConversionRequest) => {
  if (currentConversion !== null) {
    throw new Error("A conversion is already in progress.");
  }

  const toolingStatus = await getToolingStatus();
  assertToolingReady(toolingStatus);

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

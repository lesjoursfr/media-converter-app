import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { extname, isAbsolute, join } from "node:path";
import type { ConversionController, ConversionJob } from "./ffmpeg";
import { createConversionJobs, getToolingStatus, MINIMUM_REQUIRED_TOOL_VERSION, readFileMetadata } from "./ffmpeg";
import type { ConversionEvent, ConversionRequest, ToolingStatus } from "./shared";

let mainWindow: BrowserWindow | null = null;
let currentConversion: ConversionController | null = null;

const MIN_AUDIO_BITRATE_KBPS = 32;
const MAX_AUDIO_BITRATE_KBPS = 512;
const MIN_VIDEO_BITRATE_KBPS = 1_024;
const MAX_VIDEO_BITRATE_KBPS = 20_480;

function isSupportedMediaPath(inputPath: string) {
  const extension = extname(inputPath).toLowerCase();

  return [
    ".aac",
    ".avi",
    ".m4a",
    ".mkv",
    ".mov",
    ".mp3",
    ".mp4",
    ".mts",
    ".m2ts",
    ".oga",
    ".ogg",
    ".wav",
    ".weba",
    ".webm",
  ].includes(extension);
}

function assertConversionRequest(request: unknown): asserts request is ConversionRequest {
  if (typeof request !== "object" || request === null) {
    throw new Error("Charge utile de conversion invalide.");
  }

  const candidate = request as Partial<ConversionRequest>;

  if (candidate.kind !== "audio" && candidate.kind !== "video") {
    throw new Error("Type de média invalide.");
  }

  if (typeof candidate.inputPath !== "string" || candidate.inputPath.length === 0 || !isAbsolute(candidate.inputPath)) {
    throw new Error("Chemin du fichier source invalide.");
  }

  if (!isSupportedMediaPath(candidate.inputPath)) {
    throw new Error("Extension du fichier source non prise en charge.");
  }

  if (
    typeof candidate.audioBitrateKbps !== "number" ||
    !Number.isFinite(candidate.audioBitrateKbps) ||
    candidate.audioBitrateKbps < MIN_AUDIO_BITRATE_KBPS ||
    candidate.audioBitrateKbps > MAX_AUDIO_BITRATE_KBPS
  ) {
    throw new Error(
      `Le débit audio doit être compris entre ${MIN_AUDIO_BITRATE_KBPS} et ${MAX_AUDIO_BITRATE_KBPS} kb/s.`
    );
  }

  if (
    candidate.kind === "video" &&
    (typeof candidate.videoBitrateKbps !== "number" ||
      !Number.isFinite(candidate.videoBitrateKbps) ||
      candidate.videoBitrateKbps < MIN_VIDEO_BITRATE_KBPS ||
      candidate.videoBitrateKbps > MAX_VIDEO_BITRATE_KBPS)
  ) {
    throw new Error(
      `Le débit vidéo doit être compris entre ${MIN_VIDEO_BITRATE_KBPS} et ${MAX_VIDEO_BITRATE_KBPS} kb/s pour les entrées vidéo.`
    );
  }
}

function assertToolingReady(toolingStatus: ToolingStatus) {
  if (toolingStatus.allMeetMinimum) {
    return;
  }

  const issues = [toolingStatus.ffmpeg, toolingStatus.ffprobe]
    .filter((tool) => !tool.meetsMinimum)
    .map((tool) => `${tool.name} : ${tool.error ?? "non disponible"}`)
    .join("; ");

  throw new Error(
    `FFmpeg et FFprobe ${MINIMUM_REQUIRED_TOOL_VERSION}+ sont requis avant de convertir des fichiers. ${issues}`
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

        if (controller.aborted) {
          reject(new Error("Conversion annulée."));
          return;
        }

        reject(err);
      })
      .on("end", function () {
        controller.currentProcess = null;
        onProgress(100);
        resolve();
        return;
      })
      .run();

    controller.currentProcess = job.ffmpegCommand;
  });
}

async function runConversion(request: ConversionRequest, controller: ConversionController) {
  const jobs = createConversionJobs(request);

  sendConversionEvent({ type: "started", percent: 0 });

  try {
    for (const [index, job] of jobs.entries()) {
      if (controller.aborted) {
        throw new Error("Conversion annulée.");
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
      message: error instanceof Error ? error.message : "Erreur de conversion inconnue.",
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
        name: "Fichiers multimédia",
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

  return readFileMetadata(result.filePaths[0]);
});

ipcMain.handle("media:get-tooling-status", async () => {
  return getToolingStatus();
});

ipcMain.handle("media:start-conversion", async (_event, request: unknown) => {
  if (currentConversion !== null) {
    throw new Error("Une conversion est déjà en cours.");
  }

  assertConversionRequest(request);

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

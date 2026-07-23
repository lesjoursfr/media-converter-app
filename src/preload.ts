import { contextBridge, ipcRenderer } from "electron";
import type { ConversionEvent, ConversionRequest, HostOs, MediaInfo, ToolingStatus } from "./shared/media";

type HtmlElements = {
  abortButton: HTMLButtonElement;
  audioBitrateInput: HTMLInputElement;
  closeToolingHelpButton: HTMLButtonElement;
  conversionOutputs: HTMLUListElement;
  detailsList: HTMLUListElement;
  filePath: HTMLParagraphElement;
  progressBar: HTMLProgressElement;
  refreshToolingButton: HTMLButtonElement;
  selectButton: HTMLButtonElement;
  startButton: HTMLButtonElement;
  status: HTMLParagraphElement;
  toolingError: HTMLParagraphElement;
  toolingHelpContent: HTMLElement;
  toolingHelpDialog: HTMLDialogElement;
  toolingHelpLink: HTMLButtonElement;
  toolingHelpTitle: HTMLElement;
  toolingStatusList: HTMLUListElement;
  videoBitrateInput: HTMLInputElement;
};

const api = {
  cancelConversion: () => ipcRenderer.invoke("media:cancel-conversion"),
  getToolingStatus: (): Promise<ToolingStatus> => ipcRenderer.invoke("media:get-tooling-status"),
  onConversionEvent: (listener: (event: ConversionEvent) => void) => {
    ipcRenderer.on("media:conversion-event", (_event, payload: ConversionEvent) => {
      listener(payload);
    });
  },
  selectFile: (): Promise<MediaInfo | null> => ipcRenderer.invoke("media:select-file"),
  startConversion: (request: ConversionRequest) => ipcRenderer.invoke("media:start-conversion", request),
};

contextBridge.exposeInMainWorld("mediaConverter", api);

function setOutputs(list: HTMLUListElement, outputs: Array<string>) {
  list.replaceChildren();

  for (const output of outputs) {
    const item = document.createElement("li");
    item.textContent = output;
    list.append(item);
  }
}

function getElements(): HtmlElements {
  return {
    abortButton: document.querySelector("#abort-conversion-button") as HTMLButtonElement,
    audioBitrateInput: document.querySelector("#audio-bitrate") as HTMLInputElement,
    closeToolingHelpButton: document.querySelector("#close-tooling-help-button") as HTMLButtonElement,
    conversionOutputs: document.querySelector("#conversion-outputs") as HTMLUListElement,
    detailsList: document.querySelector("#media-details") as HTMLUListElement,
    filePath: document.querySelector("#selected-file-path") as HTMLParagraphElement,
    progressBar: document.querySelector("#conversion-progress") as HTMLProgressElement,
    refreshToolingButton: document.querySelector("#refresh-tooling-button") as HTMLButtonElement,
    selectButton: document.querySelector("#select-file-button") as HTMLButtonElement,
    startButton: document.querySelector("#start-conversion-button") as HTMLButtonElement,
    status: document.querySelector("#conversion-status") as HTMLParagraphElement,
    toolingError: document.querySelector("#tooling-error") as HTMLParagraphElement,
    toolingHelpContent: document.querySelector("#tooling-help-content") as HTMLElement,
    toolingHelpDialog: document.querySelector("#tooling-help-dialog") as HTMLDialogElement,
    toolingHelpLink: document.querySelector("#tooling-help-link") as HTMLButtonElement,
    toolingHelpTitle: document.querySelector("#tooling-help-title") as HTMLElement,
    toolingStatusList: document.querySelector("#tooling-status-list") as HTMLUListElement,
    videoBitrateInput: document.querySelector("#video-bitrate") as HTMLInputElement,
  };
}

function renderMediaInfo(elements: HtmlElements, mediaInfo: MediaInfo, toolingReady: boolean) {
  const entries = [
    `Container: ${mediaInfo.format}`,
    `Duration: ${mediaInfo.durationSeconds.toFixed(1)} seconds`,
    mediaInfo.audio === null
      ? "Audio: no audio track"
      : `Audio: ${mediaInfo.audio.codec} @ ${mediaInfo.audio.bitrateKbps ?? "unknown"} kbps${mediaInfo.audio.sampleRateHz === null ? "" : `, ${mediaInfo.audio.sampleRateHz} Hz`}${
          mediaInfo.audio.channels === null ? "" : `, ${mediaInfo.audio.channels} channel(s)`
        }`,
    mediaInfo.video === null
      ? "Video: no video track"
      : `Video: ${mediaInfo.video.codec} @ ${mediaInfo.video.bitrateKbps ?? "unknown"} kbps, ${mediaInfo.video.width}x${mediaInfo.video.height}${
          mediaInfo.video.frameRate === null ? "" : `, ${mediaInfo.video.frameRate}`
        }`,
  ];

  elements.detailsList.replaceChildren();

  for (const entry of entries) {
    const item = document.createElement("li");
    item.textContent = entry;
    elements.detailsList.append(item);
  }

  elements.filePath.textContent = mediaInfo.path;
  elements.audioBitrateInput.disabled = false;
  elements.audioBitrateInput.value = String(mediaInfo.suggestedAudioBitrateKbps);
  elements.videoBitrateInput.disabled = mediaInfo.kind !== "video";
  elements.videoBitrateInput.value = String(mediaInfo.kind === "video" ? mediaInfo.suggestedVideoBitrateKbps : 0);
  elements.startButton.disabled = !toolingReady;
  elements.status.textContent = "Ready to convert.";
  elements.progressBar.value = 0;
  setOutputs(elements.conversionOutputs, []);
}

function getToolingHelp(os: HostOs, minimumVersion: string) {
  if (os === "macos") {
    return {
      content: [
        "Install Homebrew if needed:",
        '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
        "",
        "Install FFmpeg (includes ffprobe):",
        "brew install ffmpeg",
        "",
        "Verify versions:",
        "ffmpeg -version",
        "ffprobe -version",
      ].join("\n"),
      title: `Install FFmpeg and FFprobe on macOS (minimum ${minimumVersion})`,
    };
  }

  if (os === "linux") {
    return {
      content: [
        "Install with your package manager:",
        "Debian/Ubuntu: sudo apt update && sudo apt install ffmpeg",
        "Fedora/RHEL: sudo dnf install ffmpeg",
        "Arch Linux: sudo pacman -S ffmpeg",
        "",
        "Verify versions:",
        "ffmpeg -version",
        "ffprobe -version",
      ].join("\n"),
      title: `Install FFmpeg and FFprobe on Linux (minimum ${minimumVersion})`,
    };
  }

  return {
    content: [
      "Install FFmpeg using your system package manager or official build:",
      "https://ffmpeg.org/download.html",
      "",
      "Verify versions:",
      "ffmpeg -version",
      "ffprobe -version",
    ].join("\n"),
    title: `Install FFmpeg and FFprobe (minimum ${minimumVersion})`,
  };
}

function renderToolingStatus(elements: HtmlElements, toolingStatus: ToolingStatus) {
  elements.toolingStatusList.replaceChildren();

  for (const tool of [toolingStatus.ffmpeg, toolingStatus.ffprobe]) {
    const item = document.createElement("li");

    if (!tool.available) {
      item.textContent = `${tool.name}: missing`;
    } else if (!tool.meetsMinimum) {
      item.textContent = `${tool.name}: ${tool.version ?? "unknown"} (requires ${toolingStatus.minimumRequiredVersion}+ )`;
    } else {
      item.textContent = `${tool.name}: ${tool.version} (ok)`;
    }

    elements.toolingStatusList.append(item);
  }

  if (toolingStatus.allMeetMinimum) {
    elements.toolingError.hidden = true;
    elements.toolingHelpLink.hidden = true;
    return;
  }

  elements.toolingError.hidden = false;
  elements.toolingHelpLink.hidden = false;
  elements.toolingError.textContent = `FFmpeg and FFprobe ${toolingStatus.minimumRequiredVersion}+ are required. `;

  const help = getToolingHelp(toolingStatus.os, toolingStatus.minimumRequiredVersion);
  elements.toolingHelpTitle.textContent = help.title;
  elements.toolingHelpContent.textContent = help.content;
}

function readBitrate(input: HTMLInputElement, fallback: number) {
  const numericValue = Number.parseInt(input.value, 10);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }

  return numericValue;
}

window.addEventListener("DOMContentLoaded", () => {
  const elements = getElements();
  let selectedMediaInfo: MediaInfo | null = null;
  let toolingStatus: ToolingStatus | null = null;

  const isToolingReady = () => toolingStatus?.allMeetMinimum ?? false;

  const refreshToolingStatus = async () => {
    elements.refreshToolingButton.disabled = true;
    elements.status.textContent = "Checking FFmpeg and FFprobe versions…";

    try {
      toolingStatus = await api.getToolingStatus();
      renderToolingStatus(elements, toolingStatus);

      if (!isToolingReady()) {
        elements.startButton.disabled = true;
        elements.selectButton.disabled = true;
        elements.status.textContent = `Install FFmpeg and FFprobe ${toolingStatus.minimumRequiredVersion}+ to continue.`;
        return;
      }

      elements.selectButton.disabled = false;
      elements.startButton.disabled = selectedMediaInfo === null;
      elements.status.textContent =
        selectedMediaInfo === null ? "FFmpeg and FFprobe are ready. Select a file." : "FFmpeg and FFprobe are ready.";
    } finally {
      elements.refreshToolingButton.disabled = false;
    }
  };

  void refreshToolingStatus().catch((error) => {
    elements.selectButton.disabled = true;
    elements.startButton.disabled = true;
    elements.toolingError.hidden = false;
    elements.toolingHelpLink.hidden = true;
    elements.toolingStatusList.replaceChildren();

    const item = document.createElement("li");
    item.textContent = "Unable to detect FFmpeg and FFprobe.";
    elements.toolingStatusList.append(item);
    elements.status.textContent = error instanceof Error ? error.message : "Unable to detect FFmpeg and FFprobe.";
  });

  elements.toolingHelpLink.addEventListener("click", () => {
    elements.toolingHelpDialog.showModal();
  });

  elements.closeToolingHelpButton.addEventListener("click", () => {
    elements.toolingHelpDialog.close();
  });

  elements.refreshToolingButton.addEventListener("click", () => {
    void refreshToolingStatus().catch((error) => {
      elements.status.textContent = error instanceof Error ? error.message : "Unable to detect FFmpeg and FFprobe.";
    });
  });

  elements.selectButton.addEventListener("click", async () => {
    if (!isToolingReady()) {
      elements.status.textContent = "Install FFmpeg and FFprobe before selecting a file.";
      return;
    }

    elements.status.textContent = "Inspecting file…";

    try {
      const mediaInfo = await api.selectFile();

      if (mediaInfo === null) {
        elements.status.textContent = selectedMediaInfo === null ? "Waiting for a file." : "File selection canceled.";
        return;
      }

      selectedMediaInfo = mediaInfo;
      renderMediaInfo(elements, mediaInfo, isToolingReady());
    } catch (error) {
      elements.status.textContent = error instanceof Error ? error.message : "Unable to inspect the selected file.";
    }
  });

  elements.startButton.addEventListener("click", async () => {
    if (!isToolingReady()) {
      elements.status.textContent = "Install FFmpeg and FFprobe before starting a conversion.";
      return;
    }

    if (selectedMediaInfo === null) {
      return;
    }

    const request: ConversionRequest = {
      audioBitrateKbps: readBitrate(elements.audioBitrateInput, selectedMediaInfo.suggestedAudioBitrateKbps),
      inputPath: selectedMediaInfo.path,
      mediaInfo: selectedMediaInfo,
      videoBitrateKbps:
        selectedMediaInfo.kind === "video"
          ? readBitrate(elements.videoBitrateInput, selectedMediaInfo.suggestedVideoBitrateKbps)
          : selectedMediaInfo.suggestedVideoBitrateKbps,
    };

    elements.startButton.disabled = true;
    elements.abortButton.disabled = false;
    elements.progressBar.value = 0;
    setOutputs(elements.conversionOutputs, []);
    elements.status.textContent = "Starting conversion…";

    try {
      await api.startConversion(request);
    } catch (error) {
      elements.startButton.disabled = false;
      elements.abortButton.disabled = true;
      elements.status.textContent = error instanceof Error ? error.message : "Unable to start the conversion.";
    }
  });

  elements.abortButton.addEventListener("click", async () => {
    await api.cancelConversion();
  });

  api.onConversionEvent((event) => {
    switch (event.type) {
      case "started":
        elements.progressBar.value = 0;
        elements.status.textContent = "Conversion started.";
        return;
      case "job-started":
        elements.status.textContent = `Encoding output ${event.jobIndex + 1} of ${event.totalJobs}: ${event.outputPath}`;
        return;
      case "progress":
        elements.progressBar.value = event.percent;
        elements.status.textContent = `Converting… ${event.percent.toFixed(1)}% complete`;
        return;
      case "completed":
        elements.progressBar.value = 100;
        elements.startButton.disabled = false;
        elements.abortButton.disabled = true;
        elements.status.textContent = "Conversion completed.";
        setOutputs(elements.conversionOutputs, event.outputPaths);
        return;
      case "aborted":
        elements.progressBar.value = 0;
        elements.startButton.disabled = false;
        elements.abortButton.disabled = true;
        elements.status.textContent = "Conversion aborted.";
        return;
      case "error":
        elements.progressBar.value = 0;
        elements.startButton.disabled = false;
        elements.abortButton.disabled = true;
        elements.status.textContent = event.message;
        return;
      default:
        return;
    }
  });
});

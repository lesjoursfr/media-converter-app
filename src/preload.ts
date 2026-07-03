import { contextBridge, ipcRenderer } from "electron";
import type { ConversionEvent, ConversionRequest, MediaInfo } from "./shared/media";

type HtmlElements = {
  abortButton: HTMLButtonElement;
  audioBitrateInput: HTMLInputElement;
  conversionOutputs: HTMLUListElement;
  detailsList: HTMLUListElement;
  filePath: HTMLParagraphElement;
  progressBar: HTMLProgressElement;
  selectButton: HTMLButtonElement;
  startButton: HTMLButtonElement;
  status: HTMLParagraphElement;
  videoBitrateInput: HTMLInputElement;
};

const api = {
  cancelConversion: () => ipcRenderer.invoke("media:cancel-conversion"),
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
    conversionOutputs: document.querySelector("#conversion-outputs") as HTMLUListElement,
    detailsList: document.querySelector("#media-details") as HTMLUListElement,
    filePath: document.querySelector("#selected-file-path") as HTMLParagraphElement,
    progressBar: document.querySelector("#conversion-progress") as HTMLProgressElement,
    selectButton: document.querySelector("#select-file-button") as HTMLButtonElement,
    startButton: document.querySelector("#start-conversion-button") as HTMLButtonElement,
    status: document.querySelector("#conversion-status") as HTMLParagraphElement,
    videoBitrateInput: document.querySelector("#video-bitrate") as HTMLInputElement,
  };
}

function renderMediaInfo(elements: HtmlElements, mediaInfo: MediaInfo) {
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
  elements.startButton.disabled = false;
  elements.status.textContent = "Ready to convert.";
  elements.progressBar.value = 0;
  setOutputs(elements.conversionOutputs, []);
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

  elements.selectButton.addEventListener("click", async () => {
    elements.status.textContent = "Inspecting file…";

    try {
      const mediaInfo = await api.selectFile();

      if (mediaInfo === null) {
        elements.status.textContent = selectedMediaInfo === null ? "Waiting for a file." : "File selection canceled.";
        return;
      }

      selectedMediaInfo = mediaInfo;
      renderMediaInfo(elements, mediaInfo);
    } catch (error) {
      elements.status.textContent = error instanceof Error ? error.message : "Unable to inspect the selected file.";
    }
  });

  elements.startButton.addEventListener("click", async () => {
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

import { contextBridge, ipcRenderer } from "electron";
import type { ConversionEvent, ConversionRequest, HostOs, MediaInfo, ToolingStatus } from "./shared";

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
    `Conteneur : ${mediaInfo.format}`,
    `Durée : ${mediaInfo.durationSeconds.toFixed(1)} secondes`,
    mediaInfo.audio === null
      ? "Audio : aucune piste audio"
      : `Audio : ${mediaInfo.audio.codec} @ ${mediaInfo.audio.bitrateKbps ?? "inconnu"} kb/s${mediaInfo.audio.sampleRateHz === null ? "" : `, ${mediaInfo.audio.sampleRateHz} Hz`}${
          mediaInfo.audio.channels === null ? "" : `, ${mediaInfo.audio.channels} canal(aux)`
        }`,
    mediaInfo.video === null
      ? "Vidéo : aucune piste vidéo"
      : `Vidéo : ${mediaInfo.video.codec} @ ${mediaInfo.video.bitrateKbps ?? "inconnu"} kb/s, ${mediaInfo.video.width}x${mediaInfo.video.height}${
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
  elements.status.textContent = "Prêt à convertir.";
  elements.progressBar.value = 0;
  setOutputs(elements.conversionOutputs, []);
}

function getToolingHelp(os: HostOs, minimumVersion: string) {
  if (os === "macos") {
    return {
      content: [
        "Installez Homebrew si nécessaire :",
        '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
        "",
        "Installez FFmpeg (inclut ffprobe) :",
        "brew install ffmpeg",
        "",
        "Vérifiez les versions :",
        "ffmpeg -version",
        "ffprobe -version",
      ].join("\n"),
      title: `Installer FFmpeg et FFprobe sur macOS (minimum ${minimumVersion})`,
    };
  }

  if (os === "linux") {
    return {
      content: [
        "Installez FFmpeg avec votre gestionnaire de paquets :",
        "Debian/Ubuntu: sudo apt update && sudo apt install ffmpeg",
        "Fedora/RHEL: sudo dnf install ffmpeg",
        "Arch Linux: sudo pacman -S ffmpeg",
        "",
        "Vérifiez les versions :",
        "ffmpeg -version",
        "ffprobe -version",
      ].join("\n"),
      title: `Installer FFmpeg et FFprobe sur Linux (minimum ${minimumVersion})`,
    };
  }

  return {
    content: [
      "Installez FFmpeg via le gestionnaire de paquets de votre système ou une version officielle :",
      "https://ffmpeg.org/download.html",
      "",
      "Vérifiez les versions :",
      "ffmpeg -version",
      "ffprobe -version",
    ].join("\n"),
    title: `Installer FFmpeg et FFprobe (minimum ${minimumVersion})`,
  };
}

function renderToolingStatus(elements: HtmlElements, toolingStatus: ToolingStatus) {
  elements.toolingStatusList.replaceChildren();

  for (const tool of [toolingStatus.ffmpeg, toolingStatus.ffprobe]) {
    const item = document.createElement("li");

    if (!tool.available) {
      item.textContent = `${tool.name} : manquant`;
    } else if (!tool.meetsMinimum) {
      item.textContent = `${tool.name} : ${tool.version ?? "inconnue"} (requiert ${toolingStatus.minimumRequiredVersion}+ )`;
    } else {
      item.textContent = `${tool.name} : ${tool.version} (ok)`;
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
  elements.toolingError.textContent = `FFmpeg et FFprobe ${toolingStatus.minimumRequiredVersion}+ sont requis. `;

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
    elements.status.textContent = "Vérification des versions de FFmpeg et FFprobe…";

    try {
      toolingStatus = await api.getToolingStatus();
      renderToolingStatus(elements, toolingStatus);

      if (!isToolingReady()) {
        elements.startButton.disabled = true;
        elements.selectButton.disabled = true;
        elements.status.textContent = `Installez FFmpeg et FFprobe ${toolingStatus.minimumRequiredVersion}+ pour continuer.`;
        return;
      }

      elements.selectButton.disabled = false;
      elements.startButton.disabled = selectedMediaInfo === null;
      elements.status.textContent =
        selectedMediaInfo === null
          ? "FFmpeg et FFprobe sont prêts. Sélectionnez un fichier."
          : "FFmpeg et FFprobe sont prêts.";
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
    item.textContent = "Impossible de détecter FFmpeg et FFprobe.";
    elements.toolingStatusList.append(item);
    elements.status.textContent = error instanceof Error ? error.message : "Impossible de détecter FFmpeg et FFprobe.";
  });

  elements.toolingHelpLink.addEventListener("click", () => {
    elements.toolingHelpDialog.showModal();
  });

  elements.closeToolingHelpButton.addEventListener("click", () => {
    elements.toolingHelpDialog.close();
  });

  elements.refreshToolingButton.addEventListener("click", () => {
    void refreshToolingStatus().catch((error) => {
      elements.status.textContent =
        error instanceof Error ? error.message : "Impossible de détecter FFmpeg et FFprobe.";
    });
  });

  elements.selectButton.addEventListener("click", async () => {
    if (!isToolingReady()) {
      elements.status.textContent = "Installez FFmpeg et FFprobe avant de sélectionner un fichier.";
      return;
    }

    elements.status.textContent = "Inspection du fichier…";

    try {
      const mediaInfo = await api.selectFile();

      if (mediaInfo === null) {
        elements.status.textContent =
          selectedMediaInfo === null ? "En attente d’un fichier." : "Sélection de fichier annulée.";
        return;
      }

      selectedMediaInfo = mediaInfo;
      renderMediaInfo(elements, mediaInfo, isToolingReady());
    } catch (error) {
      elements.status.textContent =
        error instanceof Error ? error.message : "Impossible d’inspecter le fichier sélectionné.";
    }
  });

  elements.startButton.addEventListener("click", async () => {
    if (!isToolingReady()) {
      elements.status.textContent = "Installez FFmpeg et FFprobe avant de lancer une conversion.";
      return;
    }

    if (selectedMediaInfo === null) {
      return;
    }

    const request: ConversionRequest = {
      audioBitrateKbps: readBitrate(elements.audioBitrateInput, selectedMediaInfo.suggestedAudioBitrateKbps),
      inputPath: selectedMediaInfo.path,
      kind: selectedMediaInfo.kind,
      videoBitrateKbps:
        selectedMediaInfo.kind === "video"
          ? readBitrate(elements.videoBitrateInput, selectedMediaInfo.suggestedVideoBitrateKbps)
          : selectedMediaInfo.suggestedVideoBitrateKbps,
    };

    elements.startButton.disabled = true;
    elements.abortButton.disabled = false;
    elements.progressBar.value = 0;
    setOutputs(elements.conversionOutputs, []);
    elements.status.textContent = "Démarrage de la conversion…";

    try {
      await api.startConversion(request);
    } catch (error) {
      elements.startButton.disabled = false;
      elements.abortButton.disabled = true;
      elements.status.textContent = error instanceof Error ? error.message : "Impossible de lancer la conversion.";
    }
  });

  elements.abortButton.addEventListener("click", async () => {
    await api.cancelConversion();
  });

  api.onConversionEvent((event) => {
    switch (event.type) {
      case "started":
        elements.progressBar.value = 0;
        elements.status.textContent = "Conversion démarrée.";
        return;
      case "job-started":
        elements.status.textContent = `Encodage de la sortie ${event.jobIndex + 1} sur ${event.totalJobs} : ${event.outputPath}`;
        return;
      case "progress":
        elements.progressBar.value = event.percent;
        elements.status.textContent = `Conversion… ${event.percent.toFixed(1)} % terminée`;
        return;
      case "completed":
        elements.progressBar.value = 100;
        elements.startButton.disabled = false;
        elements.abortButton.disabled = true;
        elements.status.textContent = "Conversion terminée.";
        setOutputs(elements.conversionOutputs, event.outputPaths);
        return;
      case "aborted":
        elements.progressBar.value = 0;
        elements.startButton.disabled = false;
        elements.abortButton.disabled = true;
        elements.status.textContent = "Conversion annulée.";
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

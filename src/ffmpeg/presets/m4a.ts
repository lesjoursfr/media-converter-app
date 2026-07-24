import { FfmpegCommand } from "fluent-ffmpeg";

export function configure(ffmpeg: FfmpegCommand, audioBitrate: number): FfmpegCommand {
  ffmpeg.format("mp4").noVideo().audioBitrate(`${audioBitrate}k`).audioCodec("aac").audioChannels(2).outputOptions([
    // https://ffmpeg.org/ffmpeg-codecs.html#aac
    "-aac_coder twoloop", // Two loop searching (TLS) method
    "-profile:a aac_low", // The default, AAC "Low-complexity" profile
    "-movflags +faststart", // AAC Progresive download : https://trac.ffmpeg.org/wiki/Encode/AAC#Progressivedownload
  ]);

  return ffmpeg;
}

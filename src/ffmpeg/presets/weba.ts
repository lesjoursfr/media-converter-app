import { FfmpegCommand } from "fluent-ffmpeg";

export function configure(ffmpeg: FfmpegCommand, audioBitrate: number): FfmpegCommand {
  ffmpeg
    .format("webm")
    .noVideo()
    .audioBitrate(`${audioBitrate}k`)
    .audioCodec("libopus")
    .audioChannels(2)
    .outputOptions([
      // https://ffmpeg.org/ffmpeg-codecs.html#libopus-1
      "-vbr constrained", // Use constrained variable bit rate encoding
      "-compression_level 10", // 0 gives the fastest encodes but lower quality, while 10 gives the highest quality but slowest encoding.
    ]);

  return ffmpeg;
}

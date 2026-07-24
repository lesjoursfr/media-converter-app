import { FfmpegCommand } from "fluent-ffmpeg";

export function configure(
  ffmpeg: FfmpegCommand,
  audioBitrate: number,
  videoBitrate: number,
  size: string | undefined,
  framerate: number | undefined,
  deinterlace: boolean | undefined,
  noAudio: boolean | undefined
): FfmpegCommand {
  ffmpeg.format("mp4").videoBitrate(`${videoBitrate}k`).videoCodec("libx264");

  if (noAudio === true) {
    ffmpeg.noAudio();
  } else {
    ffmpeg.audioBitrate(`${audioBitrate}k`).audioCodec("aac").audioChannels(2);
  }

  if (deinterlace) {
    ffmpeg.videoFilter([
      {
        filter: "bwdif",
        options: { mode: "send_frame" },
      },
    ]);
  }

  if (size !== undefined) {
    ffmpeg.size(size).autopad();
  }

  if (framerate !== undefined) {
    ffmpeg.fps(framerate);
  }

  ffmpeg.outputOptions([
    // https://ffmpeg.org/ffmpeg-codecs.html#aac
    "-aac_coder twoloop", // Two loop searching (TLS) method
    "-profile:a aac_low", // The default, AAC "Low-complexity" profile
    // https://www.ffmpeg.org/ffmpeg-codecs.html#libx264_002c-libx264rgb
    // https://trac.ffmpeg.org/wiki/Encode/H.264
    "-preset veryslow", // A preset is a collection of options that will provide a certain encoding speed to compression ratio. A slower preset will provide better compression (compression is quality per filesize).
    `-minrate ${Math.floor(videoBitrate / 8)}k`, // (minsection-pct) Set GOP min bitrate in bits/s. Note vpxenc’s option is specified as a percentage of the target bitrate, the libvpx wrapper converts this value as follows: (minrate * 100 / bitrate)
    `-maxrate ${Math.floor(videoBitrate * 1.5)}k`, // (maxsection-pct) Set GOP max bitrate in bits/s. Note vpxenc’s option is specified as a percentage of the target bitrate, the libvpx wrapper converts this value as follows: (maxrate * 100 / bitrate)
    "-force_key_frames expr:eq(n,0)", // Force the encoder to use a keyframe for the first frame
    "-movflags +faststart", // You can add -movflags +faststart as an output option if your videos are going to be viewed in a browser.
  ]);

  return ffmpeg;
}

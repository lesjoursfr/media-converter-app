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
  ffmpeg.format("webm").videoBitrate(`${videoBitrate}k`).videoCodec("libvpx-vp9");

  if (noAudio === true) {
    ffmpeg.noAudio();
  } else {
    ffmpeg.audioBitrate(`${audioBitrate}k`).audioCodec("libopus").audioChannels(2);
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
    // https://ffmpeg.org/ffmpeg-codecs.html#libopus-1
    "-vbr constrained", // Use constrained variable bit rate encoding
    "-compression_level 10", // 0 gives the fastest encodes but lower quality, while 10 gives the highest quality but slowest encoding.
    // https://www.ffmpeg.org/ffmpeg-codecs.html#libvpx
    // https://www.webmproject.org/docs/encoder-parameters/
    "-deadline good", // Use good quality deadline
    `-minrate ${Math.floor(videoBitrate / 8)}k`, // (minsection-pct) Set GOP min bitrate in bits/s. Note vpxenc’s option is specified as a percentage of the target bitrate, the libvpx wrapper converts this value as follows: (minrate * 100 / bitrate)
    `-maxrate ${Math.floor(videoBitrate * 1.5)}k`, // (maxsection-pct) Set GOP max bitrate in bits/s. Note vpxenc’s option is specified as a percentage of the target bitrate, the libvpx wrapper converts this value as follows: (maxrate * 100 / bitrate)
    "-cpu-used 0", // Set quality/speed ratio modifier. Higher values speed up the encode at the cost of quality.
    "-keyint_min 0", // (kf-min-dist) minimum interval between key frames (not currently supported)
    "-g 360", // (kf-max-dist) maximum interval between key frames
    "-slices 4", // Note that FFmpeg’s slices option gives the total number of partitions, while vpxenc’s token-parts is given as log2(partitions) (0-3 : recommended 0 for small images, 2 or 3 for HD))
    "-static-thresh 0", // The static threshold imposes a change threshold on blocks below which they will be skipped by the encoder. In most scenarios this value should be set to 0.
    "-qmin 0", // (valid values 0-63, recommended value 0-4)
    "-qmax 60", // (valid values --min-q to 63, recommended value 50-63)
    "-force_key_frames expr:eq(n,0)", // Force the encoder to use a keyframe for the first frame
  ]);

  return ffmpeg;
}

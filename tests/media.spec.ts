import assert from "node:assert/strict";
import test from "node:test";
import { buildConversionJobs, parseProbeOutput } from "../src/shared/media";

test("parseProbeOutput detects audio-only files and default outputs", () => {
  const mediaInfo = parseProbeOutput(
    "/tmp/example.wav",
    JSON.stringify({
      format: {
        duration: "42.5",
        format_name: "wav",
      },
      streams: [
        {
          bit_rate: "128000",
          channels: 2,
          codec_name: "pcm_s16le",
          codec_type: "audio",
          sample_rate: "48000",
        },
      ],
    })
  );

  assert.equal(mediaInfo.kind, "audio");
  assert.equal(mediaInfo.audio?.bitrateKbps, 128);
  assert.equal(mediaInfo.suggestedAudioBitrateKbps, 128);
  assert.equal(mediaInfo.suggestedVideoBitrateKbps, 0);

  const jobs = buildConversionJobs({
    audioBitrateKbps: mediaInfo.suggestedAudioBitrateKbps,
    inputPath: mediaInfo.path,
    mediaInfo,
    videoBitrateKbps: mediaInfo.suggestedVideoBitrateKbps,
  });

  assert.deepEqual(
    jobs.map((job) => job.outputPath),
    ["/tmp/example.m4a", "/tmp/example.weba"]
  );
  assert.ok(jobs[0]?.args.includes("aac"));
  assert.ok(jobs[1]?.args.includes("libopus"));
});

test("parseProbeOutput detects video files and matching target bitrates", () => {
  const mediaInfo = parseProbeOutput(
    "/tmp/example.mov",
    JSON.stringify({
      format: {
        duration: "12.0",
        format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      },
      streams: [
        {
          bit_rate: "192000",
          channels: 2,
          codec_name: "aac",
          codec_type: "audio",
          sample_rate: "48000",
        },
        {
          avg_frame_rate: "30000/1001",
          bit_rate: "4000000",
          codec_name: "h264",
          codec_type: "video",
          height: 1080,
          width: 1920,
        },
      ],
    })
  );

  assert.equal(mediaInfo.kind, "video");
  assert.equal(mediaInfo.suggestedAudioBitrateKbps, 192);
  assert.equal(mediaInfo.suggestedVideoBitrateKbps, 4000);
  assert.equal(mediaInfo.video?.frameRate, "29.97 fps");

  const jobs = buildConversionJobs({
    audioBitrateKbps: mediaInfo.suggestedAudioBitrateKbps,
    inputPath: mediaInfo.path,
    mediaInfo,
    videoBitrateKbps: mediaInfo.suggestedVideoBitrateKbps,
  });

  assert.deepEqual(
    jobs.map((job) => job.outputPath),
    ["/tmp/example.mp4", "/tmp/example.webm"]
  );
  assert.ok(jobs[0]?.args.includes("libx264"));
  assert.ok(jobs[1]?.args.includes("libvpx-vp9"));
});

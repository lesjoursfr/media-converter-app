import assert from "node:assert/strict";
import test from "node:test";
import { compareToolVersions, createConversionJobs, extractVersionFromBanner } from "../src/ffmpeg";

test("createConversionJobs creates audio conversion jobs", () => {
  const jobs = createConversionJobs({
    audioBitrateKbps: 128,
    inputPath: "/tmp/example.wav",
    kind: "audio",
    videoBitrateKbps: 0,
  });

  assert.equal(jobs.length, 2);
  assert.match(jobs[0]?.outputPath ?? "", /^\/tmp\/example-\d+\.m4a$/u);
  assert.match(jobs[1]?.outputPath ?? "", /^\/tmp\/example-\d+\.weba$/u);
  assert.ok(jobs[0]?.ffmpegCommand._getArguments().includes("aac"));
  assert.ok(jobs[1]?.ffmpegCommand._getArguments().includes("libopus"));
});

test("createConversionJobs creates video conversion jobs", () => {
  const jobs = createConversionJobs({
    audioBitrateKbps: 128,
    inputPath: "/tmp/example.mov",
    kind: "video",
    videoBitrateKbps: 4000,
  });

  assert.equal(jobs.length, 2);
  assert.match(jobs[0]?.outputPath ?? "", /^\/tmp\/example-\d+\.mp4$/u);
  assert.match(jobs[1]?.outputPath ?? "", /^\/tmp\/example-\d+\.webm$/u);
  assert.ok(jobs[0]?.ffmpegCommand._getArguments().includes("libx264"));
  assert.ok(jobs[1]?.ffmpegCommand._getArguments().includes("libvpx-vp9"));
});

test("extractVersionFromBanner parses FFmpeg and FFprobe version banners", () => {
  const ffmpegVersion = extractVersionFromBanner(
    "ffmpeg",
    "ffmpeg version n6.1.1 Copyright (c) the FFmpeg developers\nconfiguration: --enable-gpl"
  );
  const ffprobeVersion = extractVersionFromBanner("ffprobe", "ffprobe version 7.0.2-0ubuntu1 built with gcc 13");

  assert.equal(ffmpegVersion, "6.1.1");
  assert.equal(ffprobeVersion, "7.0.2");
});

test("compareToolVersions compares versions including missing patch numbers", () => {
  assert.equal(compareToolVersions("6.1", "6.1.1"), -1);
  assert.equal(compareToolVersions("6.1.1", "6.1"), 1);
  assert.equal(compareToolVersions("6.1.1", "6.1.1"), 0);
  assert.equal(compareToolVersions("6.2.0", "6.1.9"), 1);
});

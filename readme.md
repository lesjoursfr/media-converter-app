[![QC Checks](https://github.com/lesjoursfr/media-converter-app/actions/workflows/quality-control.yml/badge.svg)](https://github.com/lesjoursfr/media-converter-app/actions/workflows/quality-control.yml)

# media-converter-app

Electron application to convert audio and video files with ffmpeg.

## Features

- Select an audio or video file from the desktop app
- Inspect the detected container, duration, and audio/video codecs
- Prefill audio and video bitrate inputs from the selected file
- Convert to the same outputs as `lesjoursfr/media-converter`
  - audio: `.m4a` and `.weba`
  - video: `.mp4` and `.webm`
- Follow conversion progress and abort an ongoing conversion

## Requirements

- `ffmpeg`
- `ffprobe`

## Development

```bash
npm install
npm start
```

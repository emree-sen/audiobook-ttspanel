# xtts-server

Thin local XTTS-v2 server exposing an OpenAI-compatible `POST /v1/audio/speech`
endpoint, so the panel's existing OpenAI-compatible TTS adapter can use it directly.

## Setup & Run

```bash
cd tools/xtts-server
./run.sh --lang tr
```

First run creates a virtualenv, installs dependencies and downloads the
XTTS-v2 weights from Hugging Face (~2 GB; CPML license auto-accepted via
`COQUI_TOS_AGREED=1`). Later runs start immediately.
Flags are passed through: `--port 8020`, `--device cpu|cuda|mps`
(`XTTS_DEVICE` env also works; default avoids MPS — it produces broken audio
with this coqui-tts range). `GET /health` reports status, voices and device.

**License note:** XTTS-v2 weights are under the Coqui CPML (non-commercial)
license; this repo is MIT and does not ship them.

## Voices

Drop reference recordings into `voices/` — one clean 6-30 s WAV per voice.
The file name is the voice name (e.g. `voices/kaan.wav` → voice `kaan`).
XTTS clones the voice in the reference recording.

## Connect the panel

Settings → Connections → add: address `http://localhost:8020/v1`, any model name,
then add voices matching your WAV file names.

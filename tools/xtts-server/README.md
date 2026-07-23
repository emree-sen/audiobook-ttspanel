# xtts-server

Thin local XTTS-v2 server exposing an OpenAI-compatible `POST /v1/audio/speech`
endpoint, so the panel's existing OpenAI-compatible TTS adapter can use it directly.

## Setup

```bash
cd tools/xtts-server
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Voices

Drop reference recordings into `voices/` — one clean 6-30 s WAV per voice.
The file name is the voice name (e.g. `voices/kaan.wav` → voice `kaan`).
XTTS clones the voice in the reference recording.

## Run

```bash
python server.py --lang tr --port 8020
```

First run downloads the XTTS-v2 weights from Hugging Face (~2 GB).
**License note:** XTTS-v2 weights are under the Coqui CPML (non-commercial) license.

## Connect the panel

Settings → Connections → add: address `http://localhost:8020/v1`, any model name,
then add voices matching your WAV file names.

"""Ince XTTS-v2 sunucusu: OpenAI-uyumlu /v1/audio/speech endpoint'i.

Kullanım:  python server.py --lang tr --port 8020
Sesler:    voices/<ad>.wav — her wav bir ses (XTTS referans/klon örneği, 6-30 sn temiz kayıt).
Panel:     Ayarlar → Bağlantı ekle → adres http://localhost:8020/v1, ses adı = dosya adı.
"""
import argparse
import os
import tempfile
import threading
from pathlib import Path

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

os.environ.setdefault("COQUI_TOS_AGREED", "1")  # CPML lisansı — etkileşimli soru sunucuyu asmasın
from TTS.api import TTS

VOICES_DIR = Path(__file__).parent / "voices"
DEFAULT_LANG = os.environ.get("XTTS_LANG", "tr")
DEVICE: str | None = os.environ.get("XTTS_DEVICE")  # öncelik: --device > XTTS_DEVICE > otomatik

app = FastAPI(title="xtts-server")
_tts: TTS | None = None
_lock = threading.Lock()


def get_tts() -> TTS:
    global _tts
    if _tts is None:
        # mps varsayılan değil: bu coqui-tts sürüm aralığında XTTS-v2 MPS'te bozuk ses üretiyor
        device = DEVICE or ("cuda" if torch.cuda.is_available() else "cpu")
        print(f"[xtts-server] model yükleniyor (device={device})…")
        _tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
    return _tts


class SpeechRequest(BaseModel):
    input: str
    voice: str
    model: str = "xtts-v2"          # uyumluluk için kabul edilir, kullanılmaz
    language: str | None = None     # OpenAI şemasına ek alan; yoksa DEFAULT_LANG
    response_format: str = "wav"    # yalnızca wav desteklenir


@app.post("/v1/audio/speech")
def speech(req: SpeechRequest) -> Response:
    ref = VOICES_DIR / f"{req.voice}.wav"
    if not ref.exists():
        raise HTTPException(404, f"ses bulunamadı: voices/{req.voice}.wav dosyasını ekleyin")
    if req.response_format != "wav":
        raise HTTPException(400, "yalnızca response_format=wav desteklenir")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        out_path = f.name
    try:
        with _lock:  # paylaşılan model — istekleri sıraya diz
            get_tts().tts_to_file(
                text=req.input, speaker_wav=str(ref),
                language=req.language or DEFAULT_LANG, file_path=out_path,
            )
        return Response(content=Path(out_path).read_bytes(), media_type="audio/wav")
    except Exception as e:
        print(f"[xtts-server] üretim hatası: {e}")
        raise HTTPException(500, f"üretim hatası: {e}")
    finally:
        os.unlink(out_path)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--lang", default=DEFAULT_LANG)
    p.add_argument("--port", type=int, default=8020)
    p.add_argument("--device", default=None, help="cpu|cuda|mps (öncelik: XTTS_DEVICE ortam değişkeninden yüksek)")
    args = p.parse_args()
    DEFAULT_LANG = args.lang
    DEVICE = args.device or DEVICE
    get_tts()  # modeli açılışta yükle (ilk istek beklemesin)
    uvicorn.run(app, host="127.0.0.1", port=args.port)

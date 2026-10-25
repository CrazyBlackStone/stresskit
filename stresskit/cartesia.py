"""Cartesia voice for the Lantern: soothing text-to-speech and speech-to-text, called from this server only.

    TTS  POST https://api.cartesia.ai/tts/bytes   model sonic-3.6, a calm library voice, slowed down,
                                                    emotion "calm"; returns MP3 bytes
    STT  POST https://api.cartesia.ai/stt         model ink-whisper (batch), multipart audio upload

Both use `Authorization: Bearer <key>` and `Cartesia-Version` (docs.cartesia.ai, API version 2026-08-14).
The key comes from the CARTESIA_API_KEY environment variable, else the first line of data/cartesia.key
(gitignored). It never leaves the server: the browser only calls /api/voice/*. Spoken lines are cached
under data/voice/ so a repeated line costs nothing. Without a key the game keeps working: it falls back
to a natural browser voice if there is one, else to text and a soft chime.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
from pathlib import Path

import aiohttp

log = logging.getLogger("stresskit.cartesia")

API = "https://api.cartesia.ai"
API_VERSION = "2026-08-14"
TTS_MODEL = "sonic-3.6"
STT_MODEL = "ink-whisper"  # the batch /stt endpoint's model
# "Isla" from Cartesia's voice library: "calm voice with gentle warmth and steady rhythm, perfect for yoga,
# meditation, and relaxation". If it ever stops working, the fallback is Jacqueline, which Cartesia's
# Sonic 3.6 docs recommend as a stable, pleasant en-US voice. Override with CARTESIA_VOICE_ID.
DEFAULT_VOICE = "eef47c0d-cb49-4160-a4a0-6b97ed4c81e6"
FALLBACK_VOICE = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
SPEED = 0.85        # generation_config.speed: 0.6-1.5, 1 = normal
EMOTION = "calm"    # one of Cartesia's primary (best supported) emotions
STT_EXT = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/mpeg": ".mp3",
           "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/flac": ".flac"}


def read_key(key_file: Path) -> str | None:
    """CARTESIA_API_KEY, else the first line of key_file. Tolerates PowerShell 5.1's UTF-16 files."""
    key = os.environ.get("CARTESIA_API_KEY", "").strip()
    if key:
        return key
    try:
        raw = key_file.read_bytes()
    except OSError:
        return None
    text = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8-sig", errors="replace")
    lines = text.strip().splitlines()
    key = lines[0].strip().strip("'\"").strip() if lines else ""
    return key or None


class CartesiaError(Exception):
    def __init__(self, status: int, message: str = ""):
        super().__init__(f"HTTP {status}{': ' + message if message else ''}")
        self.status = status


class CartesiaVoice:
    """Every public method degrades to 'not available' (None) rather than raising."""

    def __init__(self, api_key: str | None, cache_dir: Path, *, voice_id: str | None = None, model: str | None = None,
                 base_url: str = API, speed: float = SPEED, emotion: str = EMOTION, timeout_s: float = 20.0):
        self._key = (api_key or "").strip() or None
        self.cache_dir = cache_dir
        self.voice_id = (voice_id or "").strip() or DEFAULT_VOICE
        self.model = (model or "").strip() or TTS_MODEL
        self.base_url = base_url.rstrip("/")
        self.speed, self.emotion = speed, emotion
        self.timeout = aiohttp.ClientTimeout(total=timeout_s)
        self._session: aiohttp.ClientSession | None = None
        self._inflight: dict[str, asyncio.Future] = {}
        self._tts_blocked_until = 0.0
        self._stt_blocked_until = 0.0
        self.last_error: str | None = None
        self.calls = {"tts": 0, "stt": 0}

    @classmethod
    def from_env(cls, data_dir: Path, **kw) -> CartesiaVoice:
        return cls(read_key(data_dir / "cartesia.key"), data_dir / "voice",
                   voice_id=os.environ.get("CARTESIA_VOICE_ID"), model=os.environ.get("CARTESIA_MODEL"), **kw)

    @property
    def configured(self) -> bool:
        return self._key is not None

    def status(self) -> dict:
        now = time.time()
        cached = len(list(self.cache_dir.glob("*.mp3"))) if self.cache_dir.is_dir() else 0
        return {
            "cartesia": self.configured,  # whether a key is set; the key itself is never sent anywhere but Cartesia
            "tts": self.configured and now >= self._tts_blocked_until,
            "stt": self.configured and now >= self._stt_blocked_until,
            "voice": self.voice_id, "model": self.model, "speed": self.speed, "emotion": self.emotion,
            "cached": cached, "calls": dict(self.calls), "error": self.last_error,
        }

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    def _http(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=self.timeout)
        return self._session

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._key}", "Cartesia-Version": API_VERSION}

    def _blocked(self, exc: CartesiaError, which: str) -> None:
        # bad key, no credits, forbidden, rate limited: stop calling for a while and let the game fall back
        if exc.status in (401, 402, 403, 429):
            until = time.time() + (60 if exc.status == 429 else 300)
            if which == "tts":
                self._tts_blocked_until = until
            else:
                self._stt_blocked_until = until

    # -------------------------------------------------------------- text to speech

    def _cache_path(self, text: str) -> Path:
        key = hashlib.sha1(f"{self.model}|{self.voice_id}|{self.speed}|{self.emotion}|{text}".encode()).hexdigest()[:24]
        return self.cache_dir / f"{key}.mp3"

    async def speak(self, text: str) -> Path | None:
        """An MP3 of `text` in the Lantern's voice (cached), or None if Cartesia isn't available."""
        path = self._cache_path(text)
        if path.is_file() and path.stat().st_size > 0:
            return path
        if not self.configured or time.time() < self._tts_blocked_until:
            return None
        fut = self._inflight.get(str(path))
        if fut is None:  # the same line asked twice at once is generated once
            fut = asyncio.ensure_future(self._generate(text))
            self._inflight[str(path)] = fut
            fut.add_done_callback(lambda _: self._inflight.pop(str(path), None))
        return await asyncio.shield(fut)

    async def _generate(self, text: str) -> Path | None:
        try:
            try:
                audio = await self._tts(text, self.voice_id)
            except CartesiaError as exc:
                if exc.status not in (400, 404) or self.voice_id == FALLBACK_VOICE:
                    raise
                log.warning("Cartesia voice %s failed (%s); switching to the fallback voice", self.voice_id, exc)
                self.voice_id = FALLBACK_VOICE
                audio = await self._tts(text, self.voice_id)
            path = self._cache_path(text)
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".part")
            tmp.write_bytes(audio)
            tmp.replace(path)
            self.last_error = None
            return path
        except CartesiaError as exc:
            self._blocked(exc, "tts")
            self.last_error = f"tts: {exc}"
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as exc:
            self.last_error = f"tts: {type(exc).__name__}"
        log.warning("Cartesia TTS failed: %s", self.last_error)
        return None

    async def _tts(self, text: str, voice_id: str) -> bytes:
        self.calls["tts"] += 1
        body = {
            "model_id": self.model,
            "transcript": text,
            "voice": {"mode": "id", "id": voice_id},
            "language": "en",
            "output_format": {"container": "mp3", "sample_rate": 44100, "bit_rate": 128000},
            "generation_config": {"speed": self.speed, "emotion": self.emotion},
        }
        async with self._http().post(f"{self.base_url}/tts/bytes", json=body, headers=self._headers()) as r:
            if r.status != 200:
                raise CartesiaError(r.status, (await r.text())[:160])
            audio = await r.read()
        if not audio:
            raise CartesiaError(502, "empty audio")
        return audio

    # -------------------------------------------------------------- speech to text

    async def transcribe(self, audio: bytes, content_type: str) -> str | None:
        """What the patient said, or None if Cartesia isn't available (the game then uses another way)."""
        if not self.configured or time.time() < self._stt_blocked_until or not audio:
            return None
        ctype = content_type.split(";")[0].strip().lower() or "audio/webm"
        form = aiohttp.FormData()
        form.add_field("file", audio, filename=f"speech{STT_EXT.get(ctype, '.webm')}", content_type=ctype)
        form.add_field("model", STT_MODEL)
        form.add_field("language", "en")
        self.calls["stt"] += 1
        try:
            async with self._http().post(f"{self.base_url}/stt", data=form, headers=self._headers()) as r:
                if r.status != 200:
                    raise CartesiaError(r.status, (await r.text())[:160])
                data = await r.json(content_type=None)
            self.last_error = None
            return str(data.get("text") or "").strip()
        except CartesiaError as exc:
            self._blocked(exc, "stt")
            self.last_error = f"stt: {exc}"
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
            self.last_error = f"stt: {type(exc).__name__}"
        log.warning("Cartesia STT failed: %s", self.last_error)
        return None

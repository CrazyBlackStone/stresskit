import asyncio

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from stresskit.cartesia import API_VERSION, DEFAULT_VOICE, FALLBACK_VOICE, CartesiaVoice, read_key
from stresskit.engine import StressEngine
from stresskit.server import Hub, build_app

KEY = "sk_car_test"
MP3 = b"ID3\x03\x00\x00\x00" + b"\x00" * 64


def fake_cartesia(tts_status=200, bad_voices=()):
    """A stand-in for api.cartesia.ai: /tts/bytes returns MP3 bytes, /stt returns a transcript."""
    seen = {"tts": [], "stt": []}

    def check(request):
        assert request.headers["Authorization"] == f"Bearer {KEY}"
        assert request.headers["Cartesia-Version"] == API_VERSION

    async def tts(request):
        check(request)
        body = await request.json()
        seen["tts"].append(body)
        if body["voice"]["id"] in bad_voices:
            return web.json_response({"error": "voice not found"}, status=404)
        if tts_status != 200:
            return web.json_response({"error": "nope"}, status=tts_status)
        return web.Response(body=MP3, content_type="audio/mpeg")

    async def stt(request):
        check(request)
        form = await request.post()
        f = form["file"]
        seen["stt"].append({"model": form["model"], "language": form["language"], "filename": f.filename,
                            "type": f.content_type, "size": len(f.file.read())})
        return web.json_response({"type": "transcript", "text": " I am safe right now. ", "language": "en"})

    app = web.Application()
    app.router.add_post("/tts/bytes", tts)
    app.router.add_post("/stt", stt)
    return app, seen


def game(voice):
    return TestClient(TestServer(build_app(Hub(StressEngine(), None, "simulator"), voice)))


def test_say_renders_once_with_a_calm_slow_voice_then_serves_the_cache(tmp_path):
    async def scenario():
        fake, seen = fake_cartesia()
        async with TestServer(fake) as api:
            voice = CartesiaVoice(KEY, tmp_path, base_url=str(api.make_url("")))
            async with game(voice) as client:
                rs = await asyncio.gather(*(client.post("/api/voice/say", json={"text": "I am safe right now."}) for _ in range(2)))
                for r in rs:
                    assert r.status == 200 and r.content_type == "audio/mpeg" and await r.read() == MP3
                r3 = await client.post("/api/voice/say", json={"text": "I am safe right now."})
                assert r3.status == 200
                st = await (await client.get("/api/voice/status")).json()
                assert st["cartesia"] and st["tts"] and st["stt"] and st["cached"] == 1
                assert KEY not in str(st)  # the key never leaves the server
        assert len(seen["tts"]) == 1
        body = seen["tts"][0]
        assert body["model_id"] == "sonic-3.6" and body["transcript"] == "I am safe right now."
        assert body["voice"] == {"mode": "id", "id": DEFAULT_VOICE}
        assert body["output_format"] == {"container": "mp3", "sample_rate": 44100, "bit_rate": 128000}
        assert body["generation_config"] == {"speed": 0.85, "emotion": "calm"}
    asyncio.run(scenario())


def test_a_missing_voice_falls_back_to_a_stable_one(tmp_path):
    async def scenario():
        fake, seen = fake_cartesia(bad_voices={DEFAULT_VOICE})
        async with TestServer(fake) as api:
            voice = CartesiaVoice(KEY, tmp_path, base_url=str(api.make_url("")))
            assert await voice.speak("Hello.") is not None
            assert voice.voice_id == FALLBACK_VOICE
            assert [b["voice"]["id"] for b in seen["tts"]] == [DEFAULT_VOICE, FALLBACK_VOICE]
            await voice.close()
    asyncio.run(scenario())


def test_no_credits_pauses_cartesia_and_the_game_falls_back(tmp_path):
    async def scenario():
        fake, seen = fake_cartesia(tts_status=402)
        async with TestServer(fake) as api:
            voice = CartesiaVoice(KEY, tmp_path, base_url=str(api.make_url("")))
            async with game(voice) as client:
                r = await client.post("/api/voice/say", json={"text": "Hello."})
                assert r.status == 503
                st = await (await client.get("/api/voice/status")).json()
                assert not st["tts"] and "402" in st["error"]
                assert (await client.post("/api/voice/say", json={"text": "Again."})).status == 503
        assert len(seen["tts"]) == 1  # paused: no second call
    asyncio.run(scenario())


def test_transcribe_sends_the_recording_to_cartesia_stt(tmp_path):
    async def scenario():
        fake, seen = fake_cartesia()
        async with TestServer(fake) as api:
            voice = CartesiaVoice(KEY, tmp_path, base_url=str(api.make_url("")))
            async with game(voice) as client:
                r = await client.post("/api/voice/transcribe", data=b"\x1aE\xdf\xa3" + b"\x00" * 500,
                                      headers={"Content-Type": "audio/webm;codecs=opus"})
                assert r.status == 200 and (await r.json()) == {"ok": True, "text": "I am safe right now."}
        assert seen["stt"] == [{"model": "ink-whisper", "language": "en", "filename": "speech.webm", "type": "audio/webm", "size": 504}]
    asyncio.run(scenario())


def test_without_a_key_everything_reports_unavailable(tmp_path):
    async def scenario():
        async with game(CartesiaVoice(None, tmp_path)) as client:
            assert (await client.post("/api/voice/say", json={"text": "Hello."})).status == 503
            assert (await client.post("/api/voice/transcribe", data=b"abc", headers={"Content-Type": "audio/webm"})).status == 503
            st = await (await client.get("/api/voice/status")).json()
            assert st["cartesia"] is False and st["tts"] is False and st["stt"] is False
            assert (await client.post("/api/voice/say", json={})).status == 400
    asyncio.run(scenario())


def test_key_file_handles_powershell_encodings(tmp_path, monkeypatch):
    monkeypatch.delenv("CARTESIA_API_KEY", raising=False)
    f = tmp_path / "cartesia.key"
    assert read_key(f) is None
    f.write_bytes("﻿sk_car_abc\r\n".encode("utf-16-le"))  # PowerShell 5.1 Out-File / > default
    assert read_key(f) == "sk_car_abc"
    f.write_bytes(b'\xef\xbb\xbf"sk_car_def"\n')  # UTF-8 with BOM, quoted
    assert read_key(f) == "sk_car_def"
    monkeypatch.setenv("CARTESIA_API_KEY", "sk_car_env")
    assert read_key(f) == "sk_car_env"  # the environment wins

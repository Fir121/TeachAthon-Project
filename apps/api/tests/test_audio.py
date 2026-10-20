import io
import math
import shutil
import struct
import wave
import pytest
from sqlalchemy import select
from app.models import LiveSession, Job, Recording, AudioChunk, Transcript
from app.audio import assemble
from test_classroom import room


def tone():
    out = io.BytesIO()
    with wave.open(out, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(24000)
        f.writeframes(b"".join(struct.pack("<h", int(1000 * math.sin(i / 24))) for i in range(12000)))
    return out.getvalue()


def test_recording_permissions_dedup_and_offsets(room):
    t, s, o, factory, cid, lid, sid, _ = room
    from uuid import uuid4

    group = str(uuid4())
    with factory() as db:
        session = db.get(LiveSession, sid)
        session.recording_enabled = True
        db.commit()
    data = {"group_id": group, "chunk_index": "0", "start_ms": "100", "end_ms": "600"}
    r = t.post(f"/api/v1/sessions/{sid}/audio/chunks", data=data, files={"file": ("tone.wav", tone(), "audio/wav")})
    assert r.status_code == 202, r.text
    assert (
        t.post(
            f"/api/v1/sessions/{sid}/audio/chunks", data=data, files={"file": ("tone.wav", tone(), "audio/wav")}
        ).json()["id"]
        == r.json()["id"]
    )
    assert (
        s.post(
            f"/api/v1/sessions/{sid}/audio/chunks", data=data, files={"file": ("tone.wav", tone(), "audio/wav")}
        ).status_code
        == 403
    )
    bad = {**data, "chunk_index": "1", "start_ms": "600", "end_ms": "10"}
    assert (
        t.post(
            f"/api/v1/sessions/{sid}/audio/chunks", data=bad, files={"file": ("tone.wav", tone(), "audio/wav")}
        ).status_code
        == 422
    )
    assert o.get(f"/api/v1/sessions/{sid}/transcript").status_code == 404
    assert t.get(f"/api/v1/sessions/{sid}/audio/config").json()["sample_rate"] == 24000
    with factory() as db:
        assert len(list(db.scalars(select(AudioChunk)))) == 1


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg assembly runs in the Compose test container")
def test_actual_assembly_and_range_media(room):
    t, s, o, factory, cid, lid, sid, _ = room
    from uuid import uuid4

    with factory() as db:
        session = db.get(LiveSession, sid)
        session.recording_enabled = True
        db.commit()
    t.post(
        f"/api/v1/sessions/{sid}/audio/chunks",
        data={"group_id": str(uuid4()), "chunk_index": "0", "start_ms": "100", "end_ms": "600"},
        files={"file": ("tone.wav", tone(), "audio/wav")},
    ).raise_for_status()
    t.post(f"/api/v1/sessions/{sid}/end").raise_for_status()
    with factory() as db:
        job = db.scalar(select(Job).where(Job.type == "assemble_recording"))
        assemble(db, job)
        recording = db.get(Recording, sid)
        assert 550 <= recording.duration_ms <= 750
    r = s.get(f"/api/v1/sessions/{sid}/recording", headers={"Range": "bytes=0-99"})
    assert r.status_code == 206 and len(r.content) == 100
    assert o.get(f"/api/v1/sessions/{sid}/recording").status_code == 404

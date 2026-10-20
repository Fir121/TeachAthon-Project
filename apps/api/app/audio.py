import asyncio
import hashlib
import json
import subprocess
from collections import defaultdict, deque
from datetime import timedelta
from uuid import UUID
from fastapi import APIRouter, UploadFile, Form, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from sqlalchemy import select
from .ai.providers.openai import OpenAILive, OpenAIBatch
from .config import settings
from .db import SessionLocal
from .models import AudioChunk, Recording, Transcript, LiveSession, Lecture, Job, Question, now
from .security import DB, Actor, authenticate
from .classroom import live, emit, offset
from .materials import private_path, require
from .ingest import command

router = APIRouter()


@router.get("/api/v1/sessions/{sid}/audio/config")
def audio_config(sid: str, db: DB, user: Actor):
    s, _ = live(db, sid, user, True, True)
    return {
        "offset_ms": offset(s),
        "recording_enabled": s.recording_enabled,
        "live_stt_configured": bool(settings().openai_api_key),
        "sample_rate": 24000,
    }


@router.post("/api/v1/sessions/{sid}/audio/chunks", status_code=202)
async def upload_audio(
    sid: str,
    db: DB,
    user: Actor,
    file: UploadFile,
    group_id: str = Form(),
    chunk_index: int = Form(),
    start_ms: int = Form(),
    end_ms: int = Form(),
):
    s, _ = live(db, sid, user, True)
    if not s.recording_enabled:
        raise HTTPException(409, "Recording consent was not enabled for this lecture.")
    if s.ended_at and now() - s.ended_at.replace(tzinfo=now().tzinfo) > timedelta(minutes=10):
        raise HTTPException(409, "The recording upload window has closed.")
    try:
        UUID(group_id)
    except ValueError:
        raise HTTPException(422, "Invalid recording group.")
    if chunk_index < 0 or chunk_index > 100000 or start_ms < 0 or end_ms <= start_ms or end_ms > offset(s) + 10000:
        raise HTTPException(422, "Invalid recording offsets.")
    if file.content_type not in {
        "audio/webm",
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg",
        "audio/ogg;codecs=opus",
        "audio/wav",
    }:
        raise HTTPException(415, "Unsupported recording codec. Use a browser supporting WebM/Opus or MP4 audio.")
    data = await file.read(5 * 1024 * 1024 + 1)
    if not data or len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "Recording chunk must be between 1 byte and 5 MB.")
    # Never hold the session row lock across awaited upload I/O.
    s, _ = live(db, sid, user, True, lock=True)
    sha = hashlib.sha256(data).hexdigest()
    existing = db.scalar(
        select(AudioChunk).where(
            AudioChunk.session_id == sid, AudioChunk.group_id == group_id, AudioChunk.chunk_index == chunk_index
        )
    )
    if existing:
        if existing.sha256 != sha:
            raise HTTPException(409, "A different chunk already exists at this index.")
        return {"id": existing.id, "stored": True}
    key = f"{s.course_id}/{sid}/chunks/{group_id}/{chunk_index:08d}.bin"
    path = private_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)
    chunk = AudioChunk(
        session_id=sid,
        group_id=group_id,
        chunk_index=chunk_index,
        start_ms=start_ms,
        end_ms=end_ms,
        storage_key=key,
        sha256=sha,
        content_type=file.content_type,
    )
    db.add(chunk)
    s.recording_state = "capturing" if s.state == "live" else "queued"
    db.commit()
    return {"id": chunk.id, "stored": True}


@router.post("/api/v1/sessions/{sid}/audio/finalize")
def finalize_audio(sid: str, db: DB, user: Actor):
    s, _ = live(db, sid, user, True, lock=True)
    if not s.recording_enabled:
        raise HTTPException(409, "Recording is disabled.")
    if s.state != "ended":
        return {"state": s.recording_state}
    if not db.scalar(
        select(Job.id)
        .where(Job.target_id == sid, Job.type == "assemble_recording", Job.status.in_(["queued", "processing"]))
        .limit(1)
    ):
        db.add(Job(type="assemble_recording", course_id=s.course_id, target_id=sid))
    s.recording_state = "queued"
    db.commit()
    return {"state": "queued"}


@router.get("/api/v1/sessions/{sid}/processing-status")
def processing_status(sid: str, db: DB, user: Actor):
    s, m = live(db, sid, user)
    jobs = list(db.scalars(select(Job).where(Job.target_id == sid).limit(20)))
    return {
        "recording_state": s.recording_state,
        "transcript_state": s.transcript_state,
        "jobs": [{"type": j.type, "status": j.status, "error": j.error_message} for j in jobs]
        if m.role == "lecturer"
        else [],
    }


@router.get("/api/v1/sessions/{sid}/recording")
def recording(sid: str, db: DB, user: Actor):
    s, _ = live(db, sid, user)
    recording = db.get(Recording, sid)
    if not recording or s.recording_state != "ready":
        raise HTTPException(409, "The recording is not ready. Check its processing status and retry.")
    return FileResponse(private_path(recording.storage_key), media_type="audio/mpeg")


@router.get("/api/v1/sessions/{sid}/transcript")
def transcript(sid: str, db: DB, user: Actor):
    s, _ = live(db, sid, user)
    return [
        {"id": t.id, "start_ms": t.start_ms, "end_ms": t.end_ms, "text": t.text, "timing": t.timing}
        for t in db.scalars(
            select(Transcript).where(Transcript.session_id == sid).order_by(Transcript.start_ms).limit(10000)
        )
    ]


def duration_ms(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        capture_output=True,
        check=True,
        timeout=30,
    )
    return int(float(json.loads(r.stdout)["format"]["duration"]) * 1000)


def assemble(db, job):
    s = db.get(LiveSession, job.target_id)
    if not s:
        return
    chunks = list(
        db.scalars(
            select(AudioChunk)
            .where(AudioChunk.session_id == s.id)
            .order_by(AudioChunk.start_ms, AudioChunk.chunk_index)
        )
    )
    if not chunks:
        s.recording_state = "no_audio"
        db.commit()
        return
    s.recording_state = "processing"
    db.commit()
    root = private_path(f"{s.course_id}/{s.id}/assembled")
    root.mkdir(parents=True, exist_ok=True)
    try:
        groups = defaultdict(list)
        for c in chunks:
            groups[c.group_id].append(c)
        inputs = []
        filters = []
        for i, group in enumerate(sorted(groups.values(), key=lambda g: min(c.start_ms for c in g))):
            group = sorted(group, key=lambda c: c.chunk_index)
            if [c.chunk_index for c in group] != list(range(len(group))):
                raise RuntimeError("Recording is missing a chunk. Retry failed uploads before finalizing.")
            source = root / f"group-{i}.bin"
            with source.open("wb") as out:
                for c in group:
                    data = private_path(c.storage_key).read_bytes()
                    if hashlib.sha256(data).hexdigest() != c.sha256:
                        raise RuntimeError("Recording chunk checksum failed.")
                    out.write(data)
            normalized = root / f"group-{i}.wav"
            command(
                ["ffmpeg", "-y", "-v", "error", "-i", str(source), "-vn", "-ar", "24000", "-ac", "1", str(normalized)]
            )
            inputs += ["-i", str(normalized)]
            start = min(c.start_ms for c in group)
            filters.append(f"[{i}:a]adelay={start}:all=1[a{i}]")
        joined = "".join(f"[a{i}]" for i in range(len(groups)))
        filters.append(f"{joined}amix=inputs={len(groups)}:normalize=0[out]")
        output = root / "recording.mp3"
        temporary = root / "recording-new.mp3"
        command(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                *inputs,
                "-filter_complex",
                ";".join(filters),
                "-map",
                "[out]",
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "64k",
                str(temporary),
            ],
            timeout=600,
        )
        temporary.replace(output)
        key = str(output.relative_to(private_path("")))
        r = db.get(Recording, s.id)
        if not r:
            r = Recording(session_id=s.id, storage_key=key, duration_ms=duration_ms(output))
            db.add(r)
        else:
            r.storage_key = key
            r.duration_ms = duration_ms(output)
        s = db.scalar(select(LiveSession).where(LiveSession.id == s.id).with_for_update())
        s.recording_state = "ready"
        from .ai.retrieval import enqueue_index

        for question in db.scalars(select(Question).where(Question.session_id == s.id, Question.state != "dismissed")):
            enqueue_index(db, s.course_id, question.id, "match_answer_excerpt")
        emit(db, s, "recording.status", {"state": "ready"})
        db.commit()
    except Exception:
        db.rollback()
        s = db.get(LiveSession, job.target_id)
        s.recording_state = "failed"
        db.commit()
        raise


async def transcribe_windows(db, resource):
    source = private_path(resource.storage_key)
    root = source.parent / "transcription"
    root.mkdir(exist_ok=True)
    command(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(source),
            "-vn",
            "-ar",
            "24000",
            "-ac",
            "1",
            "-f",
            "segment",
            "-segment_time",
            "30",
            "-reset_timestamps",
            "1",
            str(root / "part-%06d.wav"),
        ],
        timeout=600,
    )
    start = 0
    provider = OpenAIBatch()
    for i, path in enumerate(sorted(root.glob("part-*.wav"))):
        length = duration_ms(path)
        existing = db.scalar(
            select(Transcript).where(Transcript.resource_id == resource.id, Transcript.item_id == str(i))
        )
        if not existing:
            text = await provider.transcribe(path)
            db.add(
                Transcript(
                    resource_id=resource.id,
                    item_id=str(i),
                    start_ms=start,
                    end_ms=start + length,
                    text=text,
                    timing="input_window",
                )
            )
            db.commit()
        start += length
    resource.pages = [
        {"text": t.text, "start_ms": t.start_ms, "end_ms": t.end_ms}
        for t in db.scalars(
            select(Transcript).where(Transcript.resource_id == resource.id).order_by(Transcript.start_ms)
        )
    ]


@router.websocket("/ws/sessions/{sid}/audio")
async def audio_socket(ws: WebSocket, sid: str):
    provider = OpenAILive()
    receiver = None
    if ws.headers.get("origin") and ws.headers["origin"] != settings().app_origin:
        await ws.close(code=1008)
        return
    try:
        with SessionLocal() as db:
            user = authenticate(db, ws.cookies.get("lectureloop_session"))
            session, _ = live(db, sid, user, True, True)
            lecture = require(db, Lecture, session.lecture_id)
            prompt = lecture.title
        await ws.accept()
        if not settings().openai_api_key:
            await ws.send_json(
                {
                    "type": "error",
                    "message": "Live captions are unavailable: OPENAI_API_KEY is not configured on the server. Recording and manual teaching still work.",
                }
            )
            await ws.close()
            return
        await provider.start_session(prompt)
        pending = deque()
        bounds = {}
        partial = {}
        sample_count = 0
        with SessionLocal() as db:
            session = db.scalar(select(LiveSession).where(LiveSession.id == sid).with_for_update())
            session.transcript_state = "live"
            emit(db, session, "transcript.status", {"state": "live"})
            db.commit()
        await ws.send_json({"type": "ready"})

        async def receive_provider():
            async for e in provider.receive_events():
                kind = e.get("type", "")
                item = e.get("item_id")
                if kind == "input_audio_buffer.committed" and pending:
                    bounds[item] = pending.popleft()
                if kind.endswith("input_audio_transcription.delta"):
                    partial[item] = partial.get(item, "") + e.get("delta", "")
                    with SessionLocal() as db:
                        s = db.scalar(select(LiveSession).where(LiveSession.id == sid).with_for_update())
                        emit(db, s, "transcript.delta", {"text": partial[item][-4000:], "item_id": item})
                        db.commit()
                if kind.endswith("input_audio_transcription.completed"):
                    if item not in bounds:
                        raise RuntimeError(
                            "Provider transcript has no committed input window; refusing to invent timestamps."
                        )
                    start, end = bounds.pop(item)
                    text = e.get("transcript", "")
                    with SessionLocal() as db:
                        s = db.scalar(select(LiveSession).where(LiveSession.id == sid).with_for_update())
                        if not db.scalar(
                            select(Transcript.id).where(Transcript.session_id == sid, Transcript.item_id == item)
                        ):
                            t = Transcript(session_id=sid, item_id=item, start_ms=start, end_ms=end, text=text)
                            db.add(t)
                            emit(
                                db,
                                s,
                                "transcript.final",
                                {"item_id": item, "text": text, "start_ms": start, "end_ms": end},
                            )
                            from .ai.retrieval import enqueue_index

                            enqueue_index(db, s.course_id, sid, "index_session")
                            enqueue_index(db, s.course_id, sid, "infer_topic")
                            if s.state == "ended":
                                for question in db.scalars(
                                    select(Question).where(Question.session_id == sid, Question.state != "dismissed")
                                ):
                                    enqueue_index(db, s.course_id, question.id, "match_answer_excerpt")
                            db.commit()
                    partial.pop(item, None)

        receiver = asyncio.create_task(receive_provider())
        while True:
            message = await asyncio.wait_for(ws.receive(), timeout=30)
            if message["type"] == "websocket.disconnect":
                break
            if receiver.done():
                receiver.result()
            with SessionLocal() as db:
                user = authenticate(db, ws.cookies.get("lectureloop_session"))
                live(db, sid, user, True, True)
            if message.get("bytes") is not None:
                pcm = message["bytes"]
                if len(pcm) > 96000 or len(pcm) % 2:
                    raise RuntimeError("Invalid PCM audio frame.")
                await provider.send_audio(pcm)
                sample_count += len(pcm) // 2
            elif message.get("text"):
                event = json.loads(message["text"])
                if event.get("type") == "window":
                    start = int(event["start_ms"])
                    end = int(event["end_ms"])
                    with SessionLocal() as db:
                        s = db.get(LiveSession, sid)
                        maximum = offset(s) + 10000
                    if start < 0 or end <= start or end > maximum or abs((end - start) - sample_count / 24) > 1000:
                        raise RuntimeError("Audio timing does not match received PCM samples.")
                    pending.append((start, end))
                    sample_count = 0
                    await provider.commit()
                elif event.get("type") == "stop":
                    for _ in range(30):
                        if not pending and not bounds and not partial:
                            break
                        if receiver.done():
                            receiver.result()
                        await asyncio.sleep(0.1)
                    break
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await ws.send_json(
                {
                    "type": "error",
                    "message": "Live transcription stopped. Check microphone/network and server model configuration, then retry.",
                }
            )
        except RuntimeError:
            pass
        with SessionLocal() as db:
            s = db.scalar(select(LiveSession).where(LiveSession.id == sid).with_for_update())
            if s:
                s.transcript_state = "failed"
                emit(db, s, "transcript.status", {"state": "failed"})
                db.commit()
    finally:
        if receiver:
            receiver.cancel()
        await provider.close()
        with SessionLocal() as db:
            s = db.scalar(select(LiveSession).where(LiveSession.id == sid).with_for_update())
            if s and s.transcript_state == "live":
                s.transcript_state = "off"
                emit(db, s, "transcript.status", {"state": "off"})
                db.commit()
        try:
            await ws.close()
        except RuntimeError:
            pass

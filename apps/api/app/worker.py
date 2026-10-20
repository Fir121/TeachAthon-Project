"""Single database-backed worker with recoverable leases, heartbeat and bounded retries."""

import logging
import time
import threading
from datetime import timedelta
from sqlalchemy import select, or_, and_, update
from sqlalchemy.orm.exc import StaleDataError
from .db import SessionLocal
from .models import Job, now

log = logging.getLogger(__name__)
from .ingest import ingest
from .audio import assemble
from .ai.retrieval import index_resource, index_session, index_question
from .intelligence import topic_job, grouping_job, feedback_job, match_job, outline_job

HANDLERS = {
    "infer_topic": topic_job,
    "group_questions": grouping_job,
    "classify_feedback": feedback_job,
    "match_answer_excerpt": match_job,
    "generate_outline": outline_job,
    "ingest_document": ingest,
    "assemble_recording": assemble,
    "index_resource": index_resource,
    "index_session": index_session,
    "index_question": index_question,
}


def heartbeat(job_id, attempt, stop):
    while not stop.wait(30):
        try:
            with SessionLocal() as lease_db:
                lease_db.execute(
                    update(Job)
                    .where(Job.id == job_id, Job.status == "processing", Job.attempts == attempt)
                    .values(lease_until=now() + timedelta(minutes=15))
                )
                lease_db.commit()
        except Exception:
            log.warning("Could not renew processing lease for job %s", job_id)


def run_once():
    with SessionLocal() as db:
        job = db.scalar(
            select(Job)
            .where(
                or_(
                    and_(Job.status == "queued", Job.next_run_at <= now()),
                    and_(Job.status == "processing", Job.lease_until < now()),
                )
            )
            .order_by(Job.next_run_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if not job:
            return False
        job.status = "processing"
        job.attempts += 1
        job.lease_until = now() + timedelta(minutes=15)
        db.commit()
        job_id = job.id
        stop = threading.Event()
        renewal = threading.Thread(target=heartbeat, args=(job_id, job.attempts, stop), daemon=True)
        renewal.start()
        try:
            handler = HANDLERS.get(job.type)
            if not handler:
                raise RuntimeError(f"Unsupported job type: {job.type}")
            handler(db, job)
            if not db.scalar(select(Job.id).where(Job.id == job_id)):
                return True
            job.status = "ready"
            job.error_message = None
        except Exception as exc:
            db.rollback()
            job = db.get(Job, job_id)
            if not job:
                return True
            job.status = "queued" if job.attempts < 3 else "failed"
            job.next_run_at = now() + timedelta(seconds=10 * 2**job.attempts)
            job.error_message = str(exc)[:500]
            log.warning("Job %s failed (%s)", job.id, type(exc).__name__)
        finally:
            stop.set()
            renewal.join(timeout=1)
        job.lease_until = None
        try:
            db.commit()
        except StaleDataError:
            db.rollback()  # Course removal also removes its in-flight jobs.
        return True


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    while True:
        try:
            if not run_once():
                time.sleep(1)
        except Exception:
            log.exception("Worker database operation failed")
            time.sleep(3)

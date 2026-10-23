"""Opt-in running-stack AI/domain check with owner-created fixture content only.
RUN_OPENAI_SMOKE=1 apps/api/.venv/bin/python scripts/integration_smoke.py /tmp/speech.mp3
"""
import io
import os
import sys
import time
import uuid
from pathlib import Path
import httpx
from reportlab.pdfgen import canvas
import io


def wait(check,timeout=55):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        result=check()
        if result:return result
        time.sleep(.5)
    raise AssertionError('Timed out waiting for a real background result')


def main(audio):
    if os.getenv('RUN_OPENAI_SMOKE')!='1':raise SystemExit('Set RUN_OPENAI_SMOKE=1 to allow paid API calls.')
    suffix=uuid.uuid4().hex[:8]
    with httpx.Client(base_url='http://localhost:8080/api/v1',timeout=35) as t,httpx.Client(base_url='http://localhost:8080/api/v1',timeout=35) as s:
        for client,role in [(t,'lecturer'),(s,'student')]:
            r=client.post('/auth/register',json={'name':f'Integration {role}','email':f'integration-{role}-{suffix}@example.com','password':'integration-test-password','role':role});r.raise_for_status()
        course=t.post('/courses',json={'name':f'Integration validation {suffix}'}).json();cid=course['id']
        assert course['settings']['generated_answers'] is False
        try:
            t.post(f'/courses/{cid}/members',json={'email':f'integration-student-{suffix}@example.com'}).raise_for_status()
            stream = io.BytesIO()
            doc = canvas.Canvas(stream, pagesize=(960, 540))
            doc.setFont('Helvetica',24)
            doc.drawString(60, 440, 'Binary search halves a sorted interval at each comparison.')
            doc.drawString(60, 380, 'The number of comparisons grows logarithmically.')
            doc.save()
            content = stream.getvalue()
            r=t.post(f'/courses/{cid}/resources',files={'file':('search.pdf',content,'application/pdf')});r.raise_for_status();rid=r.json()['id']
            wait(lambda:t.get(f'/resources/{rid}').json()['extraction_status']=='ready', timeout=120)
            wait(lambda:t.get(f'/resources/{rid}').json()['index_status']=='ready')
            settings={'poll_mode':'manual','poll_cooldown_seconds':60,'generated_answers':True}
            t.patch(f'/courses/{cid}/settings',json=settings).raise_for_status()
            p=s.post(f'/courses/{cid}/questions/preflight',json={'text':'Why does binary search have logarithmic comparisons?'}).json()
            assert p['matches'] and p['generated_answer'],p
            print('Real resource extraction + embeddings + hybrid retrieval + opt-in grounded summary: PASS')
            settings['generated_answers']=False;t.patch(f'/courses/{cid}/settings',json=settings).raise_for_status()
            lid=t.post(f'/courses/{cid}/lectures',json={'title':'Integration lecture','slide_resource_id':rid}).json()['id']
            sid=t.post(f'/lectures/{lid}/sessions/start',json={}).json()['id']
            ids=[]
            for text in ['What makes binary search run in logarithmic time?', 'Why is binary search O(log n) rather than linear?']:
                data={'text':text,'session_id':sid}
                proof=s.post(f'/courses/{cid}/questions/preflight',json=data).json()['preflight_token']
                q=s.post(f'/courses/{cid}/questions',json={**data,'preflight_token':proof});q.raise_for_status();ids.append(q.json()['id'])
            groups=wait(lambda:[g for g in t.get(f'/sessions/{sid}/lecturer-queue').json()['groups'] if len(g['questions'])==2])
            t.post(f'/clusters/{groups[0]["id"]}/resolve').raise_for_status()
            assert s.get(f'/questions/{ids[0]}').json()['state']=='answered'
            assert s.get(f'/questions/{ids[1]}').status_code==200
            print('Real embedding/LLM grouping of named question variants and lecturer group resolution: PASS')
            pid=t.post(f'/sessions/{sid}/polls',json={}).json()['id']
            text='Could you explain why the search interval must be sorted?'
            data={'text':text,'purpose':'feedback','session_id':sid}
            proof=s.post(f'/courses/{cid}/questions/preflight',json=data).json()['preflight_token']
            s.post(f'/polls/{pid}/feedback',json={'text':text,'preflight_token':proof}).raise_for_status()
            wait(lambda:any(f['classification']=='question' and f['linked_question_id'] for f in t.get(f'/sessions/{sid}/lecturer-queue').json()['feedback']))
            assert all(q['visibility']=='public' for q in s.get(f'/sessions/{sid}/snapshot').json()['questions'])
            print('Real feedback classification with named lecturer-only routing: PASS')
            t.post(f'/sessions/{sid}/end').raise_for_status()
            r=t.post(f'/courses/{cid}/resources',files={'file':('generated-speech.mp3',audio.read_bytes(),'audio/mpeg')});r.raise_for_status();media_id=r.json()['id']
            wait(lambda:t.get(f'/resources/{media_id}').json()['index_status']=='ready')
            transcript=s.get(f'/resources/{media_id}/transcript').json()
            assert transcript and 'binary' in transcript[0]['text'].lower() and transcript[0]['start_ms']==0
            results=s.get(f'/courses/{cid}/search',params={'q':'binary search sorted interval'}).json()['matches']
            assert any(m['source_type']=='recording' and m['locations'][0]['start_ms']==0 and '/resources/' in m['url'] for m in results)
            print('Real MP3 batch transcription + mapped input offsets + cited media retrieval: PASS')
        finally:
            r=t.delete(f'/courses/{cid}');assert r.status_code==204,r.text
    print('Integration fixture course removed. All domain/provider checks passed.')


if __name__=='__main__':main(Path(sys.argv[1]))

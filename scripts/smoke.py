"""Exercises the running Compose API with unique, synthetic, owner-created content."""
import time
import uuid
import httpx
import pymupdf

BASE="http://localhost:8080/api/v1"

def main():
    suffix=uuid.uuid4().hex[:8]
    with httpx.Client(base_url=BASE,timeout=15) as t,httpx.Client(base_url=BASE,timeout=15) as s:
        for client,role in [(t,"lecturer"),(s,"student")]:
            r=client.post('/auth/register',json={'name':f'Smoke {role}','email':f'{role}-{suffix}@example.com','password':'smoke-test-password','role':role})
            assert r.status_code==201,r.text
        cid=t.post('/courses',json={'name':f'Smoke course {suffix}'}).json()['id']
        assert s.get(f'/courses/{cid}').status_code==404
        uid=s.get('/auth/me').json()['id']
        s.post(f'/courses/{cid}/join-requests').raise_for_status()
        t.post(f'/courses/{cid}/join-requests/{uid}/approve').raise_for_status()
        assert s.get(f'/courses/{cid}').status_code==200
        with pymupdf.open() as doc:
            p=doc.new_page();p.insert_text((60,60),'Binary search halves a sorted search space. Complexity is logarithmic.')
            p=doc.new_page();p.insert_text((60,60),'Invariants: maintain a valid search interval.')
            content=doc.tobytes()
        r=t.post(f'/courses/{cid}/resources',files={'file':('smoke.pdf',content,'application/pdf')})
        assert r.status_code==202,r.text
        rid=r.json()['id']
        for _ in range(40):
            state=t.get(f'/resources/{rid}').json()
            if state['process_status'] in {'ready','failed'}:break
            time.sleep(.5)
        assert state['process_status']=='ready',state
        assert state['page_count']==2,state
        assert s.get(f'/resources/{rid}/pages/1').status_code==200
        lid=t.post(f'/courses/{cid}/lectures',json={'title':'Binary search','slide_resource_id':rid}).json()['id']
        assert t.delete(f'/courses/{cid}').status_code==204
        print(f'M0/M1 running-stack smoke passed: enrolment, worker PDF conversion, slides, lecture {lid}')

if __name__=='__main__':main()

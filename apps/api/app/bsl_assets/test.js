'use strict';
const frame = document.querySelector('iframe');
const viewer = crypto.randomUUID();
const status = document.getElementById('status');
let cues = [], index = 0, running = false;
const send = (type, extra = {}) => frame.contentWindow.postMessage({v: 1, viewer, type, ...extra}, location.origin);
const timeout = setTimeout(() => { status.textContent = 'Renderer unavailable. Read the script captions below.'; }, 30000);
function next() {
  if (index >= cues.length) { status.textContent = 'Corpus script completed.'; running = false; return; }
  document.getElementById('cue').textContent = cues[index].text;
  send('play_glosses', {request_id: 'demo-' + index, glosses: cues[index].glosses});
}
window.addEventListener('message', (e) => {
  const d = e.data;
  if (e.origin !== location.origin || e.source !== frame.contentWindow || !d || d.v !== 1 || d.viewer !== viewer) return;
  if (d.type === 'cwasa_ready') {
    clearTimeout(timeout); status.textContent = 'Corpus and 3D avatar ready.';
    fetch('../demo').then(r => { if (!r.ok) throw Error(); return r.json(); }).then(data => {
      cues = data.cues; document.getElementById('play').disabled = false;
      document.getElementById('cue').textContent = cues.map(c => c.text).join(' ');
    }).catch(() => { status.textContent = 'Prepared script unavailable.'; });
  }
  if (d.type === 'cwasa_failed') { clearTimeout(timeout); status.textContent = 'Renderer failed. Use the script captions.'; }
  if (d.type === 'signing_done' && running && d.request_id === 'demo-' + index) { index++; next(); }
});
frame.src = 'panel.html?viewer=' + viewer;
document.getElementById('play').onclick = () => { if (!running) { index = 0; running = true; next(); } };
document.getElementById('pause').onclick = () => send('pause');
document.getElementById('resume').onclick = () => send('resume');
document.getElementById('speed').onchange = e => send('set_speed', {speed: Number(e.target.value)});

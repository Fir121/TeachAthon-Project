/* Adapted from Kozha extension/panel.js, MIT © 2026 Zhan Amankeldy and Bogdan Mironov.
 * BSL-only, no spelling/generated SiGML, exact corpus nodes, validated messages.
 * CWASA and its configuration/assets are distributed byte-for-byte upstream.
 */
(function () {
  'use strict';
  var origin = location.origin;
  var viewer = new URLSearchParams(location.search).get('viewer');
  if (!viewer || !/^[a-f0-9-]{36}$/.test(viewer) || window.parent === window) return;
  var signs = new Map(), ready = false, avatarReady = false, engineReady = false;
  var current = null, active = false, loaded = false, failed = false, paused = false;
  function notify(type, extra) {
    window.parent.postMessage(Object.assign({v: 1, type: type, viewer: viewer}, extra), origin);
  }
  function fail() {
    if (failed) return;
    failed = true; ready = false;
    try { CWASA.stopSiGML(0); } catch (_) { /* Engine may not have loaded. */ }
    notify('cwasa_failed');
  }
  function checkReady() {
    if (!failed && avatarReady && engineReady && signs.size && !ready) {
      ready = true; notify('cwasa_ready');
      var canvas = document.querySelector('canvas');
      if (canvas) canvas.addEventListener('webglcontextlost', function(e) { e.preventDefault(); fail(); });
    }
  }
  function click(name) {
    var button = document.querySelector('.bttn' + name + '.av0');
    if (!button || button.disabled) return;
    button.click();
  }
  function stop() {
    current = null; active = false; loaded = false;
    if (engineReady) CWASA.stopSiGML(0);
  }
  window.addEventListener('error', fail);
  window.addEventListener('unhandledrejection', fail);
  window.addEventListener('message', function(e) {
    var d = e.data;
    if (e.origin !== origin || e.source !== window.parent || !d || typeof d !== 'object' ||
        d.v !== 1 || d.viewer !== viewer || typeof d.type !== 'string') return;
    if (d.type === 'init_cwasa') { if (ready) notify('cwasa_ready'); return; }
    if (d.type === 'stop') { stop(); return; }
    if (!ready) return;
    if (d.type === 'pause') { paused = true; click('Suspend'); return; }
    if (d.type === 'resume') { paused = false; click('Resume'); return; }
    if (d.type === 'set_speed' && [0.5, 1, 2].includes(d.speed)) {
      click('SpeedReset');
      if (d.speed !== 1) click(d.speed === 2 ? 'SpeedUp' : 'SpeedDown');
      return;
    }
    if (d.type !== 'play_glosses' || current || typeof d.request_id !== 'string' ||
        d.request_id.length > 120 || !Array.isArray(d.glosses) || !d.glosses.length ||
        d.glosses.length > 24 || !d.glosses.every(function(g) { return typeof g === 'string' && signs.has(g); })) return;
    current = d.request_id; active = false; loaded = false;
    // Only concatenate untouched corpus hns_sign elements. No generated gestures.
    var sigml = '<sigml>' + d.glosses.map(function(g) { return signs.get(g); }).join('\n') + '</sigml>';
    try { CWASA.playSiGMLText(sigml, 0); } catch (_) { fail(); }
  });
  fetch('data/hamnosys_bsl_version1.sigml', {credentials: 'same-origin'}).then(function(r) {
    if (!r.ok) throw Error('corpus'); return r.text();
  }).then(function(xml) {
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw Error('corpus');
    doc.querySelectorAll('hns_sign').forEach(function(s) {
      var gloss = (s.getAttribute('gloss') || '').toLowerCase();
      if (gloss) signs.set(gloss, s.outerHTML);
    });
    if (!signs.size) throw Error('empty corpus');
    checkReady();
  }).catch(fail);
  try {
    CWASA.addHook('avatarready', function() { avatarReady = true; checkReady(); });
    CWASA.addHook('sigmlloaded', function(e) {
      if (!current) return;
      if (!e.msg || !e.msg.f || !e.msg.s) { fail(); return; }
      loaded = true;
    }, 0);
    CWASA.addHook('animactive', function() {
      if (!current) return;
      active = true; notify('signing_started', {request_id: current});
      setTimeout(function() { if (paused && current) click('Suspend'); }, 0);
    }, 0);
    CWASA.addHook('animidle', function() {
      if (!current) return;
      if (active && loaded) {
        var id = current; current = null; active = false;
        notify('signing_done', {request_id: id});
      }
    }, 0);
    CWASA.init({useClientConfig: false, useCwaConfig: false, jasBase: new URL('./', location.href).href, cwaBase: new URL('cwa/', location.href).href,
      avJARBase: new URL('cwa/avatars/', location.href).href, useAvatarJARs: true, avs: ['anna'],
      avSettings: [{width: 384, height: 320, avList: 'avs', initAv: 'anna',
        initSiGMLURL: '', initCamera: [0, 0.23, 3.24, 5, 18, 30, -1, -1], initSpeed: 0, rateSpeed: 1, ambIdle: false,
        allowFrameSteps: true, allowSiGMLText: false}]});
    CWASA.ready.then(function() { engineReady = true; checkReady(); }).catch(fail);
  } catch (_) { fail(); }
}());

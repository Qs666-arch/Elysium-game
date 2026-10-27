/* Rescue sounds follow the existing wall-clock deadline; they never change it. */
(function () {
  'use strict';
  const TOTAL = 600000, MINUTE = 60000, CUE = 10000, ALARM = 3000;
  let context = null, gain = null, tickBuffer = null, alarmBuffer = null;
  let deadline = null, alarmUntil = null, clockOffset = null, resuming = false;
  const sources = new Set();

  function cancelSources() {
    sources.forEach(source => {
      source.onended = null;
      try { source.stop(); } catch (_) {}
      try { source.disconnect(); } catch (_) {}
    });
    sources.clear();
    clockOffset = null;
  }
  function stop() {
    deadline = null;
    alarmUntil = null;
    cancelSources();
  }
  function buffer(alarm) {
    let cached = alarm ? alarmBuffer : tickBuffer;
    if (cached) return cached;
    const seconds = (alarm ? ALARM : CUE) / 1000;
    cached = context.createBuffer(1, Math.round(context.sampleRate * seconds), context.sampleRate);
    const samples = cached.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const t = i / context.sampleRate;
      if (alarm) {
        // A repeated twin-tone alarm with short attack/release envelopes.
        const beat = t % 0.25;
        const envelope = Math.max(0, Math.min(1, beat / 0.006, (0.18 - beat) / 0.02));
        const fade = Math.min(1, (seconds - t) / 0.04);
        samples[i] = envelope * fade * (0.52 * Math.sin(2 * Math.PI * 880 * t) + 0.28 * Math.sin(2 * Math.PI * 1320 * t));
      } else {
        // Alternating mechanical ticks, one per second, within a ten-second cue.
        const beat = t % 1, hz = Math.floor(t) % 2 ? 1250 : 1700;
        if (beat < 0.085) {
          const envelope = Math.min(1, beat / 0.002) * Math.exp(-beat * 75) * Math.min(1, (0.085 - beat) / 0.008);
          samples[i] = envelope * (0.7 * Math.sin(2 * Math.PI * hz * beat) + 0.2 * Math.sin(2 * Math.PI * hz * 2.4 * beat));
        }
      }
    }
    if (alarm) alarmBuffer = cached; else tickBuffer = cached;
    return cached;
  }
  function schedule(audio, start, end, now) {
    if (end <= now) return;
    const source = context.createBufferSource();
    source.buffer = audio;
    source.connect(gain);
    sources.add(source);
    source.onended = () => { source.disconnect(); sources.delete(source); };
    const offset = Math.max(0, (now - start) / 1000);
    source.start(context.currentTime + Math.max(0, (start - now) / 1000), offset, (end - Math.max(start, now)) / 1000);
  }
  function rebuild() {
    cancelSources();
    if (!context || context.state !== 'running') return;
    const now = Date.now();
    clockOffset = now / 1000 - context.currentTime;
    try {
      if (alarmUntil !== null) {
        schedule(buffer(true), alarmUntil - ALARM, alarmUntil, now);
      } else if (deadline !== null && deadline > now) {
        // Schedule on the audio clock, so throttled background JS does not
        // stack or omit minute cues. Never replay windows which already passed.
        for (let minute = 1; minute < 10; minute++) {
          const start = deadline - TOTAL + minute * MINUTE;
          if (start + CUE > now) schedule(buffer(false), start, start + CUE, now);
        }
      }
    } catch (_) { cancelSources(); }
  }
  function unlock(event) {
    if (!event.isTrusted) return;
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      if (!context || context.state === 'closed') {
        cancelSources();
        context = new AudioCtor();
        gain = context.createGain();gain.gain.value = 0.3;gain.connect(context.destination);
        tickBuffer = alarmBuffer = null;
        context.addEventListener('statechange', rebuild);
      }
      if (context.state === 'suspended' && !resuming) {
        resuming = true;
        Promise.resolve(context.resume()).then(rebuild).catch(() => {}).finally(() => { resuming = false; });
      } else if (context.state === 'running' && clockOffset === null) rebuild();
    } catch (_) { /* Sound failure must never block gameplay or an ending. */ }
  }
  window.argCountdownAudio = Object.freeze({
    sync(nextDeadline) {
      if (!Number.isFinite(nextDeadline)) return;
      if (window.argRestoringSave) { stop(); return; }
      const changed = deadline !== nextDeadline || alarmUntil !== null;
      deadline = nextDeadline;alarmUntil = null;
      const drifted = context && clockOffset !== null && Math.abs(Date.now() / 1000 - context.currentTime - clockOffset) > 1;
      if (changed || drifted) rebuild();
    },
    finish(ending) {
      stop();
      if (ending === 2 && !window.argRestoringSave) { alarmUntil = Date.now() + ALARM;rebuild(); }
    },
    stop
  });
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) rebuild(); });
  window.addEventListener('pagehide', stop);
})();

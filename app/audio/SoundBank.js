"use client";

// Match SFX via the Web Audio API. The old HTMLAudio + cloneNode() approach left
// every SFX silent on iOS: a cloned <audio> stays autoplay-locked even after the
// page is unlocked, so the looping ambience (played directly on the first
// gesture) was audible but the goal cheer / kicks (fresh clones) were silently
// blocked ("手机端进球没有动物叫"). Web Audio sidesteps this: ONE AudioContext,
// resumed on the first user gesture, unlocks every sound for the session;
// overlapping one-shots are free. Brand-new ElevenLabs audio under
// /animal-cup/audio/. Every call no-ops cleanly if a file/decode fails.
const BASE = "/animal-cup/audio/";
// Decoded the moment audio unlocks, so the first goal cheer has no fetch lag.
const WARM = [
  "cheer_lion", "cheer_jaguar", "cheer_puma", "cheer_wolf", "cheer_eagle",
  "cheer_bull", "cheer_rooster", "goal_cheer", "shot", "pass", "whistle_kickoff",
];

class SoundBank {
  constructor() {
    // Sound is ON by default (owner 2026-06-11); browsers still gate it behind
    // the first gesture, which resumes the context below.
    this.muted = false;
    this.masterVolume = 0.7;
    this.ctx = null;
    this.buffers = {};
    this.loading = {};
    this.ambience = null; // { src, gain }
    this.music = null;
    if (typeof window !== "undefined") {
      const unlock = () => {
        const ctx = this._ctx();
        if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
        WARM.forEach((id) => this._buffer(id)); // fire-and-forget decode
      };
      // Stay subscribed (don't remove): iOS can re-suspend on blur, and any
      // later tap should re-resume.
      window.addEventListener("pointerdown", unlock);
      window.addEventListener("keydown", unlock);
    }
  }

  _ctx() {
    if (!this.ctx && typeof window !== "undefined") {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    return this.ctx;
  }

  // fetch + decode once; cache the AudioBuffer. Returns a Promise<buffer|null>.
  _buffer(id) {
    if (this.buffers[id]) return Promise.resolve(this.buffers[id]);
    if (this.loading[id]) return this.loading[id];
    const ctx = this._ctx();
    if (!ctx) return Promise.resolve(null);
    this.loading[id] = fetch(BASE + id + ".mp3")
      .then((r) => r.arrayBuffer())
      // callback form of decodeAudioData — works on every browser incl. old Safari
      .then((buf) => new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej)))
      .then((b) => { this.buffers[id] = b; return b; })
      .catch(() => null);
    return this.loading[id];
  }

  play(id, { volume = 1 } = {}) {
    if (this.muted) return;
    const ctx = this._ctx();
    if (!ctx) return;
    // Not unlocked yet (no gesture): nudge a resume and skip this one-shot rather
    // than scheduling it to fire late when the context eventually resumes.
    if (ctx.state === "suspended") { ctx.resume().catch(() => {}); return; }
    this._buffer(id).then((b) => {
      if (!b || this.muted) return;
      try {
        const src = ctx.createBufferSource();
        src.buffer = b;
        const g = ctx.createGain();
        g.gain.value = Math.max(0, Math.min(1, volume * this.masterVolume));
        src.connect(g).connect(ctx.destination);
        src.start(0);
      } catch (e) {}
    });
  }

  // Loops are scheduled even while suspended — they begin the instant the
  // context resumes on the first gesture, so the crowd bed comes up on tap.
  _startLoop(slot, id, volume) {
    if (this.muted) return;
    const ctx = this._ctx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    this._buffer(id).then((b) => {
      if (!b || this.muted) return;
      try {
        this._stopLoop(slot);
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = Math.max(0, Math.min(1, volume * this.masterVolume));
        src.connect(g).connect(ctx.destination);
        src.start(0);
        this[slot] = { src, gain: g };
      } catch (e) {}
    });
  }

  _stopLoop(slot) {
    if (this[slot]) {
      try { this[slot].src.stop(); } catch (e) {}
      this[slot] = null;
    }
  }

  startAmbience(id = "crowd_ambience", volume = 0.35) { this._startLoop("ambience", id, volume); }
  stopAmbience() { this._stopLoop("ambience"); }
  startMusic(id = "music_bed", volume = 0.22) { this._startLoop("music", id, volume); }
  stopMusic() { this._stopLoop("music"); }

  setMuted(m) {
    this.muted = !!m;
    if (this.muted) { this.stopAmbience(); this.stopMusic(); }
  }
}

export const sfx = new SoundBank();

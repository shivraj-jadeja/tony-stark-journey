// Synthesised gear sounds (Web Audio, no audio files). Off by default; a toggle button turns it on.
// Browsers only allow audio after a user gesture, so the AudioContext is created inside the button's click.
//   tick("light")  short bright tick (inner ring)
//   tick("heavy")  ratchet: three pawl clicks, a short steel ring and a low thunk (outer ring, arcs)
export function createGearSound(button) {
  let ctx = null, noise = null, on = false, last = 0;
  const label = () => {
    button.setAttribute("aria-pressed", String(on));
    button.textContent = `Gear sound · ${on ? "on" : "off"}`;
  };
  label();
  button.addEventListener("click", () => {
    on = !on;
    if (on && !ctx) {
      ctx = new AudioContext();
      noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.03), ctx.sampleRate);
      const ch = noise.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 4);
    }
    if (ctx) on ? ctx.resume() : ctx.suspend();
    label();
  });

  function light(now, pitch) {
    const f = pitch * (0.94 + Math.random() * 0.12);
    const src = ctx.createBufferSource(); src.buffer = noise;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = 6;
    const g = ctx.createGain(); g.gain.value = 0.35;
    src.connect(bp).connect(g).connect(ctx.destination); src.start(now);
    const osc = ctx.createOscillator(); osc.type = "triangle"; osc.frequency.value = f / 2.3;
    const og = ctx.createGain(); og.gain.setValueAtTime(0.06, now); og.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    osc.connect(og).connect(ctx.destination); osc.start(now); osc.stop(now + 0.05);
  }

  function heavy(now, k) {
    const out = ctx.createGain(); out.gain.value = 0.9; out.connect(ctx.destination);
    for (let i = 0; i < 3; i++) {                                  // pawl clicking over three teeth
      const at = now + i * 0.016, src = ctx.createBufferSource(); src.buffer = noise;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1200;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 10; bp.frequency.value = (1900 + Math.random() * 400) * k;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.55 * Math.pow(0.6, i), at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.016);
      src.connect(hp).connect(bp).connect(g).connect(out); src.start(at); src.stop(at + 0.03);
    }
    const f0 = (620 + Math.random() * 60) * k;                   // short inharmonic steel ring
    [[1, 0.045], [2.76, 0.026], [5.4, 0.01]].forEach(([r, a]) => {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f0 * r;
      const g = ctx.createGain(); g.gain.setValueAtTime(a, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
      o.connect(g).connect(out); o.start(now); o.stop(now + 0.12);
    });
    const th = ctx.createOscillator(); th.type = "sine";           // deep thunk: the gear's mass settling
    th.frequency.setValueAtTime(130, now); th.frequency.exponentialRampToValueAtTime(55, now + 0.06);
    const tg = ctx.createGain(); tg.gain.setValueAtTime(0.26, now); tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    th.connect(tg).connect(out); th.start(now); th.stop(now + 0.08);
    const body = ctx.createBufferSource(); body.buffer = noise;      // low-mid knock under the clicks
    const lp = ctx.createBiquadFilter(); lp.type = "bandpass"; lp.frequency.value = 380 * k; lp.Q.value = 1.6;
    const bg = ctx.createGain(); bg.gain.setValueAtTime(0.5, now); bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    body.connect(lp).connect(bg).connect(out); body.start(now); body.stop(now + 0.035);
  }

  return {
    tick(kind, k = 1) {
      if (!on || !ctx) return;
      const now = ctx.currentTime;
      if (now - last < 0.022) return;                              // at most ~45 ticks/s on fast sweeps
      last = now;
      kind === "heavy" ? heavy(now, k) : light(now, 3200 * k);
    }
  };
}

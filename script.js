const svgNS = "http://www.w3.org/2000/svg";
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const state = {
  bottles: [],
  selected: null,
  stepCount: 16,
  stepIndex: 0,
  bpm: 96,
  scale: "pentatonic",
  playing: false,
  audioReady: false,
};

// DOM
const stage = document.getElementById("stage");
const countEl = document.getElementById("count");
const playBtn = document.getElementById("playBtn");
const enableBtn = document.getElementById("enableBtn");
const bpmEl = document.getElementById("bpm");
const scaleSel = document.getElementById("scaleSel");
const addBtn = document.getElementById("addBtn");
const beatDot = document.getElementById("beatDot");
const insp = document.getElementById("inspector");
const selText = document.getElementById("selText");
const fillEl = document.getElementById("fill");
const fillVal = document.getElementById("fillVal");
const seedBtn = document.getElementById("seedBtn");
const clearBtn = document.getElementById("clearBtn");
const delBtn = document.getElementById("delBtn");

// ===== music scales =====
const SCALES = {
  pentatonic: { tonic: 60, deg: [0, 2, 4, 7, 9] },
  minor: { tonic: 57, deg: [0, 2, 3, 5, 7, 8, 10] },
  whole: { tonic: 60, deg: [0, 2, 4, 6, 8, 10] },
};
const midi2freq = (m) => Tone.Frequency(m, "midi").toFrequency();
function freqFromFill(fill, scaleName) {
  const s = SCALES[scaleName] || SCALES.pentatonic;
  // only one size -> fixed octaves
  const pool = [];
  [1, 2, 3].forEach((o) =>
    s.deg.forEach((d) => pool.push(s.tonic + d + 12 * o))
  );
  const i = Math.round(clamp(fill, 0, 1) * (pool.length - 1));
  return midi2freq(pool[i]);
}

// ===== tiny synth by material =====
function makeSynth(material) {
  if (material === "rice")
    return new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0 },
    }).toDestination();
  if (material === "sand")
    return new Tone.NoiseSynth({
      noise: { type: "brown" },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0 },
    }).toDestination();
  if (material === "beads") return new Tone.PluckSynth().toDestination();
  return new Tone.AMSynth().toDestination(); // water
}
function trigger(synth, material, freq, time) {
  const when = time ?? Tone.now();
  if (material === "rice" || material === "sand")
    synth.triggerAttackRelease(0.03, when, 0.8);
  else if (material === "beads")
    synth.triggerAttackRelease(freq, 0.2, when, 0.8);
  else synth.triggerAttackRelease(freq, 0.25, when, 0.8);
}

// ===== bottle shapes (viewBox 120×240) =====
// 7 d-strings to be completed
const SHAPES = [
  "M55 8 C55 6 78 6 78 8 L78 26 C92 28 104 42 104 64 L104 186 C104 210 88 228 62 232 C36 228 20 210 20 186 L20 64 C20 42 34 28 48 26 L55 26 Z",
  "M30 20 L90 20 L94 56 L100 92 L96 172 C94 202 82 220 60 226 C38 220 26 202 24 172 L20 92 L26 56 Z",
];
function materialColors(mat) {
  if (mat === "water") return { base: "#d7ecff", hatch: "#1256ff" };
  if (mat === "rice") return { base: "#f2e2b2", hatch: "#b48a2b" };
  if (mat === "beads") return { base: "#d6f4ff", hatch: "#0b8fb3" };
  if (mat === "sand") return { base: "#eee2c7", hatch: "#9a8b55" };
  return { base: "#eef2ff", hatch: "#7b79ff" };
}

// ===== create a bottle (single size) =====
let idSeed = 1;
function createBottle(opts = {}) {
  const bottle = {
    id: "b" + idSeed++,
    material: opts.material || "water",
    fill: clamp(opts.fill ?? 0.5, 0, 1),
    x: opts.x ?? Math.random() * 0.8 + 0.1,
    y: opts.y ?? Math.random() * 0.6 + 0.25,
    steps: Array(state.stepCount).fill(false),
    synth: makeSynth(opts.material || "water"),
  };

  // DOM
  const el = document.createElement("div");
  el.className = "bottle";
  el.dataset.id = bottle.id;

  const neck = document.createElement("div");
  neck.className = "neck";
  neck.title = "grab to move";

  // SVG
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 120 240");

  const defs = document.createElementNS(svgNS, "defs");
  svg.appendChild(defs);
  const d = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  const clipId = "clip-" + bottle.id,
    patId = "pat-" + bottle.id;

  // clip from outline
  const clip = document.createElementNS(svgNS, "clipPath");
  clip.setAttribute("id", clipId);
  const cp = document.createElementNS(svgNS, "path");
  cp.setAttribute("d", d);
  clip.appendChild(cp);
  defs.appendChild(clip);

  // hatch pattern
  const pat = document.createElementNS(svgNS, "pattern");
  pat.setAttribute("id", patId);
  pat.setAttribute("patternUnits", "userSpaceOnUse");
  pat.setAttribute("width", "6");
  pat.setAttribute("height", "6");
  pat.setAttribute("patternTransform", "rotate(45)");
  const line = document.createElementNS(svgNS, "line");
  line.setAttribute("x1", "0");
  line.setAttribute("y1", "0");
  line.setAttribute("x2", "0");
  line.setAttribute("y2", "6");
  const col = materialColors(bottle.material);
  line.setAttribute("stroke", col.hatch);
  line.setAttribute("stroke-width", "1");
  line.setAttribute("opacity", "0.55");
  pat.appendChild(line);
  defs.appendChild(pat);

  // liquid rectangles (clipped)
  const base = document.createElementNS(svgNS, "rect");
  base.setAttribute("x", "0");
  base.setAttribute("y", "120");
  base.setAttribute("width", "120");
  base.setAttribute("height", "120");
  base.setAttribute("clip-path", `url(#${clipId})`);
  base.setAttribute("fill", col.base);
  base.setAttribute("opacity", "0.7");

  const hatch = document.createElementNS(svgNS, "rect");
  hatch.setAttribute("x", "0");
  hatch.setAttribute("y", "120");
  hatch.setAttribute("width", "120");
  hatch.setAttribute("height", "120");
  hatch.setAttribute("clip-path", `url(#${clipId})`);
  hatch.setAttribute("fill", `url(#${patId})`);
  hatch.setAttribute("opacity", "0.5");

  // glass outline
  const outline = document.createElementNS(svgNS, "path");
  outline.setAttribute("d", d);
  outline.setAttribute("class", "outline");

  svg.append(base, hatch, outline);

  // step ring (16 tiny squares)
  const ring = document.createElement("div");
  ring.className = "ring";
  const W = 112,
    R = Math.min((W * 0.66) / 2, 42),
    cx = 42,
    cy = 42;
  const dots = [];
  for (let i = 0; i < state.stepCount; i++) {
    const ang = (i / state.stepCount) * Math.PI * 2 - Math.PI / 2;
    const dot = document.createElement("div");
    dot.className = "step";
    dot.style.left = cx + R * Math.cos(ang) + "px";
    dot.style.top = cy + R * Math.sin(ang) + "px";
    dot.title = "toggle step";
    dot.addEventListener("click", () => {
      bottle.steps[i] = !bottle.steps[i];
      dot.classList.toggle("active", bottle.steps[i]);
    });
    ring.appendChild(dot);
    dots.push(dot);
  }

  el.append(neck, svg, ring);
  stage.appendChild(el);
  // small label chip (shows when selected)
  const chip = document.createElement("div");
  chip.className = "chip";
  el.appendChild(chip);
  bottle.chip = chip;

  // attach refs
  bottle.el = el;
  bottle.neck = neck;
  bottle.svg = svg;
  bottle.base = base;
  bottle.hatch = hatch;
  bottle.outline = outline;
  bottle.ring = ring;
  bottle.dots = dots;

  // initial placement + liquid level
  positionBottle(bottle);
  updateLiquid(bottle);

  // interactions
  bindBottle(bottle);

  state.bottles.push(bottle);
  updateCount();
  return bottle;
}

function positionBottle(b) {
  const r = stage.getBoundingClientRect();
  const left = b.x * r.width - b.el.offsetWidth / 2;
  const top = b.y * r.height - b.el.offsetHeight / 2;
  b.el.style.left = clamp(left, 6, r.width - (b.el.offsetWidth + 6)) + "px";
  b.el.style.top = clamp(top, 6, r.height - (b.el.offsetHeight + 6)) + "px";
}

function updateLiquid(b) {
  const svgH = 240,
    padTop = 24,
    padBottom = 8;
  const h = clamp(b.fill, 0, 1) * (svgH - padTop - padBottom);
  const y = svgH - padBottom - h;
  b.base.setAttribute("y", y);
  b.base.setAttribute("height", h);
  b.hatch.setAttribute("y", y);
  b.hatch.setAttribute("height", h);

  const col = materialColors(b.material);
  b.base.setAttribute("fill", col.base);
  // update hatch line color
  const line = b.svg.querySelector("defs pattern line");
  if (line) line.setAttribute("stroke", col.hatch);

  if (state.selected === b) {
    fillEl.value = b.fill;
    fillVal.textContent = Math.round(b.fill * 100) + "%";
    if (b.chip)
      b.chip.textContent = `${cap(b.material)} • ${Math.round(b.fill * 100)}%`;
  }
}

function bindBottle(b) {
  // select
  b.el.addEventListener("mousedown", () => selectBottle(b));
  b.el.addEventListener("touchstart", () => selectBottle(b));

  // move via neck
  let pid = null,
    sx = 0,
    sy = 0,
    sl = 0,
    st = 0,
    moving = false;
  const down = (e) => {
    if (e.target !== b.neck) return;
    pid = e.pointerId;
    b.neck.setPointerCapture(pid);
    moving = true;
    const r = b.el.getBoundingClientRect(),
      sr = stage.getBoundingClientRect();
    sl = r.left - sr.left;
    st = r.top - sr.top;
    sx = e.clientX;
    sy = e.clientY;
  };
  const move = (e) => {
    if (!moving || pid !== e.pointerId) return;
    const dx = e.clientX - sx,
      dy = e.clientY - sy,
      sr = stage.getBoundingClientRect();
    let L = clamp(sl + dx, 6, sr.width - (b.el.offsetWidth + 6));
    let T = clamp(st + dy, 6, sr.height - (b.el.offsetHeight + 6));
    b.el.style.left = L + "px";
    b.el.style.top = T + "px";
    b.x = (L + b.el.offsetWidth / 2) / sr.width;
    b.y = (T + b.el.offsetHeight / 2) / sr.height;
  };
  const up = (e) => {
    if (pid !== e.pointerId) return;
    moving = false;
    pid = null;
    positionBottle(b);
  };
  b.neck.addEventListener("pointerdown", down);
  b.neck.addEventListener("pointermove", move);
  b.neck.addEventListener("pointerup", up);
  b.neck.addEventListener("pointercancel", up);

  // tune via vertical drag on svg
  let tid = null,
    lastY = 0;
  const sdown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    tid = e.pointerId;
    b.svg.setPointerCapture(tid);
    lastY = e.clientY;
  };
  const smove = (e) => {
    if (tid !== e.pointerId) return;
    const dy = e.clientY - lastY;
    b.fill = clamp(b.fill - dy / 300, 0, 1);
    updateLiquid(b);
    lastY = e.clientY;
  };
  const sup = (e) => {
    if (tid !== e.pointerId) return;
    tid = null;
  };
  b.svg.addEventListener("pointerdown", sdown);
  b.svg.addEventListener("pointermove", smove);
  b.svg.addEventListener("pointerup", sup);
  b.svg.addEventListener("pointercancel", sup);

  // click to audition
  b.svg.addEventListener("click", () => {
    if (!state.audioReady) return;
    trigger(b.synth, b.material, freqFromFill(b.fill, state.scale));
  });
}

// selection & inspector
function selectBottle(b) {
  if (state.selected) {
    state.selected.el.classList.remove("selected");
  }
  state.selected = b;
  if (!b) {
    insp.hidden = true;
    return;
  }
  b.el.classList.add("selected");
  insp.hidden = false;
  selText.textContent = `${b.id} • ${b.material}`;
  fillEl.value = b.fill;
  fillVal.textContent = Math.round(b.fill * 100) + "%";
  document
    .querySelectorAll('input[name="mat"]')
    .forEach((x) => (x.checked = x.value === b.material));
}
stage.addEventListener("mousedown", (e) => {
  if (e.target === stage) selectBottle(null);
});

document.getElementById("inspector").addEventListener("change", (e) => {
  if (!state.selected) return;
  const t = e.target;
  if (t.name === "mat") {
    state.selected.material = t.value;
    state.selected.synth.dispose();
    state.selected.synth = makeSynth(t.value);
    updateLiquid(state.selected);
  }
});
fillEl.addEventListener("input", (e) => {
  if (!state.selected) return;
  state.selected.fill = parseFloat(e.target.value);
  fillVal.textContent = Math.round(state.selected.fill * 100) + "%";
  updateLiquid(state.selected);
});
seedBtn.addEventListener("click", () => {
  if (!state.selected) return;
  for (let i = 0; i < state.stepCount; i++)
    state.selected.steps[i] = i % 4 === 0;
  rebuildRing(state.selected);
});
clearBtn.addEventListener("click", () => {
  if (!state.selected) return;
  state.selected.steps.fill(false);
  rebuildRing(state.selected);
});
delBtn.addEventListener("click", () => {
  if (!state.selected) return;
  state.selected.synth.dispose();
  state.selected.el.remove();
  state.bottles = state.bottles.filter((x) => x !== state.selected);
  selectBottle(null);
  updateCount();
});

function rebuildRing(b) {
  const W = 112,
    R = Math.min((W * 0.66) / 2, 42),
    cx = 42,
    cy = 42;
  b.ring.innerHTML = "";
  b.dots = [];
  for (let i = 0; i < state.stepCount; i++) {
    const ang = (i / state.stepCount) * Math.PI * 2 - Math.PI / 2;
    const dot = document.createElement("div");
    dot.className = "step";
    dot.style.left = cx + R * Math.cos(ang) + "px";
    dot.style.top = cy + R * Math.sin(ang) + "px";
    if (b.steps[i]) dot.classList.add("active");
    dot.addEventListener("click", () => {
      b.steps[i] = !b.steps[i];
      dot.classList.toggle("active", b.steps[i]);
    });
    b.ring.appendChild(dot);
    b.dots.push(dot);
  }
}

// app controls & transport
function updateCount() {
  countEl.textContent = state.bottles.length;
}
addBtn.addEventListener("click", () => {
  if (state.bottles.length >= 7) return;
  const mats = ["water", "rice", "beads", "sand"];
  const b = createBottle({
    material: mats[Math.floor(Math.random() * mats.length)],
    fill: Math.random() * 0.7 + 0.15,
  });
  selectBottle(b);
});

enableBtn.addEventListener("click", async () => {
  if (state.audioReady) return;
  await Tone.start();
  state.audioReady = true;
  enableBtn.disabled = true;
  enableBtn.textContent = "Sound Ready";
});

playBtn.addEventListener("click", async () => {
  if (!state.audioReady) {
    await Tone.start();
    state.audioReady = true;
    enableBtn.disabled = true;
    enableBtn.textContent = "Sound Ready";
  }
  if (state.playing) {
    Tone.Transport.stop();
    state.playing = false;
    playBtn.textContent = "▶ Play";
  } else {
    Tone.Transport.start("+0.05");
    state.playing = true;
    playBtn.textContent = "⏸ Stop";
  }
});

bpmEl.addEventListener("input", (e) => {
  state.bpm = parseInt(e.target.value || "96", 10);
  Tone.Transport.bpm.rampTo(state.bpm, 0.1);
});
scaleSel.addEventListener("change", (e) => {
  state.scale = e.target.value;
});

Tone.Transport.bpm.value = state.bpm;
Tone.Transport.scheduleRepeat((time) => {
  state.stepIndex = (state.stepIndex + 1) % state.stepCount;
  state.bottles.forEach((b) => {
    if (b.steps[state.stepIndex]) {
      const f = freqFromFill(b.fill, state.scale);
      trigger(b.synth, b.material, f, time);
    }
    if (b.dots) {
      b.dots.forEach((d, i) =>
        d.classList.toggle("play", i === state.stepIndex)
      );
    }
  });
  if (state.stepIndex % 4 === 0) {
    beatDot.classList.add("on");
    setTimeout(() => beatDot.classList.remove("on"), 100);
  }
}, "16n");

// seed minimal scene (1–2 bottles, same size)
function seed() {
  createBottle({ material: "water", fill: 0.45, x: 0.35, y: 0.66 });
  createBottle({ material: "beads", fill: 0.65, x: 0.65, y: 0.58 });
}
seed();
updateCount();

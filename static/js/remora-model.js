// Remora page: the prototype in 3D. Rotate, cut a cross-section, explode the parts, power it
// on, or watch it follow the beacon. Designed parts are the real CAD (printed in nylon); bought
// parts are stand-ins at their real size and position. The model (~0.5 MB) loads only when
// the figure comes near the screen. Uses three.js r128, self-hosted in static/js/vendor/.

import { animate, cssVar, onThemeChange, reducedMotion } from "./util.js";

const root = document.querySelector("[data-model]");
if (root && window.THREE && THREE.OrbitControls) {
  new IntersectionObserver((entries, obs) => {
    if (entries[0].isIntersecting) {
      obs.disconnect();
      load(root);
    }
  }, { rootMargin: "300px" }).observe(root);
}

async function load(root) {
  const status = root.querySelector("[data-status]");
  const texts = JSON.parse(root.dataset.texts);
  let data;
  try {
    data = await (await fetch(root.dataset.src)).json();
  } catch (e) {
    status.textContent = texts.failed;
    return;
  }
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    status.textContent = texts.nowebgl;
    return;
  }
  status.textContent = texts.hint;
  start(root, data, renderer, texts, status);
}

function decode(s, Type) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Type(u8.buffer);
}

function start(root, data, renderer, texts, status) {
  const box = root.querySelector(".canvas-box");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  box.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", texts.aria);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 6000);
  camera.up.set(0, 0, 1);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b645c, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 0.75);
  key.position.set(180, -220, 320);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(-220, 160, 120);
  scene.add(fill);

  const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  const aircraft = new THREE.Group();
  const beacon = new THREE.Group();
  scene.add(aircraft, beacon);
  const parts = [];

  for (const p of data.parts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(decode(p.v, Float32Array), 3));
    g.setIndex(new THREE.BufferAttribute(decode(p.i, Uint32Array), 1));
    g.computeVertexNormals();
    g.computeBoundingBox();
    const designed = p.group === "Designed" || p.id === "bcase" || p.id === "blid";
    const metal = p.id.startsWith("motor");
    const mat = new THREE.MeshStandardMaterial({ roughness: metal ? 0.35 : 0.7, metalness: metal ? 0.6 : 0.04 });
    const cutMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
    const mesh = new THREE.Mesh(g, mat);
    const cut = new THREE.Mesh(g, cutMat);
    cut.visible = false;
    const holder = new THREE.Group();
    const pivot = new THREE.Group();
    if (p.spin) {
      pivot.position.set(p.spin[0], p.spin[1], 0);
      mesh.position.set(-p.spin[0], -p.spin[1], 0);
      cut.position.copy(mesh.position);
    }
    pivot.add(mesh, cut);
    holder.add(pivot);
    (p.group === "Beacon" ? beacon : aircraft).add(holder);
    const rec = { p, designed, mesh, cut, holder, pivot, mat, cutMat, on: true };
    mesh.userData.rec = rec;
    parts.push(rec);
  }

  // colours from the page palette: designed parts in the accent, bought parts in neutrals
  function paint() {
    renderer.setClearColor(new THREE.Color(cssVar("--surface")));
    const accent = new THREE.Color(cssVar("--accent"));
    for (const r of parts) {
      const c = r.designed ? accent.clone() : new THREE.Color(r.p.color);
      if (r.designed && (r.p.id === "guard" || r.p.id === "blid")) c.offsetHSL(0, -0.05, 0.12);
      if (!r.designed) c.lerp(new THREE.Color(cssVar("--muted")), 0.35);
      r.mat.color.copy(c);
      r.cutMat.color.set(cssVar("--ink"));
    }
  }
  paint();
  onThemeChange(paint);

  const state = { explode: 0, section: "off", pos: 0.5, power: false, demo: false, xray: false, show: "all", selected: null };

  function bounds() {
    const b = new THREE.Box3();
    for (const r of parts) {
      if (!r.on) continue;
      r.mesh.updateWorldMatrix(true, false);
      b.union(r.mesh.geometry.boundingBox.clone().applyMatrix4(r.mesh.matrixWorld));
    }
    return b;
  }

  let lastSig = "";
  function refresh() {
    for (const r of parts) {
      r.on = state.show === "all" || (state.show === "designed" && r.designed) ||
        (state.show === "aircraft" && r.p.group !== "Beacon") || (state.show === "beacon" && r.p.group === "Beacon");
      r.holder.visible = r.on;
      const e = r.p.explode;
      r.holder.position.set(e[0] * state.explode, e[1] * state.explode, e[2] * state.explode);
    }
    const on = state.section !== "off";
    if (on) {
      const b = bounds();
      const idx = { x: 0, y: 1, z: 2 }[state.section];
      const lo = b.min.getComponent(idx);
      const hi = b.max.getComponent(idx);
      const n = new THREE.Vector3();
      n.setComponent(idx, -1);
      plane.normal.copy(n);
      plane.constant = lo + (hi - lo) * state.pos;
    }
    for (const r of parts) r.cut.visible = on && r.on && !state.xray;
    const sig = [on, state.xray, state.selected ? state.selected.p.id : ""].join("|");
    if (sig !== lastSig) {
      lastSig = sig;
      for (const r of parts) {
        const sel = state.selected === r;
        r.mat.clippingPlanes = on ? [plane] : null;
        r.cutMat.clippingPlanes = on ? [plane] : null;
        r.mat.transparent = state.xray && !sel;
        r.mat.opacity = state.xray && !sel ? 0.2 : 1;
        r.mat.depthWrite = !(state.xray && !sel);
        r.mat.emissive.set(sel ? 0xffffff : 0x000000);
        r.mat.emissiveIntensity = sel ? 0.18 : 0;
        r.mat.needsUpdate = true;
        r.cutMat.needsUpdate = true;
      }
    }
  }

  const views = { iso: [1.1, -1.35, 0.95], top: [-0.03, 0, 1], front: [1, 0, 0.12], side: [0, -1, 0.12] };
  let view = "iso";
  function fit() {
    const b = bounds();
    if (b.isEmpty()) return;
    const center = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3()).length();
    const d = views[view];
    const dir = new THREE.Vector3(d[0], d[1], d[2]).normalize();
    const dist = (size / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * 0.92;
    camera.position.copy(center).addScaledVector(dir, dist);
    controls.target.copy(center);
    controls.update();
  }

  // controls
  const seg = (name, fn) => {
    const buttons = root.querySelectorAll(`[data-${name}] button`);
    buttons.forEach((b) => b.addEventListener("click", () => {
      buttons.forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      fn(b.value);
    }));
  };
  const toggle = (name, fn) => {
    const b = root.querySelector(`[data-toggle=${name}]`);
    b.addEventListener("click", () => {
      const v = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(v));
      fn(v);
    });
    return b;
  };
  seg("view", (v) => { view = v; fit(); });
  seg("show", (v) => { state.show = v; state.selected = null; refresh(); fit(); readout(null); });
  seg("section", (v) => { state.section = v; secInput.disabled = v === "off"; refresh(); });
  const powerBtn = toggle("power", (v) => { state.power = v; if (!v && state.demo) demoBtn.click(); });
  const demoBtn = toggle("demo", (v) => {
    state.demo = v;
    if (v && !state.power) powerBtn.click();
    if (!v) { aircraft.position.set(0, 0, 0); aircraft.rotation.z = 0; beacon.position.set(0, 0, 0); vel.set(0, 0, 0); }
  });
  toggle("xray", (v) => { state.xray = v; refresh(); });
  const expInput = root.querySelector("input[name=explode]");
  const secInput = root.querySelector("input[name=section]");
  expInput.addEventListener("input", () => { state.explode = expInput.value / 100; refresh(); });
  secInput.addEventListener("input", () => { state.pos = secInput.value / 100; refresh(); });

  // click a part to read what it is
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    let hits = ray.intersectObjects(parts.filter((r) => r.on).map((r) => r.mesh), false);
    if (state.section !== "off") hits = hits.filter((h) => plane.distanceToPoint(h.point) >= 0);
    const rec = hits.length ? hits[0].object.userData.rec : null;
    state.selected = state.selected === rec ? null : rec;
    readout(state.selected);
    refresh();
  });
  function readout(r) {
    if (!r) { status.textContent = texts.hint; return; }
    const names = texts.parts[r.p.id] || r.p.name;
    const kind = r.designed ? texts.designed : texts.bought;
    status.textContent = `${names} · ${kind} · ${r.p.mass_g.toFixed(1)} g`;
  }

  function resize() {
    const w = box.clientWidth;
    const h = Math.round(Math.max(340, Math.min(620, w * 0.62)));
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(box);
  resize();
  refresh();
  fit();

  // power, follow demo and render loop (only while the figure is on screen)
  const vel = new THREE.Vector3();
  let t = 0;
  animate(root, (dt) => {
    t += dt;
    if (state.power) {
      const w = reducedMotion.matches ? 4 : 28;
      for (const r of parts) if (r.p.spin) r.pivot.rotation.z += r.p.spin[2] * w * dt;
      if (!state.demo) aircraft.position.z = 1.5 * Math.sin(t * 2.2);
    } else if (!state.demo) {
      aircraft.position.z = 0;
    }
    if (state.demo) {
      // the beacon walks a smooth loop; the aircraft holds its offset with a critically damped
      // spring and turns to face it, which is what the follow controller asks of the autopilot
      const bx = 260 * Math.sin(t * 0.35);
      const by = 160 * Math.sin(t * 0.7);
      beacon.position.set(bx, by, 0);
      const k = 4;
      const acc = new THREE.Vector3(bx, by, 6).sub(aircraft.position).multiplyScalar(k).addScaledVector(vel, -2 * Math.sqrt(k));
      vel.addScaledVector(acc, dt);
      aircraft.position.addScaledVector(vel, dt);
      const yaw = Math.atan2(by - 175 - aircraft.position.y, bx - aircraft.position.x);
      const d = Math.atan2(Math.sin(yaw - aircraft.rotation.z), Math.cos(yaw - aircraft.rotation.z));
      aircraft.rotation.z += d * Math.min(1, 3 * dt);
    }
    controls.update();
    renderer.render(scene, camera);
  });
}

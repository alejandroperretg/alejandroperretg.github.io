// Remora page: the prototype in 3D. Rotate, cut a cross-section, explode the parts, power it
// on, or watch it follow the beacon. Designed parts are the real CAD (printed in nylon); bought
// parts are detailed stand-ins at their published size. Rendered with physically based
// materials, a studio environment and soft shadows. The model (~2 MB) loads only when the
// figure comes near the screen. Uses three.js r128, self-hosted in static/js/vendor/.

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

function geometry(m, q) {
  const raw = decode(m.v, Int16Array);
  const pos = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) pos[i] = raw[i] * q;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(decode(m.i, m.i32 ? Uint32Array : Uint16Array), 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

// A soft studio: a dim room with a few broad light panels, prefiltered for reflections
function studio(renderer) {
  const room = new THREE.Scene();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const walls = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x5c5853, side: THREE.BackSide }));
  walls.scale.set(30, 30, 18);
  walls.position.z = 6;
  room.add(walls);
  const panel = (x, y, z, sx, sy, sz, k) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k) }));
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    room.add(m);
  };
  panel(0, 0, 14.5, 14, 10, 0.2, 2.2);    // overhead softbox
  panel(-13, 6, 6, 0.2, 9, 6, 1.1);       // left strip
  panel(12, -9, 5, 0.2, 7, 7, 1.5);       // key side
  panel(4, 13, 4, 10, 0.2, 4, 0.8);       // back fill
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, 0.035).texture;
  pmrem.dispose();
  return env;
}

function start(root, data, renderer, texts, status) {
  const box = root.querySelector(".canvas-box");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  box.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", texts.aria);

  const scene = new THREE.Scene();
  scene.environment = studio(renderer);
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 6000);
  camera.up.set(0, 0, 1);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(160, -120, 420);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.6;
  scene.add(key, key.target);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8178, 0.25));

  const groundMat = new THREE.ShadowMaterial({ opacity: 0.18 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), groundMat);
  ground.receiveShadow = true;
  ground.position.z = data.ground_z;
  scene.add(ground);

  const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  const aircraft = new THREE.Group();
  const beacon = new THREE.Group();
  scene.add(aircraft, beacon);
  const parts = [];
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  for (const p of data.parts) {
    const holder = new THREE.Group();
    const pivot = new THREE.Group();
    if (p.spin) pivot.position.set(p.spin[0], p.spin[1], 0);
    const rec = { p, designed: p.designed, meshes: [], cuts: [], holder, pivot, on: true };
    for (const m of p.meshes) {
      const g = geometry(m, data.q);
      const spec = data.materials[m.m];
      const mat = new THREE.MeshPhysicalMaterial({
        color: lin(spec.color), roughness: spec.rough, metalness: spec.metal,
        clearcoat: spec.clear || 0, clearcoatRoughness: 0.35, clipShadows: true, clippingPlanes: [],
      });
      mat.userData.opacity = spec.opacity || 1;
      if (mat.userData.opacity < 1) { mat.transparent = true; mat.opacity = mat.userData.opacity; }
      mat.userData.key = m.m;
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const cut = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
      cut.visible = false;
      if (p.spin) { mesh.position.set(-p.spin[0], -p.spin[1], 0); cut.position.copy(mesh.position); }
      mesh.userData.rec = rec;
      pivot.add(mesh, cut);
      rec.meshes.push(mesh);
      rec.cuts.push(cut);
    }
    holder.add(pivot);
    (p.group === "Beacon" ? beacon : aircraft).add(holder);
    parts.push(rec);
  }

  // colours from the page palette: designed parts in the accent, cut faces a lighter accent
  function paint() {
    renderer.setClearColor(new THREE.Color(cssVar("--surface")));
    const dark = new THREE.Color(cssVar("--surface")).getHSL({}).l < 0.4;
    groundMat.opacity = dark ? 0.42 : 0.2;
    const accent = lin(cssVar("--accent"));
    const cap = new THREE.Color(cssVar("--accent")).lerp(new THREE.Color(dark ? "#000000" : "#ffffff"), 0.3);
    for (const r of parts) {
      for (const mesh of r.meshes) {
        if (r.designed && mesh.material.userData.key === "printed") {
          const c = accent.clone();
          if (r.p.id === "guard" || r.p.id === "blid") c.offsetHSL(0, -0.04, 0.06);
          mesh.material.color.copy(c);
          mesh.material.roughness = 0.58;
          mesh.material.clearcoat = 0.08;
        }
      }
      for (const cut of r.cuts) cut.material.color.copy(cap);
    }
  }
  paint();
  onThemeChange(paint);

  const state = { explode: 0, section: "off", pos: 0.5, power: false, demo: false, xray: false, show: "all", selected: null };

  function bounds() {
    const b = new THREE.Box3();
    for (const r of parts) {
      if (!r.on) continue;
      for (const m of r.meshes) {
        m.updateWorldMatrix(true, false);
        b.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld));
      }
    }
    return b;
  }

  function fitShadow(b) {
    const c = b.getCenter(new THREE.Vector3());
    const r = b.getSize(new THREE.Vector3()).length() * 0.6 + 40;
    key.target.position.copy(c);
    key.position.copy(c).add(new THREE.Vector3(160, -120, 420));
    const cam = key.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 10; cam.far = 1200;
    cam.updateProjectionMatrix();
    ground.position.z = Math.min(data.ground_z, b.min.z - 0.5);
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
    const b = bounds();
    if (on) {
      const idx = { x: 0, y: 1, z: 2 }[state.section];
      const lo = b.min.getComponent(idx);
      const hi = b.max.getComponent(idx);
      const n = new THREE.Vector3();
      n.setComponent(idx, -1);
      plane.normal.copy(n);
      plane.constant = lo + (hi - lo) * state.pos;
    }
    if (!b.isEmpty()) fitShadow(b);
    for (const r of parts) for (const c of r.cuts) c.visible = on && r.on && !state.xray;
    const sig = [on, state.xray, state.selected ? state.selected.p.id : ""].join("|");
    if (sig !== lastSig) {
      lastSig = sig;
      for (const r of parts) {
        const sel = state.selected === r;
        const ghost = state.xray && !sel;
        for (const m of r.meshes) {
          const mat = m.material;
          mat.clippingPlanes = on ? [plane] : [];  // r128 needs an array when clipShadows is on
          mat.transparent = ghost || mat.userData.opacity < 1;
          mat.opacity = ghost ? 0.16 : mat.userData.opacity;
          mat.depthWrite = !ghost;
          mat.emissive.set(sel ? 0xffffff : 0x000000);
          mat.emissiveIntensity = sel ? 0.16 : 0;
          m.castShadow = !ghost;
          mat.needsUpdate = true;
        }
        for (const c of r.cuts) {
          c.material.clippingPlanes = on ? [plane] : [];
          c.material.needsUpdate = true;
        }
      }
    }
  }

  const views = { iso: [1.15, -1.3, 0.8], top: [-0.03, 0, 1], front: [1, 0, 0.1], side: [0, -1, 0.1] };
  let view = "iso";
  function fit() {
    const b = bounds();
    if (b.isEmpty()) return;
    const center = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3()).length();
    const d = views[view];
    const dir = new THREE.Vector3(d[0], d[1], d[2]).normalize();
    const dist = (size / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * 0.78;
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
    let hits = ray.intersectObjects(parts.filter((r) => r.on).flatMap((r) => r.meshes), false);
    if (state.section !== "off") hits = hits.filter((h) => plane.distanceToPoint(h.point) >= 0);
    const rec = hits.length ? hits[0].object.userData.rec : null;
    state.selected = state.selected === rec ? null : rec;
    readout(state.selected);
    refresh();
  });
  function readout(r) {
    if (!r) { status.textContent = texts.hint; return; }
    const id = r.p.id.replace(/\d+$/, "");
    const name = texts.parts[r.p.id] || texts.parts[id] || r.p.name;
    const kind = r.designed ? texts.designed : texts.bought;
    status.textContent = `${name} · ${kind} · ${r.p.mass_g.toFixed(1)} g`;
  }

  function resize() {
    const w = box.clientWidth;
    const h = Math.round(Math.max(340, Math.min(640, w * 0.64)));
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(box);
  resize();
  refresh();
  fit();
  root.dataset.ready = "true";

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

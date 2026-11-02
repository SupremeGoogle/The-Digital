// Небольшая живая витрина: матовые задачи на мягких цветных платформах.
// Кубы можно перетаскивать между этажами, клик открывает карточку задачи.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as store from './store.js';

const LANES = [
  { status: 'todo', x: -3.4, color: '#79adf0', label: 'Планы' },
  { status: 'doing', x: 0, color: '#f2cf74', label: 'В работе' },
  { status: 'done', x: 3.4, color: '#80ccb2', label: 'Готово' },
];
const TAG_COLORS = { work: '#6c9fe7', home: '#82c9b3', study: '#edbf69', urgent: '#e49ca9' };
const DONE_COLOR = '#80ccb2';
const HEIGHT = { low: 0.75, med: 1.05, high: 1.4 };
const FLOOR_W = 2.9;
const FLOOR_D = 4.8;

const CAMERAS = {
  overview: { pos: [0, 5.4, 8.6], target: [0, 0.5, 0.2] },
  top: { pos: [0, 12.5, 3], target: [0, 0, 0] },
  front: { pos: [0, 2.2, 10.5], target: [0, 1, 0] },
  side: { pos: [10.5, 4.2, 4.5], target: [0, 0.6, 0] },
};

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Сияющий цвет: значения выше 1 проходят порог bloom
const glow = (hex) => new THREE.Color(hex);

export function createScene(host, { onOpen, onHover }) {
  const canvasWrap = host.querySelector('.scene-canvas');
  const tooltip = host.querySelector('.scene-tip');
  const labelsLayer = document.createElement('div');
  labelsLayer.className = 'scene-labels';
  labelsLayer.setAttribute('aria-hidden', 'true');
  labelsLayer.style.pointerEvents = 'none';
  canvasWrap.appendChild(labelsLayer);
  let labelsNeedMeasure = true;
  let labelsExpanded = host.classList.contains('is-expanded');
  let viewportWidth = 1;
  let viewportHeight = 1;

  // ---------- рендер ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasWrap.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e7f3ff');
  scene.fog = new THREE.Fog('#e7f3ff', 18, 38);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(...CAMERAS.overview.pos);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...CAMERAS.overview.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  // Колесо прокручивает страницу, а не зумит: приближение — кнопками камеры
  controls.enableZoom = false;
  // На телефоне один палец листает страницу, вращение — двумя
  if (matchMedia('(pointer: coarse)').matches) {
    controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    renderer.domElement.style.touchAction = 'pan-y';
  }
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 0.35;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());

  // ---------- свет ----------
  scene.add(new THREE.HemisphereLight('#ffffff', '#adbed6', 1.25));
  const key = new THREE.DirectionalLight('#fff9ee', 2);
  key.position.set(-4, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 8, bottom: -8, near: 0.1, far: 30 });
  key.shadow.normalBias = 0.04;
  key.shadow.bias = -0.0002;
  key.shadow.radius = 4;
  scene.add(key);
  const rimA = new THREE.PointLight('#b9d9ff', 2, 12);
  rimA.position.set(-7, 4, -5);
  const rimB = new THREE.PointLight('#ffe7ac', 2, 12);
  rimB.position.set(7, 4, -5);
  scene.add(rimA, rimB);

  // ---------- окружение ----------
  let dust;
  scene.add(makeGround());
  scene.add(makeDust());

  // ---------- этажи ----------
  const lanes = LANES.map((lane) => makeLane(lane));
  lanes.forEach((l) => scene.add(l.group));

  // Провода между этажами: поток слева направо
  const laneFlows = [makeFlow(lanes[0], lanes[1]), makeFlow(lanes[1], lanes[2])];
  laneFlows.forEach((f) => scene.add(f.group));

  // ---------- задачи ----------
  const nodes = new Map(); // id → node
  let firstLayout = true;
  const nodeGroup = new THREE.Group();
  scene.add(nodeGroup);
  const wires = new THREE.Group();
  scene.add(wires);
  const bursts = [];

  const geo = {
    cube: new RoundedBoxGeometry(0.62, 0.62, 0.62, 5, 0.13),
    core: new THREE.IcosahedronGeometry(0.15, 3),
    shell: new THREE.IcosahedronGeometry(0.26, 1),
    beam: new THREE.CylinderGeometry(0.012, 0.012, 1, 6, 1, true),
    spot: new THREE.RingGeometry(0.2, 0.3, 40),
    dot: new THREE.SphereGeometry(0.035, 10, 8),
    halo: new THREE.TorusGeometry(0.5, 0.012, 8, 64),
  };
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#8ab8ee', metalness: 0, roughness: 0.72,
    clearcoat: 0.12, clearcoatRoughness: 0.7,
  });

  function makeNode(task) {
    const group = new THREE.Group();
    group.userData.id = task.id;
    const label = document.createElement('span');
    label.className = 'scene-node-label';
    label.dataset.id = task.id;
    label.hidden = true;
    labelsLayer.appendChild(label);
    labelsNeedMeasure = true;

    const cube = new THREE.Mesh(geo.cube, glassMat.clone());
    cube.userData.id = task.id;
    cube.castShadow = true;
    cube.receiveShadow = true;
    group.add(cube);

    // Рельефная пиктограмма вращается вместе с самой задачей.
    const face = new THREE.Group();
    const ink = new THREE.MeshStandardMaterial({ color: '#f8fcff', roughness: 0.8 });
    for (let i = 0; i < 3; i++) {
      const line = new THREE.Mesh(new RoundedBoxGeometry(0.3 - i * 0.04, 0.045, 0.035, 3, 0.015), ink);
      line.position.set(0, 0.1 - i * 0.1, 0.305);
      face.add(line);
    }
    cube.add(face);

    const coreMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const core = new THREE.Mesh(geo.core, coreMat);
    group.add(core);
    core.visible = false;

    const shellMat = new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.35, toneMapped: false });
    const shell = new THREE.Mesh(geo.shell, shellMat);
    group.add(shell);
    shell.visible = false;

    // Приоритет: число спутников вокруг куба
    const sats = new THREE.Group();
    group.add(sats);

    const halo = new THREE.Mesh(geo.halo, new THREE.MeshStandardMaterial({ color: '#efc454', roughness: 0.6 }));
    halo.rotation.x = Math.PI / 2;
    group.add(halo);

    const beamMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const beam = new THREE.Mesh(geo.beam, beamMat);
    scene.add(beam);

    const spotMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const spot = new THREE.Mesh(geo.spot, spotMat);
    spot.rotation.x = -Math.PI / 2;
    scene.add(spot);

    const node = {
      id: task.id, group, cube, core, shell, sats, halo, beam, spot, face, label,
      labelWidth: 76, labelHeight: 18,
      target: new THREE.Vector3(), phase: Math.random() * Math.PI * 2,
      scale: 0, hover: 0, dragging: false, removing: false, priority: null, color: null,
    };
    nodeGroup.add(group);
    return node;
  }

  function styleNode(node, task) {
    if (node.label.textContent !== task.text) {
      node.label.textContent = task.text;
      node.label.title = task.text;
      labelsNeedMeasure = true;
    }
    node.label.dataset.status = task.status;
    const color = task.status === 'done' ? DONE_COLOR : TAG_COLORS[task.tag];
    if (node.color !== color) {
      node.color = color;
      node.core.material.color.copy(glow(color, 2.6));
      node.shell.material.color.copy(glow(color, 1.6));
      node.beam.material.color.copy(glow(color, 1.4));
      node.spot.material.color.copy(glow(color, 1.6));
      node.cube.material.color.set(color);
      node.cube.material.attenuationColor = new THREE.Color(color);
    }
    if (node.priority !== task.priority) {
      node.priority = task.priority;
      node.sats.clear();
      const count = { low: 1, med: 2, high: 3 }[task.priority];
      for (let i = 0; i < count; i++) {
        const dot = new THREE.Mesh(geo.dot, new THREE.MeshStandardMaterial({ color: '#f1c864', roughness: 0.6 }));
        dot.userData.angle = (i / count) * Math.PI * 2;
        node.sats.add(dot);
      }
    }
    node.halo.visible = task.priority === 'high' && task.status !== 'done';
    node.done = task.status === 'done';
  }

  function layout() {
    const tasks = store.all();
    const seen = new Set();
    LANES.forEach((lane, li) => {
      const list = tasks.filter((t) => t.status === lane.status);
      lanes[li].count = list.length;
      list.forEach((task, i) => {
        seen.add(task.id);
        let node = nodes.get(task.id);
        const fresh = !node;
        if (!node) {
          node = makeNode(task);
          nodes.set(task.id, node);
          // Новые задачи вылетают из пола своего этажа, а при первой загрузке сразу стоят на местах
          node.group.position.set(lane.x, -0.6, 0);
        }
        styleNode(node, task);
        node.removing = false;
        const col = i % 2;
        const row = Math.floor(i / 2) % 4;
        const layer = Math.floor(i / 8);
        // Ряды центрируются на этаже, у переднего края остаётся место для подписи
        const rows = Math.ceil(Math.min(list.length - layer * 8, 8) / 2);
        const z0 = -0.35 - ((rows - 1) * 1.12) / 2;
        const base = task.status === 'done' ? 0.62 : HEIGHT[task.priority];
        node.target.set(lane.x + (col - 0.5) * 1.18, base + layer * 0.95, z0 + row * 1.12);
        node.order = i;
        node.lane = li;
        if (fresh && firstLayout) {
          node.group.position.copy(node.target);
          node.scale = task.status === 'done' ? 0.86 : 1;
        }
      });
    });
    nodes.forEach((node, id) => {
      if (!seen.has(id) && !node.removing) {
        node.removing = true;
        node.label.hidden = true;
      }
    });
    firstLayout = false;
  }

  function disposeNode(node) {
    node.label.remove();
    nodeGroup.remove(node.group);
    scene.remove(node.beam, node.spot);
    node.cube.material.dispose();
    node.face.children.forEach((line) => line.geometry.dispose());
    node.face.children[0].material.dispose();
    node.core.material.dispose();
    node.shell.material.dispose();
    node.beam.material.dispose();
    node.spot.material.dispose();
    node.halo.material.dispose();
    node.sats.children.forEach((d) => d.material.dispose());
    nodes.delete(node.id);
  }

  // ---------- провода между задачами одного этажа ----------
  const wirePool = [];
  function updateWires(t) {
    const byLane = [[], [], []];
    nodes.forEach((n) => !n.removing && byLane[n.lane]?.push(n));
    let w = 0;
    byLane.forEach((list, li) => {
      list.sort((a, b) => a.order - b.order);
      for (let i = 0; i < list.length - 1; i++) {
        const wire = wirePool[w] || (wirePool[w] = makeWire());
        const a = list[i].group.position;
        const b = list[i + 1].group.position;
        wire.curve.v0.copy(a);
        wire.curve.v2.copy(b);
        wire.curve.v1.copy(a).add(b).multiplyScalar(0.5).setY(Math.max(a.y, b.y) + 0.45);
        const pts = wire.curve.getPoints(23);
        wire.line.geometry.setFromPoints(pts);
        wire.line.material.color.copy(glow(LANES[li].color, 1.1));
        wire.pulse.material.color.copy(glow(LANES[li].color, 2.4));
        wire.pulse.position.copy(wire.curve.getPoint((t * 0.35 + i * 0.27) % 1));
        wire.line.visible = wire.pulse.visible = true;
        w++;
      }
    });
    for (; w < wirePool.length; w++) wirePool[w].line.visible = wirePool[w].pulse.visible = false;
  }

  function makeWire() {
    const line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55, toneMapped: false }),
    );
    const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }));
    wires.add(line, pulse);
    return { line, pulse, curve: new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()) };
  }

  // ---------- вспышка при выполнении ----------
  function burst(position, color = DONE_COLOR) {
    if (reduceMotion) return;
    const count = 90;
    const positions = new Float32Array(count * 3);
    const velocities = [];
    const colors = new Float32Array(count * 3);
    const palette = [color, '#2ee6ff', '#9b6bff', '#ff4fa3', '#ff8a3d'].map((c) => glow(c, 2));
    for (let i = 0; i < count; i++) {
      positions.set([position.x, position.y, position.z], i * 3);
      const dir = new THREE.Vector3().randomDirection().multiplyScalar(1.4 + Math.random() * 2.2);
      dir.y = Math.abs(dir.y) * 1.3;
      velocities.push(dir);
      const c = palette[i % palette.length];
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.14, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    scene.add(points);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.36, 64),
      new THREE.MeshBasicMaterial({ color: glow(color, 2), transparent: true, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(position.x, 0.12, position.z);
    scene.add(ring);
    bursts.push({ points, velocities, ring, life: 0 });
  }

  function updateBursts(dt) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.life += dt;
      const pos = b.points.geometry.attributes.position;
      b.velocities.forEach((v, k) => {
        v.y -= 3.2 * dt;
        v.multiplyScalar(0.985);
        pos.setXYZ(k, pos.getX(k) + v.x * dt, pos.getY(k) + v.y * dt, pos.getZ(k) + v.z * dt);
      });
      pos.needsUpdate = true;
      const k = b.life / 1.3;
      b.points.material.opacity = 1 - k;
      b.ring.scale.setScalar(1 + k * 7);
      b.ring.material.opacity = 1 - k;
      if (k >= 1) {
        scene.remove(b.points, b.ring);
        b.points.geometry.dispose();
        b.points.material.dispose();
        b.ring.geometry.dispose();
        b.ring.material.dispose();
        bursts.splice(i, 1);
      }
    }
  }

  // ---------- взаимодействие ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let hovered = null;
  let press = null; // { node, x, y, moved }

  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const cubes = [...nodes.values()].filter((n) => !n.removing).map((n) => n.cube);
    const found = raycaster.intersectObjects(cubes, false)[0];
    return found ? nodes.get(found.object.userData.id) : null;
  }

  function laneAt(x) {
    let best = 0;
    LANES.forEach((l, i) => Math.abs(l.x - x) < Math.abs(LANES[best].x - x) && (best = i));
    return best;
  }

  renderer.domElement.addEventListener('pointerdown', (e) => {
    const node = pick(e);
    if (!node) return;
    press = { node, x: e.clientX, y: e.clientY, moved: false };
    controls.enabled = false;
    renderer.domElement.setPointerCapture(e.pointerId);
  });

  renderer.domElement.addEventListener('pointermove', (e) => {
    if (press) {
      if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) {
        press.moved = true;
        press.node.dragging = true;
        dragPlane.constant = -(press.node.group.position.y + 0.25);
        host.classList.add('is-dragging');
      }
      if (press.moved) {
        pick(e);
        if (raycaster.ray.intersectPlane(dragPlane, hit)) {
          hit.x = THREE.MathUtils.clamp(hit.x, -5.2, 5.2);
          hit.z = THREE.MathUtils.clamp(hit.z, -2.6, 2.6);
          press.node.target.copy(hit);
          const li = laneAt(hit.x);
          lanes.forEach((l, i) => (l.highlight = i === li ? 1 : 0));
        }
      }
      return;
    }
    const node = pick(e);
    if (node !== hovered) {
      hovered = node;
      renderer.domElement.style.cursor = node ? 'grab' : '';
      onHover?.(node?.id || null);
    }
    if (node) showTip(node.id, e);
    else tooltip.hidden = true;
  });

  const release = (e) => {
    if (!press) return;
    const { node, moved } = press;
    press = null;
    controls.enabled = true;
    host.classList.remove('is-dragging');
    lanes.forEach((l) => (l.highlight = 0));
    if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId);
    if (!moved) {
      onOpen?.(node.id);
      return;
    }
    node.dragging = false;
    const status = LANES[laneAt(node.target.x)].status;
    const task = store.get(node.id);
    if (task && task.status !== status) store.move(node.id, status);
    else layout();
  };
  renderer.domElement.addEventListener('pointerup', release);
  renderer.domElement.addEventListener('pointercancel', release);
  renderer.domElement.addEventListener('pointerleave', () => {
    if (!press) {
      tooltip.hidden = true;
      hovered = null;
      onHover?.(null);
    }
  });

  function showTip(id, e) {
    const task = store.get(id);
    if (!task) return;
    const r = host.getBoundingClientRect();
    tooltip.hidden = false;
    tooltip.querySelector('.tip-title').textContent = task.text;
    tooltip.querySelector('.tip-meta').textContent =
      `${store.STATUS_LABELS[task.status]} · ${store.TAGS[task.tag]} · ${store.PRIORITIES[task.priority].toLowerCase()} приоритет`;
    tooltip.style.setProperty('--x', `${e.clientX - r.left}px`);
    tooltip.style.setProperty('--y', `${e.clientY - r.top}px`);
  }

  // Подсветка куба, когда курсор над карточкой в канбане
  let externalHover = null;
  function highlight(id) {
    externalHover = id;
  }

  // ---------- камера ----------
  let camAnim = null;
  function setView(name) {
    const v = CAMERAS[name];
    if (!v) return;
    if (reduceMotion) {
      camera.position.set(...v.pos);
      controls.target.set(...v.target);
      return;
    }
    camAnim = {
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPos: new THREE.Vector3(...v.pos),
      toTarget: new THREE.Vector3(...v.target),
      t: 0,
    };
  }

  function setAutoRotate(on) {
    controls.autoRotate = on;
  }

  // «Повтор»: готовые задачи заново пролетают путь с первого этажа
  function replay() {
    const done = [...nodes.values()].filter((n) => n.done && !n.removing);
    done.forEach((n, i) => {
      n.group.position.set(LANES[0].x, 1.2, n.target.z);
      n.hold = 0.25 + i * 0.22;
    });
    done.forEach((n, i) => setTimeout(() => burst(n.target.clone()), (0.25 + i * 0.22) * 1000 + 650));
  }

  // ---------- кадр ----------
  const clock = new THREE.Clock();
  let running = true;
  let visible = true;

  // DOM-подписи остаются чёткими при любом DPR и размере WebGL-буфера.
  // В цикле меняются только координаты; текст и размеры обновляются при изменениях.
  const labelPoint = new THREE.Vector3();
  function updateLabels() {
    const expanded = host.classList.contains('is-expanded');
    if (expanded !== labelsExpanded) {
      labelsExpanded = expanded;
      labelsNeedMeasure = true;
    }
    const entries = [];
    nodes.forEach((node) => {
      labelPoint.copy(node.group.position);
      labelPoint.y += 0.48 * node.scale;
      labelPoint.project(camera);
      const hidden = node.removing || node.scale < 0.1 ||
        labelPoint.z < -1 || labelPoint.z > 1 ||
        Math.abs(labelPoint.x) > 1 || Math.abs(labelPoint.y) > 1;
      node.label.hidden = hidden;
      if (!hidden) entries.push({
        node,
        x: (labelPoint.x * 0.5 + 0.5) * viewportWidth,
        y: (-labelPoint.y * 0.5 + 0.5) * viewportHeight - 3,
        depth: labelPoint.z,
      });
    });

    // Read all dimensions together, before writing positions; no frame-by-frame reflow.
    if (labelsNeedMeasure) {
      entries.forEach(({ node }) => {
        node.labelWidth = node.label.offsetWidth || (expanded ? 150 : 76);
        node.labelHeight = node.label.offsetHeight || (expanded ? 34 : 18);
      });
      labelsNeedMeasure = false;
    }

    // A stable top-to-bottom pass shifts only colliding labels vertically.
    // Every visible cube keeps its own label, including crowded compact scenes.
    entries.sort((a, b) => a.y - b.y || a.x - b.x || a.node.id.localeCompare(b.node.id));
    const placed = [];
    const padding = 6;
    entries.forEach(({ node, x, y, depth }) => {
      const width = Math.min(node.labelWidth, viewportWidth - padding * 2);
      const height = node.labelHeight;
      const cx = THREE.MathUtils.clamp(x, padding + width / 2, viewportWidth - padding - width / 2);
      const minY = padding + height;
      const maxY = Math.max(minY, viewportHeight - padding);
      const idealY = THREE.MathUtils.clamp(y, minY, maxY);
      const step = height + 3;
      let bestY = idealY;
      let bestScore = Infinity;
      const attempts = Math.ceil(viewportHeight / step);
      for (let offset = 0; offset <= attempts; offset++) {
        const directions = offset ? [-1, 1] : [0];
        for (const direction of directions) {
          const candidateY = idealY + direction * offset * step;
          if (candidateY < minY || candidateY > maxY) continue;
          const left = cx - width / 2;
          const right = cx + width / 2;
          const top = candidateY - height;
          let overlap = 0;
          placed.forEach((other) => {
            const dx = Math.min(right + 2, other.right) - Math.max(left - 2, other.left);
            const dy = Math.min(candidateY + 2, other.bottom) - Math.max(top - 2, other.top);
            if (dx > 0 && dy > 0) overlap += dx * dy;
          });
          const score = overlap * 1000 + Math.abs(candidateY - idealY);
          if (score < bestScore) { bestScore = score; bestY = candidateY; }
          if (!overlap) break;
        }
        if (bestScore <= offset * step) break;
      }
      placed.push({ left: cx - width / 2, right: cx + width / 2, top: bestY - height, bottom: bestY });
      node.label.style.left = `${cx.toFixed(1)}px`;
      node.label.style.top = `${bestY.toFixed(1)}px`;
      node.label.style.zIndex = String(Math.round((1 - depth) * 1000));
    });
  }

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = reduceMotion ? 0 : clock.elapsedTime;

    if (camAnim) {
      camAnim.t = Math.min(camAnim.t + dt / 0.9, 1);
      const k = 1 - Math.pow(1 - camAnim.t, 3);
      camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, k);
      controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, k);
      if (camAnim.t >= 1) camAnim = null;
    }
    controls.update();

    nodes.forEach((n) => {
      if (n.hold > 0) {
        n.hold -= dt;
      } else {
        const bob = n.dragging || reduceMotion ? 0 : Math.sin(t * 1.3 + n.phase) * 0.06;
        const goal = n.target.clone();
        goal.y += bob;
        n.group.position.lerp(goal, 1 - Math.exp(-dt * (n.dragging ? 18 : 5)));
      }
      const isHot = n === hovered || n.id === externalHover || n.dragging;
      n.hover += ((isHot ? 1 : 0) - n.hover) * (1 - Math.exp(-dt * 10));
      const want = n.removing ? 0 : (n.done ? 0.86 : 1) * (1 + n.hover * 0.18);
      n.scale += (want - n.scale) * (1 - Math.exp(-dt * 7));
      n.group.scale.setScalar(Math.max(n.scale, 0.0001));

      n.cube.rotation.y = n.phase + t * (reduceMotion ? 0 : 0.25);
      n.cube.rotation.x = Math.sin(t * 0.6 + n.phase) * 0.12;
      n.shell.rotation.set(t * 0.7, t * 0.9 + n.phase, 0);
      n.core.scale.setScalar(1 + Math.sin(t * 3 + n.phase) * 0.08 + n.hover * 0.25);
      n.halo.rotation.z = t * 1.4;
      n.halo.scale.setScalar(1 + Math.sin(t * 4) * 0.05);
      n.sats.children.forEach((d, i) => {
        const a = d.userData.angle + t * 1.8;
        d.position.set(Math.cos(a) * 0.48, Math.sin(a * 2 + i) * 0.08, Math.sin(a) * 0.48);
      });

      const p = n.group.position;
      const h = Math.max(p.y - 0.1, 0.01);
      n.beam.position.set(p.x, 0.1 + h / 2, p.z);
      n.beam.scale.set(1, h, 1);
      n.beam.material.opacity = 0.12 * n.scale;
      n.spot.position.set(p.x, 0.115, p.z);
      n.spot.scale.setScalar((1 + Math.sin(t * 2.4 + n.phase) * 0.12) * n.scale);
      n.spot.material.opacity = 0.2 * n.scale;

      if (n.removing && n.scale < 0.02) disposeNode(n);
    });

    lanes.forEach((l, i) => {
      l.glowLevel += ((l.highlight ? 1 : 0) - l.glowLevel) * (1 - Math.exp(-dt * 8));
      l.edge.material.color.copy(glow(LANES[i].color, 1.15 + l.glowLevel * 1.6 + Math.sin(t * 1.5 + i) * 0.12));
      l.top.material.opacity = 0.9 + l.glowLevel * 0.1;
      l.scan.position.z = ((t * 0.5 + i * 0.33) % 1) * FLOOR_D - FLOOR_D / 2;
      l.scan.material.opacity = 0.12 + l.glowLevel * 0.25;
    });
    laneFlows.forEach((f, i) => f.update(t, i));
    updateWires(t);
    updateBursts(dt);
    dust.rotation.y = t * 0.02;

    composer.render();
    updateLabels();
  }

  // ---------- размеры и видимость ----------
  function resize() {
    const { width, height } = canvasWrap.getBoundingClientRect();
    if (!width || !height) return;
    viewportWidth = width;
    viewportHeight = height;
    labelsNeedMeasure = true;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    // Горизонтальный угол обзора держим постоянным, чтобы на узком экране влезали все три этажа
    const aspect = width / height;
    camera.fov = Math.max(38, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(33)) / aspect)));
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvasWrap);
  new IntersectionObserver(([entry]) => (visible = entry.isIntersecting)).observe(host);
  resize();

  // ---------- связь со store ----------
  store.subscribe((change) => {
    layout();
    if ((change.type === 'move' || change.type === 'update') && change.to === 'done' && change.from !== 'done') {
      const node = nodes.get(change.ids[0]);
      if (node) setTimeout(() => burst(node.target.clone()), 380);
    }
  });
  layout();
  frame();

  function makeDust() {
    const count = 90;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const palette = ['#2ee6ff', '#9b6bff', '#ff4fa3', '#ff8a3d', '#ffffff'].map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      // Пыль держится дальше камеры, чтобы частицы не раздувались вблизи
      const r = 13 + Math.random() * 12;
      const a = Math.random() * Math.PI * 2;
      pos.set([Math.cos(a) * r, Math.random() * 9 - 1.5, Math.sin(a) * r], i * 3);
      const c = palette[i % palette.length];
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    dust = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.04, map: dotTexture(), vertexColors: true, transparent: true, opacity: 0.12, depthWrite: false,
    }));
    return dust;
  }

  return { setView, setAutoRotate, replay, highlight, burst: (id) => nodes.get(id) && burst(nodes.get(id).target.clone()) };
}

// ---------- сборка частей сцены ----------

function makeGround() {
  const group = new THREE.Group();
  const size = 40;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: '#e7f3ff', roughness: 1 }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -0.15;
  plane.receiveShadow = true;
  group.add(plane);

  // Мягкое пятно света под этажами
  const glowTex = new THREE.CanvasTexture(radialCanvas());
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 10),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.09, depthWrite: false }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = -0.14;
  group.add(pool);
  return group;
}

function makeLane(lane) {
  const group = new THREE.Group();
  group.position.x = lane.x;

  const slab = new THREE.Mesh(
    new RoundedBoxGeometry(FLOOR_W, 0.26, FLOOR_D, 6, 0.12),
    new THREE.MeshPhysicalMaterial({ color: lane.color, metalness: 0, roughness: 0.78, clearcoat: 0.08 }),
  );
  slab.position.y = 0;
  slab.castShadow = true;
  slab.receiveShadow = true;
  group.add(slab);

  // Верх этажа: точечная сетка и подпись
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR_W - 0.08, FLOOR_D - 0.08),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(laneTopCanvas(lane)), transparent: true, opacity: 0.9, depthWrite: false }),
  );
  top.material.map.colorSpace = THREE.SRGBColorSpace;
  top.material.map.anisotropy = 8;
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.135;
  group.add(top);

  // Светящийся контур
  const shape = roundedRect(FLOOR_W / 2, FLOOR_D / 2, 0.16);
  const hole = roundedRect(FLOOR_W / 2 - 0.035, FLOOR_D / 2 - 0.035, 0.13);
  shape.holes.push(hole);
  const edge = new THREE.Mesh(new THREE.ShapeGeometry(shape, 12), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22 }));
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.14;
  group.add(edge);

  // Бегущая линия сканера
  const scan = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR_W - 0.2, 0.05),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.2, depthWrite: false }),
  );
  scan.rotation.x = -Math.PI / 2;
  scan.position.y = 0.145;
  group.add(scan);

  return { group, edge, top, scan, highlight: 0, glowLevel: 0, x: lane.x, color: lane.color };
}

function makeFlow(a, b) {
  const group = new THREE.Group();
  const curves = [-1.2, 0, 1.2].map((z) => {
    const from = new THREE.Vector3(a.x + FLOOR_W / 2 - 0.05, 0.12, z);
    const to = new THREE.Vector3(b.x - FLOOR_W / 2 + 0.05, 0.12, z);
    const mid = from.clone().add(to).multiplyScalar(0.5).setY(0.6);
    return new THREE.QuadraticBezierCurve3(from, mid, to);
  });
  const pulses = [];
  curves.forEach((curve) => {
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 32, 0.012, 6),
      new THREE.MeshBasicMaterial({ color: '#98b3cf', transparent: true, opacity: 0.4 }),
    );
    group.add(tube);
    for (let k = 0; k < 2; k++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }));
      p.userData = { curve, offset: k * 0.5 + Math.random() * 0.2 };
      pulses.push(p);
      group.add(p);
    }
  });
  const ca = new THREE.Color(a.color);
  const cb = new THREE.Color(b.color);
  return {
    group,
    update(t) {
      pulses.forEach((p) => {
        const k = (t * 0.28 + p.userData.offset) % 1;
        p.position.copy(p.userData.curve.getPoint(k));
        p.material.color.copy(ca.clone().lerp(cb, k)).multiplyScalar(2.6);
        p.scale.setScalar(Math.sin(k * Math.PI) * 1.2 + 0.2);
      });
    },
  };
}

function roundedRect(hw, hh, r) {
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return s;
}

function laneTopCanvas(lane) {
  const c = document.createElement('canvas');
  const scale = 220;
  c.width = Math.round((FLOOR_W - 0.08) * scale);
  c.height = Math.round((FLOOR_D - 0.08) * scale);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0.04)');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(32,68,110,0.1)';
  for (let x = 30; x < c.width; x += 44) for (let y = 30; y < c.height - 120; y += 44) g.fillRect(x, y, 3, 3);
  g.font = '900 58px Nunito, Manrope, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = '#25496e';
  g.shadowColor = 'rgba(255,255,255,0.6)';
  g.shadowBlur = 2;
  g.fillText(lane.label, c.width / 2, c.height - 50);
  return c;
}

function gridCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(140,130,255,0.22)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 128, 128);
  return c;
}

// Мягкий фон витрины, без декоративных объектов поверх рабочих платформ.
function makeSkyDetails() {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#f7fbff', roughness: 1 });
  [[-5.8, -3.3], [5.9, -3.8]].forEach(([x, z]) => {
    [0, 1, 2].forEach((i) => {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.52 + (i % 2) * 0.25, 24, 16), white);
      puff.position.set(x + (i - 1) * 0.6, 0.08 + (i % 2) * 0.15, z);
      puff.scale.set(1.1, 0.85, 0.85);
      puff.castShadow = true;
      group.add(puff);
    });
  });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.65, 32, 20), new THREE.MeshStandardMaterial({ color: '#f4d47e', roughness: 0.75 }));
  sun.position.set(-5.7, 0.65, -4.2);
  group.add(sun);
  return group;
}

function radialCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(160,191,227,0.35)');
  grad.addColorStop(0.5, 'rgba(194,217,241,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return c;
}

// Круглая мягкая точка для частиц
let dotTex = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

function hexA(hex, a) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

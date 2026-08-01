// A three.js board. The pieces are turned, not downloaded: a Staunton set is
// essentially a silhouette revolved around its axis, which LatheGeometry does
// exactly — so the whole set is a handful of profiles, no asset licences, no
// megabytes, and it scales to any resolution. (The knight breaks the rule of
// revolution, so it gets an extruded profile and a chamfer instead.)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const V = (x, y) => new THREE.Vector2(x, y);

// profiles are (radius, height) in units where a square is 1.0
const PROFILES = {
  p: [[0.00, 0.00], [0.22, 0.00], [0.22, 0.05], [0.15, 0.09], [0.13, 0.20], [0.16, 0.26],
      [0.11, 0.30], [0.13, 0.36], [0.11, 0.42], [0.15, 0.46], [0.15, 0.50], [0.00, 0.62]],
  r: [[0.00, 0.00], [0.25, 0.00], [0.25, 0.06], [0.18, 0.11], [0.17, 0.48], [0.22, 0.54],
      [0.24, 0.60], [0.24, 0.72], [0.16, 0.72], [0.16, 0.66], [0.00, 0.66]],
  b: [[0.00, 0.00], [0.26, 0.00], [0.26, 0.06], [0.18, 0.12], [0.14, 0.42], [0.19, 0.50],
      [0.13, 0.56], [0.15, 0.62], [0.10, 0.72], [0.05, 0.80], [0.06, 0.86], [0.00, 0.92]],
  q: [[0.00, 0.00], [0.30, 0.00], [0.30, 0.07], [0.21, 0.13], [0.15, 0.55], [0.22, 0.64],
      [0.26, 0.72], [0.20, 0.78], [0.22, 0.88], [0.10, 0.92], [0.00, 0.98]],
  k: [[0.00, 0.00], [0.30, 0.00], [0.30, 0.07], [0.21, 0.13], [0.15, 0.58], [0.23, 0.67],
      [0.26, 0.76], [0.19, 0.82], [0.20, 0.92], [0.09, 0.96], [0.00, 1.00]],
  n: [[0.00, 0.00], [0.26, 0.00], [0.26, 0.06], [0.19, 0.12], [0.16, 0.34], [0.00, 0.38]],
};

function lathe(profile, segments = 28) {
  const pts = profile.map(([r, y]) => V(Math.max(0.001, r), y));
  const g = new THREE.LatheGeometry(pts, segments);
  g.computeVertexNormals();
  return g;
}

// the knight: an extruded head profile, sitting on a turned base
function knightHead() {
  const s = new THREE.Shape();
  s.moveTo(-0.16, 0.30); s.lineTo(-0.20, 0.44); s.lineTo(-0.12, 0.56);
  s.lineTo(0.02, 0.66); s.lineTo(0.04, 0.78); s.lineTo(0.12, 0.68);
  s.lineTo(0.20, 0.70); s.lineTo(0.22, 0.58); s.lineTo(0.14, 0.44);
  s.lineTo(0.20, 0.34); s.lineTo(0.10, 0.30); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.20, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
  g.translate(0, 0, -0.10);
  return g;
}

function crossTop() {
  const g = new THREE.BoxGeometry(0.07, 0.22, 0.07);
  const arm = new THREE.BoxGeometry(0.18, 0.07, 0.07);
  const merged = new THREE.BufferGeometry();
  g.translate(0, 1.10, 0); arm.translate(0, 1.11, 0);
  return [g, arm];
}

export function createBoard3D(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#12151c');
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 10.2, 9.9);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 6; controls.maxDistance = 22;

  scene.add(new THREE.HemisphereLight('#dfeaff', '#3a4152', 1.1));
  const key = new THREE.DirectionalLight('#fff4e2', 1.5);
  key.position.set(6, 12, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const d = 7;
  key.shadow.camera.left = -d; key.shadow.camera.right = d;
  key.shadow.camera.top = d; key.shadow.camera.bottom = -d;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9fc4ff', 0.5);
  rim.position.set(-8, 5, -6);
  scene.add(rim);

  // board
  const boardGroup = new THREE.Group();
  scene.add(boardGroup);
  const light = new THREE.MeshStandardMaterial({ color: '#e8dcc3', roughness: 0.75, metalness: 0.02 });
  const dark = new THREE.MeshStandardMaterial({ color: '#6d8296', roughness: 0.72, metalness: 0.02 });
  const sqGeo = new THREE.BoxGeometry(1, 0.22, 1);
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const m = new THREE.Mesh(sqGeo, (f + r) % 2 ? light : dark);
    m.position.set(f - 3.5, -0.11, 3.5 - r);
    m.receiveShadow = true;
    boardGroup.add(m);
  }
  const rimGeo = new THREE.BoxGeometry(9.1, 0.26, 9.1);
  const rimMesh = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({ color: '#2f3743', roughness: 0.8 }));
  rimMesh.position.y = -0.15; rimMesh.receiveShadow = true;
  boardGroup.add(rimMesh);

  const whiteMat = new THREE.MeshStandardMaterial({ color: '#f2ece0', roughness: 0.42, metalness: 0.05 });
  const blackMat = new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.45, metalness: 0.08 });
  const geo = {};
  for (const [t, prof] of Object.entries(PROFILES)) geo[t] = lathe(prof);
  const headGeo = knightHead();
  const crossGeos = crossTop();

  const pieces = new THREE.Group();
  scene.add(pieces);

  function buildPiece(type, white) {
    const g = new THREE.Group();
    const mat = white ? whiteMat : blackMat;
    const body = new THREE.Mesh(geo[type], mat);
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);
    if (type === 'n') {
      const head = new THREE.Mesh(headGeo, mat);
      head.castShadow = true;
      head.rotation.y = white ? Math.PI : 0;
      g.add(head);
    }
    if (type === 'k') for (const cg of crossGeos) {
      const c = new THREE.Mesh(cg, mat); c.castShadow = true; g.add(c);
    }
    if (type === 'q') {
      // a ring of points instead of a crown of them
      for (let i = 0; i < 7; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat);
        const a = (i / 7) * Math.PI * 2;
        b.position.set(Math.cos(a) * 0.115, 1.0, Math.sin(a) * 0.115);
        b.castShadow = true; g.add(b);
      }
    }
    if (type === 'r') for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.07), mat);
      const a = (i / 6) * Math.PI * 2;
      b.position.set(Math.cos(a) * 0.19, 0.74, Math.sin(a) * 0.19);
      b.castShadow = true; g.add(b);
    }
    return g;
  }

  const cache = {};
  function setPosition(board) {   // board: 64 chars, index = rank*8+file
    pieces.clear();
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const ch = board[r * 8 + f];
      if (!ch) continue;
      const white = ch === ch.toUpperCase();
      const type = ch.toLowerCase();
      const key = type + (white ? 'w' : 'b');
      const proto = cache[key] ?? (cache[key] = buildPiece(type, white));
      const g = proto.clone();
      g.position.set(f - 3.5, 0, 3.5 - r);
      g.rotation.y = white ? 0 : Math.PI;
      pieces.add(g);
    }
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight || Math.round(w * 0.82);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  let raf = 0;
  (function loop() {
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  })();

  return { setPosition, resize, dispose: () => { cancelAnimationFrame(raf); renderer.dispose(); } };
}

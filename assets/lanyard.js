// Vanilla port of the pasted Lanyard component (three.js physics lanyard).
// createLanyard(container, opts) -> { reset(intro), dispose() }
import * as THREE from 'three';

const CARD_SIZES = { portrait: [1.6, 2.25], landscape: [2.25, 1.6] };
const ANCHORS = { left: 0.27, center: 0.5, right: 0.73 };
const THICKNESS = 0.018, BEVEL = 0.007, JOINTS = 4, NODE_WEIGHT = 1 / 0.05, MAX_STEP = 1 / 960, ITERATIONS = 2, SAMPLES = 72, FOV = 24;
const STRAP_WIDTH = 0.36, RING_RADIUS = 0.095, RING_TUBE = 0.0135, EYELET_RADIUS = 0.036, CLAMP_BODY = 0.15, FACE_WIDTH = 1024;
const FINISHES = {
  glossy: { roughness: 0.42, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, foil: 0, anisotropy: 0 },
  matte: { roughness: 0.85, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.6, foil: 0, anisotropy: 0 },
  holographic: { roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, foil: 1, anisotropy: 0 },
  metallic: { roughness: 0.36, metalness: 0.75, clearcoat: 0.5, clearcoatRoughness: 0.18, foil: 0, anisotropy: 0.7 }
};
const BAND_COLUMNS = [0, 0.07, 0.93, 1], BAND_BEND = [-0.95, -0.28, 0.28, 0.95], FLIP_SPIN = 9;
const METALS = { silver: { color: '#d9dce2', roughness: 0.16 }, gold: { color: '#e4b965', roughness: 0.2 }, graphite: { color: '#4d4f55', roughness: 0.28 } };

const FOIL_VERTEX_HEAD = `varying vec2 vFoilUv;varying vec3 vFoilX;varying vec3 vFoilY;`;
const FOIL_VERTEX_BODY = `vFoilUv = uv;vFoilX = normalize((modelViewMatrix * vec4(1.0,0.0,0.0,0.0)).xyz);vFoilY = normalize((modelViewMatrix * vec4(0.0,1.0,0.0,0.0)).xyz);`;
const FOIL_FRAGMENT_HEAD = `
uniform float foilStrength;uniform float foilAspect;uniform vec3 foilKey;uniform vec3 foilFill;uniform vec3 foilTop;
varying vec2 vFoilUv;varying vec3 vFoilX;varying vec3 vFoilY;
float foilHash(vec2 p){p=fract(p*vec2(234.34,435.345));p+=dot(p,p+34.23);return fract(p.x*p.y);}
float foilBump(float t,float c,float w){float x=(t-c)/w;return max(0.0,1.0-x*x);}
vec3 foilSpectrum(float t){return vec3(foilBump(t,0.82,0.32)+0.4*foilBump(t,0.02,0.12),foilBump(t,0.5,0.26),foilBump(t,0.18,0.24));}
vec3 foilGrating(float u,float s){vec3 c=vec3(0.0);for(int m=1;m<=2;m++){float o=float(m);float t=(s*abs(u)/o-0.38)/0.32;c+=foilSpectrum(t)/o;}return c;}
vec3 foilShard(vec2 p){vec2 base=floor(p);float best=9.0;float edge=9.0;vec2 id=base;for(int j=-1;j<=1;j++){for(int i=-1;i<=1;i++){vec2 cell=base+vec2(float(i),float(j));vec2 site=cell+vec2(foilHash(cell),foilHash(cell+7.31))*0.9+0.05;float d=length(site-p);if(d<best){edge=best;best=d;id=cell;}else if(d<edge){edge=d;}}}return vec3(foilHash(id+3.17),foilHash(id+11.73),edge-best);}
`;
const FOIL_FRAGMENT_BODY = `
if (foilStrength > 0.0) {
  vec3 foilView=normalize(vViewPosition);vec3 foilNormal=normalize(normal);vec2 foilP=vec2(vFoilUv.x,vFoilUv.y*foilAspect);
  vec3 shard=foilShard(foilP*26.0);vec2 ray=foilP-vec2(-1.6,2.6*foilAspect);float angle=atan(ray.y,ray.x)+(shard.x-0.5)*0.16;
  vec3 grating=normalize(vFoilX*cos(angle)+vFoilY*sin(angle));float spacing=1.7*(0.95+shard.y*0.1);
  vec3 rainbow=foilGrating(dot(foilKey+foilView,grating),spacing);rainbow+=0.6*foilGrating(dot(foilTop+foilView,grating),spacing);
  rainbow*=0.8+0.2*smoothstep(0.0,0.04,shard.z);rainbow=max(rainbow-0.35*min(rainbow.r,min(rainbow.g,rainbow.b)),0.0);
  float ink=dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722));float foil=foilStrength*(0.08+0.92*smoothstep(0.04,0.7,ink));
  float facing=clamp(dot(foilNormal,foilView),0.0,1.0);float tint=clamp(dot(rainbow,vec3(0.4)),0.0,1.0);
  outgoingLight=outgoingLight*(1.0-foil*(0.3+0.32*tint))+(rainbow*0.62*(0.4+0.6*facing))*foil;
}`;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const parseColor = (value, fallback) => {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = '#000000'; ctx.fillStyle = value; const r = ctx.fillStyle;
    if (r.startsWith('#')) { const n = parseInt(r.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
    const p = r.match(/[\d.]+/g); if (!p || p.length < 3) return fallback; return [p[0] / 255, p[1] / 255, p[2] / 255];
  } catch { return fallback; }
};
const luminance = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const toCss = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const seeded = start => { let s = start >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const traceRoundedRect = (p, x, y, w, h, radius) => {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2)), k = r * 0.4477;
  p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.bezierCurveTo(x + w - k, y, x + w, y + k, x + w, y + r);
  p.lineTo(x + w, y + h - r); p.bezierCurveTo(x + w, y + h - k, x + w - k, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h); p.bezierCurveTo(x + k, y + h, x, y + h - k, x, y + h - r);
  p.lineTo(x, y + r); p.bezierCurveTo(x, y + k, x + k, y, x + r, y);
};
const cardLayout = (orientation, cornerRadius) => {
  const [width, height] = CARD_SIZES[orientation] || CARD_SIZES.portrait;
  const radius = mix(0.03, Math.min(width, height) * 0.2, clamp(cornerRadius, 0, 1));
  const slot = { width: 0.34, height: 0.07, y: height / 2 - 0.13 };
  const ringY = height / 2 - 0.055;
  return { width, height, radius, slot, ringY, hangY: ringY + RING_RADIUS };
};
const buildCardGeometry = L => {
  const { width, height, radius, slot } = L;
  const outline = new THREE.Shape();
  traceRoundedRect(outline, -width / 2 + BEVEL, -height / 2 + BEVEL, width - BEVEL * 2, height - BEVEL * 2, Math.max(radius - BEVEL, 0.005));
  const hole = new THREE.Path();
  traceRoundedRect(hole, -slot.width / 2 - BEVEL, slot.y - slot.height / 2 - BEVEL, slot.width + BEVEL * 2, slot.height + BEVEL * 2, slot.height / 2 + BEVEL);
  outline.holes.push(hole);
  const body = new THREE.ExtrudeGeometry(outline, { depth: THICKNESS, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 5, curveSegments: 24 });
  body.translate(0, 0, -THICKNESS / 2);
  const face = new THREE.ShapeGeometry(outline, 24);
  const pos = face.getAttribute('position'), uv = face.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + width / 2) / width, (pos.getY(i) + height / 2) / height);
  uv.needsUpdate = true;
  return { body, face };
};
const buildClampGeometry = width => {
  const s = new THREE.Shape(), w = width * 1.16;
  traceRoundedRect(s, -w / 2 + 0.014, -CLAMP_BODY / 2 + 0.014, w - 0.028, CLAMP_BODY - 0.028, 0.024);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.014, bevelSegments: 6, curveSegments: 10 });
  g.translate(0, 0, -0.01); return g;
};
const buildBandGeometry = count => {
  const cols = BAND_COLUMNS.length, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * cols * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * cols * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * cols * 2), 2));
  const idx = [];
  for (let i = 0; i < count - 1; i++) for (let c = 0; c < cols - 1; c++) { const a = i * cols + c; idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1); }
  g.setIndex(idx); return g;
};
const buildEnvironment = renderer => {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0.035, 0.035, 0.04);
  const geo = new THREE.PlaneGeometry(1, 1), mats = [];
  const panel = (k, p, s, rot = 0) => { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }); mats.push(m); const mesh = new THREE.Mesh(geo, m); mesh.position.set(...p); mesh.scale.set(s[0], s[1], 1); mesh.lookAt(0, 0, 0); mesh.rotateZ(rot); scene.add(mesh); };
  panel(2.6, [0, 4.5, 8], [9, 4]); panel(6, [-5.5, 0.5, 7], [0.9, 14]); panel(4, [5, -0.5, 8], [0.6, 14]);
  panel(3.5, [0, -1, 9], [24, 0.35], Math.PI / 3); panel(2.5, [1, 2.5, 9], [24, 0.2], Math.PI / 3);
  panel(1.4, [0, 6, -6], [12, 4]); panel(0.5, [0, -7, 1], [16, 6]); panel(0.9, [8, 0, -2], [4, 10]);
  const pm = new THREE.PMREMGenerator(renderer); const t = pm.fromScene(scene, 0.035); pm.dispose(); geo.dispose(); mats.forEach(m => m.dispose()); return t;
};
const makeCanvasTexture = (c, an) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = an; return t; };
const buildGrainTexture = () => {
  const size = 128, c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d');
  const rnd = seeded(7), field = Float32Array.from({ length: size * size }, () => rnd());
  const h = (x, y) => { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += field[((y + j + size) % size) * size + ((x + i + size) % size)]; return (s / 9) * 1.6; };
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = h((x - 1 + size) % size, y) - h((x + 1) % size, y), ny = h(x, (y - 1 + size) % size) - h(x, (y + 1) % size), l = Math.hypot(nx, ny, 1), i = (y * size + x) * 4;
    img.data[i] = ((nx / l) * 0.5 + 0.5) * 255; img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255; img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 7); return t;
};
const buildWeaveTexture = () => {
  const size = 128, threads = 8, rnd = seeded(19), fiber = Float32Array.from({ length: size * size }, () => rnd());
  const prof = f => Math.sqrt(Math.max(0, 1 - 4 * f * f));
  const h = (x, y) => {
    const px = ((x % size) + size) % size, py = ((y % size) + size) % size, u = (px / size) * threads, v = (py / size) * threads;
    const cu = Math.floor(u), cv = Math.floor(v), fu = u - cu - 0.5, fv = v - cv - 0.5, lift = (cu + cv) % 2 === 0;
    const warp = prof(fu) * (0.55 + 0.45 * Math.cos(fv * Math.PI * (lift ? 1 : 0.6))), weft = prof(fv) * (0.55 + 0.45 * Math.cos(fu * Math.PI * (lift ? 0.6 : 1)));
    return (lift ? Math.max(warp, weft * 0.7) : Math.max(weft, warp * 0.7)) + fiber[py * size + px] * 0.08;
  };
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (h(x - 1, y) - h(x + 1, y)) * 1.6, ny = (h(x, y - 1) - h(x, y + 1)) * 1.6, l = Math.hypot(nx, ny, 1), i = (y * size + x) * 4;
    d[i] = ((nx / l) * 0.5 + 0.5) * 255; d[i + 1] = ((ny / l) * 0.5 + 0.5) * 255; d[i + 2] = ((1 / l) * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, size, size); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
};
const paintStrap = (canvas, color) => {
  const across = 192, along = across * 2; canvas.width = across; canvas.height = along;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = toCss(color); ctx.fillRect(0, 0, across, along);
  const ink = luminance(color) > 0.5 ? [0, 0, 0] : [1, 1, 1];
  ctx.fillStyle = toCss(ink, 0.05); for (let y = 0; y < along; y += 4) ctx.fillRect(0, y, across, 1);
  ctx.fillStyle = toCss(ink, 0.2); for (let y = 0; y < along; y += 14) { ctx.fillRect(across * 0.075, y, 2, 8); ctx.fillRect(across * 0.925 - 2, y, 2, 8); }
  return along / across;
};

const createSimulation = () => {
  const vs = () => Array.from({ length: JOINTS + 1 }, () => new THREE.Vector3());
  return { nodes: vs(), previous: vs(), velocities: vs(), lengths: new Float64Array(JOINTS), impulses: new Float64Array(JOINTS), rest: 1, anchor: new THREE.Vector3(),
    body: { position: new THREE.Vector3(), previous: new THREE.Vector3(), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(), previousQuaternion: new THREE.Quaternion(), angular: new THREE.Vector3(), mass: 1, inverseInertia: new THREE.Vector3(1, 1, 1), hang: new THREE.Vector3() },
    grab: null, turn: 0, twist: 0, twistRaw: 0, calm: 0 };
};
const S = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), e: new THREE.Vector3(), f: new THREE.Vector3(), g: new THREE.Vector3(), pin: new THREE.Vector3(), q: new THREE.Quaternion(), r: new THREE.Quaternion() };
const applyInverseInertia = (b, v, out) => { S.r.copy(b.quaternion).invert(); out.copy(v).applyQuaternion(S.r); out.set(out.x * b.inverseInertia.x, out.y * b.inverseInertia.y, out.z * b.inverseInertia.z); return out.applyQuaternion(b.quaternion); };
const rotateBody = (q, w) => { const { x: qx, y: qy, z: qz, w: qw } = q; q.x += 0.5 * (w.x * qw + w.y * qz - w.z * qy); q.y += 0.5 * (w.y * qw + w.z * qx - w.x * qz); q.z += 0.5 * (w.z * qw + w.x * qy - w.y * qx); q.w += 0.5 * (-w.x * qx - w.y * qy - w.z * qz); q.normalize(); };
const bodyWeight = (b, r, n) => { const rn = S.c.crossVectors(r, n); return 1 / b.mass + rn.dot(applyInverseInertia(b, rn, S.d)); };
const pushBody = (b, r, imp) => { b.position.addScaledVector(imp, 1 / b.mass); rotateBody(b.quaternion, applyInverseInertia(b, S.e.crossVectors(r, imp), S.f)); };
const solveSegment = (sim, i, h, P) => {
  const { nodes, body } = sim, a = nodes[i], wa = i === 0 ? 0 : NODE_WEIGHT, last = i === JOINTS - 1, r = S.g;
  let b = nodes[i + 1];
  if (last) { r.copy(body.hang).applyQuaternion(body.quaternion); b = S.b.copy(body.position).add(r); }
  const delta = S.a.subVectors(b, a), length = delta.length(), stretch = length - sim.rest;
  if (stretch <= 0 || length < 1e-9) return;
  const n = delta.divideScalar(length), wb = last ? bodyWeight(body, r, n) : NODE_WEIGHT, rate = (length - sim.lengths[i]) / h;
  const tension = P.hold * Math.tanh((P.stiffness * stretch) / P.hold) + P.spring * stretch + P.bandDamping * Math.max(0, rate);
  const room = tension * h * h - sim.impulses[i]; if (room <= 0) return;
  const lambda = Math.min(stretch / (wa + wb), room); sim.impulses[i] += lambda;
  if (wa) a.addScaledVector(n, lambda * wa);
  if (last) pushBody(body, r, n.multiplyScalar(-lambda)); else b.addScaledVector(n, -lambda * wb);
};
const solvePin = (body, grab, target) => {
  const r = S.g.copy(grab.local).applyQuaternion(body.quaternion), delta = S.a.copy(target).sub(body.position).sub(r), dist = delta.length();
  if (dist < 1e-9) return; const n = delta.divideScalar(dist); pushBody(body, r, n.multiplyScalar(dist / bodyWeight(body, r, n)));
};
const placeHanging = (sim, L, intro) => {
  const { nodes, previous, velocities, body, anchor } = sim;
  nodes[0].copy(anchor);
  for (let i = 1; i <= JOINTS; i++) { nodes[i].copy(nodes[i - 1]); nodes[i].y -= sim.rest; }
  body.quaternion.identity();
  
  body.hang.set(0, L.hangY, 0);
  const off = S.a.copy(body.hang).applyQuaternion(body.quaternion);
  body.position.copy(nodes[JOINTS]).sub(off); body.previous.copy(body.position); body.previousQuaternion.copy(body.quaternion);
  body.velocity.set(0, 0, 0); body.angular.set(0, 0, 0);
  for (let i = 0; i <= JOINTS; i++) { previous[i].copy(nodes[i]); velocities[i].set(0, 0, 0); }
  sim.lengths.fill(sim.rest); sim.turn = 0; sim.twist = 0; sim.twistRaw = 0; sim.calm = 0;
  if (intro) { const d = intro < 0 ? -1 : 1; body.velocity.set(4.2 * d, 0, 1.2); body.angular.set(0, 2.4 * d, -1.2 * d); for (let i = 1; i < JOINTS; i++) velocities[i].set(3 * d * i / JOINTS, 0, 0); }
};
const configureSimulation = (sim, L, length) => {
  sim.rest = length / JOINTS; const { width, height } = L, b = sim.body, t = THICKNESS + BEVEL * 2;
  b.mass = 1; b.inverseInertia.set(12 / (height * height + t * t), 12 / (width * width + t * t), 12 / (width * width + height * height)); b.hang.set(0, L.hangY, 0);
};
const stepSimulation = (sim, dt, P, time) => {
  const steps = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-6)), h = dt / steps, { nodes, previous, velocities, body } = sim;
  const windX = P.breeze * (Math.sin(time * 0.53) * 0.7 + Math.sin(time * 1.31 + 1.7) * 0.3) * 3, windZ = P.breeze * Math.sin(time * 0.37 + 0.6) * 2;
  const grab = sim.grab, pin = S.pin, nodeDrag = Math.exp(-P.nodeDrag * h), linearDrag = Math.exp(-P.linearDrag * h), angularDrag = Math.exp(-P.angularDrag * h);
  for (let s = 0; s < steps; s++) {
    for (let i = 1; i < JOINTS; i++) { const v = velocities[i]; v.y -= P.gravity * h; v.x += windX * h; v.z += windZ * h; previous[i].copy(nodes[i]); nodes[i].addScaledVector(v, h); }
    body.previous.copy(body.position); body.previousQuaternion.copy(body.quaternion);
    const q = body.quaternion;
    if (grab) {
      const turn = S.q.copy(grab.rotation).multiply(S.r.copy(q).invert()); if (turn.w < 0) turn.set(-turn.x, -turn.y, -turn.z, -turn.w);
      const torque = S.a.set(turn.x, turn.y, turn.z).multiplyScalar(2 * P.grip); torque.addScaledVector(body.angular, -P.gripDamping);
      body.angular.addScaledVector(applyInverseInertia(body, torque, S.b), h);
    }
    const up = S.a.set(0, 1, 0).applyQuaternion(q), front = S.b.set(-up.x * up.z, -up.y * up.z, 1 - up.z * up.z);
    if (front.lengthSq() > 1e-3) {
      const facing = S.d.set(0, 0, 1).applyQuaternion(q), raw = Math.atan2(S.e.crossVectors(front, facing).dot(up), front.dot(facing));
      let turned = raw - sim.twistRaw; if (turned > Math.PI) turned -= Math.PI * 2; else if (turned < -Math.PI) turned += Math.PI * 2;
      sim.twist += turned; sim.twistRaw = raw;
    }
    if (!grab) { const spin = body.angular.dot(up); body.angular.addScaledVector(up, (P.twist * (sim.turn - sim.twist) - P.twistDamping * spin) * h); }
    body.velocity.y -= P.gravity * h; body.velocity.x += windX * 0.35 * h; body.velocity.z += windZ * 0.35 * h;
    body.position.addScaledVector(body.velocity, h); rotateBody(body.quaternion, S.f.copy(body.angular).multiplyScalar(h));
    sim.impulses.fill(0);
    if (grab) pin.lerpVectors(grab.from, grab.target, (s + 1) / steps);
    for (let it = 0; it < ITERATIONS; it++) { for (let i = 0; i < JOINTS; i++) solveSegment(sim, i, h, P); if (grab) solvePin(body, grab, pin); }
    for (let i = 1; i < JOINTS; i++) { const v = velocities[i].subVectors(nodes[i], previous[i]).divideScalar(h).multiplyScalar(nodeDrag); v.multiplyScalar(1 / (1 + P.nodeAir * v.length() * h)); }
    body.velocity.subVectors(body.position, body.previous).divideScalar(h);
    const dq = S.q.copy(body.previousQuaternion).invert().premultiply(body.quaternion);
    body.angular.set(dq.x, dq.y, dq.z).multiplyScalar((2 / h) * (dq.w < 0 ? -1 : 1));
    const n = S.a.set(0, 0, 1).applyQuaternion(body.quaternion), across = body.velocity.dot(n), along = S.b.copy(body.velocity).addScaledVector(n, -across);
    along.multiplyScalar(1 / (1 + P.air * along.length() * h));
    body.velocity.copy(along).addScaledVector(n, across / (1 + P.broadside * Math.abs(across) * h)).multiplyScalar(linearDrag);
    body.angular.multiplyScalar(angularDrag / (1 + P.spinAir * body.angular.length() * h));
    if (body.velocity.lengthSq() > 3600) body.velocity.setLength(60);
    if (body.angular.lengthSq() > 1600) body.angular.setLength(40);
    nodes[JOINTS].copy(body.hang).applyQuaternion(body.quaternion).add(body.position);
    for (let i = 0; i < JOINTS; i++) sim.lengths[i] = nodes[i].distanceTo(nodes[i + 1]);
  }
  if (grab) grab.from.copy(grab.target);
  let energy = body.velocity.lengthSq() + body.angular.lengthSq() * 0.3;
  for (let i = 1; i < JOINTS; i++) energy += velocities[i].lengthSq() * 0.05;
  sim.calm = energy < 2e-4 ? sim.calm + dt : 0;
};

/**
 * opts: frontCanvas, backCanvas (pre-painted HTMLCanvasElements at FACE_WIDTH x card ratio),
 * cardColor, finish, cornerRadius, size, fill (card width share of container), anchor, strapLength,
 * strapColor, strapWidth, metal, gravity, damping, elasticity, breeze, interactive, intro (+1/-1/0), onFlip
 */
export function createLanyard(container, o) {
  const s = Object.assign({ cardColor: '#ffffff', orientation: 'portrait', finish: 'glossy', cornerRadius: 0.3, size: 0.6, fill: 0.72, anchor: 'center', strapLength: 0.5, strapColor: '#111111', strapWidth: 0.65, metal: 'silver', gravity: 1, damping: 0.5, elasticity: 0.5, breeze: 0.3, interactive: true, intro: 1, bleed: 1, eventTarget: null, hoverSet: null }, o);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch { return null; }
  renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1;
  const canvas = renderer.domElement; canvas.className = 'lanyard-canvas';
  if (s.bleed > 1) Object.assign(canvas.style, { position: 'absolute', top: '0', left: (-(s.bleed - 1) / 2 * 100) + '%', width: (s.bleed * 100) + '%', height: '100%', pointerEvents: s.eventTarget ? 'none' : '' }); canvas.setAttribute('aria-hidden', 'true'); container.appendChild(canvas);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const scene = new THREE.Scene(), environment = buildEnvironment(renderer); scene.environment = environment.texture;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-2.5, 4, 6);
  const fillL = new THREE.DirectionalLight(0xffffff, 0.35); fillL.position.set(3, -1, 4); scene.add(key, fillL);

  const frontTexture = makeCanvasTexture(s.frontCanvas, anisotropy), backTexture = makeCanvasTexture(s.backCanvas || s.frontCanvas, anisotropy);
  const strapCanvas = document.createElement('canvas'), strapTexture = makeCanvasTexture(strapCanvas, anisotropy);
  strapTexture.wrapS = THREE.ClampToEdgeWrapping; strapTexture.wrapT = THREE.RepeatWrapping;
  const grain = buildGrainTexture(), weave = buildWeaveTexture();
  const foilUniforms = { foilStrength: { value: 0 }, foilAspect: { value: 1.4 }, foilKey: { value: new THREE.Vector3() }, foilFill: { value: new THREE.Vector3() }, foilTop: { value: new THREE.Vector3() } };
  const injectFoil = sh => {
    Object.assign(sh.uniforms, foilUniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${FOIL_VERTEX_HEAD}`).replace('#include <project_vertex>', `#include <project_vertex>\n${FOIL_VERTEX_BODY}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${FOIL_FRAGMENT_HEAD}`).replace('#include <opaque_fragment>', `${FOIL_FRAGMENT_BODY}\n#include <opaque_fragment>`);
  };
  const frontMaterial = new THREE.MeshPhysicalMaterial({ map: frontTexture, normalMap: grain, normalScale: new THREE.Vector2(0.06, 0.06) });
  const backMaterial = new THREE.MeshPhysicalMaterial({ map: backTexture, normalMap: grain, normalScale: new THREE.Vector2(0.06, 0.06) });
  frontMaterial.onBeforeCompile = injectFoil; backMaterial.onBeforeCompile = injectFoil;
  const edgeMaterial = new THREE.MeshPhysicalMaterial(), metalMaterial = new THREE.MeshStandardMaterial({ metalness: 1 });
  const bandMaterial = new THREE.MeshPhysicalMaterial({ map: strapTexture, normalMap: weave, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.68, sheen: 1, sheenRoughness: 0.42, sheenColor: new THREE.Color(0.32, 0.32, 0.34), side: THREE.DoubleSide });

  const layout = cardLayout(s.orientation, s.cornerRadius), geo = buildCardGeometry(layout);
  const cardGroup = new THREE.Group();
  const bodyMesh = new THREE.Mesh(geo.body, edgeMaterial), frontMesh = new THREE.Mesh(geo.face, frontMaterial), backMesh = new THREE.Mesh(geo.face.clone(), backMaterial);
  frontMesh.position.z = THICKNESS / 2 + BEVEL + 0.0006; backMesh.rotation.y = Math.PI; backMesh.position.z = -(THICKNESS / 2 + BEVEL + 0.0006);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 18, 72), metalMaterial); ring.rotation.y = Math.PI / 2 - 0.7; ring.position.set(0, layout.ringY, 0);
  cardGroup.add(bodyMesh, frontMesh, backMesh, ring); scene.add(cardGroup);
  const bandGeometry = buildBandGeometry(SAMPLES), band = new THREE.Mesh(bandGeometry, bandMaterial); band.frustumCulled = false; scene.add(band);
  const strapScale = STRAP_WIDTH * clamp(s.strapWidth, 0.4, 2);
  const clampGroup = new THREE.Group(), clampMesh = new THREE.Mesh(buildClampGeometry(strapScale), metalMaterial); clampMesh.position.y = EYELET_RADIUS + CLAMP_BODY / 2 - 0.004;
  const eyelet = new THREE.Mesh(new THREE.TorusGeometry(EYELET_RADIUS, 0.0105, 14, 40), metalMaterial); clampGroup.add(clampMesh, eyelet); scene.add(clampGroup);

  // materials
  const finish = FINISHES[s.finish] || FINISHES.glossy, card = parseColor(s.cardColor, [1, 1, 1]);
  [frontMaterial, backMaterial].forEach(m => { m.roughness = finish.roughness; m.metalness = finish.metalness; m.clearcoat = finish.clearcoat; m.clearcoatRoughness = finish.clearcoatRoughness; m.anisotropy = finish.anisotropy; });
  foilUniforms.foilStrength.value = finish.foil; foilUniforms.foilAspect.value = layout.height / layout.width;
  edgeMaterial.color.setRGB(card[0] * 0.92, card[1] * 0.92, card[2] * 0.92, THREE.SRGBColorSpace); edgeMaterial.roughness = Math.min(finish.roughness, 0.35); edgeMaterial.metalness = finish.metalness; edgeMaterial.clearcoat = 1; edgeMaterial.clearcoatRoughness = 0.08;
  const metalLook = METALS[s.metal] || METALS.silver; metalMaterial.color.set(metalLook.color); metalMaterial.roughness = metalLook.roughness;
  const tileRatio = paintStrap(strapCanvas, parseColor(s.strapColor, [0.07, 0.07, 0.07])); weave.repeat.set(2, 2 * tileRatio); strapTexture.needsUpdate = true;
  canvas.style.touchAction = 'pan-x pan-y';

  const sim = createSimulation(), controls = [], mouth = new THREE.Vector3(), tuck = new THREE.Vector3();
  const curve = new THREE.CatmullRomCurve3(controls, false, 'centripetal'), view = { width: 1, height: 1 };
  let raf = 0, last = performance.now(), time = 0, visible = true, alive = true, placed = false, hovering = false, press = null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const frameView = () => {
    const aspect = view.width / view.height;
    let vh = layout.height / clamp(s.size, 0.15, 0.9); const minW = layout.width / s.fill;
    if (vh * aspect < minW) vh = minW / aspect;
    const vw = vh * aspect;
    camera.aspect = aspect; camera.position.set(0, 0, vh / 2 / Math.tan((FOV * Math.PI) / 360)); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    foilUniforms.foilKey.value.set(-2.5, 4, 6).normalize().transformDirection(camera.matrixWorldInverse);
    foilUniforms.foilFill.value.set(3, -1, 4).normalize().transformDirection(camera.matrixWorldInverse);
    foilUniforms.foilTop.value.set(0.5, 4.5, 8).normalize().transformDirection(camera.matrixWorldInverse);
    const ax = ((ANCHORS[s.anchor] ?? 0.5) - 0.5) * vw, ay = vh / 2 + 0.2;
    const cardTop = vh / 2 - vh * mix(0.12, 0.42, clamp(s.strapLength, 0, 1)), hangTop = cardTop + (layout.hangY - layout.height / 2);
    sim.anchor.set(ax, ay, 0); configureSimulation(sim, layout, ay - hangTop); sim.nodes[0].copy(sim.anchor); sim.previous[0].copy(sim.anchor);
  };

  const points = Array.from({ length: SAMPLES }, () => new THREE.Vector3()), sides = Array.from({ length: SAMPLES }, () => new THREE.Vector3());
  const bends = BAND_BEND.map(a => [Math.cos(a), Math.sin(a)]);
  const W = { tangent: new THREE.Vector3(), toCamera: new THREE.Vector3(), basis: new THREE.Matrix4(), up: new THREE.Vector3(), across: new THREE.Vector3(), facing: new THREE.Vector3(), end: new THREE.Vector3() };
  const updateBand = () => {
    const hang = sim.nodes[JOINTS], reach = EYELET_RADIUS + CLAMP_BODY + 0.05;
    let guide = JOINTS - 1; while (guide > 0 && sim.nodes[guide].distanceTo(hang) < reach * 1.1) guide--;
    const axis = W.up.subVectors(sim.nodes[guide], hang); if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0).applyQuaternion(sim.body.quaternion); axis.normalize();
    mouth.copy(hang).addScaledVector(axis, reach); tuck.copy(hang).addScaledVector(axis, EYELET_RADIUS + CLAMP_BODY * 0.35);
    controls.length = 0; for (let i = 0; i <= guide; i++) controls.push(sim.nodes[i]); controls.push(mouth, tuck);
    curve.updateArcLengths(); for (let i = 0; i < SAMPLES; i++) curve.getPointAt(i / (SAMPLES - 1), points[i]);
    const length = curve.getLength(), held = 1 - mouth.distanceTo(tuck) / Math.max(length, 0.001);
    const position = bandGeometry.getAttribute('position'), normal = bandGeometry.getAttribute('normal'), uv = bandGeometry.getAttribute('uv');
    const cols = BAND_COLUMNS.length, restLength = sim.rest * JOINTS, repeats = restLength / (strapScale * tileRatio);
    const width = strapScale / Math.pow(Math.max(1, length / Math.max(restLength, 0.001)), 0.35);
    const { tangent, toCamera, across, facing } = W;
    for (let i = 0; i < SAMPLES; i++) {
      tangent.subVectors(points[Math.min(SAMPLES - 1, i + 1)], points[Math.max(0, i - 1)]); if (tangent.lengthSq() < 1e-12) tangent.set(0, -1, 0); tangent.normalize();
      toCamera.subVectors(camera.position, points[i]).normalize();
      const side = sides[i].crossVectors(toCamera, tangent); if (side.lengthSq() < 1e-10) side.copy(i > 0 ? sides[i - 1] : S.a.set(1, 0, 0)); side.normalize();
      if (i > 0 && side.dot(sides[i - 1]) < 0) side.negate();
      const angle = -sim.twist * Math.pow(Math.min(1, i / (SAMPLES - 1) / held), 1.3);
      facing.crossVectors(tangent, side); across.copy(side).multiplyScalar(Math.cos(angle)).addScaledVector(facing, Math.sin(angle)); facing.crossVectors(tangent, across);
      const p = points[i], v = (1 - i / (SAMPLES - 1)) * repeats;
      for (let c = 0; c < cols; c++) {
        const k = i * cols + c, off = (BAND_COLUMNS[c] - 0.5) * width, [bc, bs] = bends[c];
        position.setXYZ(k, p.x + across.x * off, p.y + across.y * off, p.z + across.z * off);
        normal.setXYZ(k, facing.x * bc + across.x * bs, facing.y * bc + across.y * bs, facing.z * bc + across.z * bs);
        uv.setXY(k, BAND_COLUMNS[c], v);
      }
    }
    W.end.copy(across); position.needsUpdate = normal.needsUpdate = uv.needsUpdate = true;
    across.copy(W.end).addScaledVector(axis, -W.end.dot(axis)).normalize(); facing.crossVectors(across, axis).normalize();
    W.basis.makeBasis(across, axis, facing); clampGroup.quaternion.setFromRotationMatrix(W.basis); clampGroup.position.copy(hang);
  };
  const render = () => { cardGroup.position.copy(sim.body.position); cardGroup.quaternion.copy(sim.body.quaternion); updateBand(); renderer.render(scene, camera); };
  const physics = () => {
    const g = 40 * clamp(s.gravity, 0, 3), w = Math.max(g, 20), sp = clamp(s.elasticity, 0, 1), st = clamp(s.damping, 0, 1);
    return { gravity: g, hold: w * mix(2.2, 5.5, sp), stiffness: w * 10 * JOINTS, spring: w * mix(0.1, 0.4, sp) * JOINTS, bandDamping: w * mix(0.3, 0.08, sp) * JOINTS,
      linearDrag: 0.25 * Math.pow(16, st), angularDrag: 0.5 * Math.pow(12, st), air: 0.15, broadside: 0.5, spinAir: 0.03, nodeDrag: 2, nodeAir: 0.2,
      twist: 30, twistDamping: 3, grip: 40, gripDamping: 6, breeze: reducedMotion ? 0 : clamp(s.breeze, 0, 1) };
  };
  const tick = now => {
    raf = 0; if (!alive) return;
    const dt = Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000)); last = now; time += dt;
    const P = physics(); stepSimulation(sim, dt, P, time);
    const b = sim.body; if (!Number.isFinite(b.position.x + b.position.y + b.position.z + b.quaternion.w)) { sim.grab = null; placeHanging(sim, layout, 0); }
    render();
    const resting = sim.calm > 1.2 && !sim.grab && P.breeze === 0;
    if (visible && !resting) raf = requestAnimationFrame(tick);
  };
  const start = () => { if (raf || !visible || !alive) return; sim.calm = 0; last = performance.now(); raf = requestAnimationFrame(tick); };

  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const toPointer = e => { const r = canvas.getBoundingClientRect(); pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); raycaster.setFromCamera(pointer, camera); };
  const pickCard = () => { cardGroup.updateMatrixWorld(); const h = raycaster.intersectObjects([bodyMesh, frontMesh, backMesh], false); return h[0] || null; };
  const tgt = s.eventTarget || canvas;
  const setCursor = v => { let c = v; if (s.hoverSet) { if (v === 'grab') s.hoverSet.add(sim); else if (!v) s.hoverSet.delete(sim); if (!c && s.hoverSet.size) c = 'grab'; } if (tgt.style.cursor !== c) tgt.style.cursor = c; };
  const flip = point => {
    const b = sim.body, up = S.a.set(0, 1, 0).applyQuaternion(b.quaternion);
    let dir = sim.turn > 0 ? -1 : 1;
    if (sim.turn === 0) { const away = S.c.subVectors(point || b.position, camera.position).normalize(); dir = S.b.subVectors(point || b.position, b.position).cross(away).dot(up) < 0 ? -1 : 1; }
    sim.turn = sim.turn === 0 ? Math.PI * dir : 0; b.angular.addScaledVector(up, FLIP_SPIN * dir);
    s.onFlip && s.onFlip(sim.turn !== 0); start();
  };
  const onDown = e => {
    if (!s.interactive || e.button > 0 || e.__lan) return; toPointer(e); const hit = pickCard(); if (!hit) return; e.__lan = true;
    sim.grab = { local: hit.point.clone().sub(sim.body.position).applyQuaternion(sim.body.quaternion.clone().invert()), rotation: sim.body.quaternion.clone(), reach: hit.distance, from: hit.point.clone(), target: hit.point.clone() };
    press = { x: e.clientX, y: e.clientY, time: performance.now(), point: hit.point.clone() };
    tgt.setPointerCapture?.(e.pointerId); setCursor('grabbing'); e.preventDefault(); start();
  };
  const onMove = e => {
    if (!s.interactive) return; toPointer(e);
    if (sim.grab) { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) press = null; raycaster.ray.at(sim.grab.reach, sim.grab.target); start(); return; }
    if (e.pointerType === 'touch') return; hovering = !!pickCard() && !e.__lanHover; if (hovering) e.__lanHover = true; setCursor(hovering ? 'grab' : '');
  };
  const onUp = e => {
    if (!sim.grab) return; sim.grab = null;
    if (press && e.type === 'pointerup' && performance.now() - press.time < 450) flip(press.point);
    press = null; tgt.releasePointerCapture?.(e.pointerId); setCursor(hovering && e.pointerType !== 'touch' ? 'grab' : ''); start();
  };
  const onTouch = e => { if (!s.interactive || e.touches.length !== 1) return; toPointer(e.touches[0]); if (pickCard()) e.preventDefault(); };
  const lst = [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp], ['lostpointercapture', onUp]];
  lst.forEach(([n, f]) => tgt.addEventListener(n, f)); tgt.addEventListener('touchstart', onTouch, { passive: false });

  const resize = () => {
    const w = Math.max(1, Math.round(container.clientWidth * s.bleed)), h = Math.max(1, container.clientHeight);
    if (w === view.width && h === view.height && placed) return;
    view.width = w; view.height = h; renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(w, h, false);
    frameView();
    if (!placed) { placeHanging(sim, layout, reducedMotion ? 0 : s.intro); placed = true; }
    render(); start();
  };
  const ro = new ResizeObserver(resize); ro.observe(container);
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) start(); }); io.observe(container);
  const onVis = () => { if (!document.hidden) start(); }; document.addEventListener('visibilitychange', onVis);
  resize();

  return {
    reset(intro = s.intro) { frameView(); placeHanging(sim, layout, reducedMotion ? 0 : intro); render(); start(); },
    flip: () => flip(null),
    dispose() {
      alive = false; cancelAnimationFrame(raf); lst.forEach(([n, f]) => tgt.removeEventListener(n, f)); tgt.removeEventListener('touchstart', onTouch); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis);
      [bodyMesh, frontMesh, backMesh, ring, clampMesh, eyelet, band].forEach(m => m.geometry?.dispose());
      [frontMaterial, backMaterial, edgeMaterial, metalMaterial, bandMaterial].forEach(m => m.dispose());
      [frontTexture, backTexture, strapTexture, grain, weave].forEach(t => t.dispose()); environment.dispose(); renderer.dispose(); canvas.remove();
    }
  };
}
export const CARD_FACE = { width: FACE_WIDTH, height: Math.round(FACE_WIDTH * 2.25 / 1.6) };

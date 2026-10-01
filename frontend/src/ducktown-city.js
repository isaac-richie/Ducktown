import * as THREE from 'three';

// Ducktown at blue hour: an original, procedurally generated city around the hero duck.
// Units match the robot rig (cm; the duck is 25 tall). The hero camera orbits at ~59 cm, so
// everything tall lives outside ORBIT_CLEAR and can never come between the camera and the duck.
// Nothing here is copied art: facades, sky and street are all drawn in code.
export const ORBIT_CLEAR = 61;
export const PLAZA_RADIUS = 64;
const STREET = {inner: 64, outer: 74};
const SIDEWALK = {inner: 74, outer: 80};
const RINGS = [
  // Brick shops and walk-ups facing the square, low so the skyline reads behind them.
  {kind: 'brick', radius: 88, height: [14, 30], width: [14, 22], depth: [12, 16], tiers: 1},
  // Concrete offices and apartments.
  {kind: 'concrete', radius: 120, height: [38, 92], width: [16, 26], depth: [14, 20], tiers: 2},
  // Glass towers with setbacks: the skyline.
  {kind: 'glass', radius: 162, height: [90, 210], width: [18, 30], depth: [16, 24], tiers: 3},
  // Far city silhouette, mostly lit windows in the haze.
  {kind: 'far', radius: 250, height: [60, 240], width: [20, 36], depth: [18, 28], tiers: 2}
];
const TINTS = {
  brick: ['#b9775f', '#a8644f', '#c58a6a', '#8e5a4a', '#d0a080'],
  concrete: ['#d9d3c8', '#c7c0b4', '#b8bcc0', '#e2d8c6', '#a9aeb3'],
  glass: ['#9fb8c8', '#8fa6b8', '#b2c4cf', '#7d93a6', '#a7b5bd'],
  far: ['#6d7486', '#5f6678', '#787f90']
};
const BAY = {brick: [3.4, 4.2], concrete: [3.2, 4.4], glass: [2.6, 4.0], far: [3.2, 4.4]};
const TILE = {cols: 8, rows: 16}; // windows per facade texture tile

function seeded(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// Pure layout so it can be tested without WebGL. detail: 1 = desktop, .5 = phones.
export function layoutCity({seed = 7, detail = 1} = {}) {
  const rand = seeded(seed), between = ([a, b]) => a + (b - a) * rand();
  const buildings = [];
  for (const [ringIndex, ring] of RINGS.entries()) {
    if (detail < 1 && ring.kind === 'far') continue; // phones skip the far silhouette ring
    const start = rand() * Math.PI * 2, end = start + Math.PI * 2;
    let angle = start, prevHalf = 0, firstHalf = null;
    while (true) {
      // Space centres by both neighbours' half-widths plus a gap, so footprints never touch.
      const width = between(ring.width), gap = 2.5 + rand() * 3.5;
      if (firstHalf !== null) angle += (prevHalf + gap + width / 2) / ring.radius;
      if (firstHalf !== null && angle + (width / 2 + gap + firstHalf) / ring.radius > end) break;
      const radius = ring.radius + rand() * 8, tiers = 1 + Math.floor(rand() * ring.tiers);
      const tint = TINTS[ring.kind];
      buildings.push({
        kind: ring.kind, ring: ringIndex,
        x: Math.sin(angle) * radius, z: Math.cos(angle) * radius, facing: angle + Math.PI,
        width, depth: between(ring.depth), height: between(ring.height), tiers,
        tint: tint[Math.floor(rand() * tint.length)], uOffset: rand(), vOffset: rand(),
        roof: rand()
      });
      prevHalf = width / 2;
      if (firstHalf === null) firstHalf = width / 2;
    }
  }
  const props = [];
  for (let i = 0, count = detail < 1 ? 12 : 20; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + .12;
    props.push({kind: i % 2 ? 'tree' : 'lamp', x: Math.sin(angle) * (ORBIT_CLEAR + 1.5), z: Math.cos(angle) * (ORBIT_CLEAR + 1.5), scale: .85 + rand() * .4});
  }
  return {buildings, props};
}

// ---------- procedural textures ----------

function canvasTexture(width, height, draw, srgb = true) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// One facade tile = TILE.cols × TILE.rows windows. `map` is the wall (greyscale, tinted per
// building by vertex colour); `emissive` is which windows are lit, with blinds and warm/cool variety.
function facadeTextures(kind, seed) {
  const rand = seeded(seed), cw = 64, ch = 64, W = TILE.cols * cw, H = TILE.rows * ch;
  const glass = kind === 'glass';
  const map = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = glass ? '#5f7180' : '#e9e4dc'; ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < TILE.rows; r++) for (let c = 0; c < TILE.cols; c++) {
      const x = c * cw, y = r * ch;
      if (kind === 'brick') {
        // Brick courses, then a recessed sash window with a stone sill.
        ctx.fillStyle = 'rgba(80,40,30,.10)';
        for (let b = 0; b < ch; b += 6) ctx.fillRect(x, y + b, cw, 1);
        ctx.fillStyle = '#ece6dc'; ctx.fillRect(x + 15, y + 50, 34, 4);
        ctx.fillStyle = '#29313a'; ctx.fillRect(x + 17, y + 12, 30, 38);
        ctx.fillStyle = '#d8d1c4'; ctx.fillRect(x + 31, y + 12, 2, 38); ctx.fillRect(x + 17, y + 30, 30, 2);
      } else if (glass) {
        // Curtain wall: big panes, thin mullions, a spandrel band per floor, sky-ish gradient.
        const g = ctx.createLinearGradient(x, y, x + cw, y + ch);
        g.addColorStop(0, '#3e5566'); g.addColorStop(1, '#273947');
        ctx.fillStyle = g; ctx.fillRect(x + 1, y + 1, cw - 2, ch - 12);
        ctx.fillStyle = '#7e8e98'; ctx.fillRect(x, y + ch - 11, cw, 10);
      } else {
        // Concrete office/apartment: slab line, ribbon window with frame.
        ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(x, y + ch - 6, cw, 6);
        ctx.fillStyle = '#2c343c'; ctx.fillRect(x + 8, y + 10, cw - 16, 36);
        ctx.fillStyle = '#c9c4ba'; ctx.fillRect(x + cw / 2 - 1, y + 10, 2, 36);
      }
      // Weathering speckle so walls are not flat colour.
      ctx.fillStyle = `rgba(0,0,0,${.02 + rand() * .04})`; ctx.fillRect(x, y, cw, ch);
    }
  });
  const litShare = {brick: .45, concrete: .38, glass: .3, far: .42}[kind];
  const emissive = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < TILE.rows; r++) for (let c = 0; c < TILE.cols; c++) {
      if (rand() > litShare) continue;
      const x = c * cw, y = r * ch, warm = rand() < .78, dim = .55 + rand() * .45;
      const [R, G, B] = warm ? [255, 196 + rand() * 30, 120 + rand() * 40] : [190 + rand() * 30, 220, 255];
      ctx.fillStyle = `rgba(${R|0},${G|0},${B|0},${dim})`;
      if (kind === 'brick') ctx.fillRect(x + 17, y + 12, 30, 38);
      else if (glass) ctx.fillRect(x + 1, y + 1, cw - 2, ch - 12);
      else ctx.fillRect(x + 8, y + 10, cw - 16, 36);
      // Some blinds half drawn.
      if (rand() < .3) { ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(x + 8, y + 10, cw - 16, 10 + rand() * 18); }
    }
  });
  return {map, emissive};
}

// ---------- geometry helpers ----------

// Accumulates quads (two triangles) with position / normal / uv / colour into one geometry.
class QuadBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; }
  quad(a, b, c, d, normal, uvs, color) {
    for (const [v, t] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [a, uvs[0]], [c, uvs[2]], [d, uvs[3]]]) {
      this.p.push(v.x, v.y, v.z); this.n.push(normal.x, normal.y, normal.z); this.uv.push(t[0], t[1]); this.c.push(color.r, color.g, color.b);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// A block's four walls with facade UVs in "window units", so windows keep their real size on
// every building; plus its roof into a separate builder.
function addBlock(walls, roofs, b, cx, cz, w, d, y0, y1, color) {
  const [bayW, bayH] = BAY[b.kind], cos = Math.cos(b.facing), sin = Math.sin(b.facing);
  const at = (lx, y, lz) => new THREE.Vector3(cx + lx * cos + lz * sin, y, cz - lx * sin + lz * cos);
  const dir = (lx, lz) => new THREE.Vector3(lx * cos + lz * sin, 0, -lx * sin + lz * cos);
  const v0 = b.vOffset + y0 / (bayH * TILE.rows), v1 = b.vOffset + y1 / (bayH * TILE.rows);
  const sides = [[w, [0, 1]], [d, [1, 0]], [w, [0, -1]], [d, [-1, 0]]];
  let u = b.uOffset;
  for (const [len, [nx, nz]] of sides) {
    const half = len / 2, ox = nx * (nx ? (w / 2) : 0) + 0, oz = nz * (nz ? (d / 2) : 0);
    // Tangent runs along the wall, keeping windows upright and left-to-right.
    const tx = -nz, tz = nx, u1 = u + len / (bayW * TILE.cols);
    const a = at(ox - tx * half, y0, oz - tz * half), bb = at(ox + tx * half, y0, oz + tz * half);
    const c = at(ox + tx * half, y1, oz + tz * half), dd = at(ox - tx * half, y1, oz - tz * half);
    walls.quad(a, bb, c, dd, dir(nx, nz), [[u, v0], [u1, v0], [u1, v1], [u, v1]], color);
    u = u1;
  }
  roofs.quad(at(-w / 2, y1, d / 2), at(w / 2, y1, d / 2), at(w / 2, y1, -d / 2), at(-w / 2, y1, -d / 2), new THREE.Vector3(0, 1, 0), [[0, 0], [1, 0], [1, 1], [0, 1]], color);
}

// A ring with polar UVs: u runs around the ring (in metres / uScale), v runs across it.
function polarRing(inner, outer, segments, uScale) {
  const p = [], uv = [], idx = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
    for (const [r, v] of [[inner, 0], [outer, 1]]) { p.push(s * r, 0, c * r); uv.push(a * (inner + outer) / 2 / uScale, v); }
    if (i < segments) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---------- sky ----------

const SKY = {
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec3 vDir; uniform vec3 sunDir;
    float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    void main(){
      vec3 d = normalize(vDir); float h = d.y;
      // Blue hour: deep indigo overhead, violet mid-sky, a last band of sunset at the horizon.
      vec3 zenith = vec3(0.07, 0.10, 0.24), mid = vec3(0.30, 0.24, 0.45), glow = vec3(1.0, 0.52, 0.30), ground = vec3(0.10, 0.08, 0.12);
      vec3 sky = mix(mid, zenith, smoothstep(0.08, 0.6, h));
      sky = mix(glow, sky, smoothstep(-0.02, 0.22, h));
      float sun = max(dot(d, sunDir), 0.0);
      sky += vec3(1.0, 0.45, 0.2) * pow(sun, 8.0) * 0.6 * smoothstep(0.35, -0.05, h);
      // A sprinkle of early stars high up.
      float star = step(0.9975, hash(floor(d * 420.0))) * smoothstep(0.35, 0.8, h);
      sky += vec3(star * 0.9);
      sky = mix(ground, sky, smoothstep(-0.06, 0.0, h));
      gl_FragColor = vec4(sky, 1.0);
    }`
};

// ---------- the city ----------

export function buildCity({detail = 1, renderer = null} = {}) {
  const group = new THREE.Group();
  group.name = 'ducktown-city';
  const disposables = [];
  const keep = (...items) => { disposables.push(...items); return items[0]; };
  const {buildings, props} = layoutCity({detail});
  const sunDir = new THREE.Vector3(-.55, -.02, .83).normalize();

  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(520, 48, 24)), keep(new THREE.ShaderMaterial({
    ...SKY, side: THREE.BackSide, depthWrite: false, fog: false, uniforms: {sunDir: {value: sunDir}}
  })));
  sky.renderOrder = -1;
  group.add(sky);

  // Reflections for glass towers come from this same sky.
  let skyEnv = null;
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer), skyScene = new THREE.Scene();
    skyScene.add(sky.clone());
    skyEnv = keep(pmrem.fromScene(skyScene, .02).texture);
    pmrem.dispose();
  }

  // --- ground: plaza, duck stage, street, sidewalk ---
  const paving = keep(canvasTexture(256, 256, (ctx, s) => {
    const rand = seeded(3);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const l = 52 + rand() * 8;
      ctx.fillStyle = `hsl(28, 14%, ${l}%)`; ctx.fillRect(x * 64, y * 64, 64, 64);
    }
    ctx.strokeStyle = 'rgba(30,20,15,.35)'; ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, s); ctx.moveTo(0, i * 64); ctx.lineTo(s, i * 64); ctx.stroke(); }
  }));
  paving.repeat.set(PLAZA_RADIUS / 6, PLAZA_RADIUS / 6);
  const plaza = new THREE.Mesh(keep(new THREE.CircleGeometry(PLAZA_RADIUS, 128)), keep(new THREE.MeshStandardMaterial({map: paving, roughness: .55, metalness: .05, envMap: skyEnv, envMapIntensity: .6})));
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = -.34; plaza.receiveShadow = true;
  group.add(plaza);

  // The duck's stage: polished dark stone around the walk loop, rimmed with a line of light.
  const stage = new THREE.Mesh(keep(new THREE.CircleGeometry(17, 96)), keep(new THREE.MeshStandardMaterial({color: '#2b2a33', roughness: .25, metalness: .2, envMap: skyEnv, envMapIntensity: 1})));
  stage.rotation.x = -Math.PI / 2; stage.position.set(0, -.32, -5); stage.receiveShadow = true;
  group.add(stage);
  const stageRim = new THREE.Mesh(keep(new THREE.RingGeometry(16.6, 17.2, 128)), keep(new THREE.MeshBasicMaterial({color: new THREE.Color('#ffd27a').multiplyScalar(3.2), toneMapped: false})));
  stageRim.rotation.x = -Math.PI / 2; stageRim.position.set(0, -.3, -5);
  group.add(stageRim);
  // The walk loop as an inlaid path.
  const pathShape = new THREE.Shape().absellipse(0, 0, 7.9, 6.9, 0, Math.PI * 2);
  pathShape.holes.push(new THREE.Path().absellipse(0, 0, 6.1, 5.1, 0, Math.PI * 2, true));
  const path = new THREE.Mesh(keep(new THREE.ShapeGeometry(pathShape, 64)), keep(new THREE.MeshStandardMaterial({color: '#4a4652', roughness: .4, metalness: .2})));
  path.rotation.x = -Math.PI / 2; path.position.set(0, -.31, -6);
  group.add(path);
  // A soft ring of light that follows the duck's feet.
  const glowTex = keep(canvasTexture(128, 128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, s * .28, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.25, 'rgba(255,255,255,.9)'); g.addColorStop(.45, 'rgba(255,255,255,.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }));
  const footRing = new THREE.Mesh(keep(new THREE.PlaneGeometry(18, 18)), keep(new THREE.MeshBasicMaterial({map: glowTex, color: new THREE.Color('#9fe0ff').multiplyScalar(2.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false})));
  footRing.rotation.x = -Math.PI / 2; footRing.position.y = -.29;
  group.add(footRing);

  // Street with lane markings, then a raised sidewalk and kerb.
  const asphalt = keep(canvasTexture(256, 64, (ctx, w, h) => {
    const rand = seeded(5);
    ctx.fillStyle = '#2e3134'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(255,255,255,${rand() * .05})`; ctx.fillRect(rand() * w, rand() * h, 2, 2); }
    ctx.fillStyle = '#e8d27a'; ctx.fillRect(0, h / 2 - 2, w * .55, 4); // dashed centre line
    ctx.fillStyle = 'rgba(240,240,240,.85)'; ctx.fillRect(0, 3, w, 2); ctx.fillRect(0, h - 5, w, 2); // edge lines
  }));
  const street = new THREE.Mesh(keep(polarRing(STREET.inner, STREET.outer, 160, 8)), keep(new THREE.MeshStandardMaterial({map: asphalt, roughness: .85, envMap: skyEnv, envMapIntensity: .4})));
  street.position.y = -.36; street.receiveShadow = true;
  group.add(street);
  const crossTex = keep(canvasTexture(64, 64, (ctx, s) => { ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.clearRect(0, 0, s, s); ctx.fillStyle = 'rgba(240,240,240,.9)'; for (let i = 0; i < 4; i++) ctx.fillRect(i * 16 + 3, 0, 9, s); }));
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4, cw = new THREE.Mesh(keep(new THREE.PlaneGeometry(8, STREET.outer - STREET.inner)), keep(new THREE.MeshBasicMaterial({map: crossTex, transparent: true, depthWrite: false, color: '#9a9a9a'})));
    cw.rotation.set(-Math.PI / 2, 0, a); cw.position.set(Math.sin(a) * (STREET.inner + STREET.outer) / 2, -.35, Math.cos(a) * (STREET.inner + STREET.outer) / 2);
    group.add(cw);
  }
  const concrete = keep(canvasTexture(128, 128, (ctx, s) => { ctx.fillStyle = '#9b958c'; ctx.fillRect(0, 0, s, s); ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, s, s); }));
  const sidewalk = new THREE.Mesh(keep(polarRing(SIDEWALK.inner, SIDEWALK.outer, 160, 3)), keep(new THREE.MeshStandardMaterial({map: concrete, roughness: .9})));
  sidewalk.position.y = .1;
  const kerb = new THREE.Mesh(keep(new THREE.CylinderGeometry(SIDEWALK.inner, SIDEWALK.inner, .46, 160, 1, true)), keep(new THREE.MeshStandardMaterial({color: '#8d877e', roughness: .9, side: THREE.DoubleSide})));
  kerb.position.y = -.13;
  const outerGround = new THREE.Mesh(keep(new THREE.RingGeometry(SIDEWALK.outer, 520, 64)), keep(new THREE.MeshStandardMaterial({color: '#3a3438', roughness: 1})));
  outerGround.rotation.x = -Math.PI / 2; outerGround.position.y = .08;
  group.add(sidewalk, kerb, outerGround);

  // --- buildings: merged per facade type, a few draw calls for the whole skyline ---
  const kinds = ['brick', 'concrete', 'glass', 'far'], walls = {}, roofs = new QuadBuilder(), tops = [];
  for (const k of kinds) walls[k] = new QuadBuilder();
  const color = new THREE.Color();
  for (const b of buildings) {
    color.set(b.tint);
    if (b.kind === 'far') color.multiplyScalar(.75);
    let w = b.width, d = b.depth, y = .1;
    const tierHeights = b.tiers === 1 ? [b.height] : b.tiers === 2 ? [b.height * .7, b.height * .3] : [b.height * .55, b.height * .28, b.height * .17];
    for (const th of tierHeights) {
      addBlock(walls[b.kind], roofs, b, b.x, b.z, w, d, y, y + th, color);
      y += th; w *= .78; d *= .78;
    }
    tops.push({b, y, w: w / .78, d: d / .78});
  }
  const materials = {};
  for (const [i, k] of kinds.entries()) {
    const {map, emissive} = facadeTextures(k, 20 + i);
    keep(map, emissive);
    materials[k] = keep(new THREE.MeshStandardMaterial({
      map, vertexColors: true, emissive: '#ffffff', emissiveMap: emissive,
      emissiveIntensity: k === 'far' ? 2.6 : 3.6, roughness: k === 'glass' ? .12 : .8,
      metalness: k === 'glass' ? .75 : .02, envMap: skyEnv, envMapIntensity: k === 'glass' ? 1.4 : .35
    }));
    const mesh = new THREE.Mesh(keep(walls[k].build()), materials[k]);
    mesh.receiveShadow = k === 'brick';
    group.add(mesh);
  }
  const roofMesh = new THREE.Mesh(keep(roofs.build()), keep(new THREE.MeshStandardMaterial({color: '#3c3a3f', roughness: .9})));
  group.add(roofMesh);

  // Brick ground floors become shops: glowing storefronts with coloured awnings.
  const shops = buildings.filter(b => b.kind === 'brick');
  // Shop window: mullioned panes over a warm interior, a door, and a dark sign band on top.
  const shopTex = keep(canvasTexture(256, 96, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2a2422'); g.addColorStop(.22, '#2a2422'); g.addColorStop(.24, '#ffe3b8'); g.addColorStop(1, '#c98a52');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3a2c25';
    for (let x = 0; x <= w; x += 42) ctx.fillRect(x, h * .22, 4, h);
    ctx.fillRect(0, h * .6, w, 3);
    ctx.fillStyle = '#5a4033'; ctx.fillRect(w * .44, h * .3, w * .12, h * .7);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; for (let x = 10; x < w; x += 42) ctx.fillRect(x, h * .7, 22, h * .3); // shelves / shapes inside
  }));
  const front = new THREE.InstancedMesh(keep(new THREE.PlaneGeometry(1, 1)), keep(new THREE.MeshBasicMaterial({map: shopTex, toneMapped: false})), shops.length);
  const awning = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1, 1, 1)), keep(new THREE.MeshStandardMaterial({roughness: .7})), shops.length);
  const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const awningColors = ['#d9634a', '#2f6d5f', '#e2b04a', '#3d5a8a', '#8a3d5a'], shopGlow = ['#ffcf8a', '#ffe2b8', '#ffd59e', '#cfe6ff'];
  const rand = seeded(17);
  shops.forEach((b, i) => {
    quat.setFromAxisAngle(up, b.facing);
    const fx = Math.sin(b.facing) * (b.depth / 2 + .06), fz = Math.cos(b.facing) * (b.depth / 2 + .06);
    matrix.compose(new THREE.Vector3(b.x + fx, 2.1, b.z + fz), quat, new THREE.Vector3(b.width * .86, 3.4, 1));
    front.setMatrixAt(i, matrix);
    front.setColorAt(i, color.set(shopGlow[Math.floor(rand() * shopGlow.length)]).multiplyScalar(1.15));
    const ax = Math.sin(b.facing) * (b.depth / 2 + 1.1), az = Math.cos(b.facing) * (b.depth / 2 + 1.1);
    matrix.compose(new THREE.Vector3(b.x + ax, 4.3, b.z + az), quat, new THREE.Vector3(b.width * .9, .35, 2.2));
    awning.setMatrixAt(i, matrix);
    awning.setColorAt(i, color.set(awningColors[Math.floor(rand() * awningColors.length)]));
  });
  group.add(front, awning);

  // Rooftop clutter: AC units, water tanks, and antennas with blinking red aircraft lights.
  const roofTops = tops.filter(t => t.b.kind !== 'far');
  const ac = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(2.4, 1.6, 2.4).translate(0, .8, 0)), keep(new THREE.MeshStandardMaterial({color: '#8f9193', roughness: .6, metalness: .4})), roofTops.length);
  const tanks = roofTops.filter(t => t.b.kind !== 'glass' && t.b.roof < .5);
  const tank = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(1.8, 1.8, 3.2, 12).translate(0, 4.6, 0)), keep(new THREE.MeshStandardMaterial({color: '#6b4f3a', roughness: .9})), tanks.length);
  const masts = tops.filter(t => t.b.kind === 'glass' || (t.b.kind === 'far' && t.b.height > 150));
  const mast = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(.18, .3, 14, 6).translate(0, 7, 0)), keep(new THREE.MeshStandardMaterial({color: '#aab0b5', metalness: .6, roughness: .4})), masts.length);
  const beaconMat = keep(new THREE.MeshBasicMaterial({color: new THREE.Color('#ff3b30').multiplyScalar(3), toneMapped: false}));
  const beacon = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(.55, 8, 6).translate(0, 14.3, 0)), beaconMat, masts.length);
  const place = (mesh, list, offset = () => [0, 0]) => list.forEach((t, i) => {
    const [ox, oz] = offset(t);
    quat.setFromAxisAngle(up, t.b.facing);
    matrix.compose(new THREE.Vector3(t.b.x + ox, t.y, t.b.z + oz), quat, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, matrix);
  });
  place(ac, roofTops, t => [Math.cos(t.b.facing) * t.w * .22, -Math.sin(t.b.facing) * t.w * .22]);
  place(tank, tanks, t => [-Math.cos(t.b.facing) * t.w * .2, Math.sin(t.b.facing) * t.w * .2]);
  place(mast, masts); place(beacon, masts);
  group.add(ac, tank, mast, beacon);

  // Street lamps just outside the orbit circle, each with a pool of light on the paving.
  const lamps = props.filter(p => p.kind === 'lamp'), trees = props.filter(p => p.kind === 'tree');
  const post = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(.22, .3, 14, 8).translate(0, 7, 0)), keep(new THREE.MeshStandardMaterial({color: '#25292b', roughness: .5, metalness: .5})), lamps.length);
  const head = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(.85, 16, 10).translate(0, 14.2, 0)), keep(new THREE.MeshBasicMaterial({color: new THREE.Color('#ffd9a0').multiplyScalar(3), toneMapped: false})), lamps.length);
  const pool = new THREE.InstancedMesh(keep(new THREE.PlaneGeometry(22, 22).rotateX(-Math.PI / 2)), keep(new THREE.MeshBasicMaterial({map: keep(canvasTexture(128, 128, (ctx, s) => { const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(255,214,150,.55)'); g.addColorStop(1, 'rgba(255,214,150,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); })), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending})), lamps.length);
  lamps.forEach((l, i) => {
    matrix.compose(new THREE.Vector3(l.x, -.3, l.z), quat.identity(), new THREE.Vector3(1, 1, 1));
    post.setMatrixAt(i, matrix); head.setMatrixAt(i, matrix);
    matrix.compose(new THREE.Vector3(l.x * .93, -.27, l.z * .93), quat.identity(), new THREE.Vector3(1, 1, 1));
    pool.setMatrixAt(i, matrix);
  });
  // Trees: a trunk and a clustered crown in evening greens.
  const trunk = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(.45, .65, 7, 8).translate(0, 3.5, 0)), keep(new THREE.MeshStandardMaterial({color: '#4b382c', roughness: 1})), trees.length);
  const crownGeo = keep(new THREE.IcosahedronGeometry(3.6, 2));
  const crowns = [[0, 10, 0, 1], [2.2, 8.8, .8, .75], [-1.9, 9.2, -.9, .8], [.4, 12, -.6, .7]].map(([x, y, z, s], j) => {
    const m = new THREE.InstancedMesh(crownGeo, keep(new THREE.MeshStandardMaterial({color: ['#3f5f3a', '#4a6b41', '#36532f', '#55764a'][j], roughness: .95})), trees.length);
    trees.forEach((t, i) => { matrix.compose(new THREE.Vector3(t.x + x * t.scale, -.3 + y * t.scale, t.z + z * t.scale), quat.identity(), new THREE.Vector3(s * t.scale, s * t.scale * .9, s * t.scale)); m.setMatrixAt(i, matrix); });
    return m;
  });
  trees.forEach((t, i) => { matrix.compose(new THREE.Vector3(t.x, -.3, t.z), quat.identity(), new THREE.Vector3(t.scale, t.scale, t.scale)); trunk.setMatrixAt(i, matrix); });
  group.add(post, head, pool, trunk, ...crowns);

  // Traffic: car bodies and cabins, white headlights, red taillights, circling in two lanes.
  const carCount = detail < 1 ? 6 : 12, carColors = ['#c8402f', '#e8e3d8', '#2d3a4a', '#d9a441', '#3f6b5a', '#8a8f96', '#1f1f24', '#5b7fb0'];
  const carBody = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(4.2, 1.6, 8.6).translate(0, 1.1, 0)), keep(new THREE.MeshStandardMaterial({roughness: .35, metalness: .5, envMap: skyEnv, envMapIntensity: 1.2})), carCount);
  const carCabin = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(3.6, 1.3, 4.4).translate(0, 2.5, -.4)), keep(new THREE.MeshStandardMaterial({color: '#1d2329', roughness: .1, metalness: .8, envMap: skyEnv, envMapIntensity: 1.5})), carCount);
  const headlight = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(3.6, .45, .1).translate(0, 1.3, 4.32)), keep(new THREE.MeshBasicMaterial({color: new THREE.Color('#fff4dc').multiplyScalar(4), toneMapped: false})), carCount);
  const taillight = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(3.6, .4, .1).translate(0, 1.4, -4.32)), keep(new THREE.MeshBasicMaterial({color: new THREE.Color('#ff2a1a').multiplyScalar(3), toneMapped: false})), carCount);
  const carState = Array.from({length: carCount}, (_, i) => ({angle: (i / carCount) * Math.PI * 2 + i * .3, lane: i % 2, speed: .07 + (i % 4) * .012}));
  carState.forEach((c, i) => carBody.setColorAt(i, color.set(carColors[i % carColors.length])));
  group.add(carBody, carCabin, headlight, taillight);
  const placeCars = () => carState.forEach((c, i) => {
    const r = c.lane ? STREET.outer - 2.6 : STREET.inner + 2.6, dir = c.lane ? 1 : -1;
    quat.setFromAxisAngle(up, c.angle + dir * Math.PI / 2);
    matrix.compose(new THREE.Vector3(Math.sin(c.angle) * r, -.36, Math.cos(c.angle) * r), quat, new THREE.Vector3(1, 1, 1));
    for (const m of [carBody, carCabin, headlight, taillight]) m.setMatrixAt(i, matrix);
  });
  placeCars();

  // Seen from underneath, the one-sided ground disappears; a faint grid keeps the floor readable.
  const grid = new THREE.GridHelper(150, 38, '#9fd8ff', '#9fd8ff');
  grid.material.transparent = true; grid.material.opacity = 0; grid.position.y = -.3; grid.visible = false;
  keep(grid.geometry, grid.material);
  group.add(grid);

  group.traverse(o => { if (o.isInstancedMesh) o.frustumCulled = false; });

  let time = 0;
  return {
    group,
    fog: new THREE.FogExp2('#4f3f5c', .0032),
    // Evening light for the scene: cool sky fill, a warm low key; the duck keeps its studio rig.
    hemisphere: {sky: '#6f7fb8', ground: '#3d2f35', intensity: .7},
    update(dt, camera, animate, duck) {
      const below = camera.position.y < 0;
      grid.visible = below; grid.material.opacity = below ? .35 : 0;
      if (duck) footRing.position.set(duck.x, -.29, duck.z);
      if (!animate) return false;
      time += dt;
      for (const c of carState) c.angle += (c.lane ? 1 : -1) * c.speed * dt;
      placeCars();
      for (const m of [carBody, carCabin, headlight, taillight]) m.instanceMatrix.needsUpdate = true;
      // Aircraft beacons blink together; the duck's light ring breathes.
      beaconMat.color.setRGB(time % 1.6 < .35 ? 3 : .25, time % 1.6 < .35 ? .35 : .03, time % 1.6 < .35 ? .27 : .02);
      footRing.material.opacity = .75 + Math.sin(time * 2.2) * .2;
      return true;
    },
    dispose() { for (const item of disposables) item.dispose?.(); }
  };
}

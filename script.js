// ─── MTL LOADER ──────────────────────────────────────────────────────────────
class MTLLoader {
  constructor(mgr) { this.mgr = mgr || THREE.DefaultLoadingManager; }
  load(url, onLoad, onProg, onErr) {
    new THREE.FileLoader(this.mgr).load(url, t => onLoad(this.parse(t)), onProg, onErr);
  }
  parse(text) {
    const info = {}; let cur = null;
    for (let line of text.split('\n')) {
      line = line.trim();
      if (!line || line[0] === '#') continue;
      const sp = line.indexOf(' ');
      const k = sp >= 0 ? line.slice(0, sp) : line;
      const v = sp >= 0 ? line.slice(sp + 1).trim() : '';
      if (k === 'newmtl') { cur = v; info[cur] = { name: cur }; }
      else if (cur && k === 'Kd') { info[cur].kd = v.split(/\s+/).map(Number); }
    }
    return new MatCreator(info);
  }
}

class MatCreator {
  constructor(info) { this.info = info; this.mats = {}; }
  preload() { for (const n in this.info) this.create(n); }
  create(name) {
    if (!this.mats[name]) {
      const d     = this.info[name] || {};
      const kd    = d.kd || [1, 1, 1];
      const props = MATERIAL_PROPS[name] || MATERIAL_PROPS._default;
      let m;

      if (name === 'Record') {
        // MeshPhysicalMaterial for vinyl — enables normalMap-driven anisotropy
        m = new THREE.MeshPhysicalMaterial({
          color:          new THREE.Color(kd[0], kd[1], kd[2]),
          roughness:      props.roughness,
          metalness:      props.metalness,
          normalMap:      vinylNormalMap,
          normalScale:    new THREE.Vector2(1.2, 1.2),
          envMap:         envMap,
          envMapIntensity: 0.6,
          reflectivity:   0.4,
        });
      } else if (name === 'Steel') {
        // Chrome-look: high metalness, low roughness, strong env reflection
        m = new THREE.MeshStandardMaterial({
          color:           new THREE.Color(0xf0f0f0),
          roughness:       props.roughness,
          metalness:       props.metalness,
          envMap:          envMap,
          envMapIntensity: 1.8,
        });
      } else {
        m = new THREE.MeshStandardMaterial({
          color:     new THREE.Color(kd[0], kd[1], kd[2]),
          roughness: props.roughness,
          metalness: props.metalness,
        });
      }

      m.name = name;
      this.mats[name] = m;
    }
    return this.mats[name];
  }
  get(name) { return this.mats[name] || null; }
}

// ─── SMOOTH-BY-ANGLE NORMALS ─────────────────────────────────────────────────
// Replaces computeVertexNormals() with an angle-weighted version.
// Faces sharing a vertex are averaged together only when the angle between
// them is below thresholdDeg — giving smooth silhouettes on curves while
// keeping intentional hard edges (e.g. the flat top/bottom of the coaster).
function computeSmoothedNormals(geo, thresholdDeg) {
  const pos    = geo.attributes.position;
  const count  = pos.count;
  const thresh = Math.cos(thresholdDeg * Math.PI / 180);

  // Compute per-face normals and centroids
  const faceNormals = [];
  for (let f = 0; f < count; f += 3) {
    const ax = pos.getX(f),   ay = pos.getY(f),   az = pos.getZ(f);
    const bx = pos.getX(f+1), by = pos.getY(f+1), bz = pos.getZ(f+1);
    const cx = pos.getX(f+2), cy = pos.getY(f+2), cz = pos.getZ(f+2);
    const ex = bx-ax, ey = by-ay, ez = bz-az;
    const fx = cx-ax, fy = cy-ay, fz = cz-az;
    // Cross product e × f
    const nx = ey*fz - ez*fy;
    const ny = ez*fx - ex*fz;
    const nz = ex*fy - ey*fx;
    const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
    faceNormals.push(nx/len, ny/len, nz/len);
  }

  // Build a position→vertex index map (weld by position string key)
  const posKey  = i => `${pos.getX(i).toFixed(6)},${pos.getY(i).toFixed(6)},${pos.getZ(i).toFixed(6)}`;
  const posToVerts = {};
  for (let i = 0; i < count; i++) {
    const k = posKey(i);
    if (!posToVerts[k]) posToVerts[k] = [];
    posToVerts[k].push(i);
  }

  // For each vertex, average face normals within the threshold angle
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const fi  = Math.floor(i / 3);
    const fnx = faceNormals[fi*3], fny = faceNormals[fi*3+1], fnz = faceNormals[fi*3+2];
    let sx = fnx, sy = fny, sz = fnz;

    const neighbours = posToVerts[posKey(i)] || [];
    for (const j of neighbours) {
      if (j === i) continue;
      const fj  = Math.floor(j / 3);
      if (fj === fi) continue;
      const nx2 = faceNormals[fj*3], ny2 = faceNormals[fj*3+1], nz2 = faceNormals[fj*3+2];
      const dot = fnx*nx2 + fny*ny2 + fnz*nz2;
      if (dot >= thresh) { sx += nx2; sy += ny2; sz += nz2; }
    }

    const len = Math.sqrt(sx*sx + sy*sy + sz*sz) || 1;
    normals[i*3]     = sx/len;
    normals[i*3 + 1] = sy/len;
    normals[i*3 + 2] = sz/len;
  }

  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
}

// ─── OBJ LOADER ──────────────────────────────────────────────────────────────
class OBJLoader {
  constructor(mgr) { this.mgr = mgr || THREE.DefaultLoadingManager; this.mats = null; }
  setMaterials(m) { this.mats = m; return this; }
  load(url, onLoad, onProg, onErr) {
    new THREE.FileLoader(this.mgr).load(url, t => onLoad(this.parse(t)), onProg, onErr);
  }
  parse(text) {
    const vp = [], vn = [];
    const groups = {};
    let curMat = 'default';
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line[0] === '#') continue;
      const p = line.split(/\s+/);
      switch (p[0]) {
        case 'v':      vp.push(+p[1], +p[2], +p[3]); break;
        case 'vn':     vn.push(+p[1], +p[2], +p[3]); break;
        case 'usemtl': curMat = p.slice(1).join(' '); break;
        case 'f': {
          if (!groups[curMat]) groups[curMat] = { pos: [], nor: [] };
          const fv = p.slice(1).map(s => s.split('/').map(x => x ? +x - 1 : -1));
          for (let i = 1; i < fv.length - 1; i++) {
            for (const [vi,, ni] of [fv[0], fv[i], fv[i + 1]]) {
              if (vi >= 0) groups[curMat].pos.push(vp[vi*3], vp[vi*3+1], vp[vi*3+2]);
              if (ni >= 0) groups[curMat].nor.push(vn[ni*3], vn[ni*3+1], vn[ni*3+2]);
            }
          }
          break;
        }
      }
    }
    const root = new THREE.Group();
    for (const [matName, data] of Object.entries(groups)) {
      if (!data.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
      if (data.nor.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.nor, 3));
      else computeSmoothedNormals(geo, 35);
      let mat = this.mats ? this.mats.get(matName) : null;
      if (!mat) mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.72, metalness: 0 });
      mat = mat.clone(); mat.name = matName;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = matName;
      root.add(mesh);
    }
    return root;
  }
}

// ─── SCENE SETUP ─────────────────────────────────────────────────────────────
const wrap = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
wrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const bgLightColor = new THREE.Color('#EDE7DF');
const bgDarkColor  = new THREE.Color('#0f0f0f');
scene.background = bgLightColor.clone();

const camera = new THREE.PerspectiveCamera(38, 1, 0.001, 100);
scene.add(camera);


// ─── ENVIRONMENT MAP (chrome/metal reflections) ──────────────────────────────
// Single vertical gradient baked into an equirectangular DataTexture, then
// converted to a PMREMGenerator cube map. One seamless horizon = smooth chrome
// reflections with no visible wall edges.
//
// Gradient stops (top → bottom):
//   sky-blue top  →  sandy-tan horizon  →  dark-blue lower sky
// Tune the colour stops here to change the look of all metal/reflective surfaces.
function buildEnvMap() {
  const W = 512, H = 256;
  const data = new Uint8Array(W * H * 4);

  // Gradient colour stops: [ 0..1 position, r, g, b ] — all in 0-255
  const stops = [
    [ 0.00,  42,  82, 130 ],   // deep sky blue — very top
    [ 0.30,  96, 145, 185 ],   // mid sky blue
    [ 0.50, 214, 195, 166 ],   // sandy tan — horizon
    [ 0.65, 180, 165, 148 ],   // warm shadow below horizon
    [ 0.80,  30,  42,  68 ],   // dark blue lower sky / floor reflection
    [ 1.00,  15,  20,  35 ],   // near-black at very bottom
  ];

  function sampleGradient(t) {
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, r0, g0, b0] = stops[i];
      const [t1, r1, g1, b1] = stops[i + 1];
      if (t >= t0 && t <= t1) {
        const f = (t - t0) / (t1 - t0);
        return [
          Math.round(r0 + (r1 - r0) * f),
          Math.round(g0 + (g1 - g0) * f),
          Math.round(b0 + (b1 - b0) * f),
        ];
      }
    }
    return [stops[stops.length-1][1], stops[stops.length-1][2], stops[stops.length-1][3]];
  }

  for (let y = 0; y < H; y++) {
    const t   = y / (H - 1);
    const [r, g, b] = sampleGradient(t);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data[i]     = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }

  const equirect = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  equirect.encoding  = THREE.sRGBEncoding;
  equirect.mapping   = THREE.EquirectangularReflectionMapping;
  equirect.needsUpdate = true;

  // Convert to PMREM so Three.js can use it for PBR environment lighting
  const pmrem   = new THREE.PMREMGenerator(renderer);
  const envMap  = pmrem.fromEquirectangular(equirect).texture;
  pmrem.dispose();
  equirect.dispose();
  return envMap;
}

const envMap = buildEnvMap();
scene.environment = envMap; // all PBR materials pick this up automatically

// ─── VINYL RADIAL NORMAL MAP ─────────────────────────────────────────────────
// Baked at runtime onto a canvas. Encodes the direction of the concentric
// grooves so specular highlights stretch radially — the anisotropic look of
// real vinyl without a custom shader.
function buildVinylNormalMap(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx  = canvas.getContext('2d');
  const imgd = ctx.createImageData(size, size);
  const data = imgd.data;
  const half = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Vector from centre → this pixel
      const dx = x - half;
      const dy = y - half;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;

      // Tangent direction (perpendicular to radius = groove direction)
      const tx = -dy / len;
      const ty =  dx / len;

      // Groove depth modulation: subtle sine ripple along radius
      const r   = len / half;
      const rip = Math.sin(r * 180 * Math.PI) * 0.12; // 180 groove bands

      // Normal = blend of surface normal (0,0,1) perturbed by tangent
      // strength controls how pronounced the anisotropy is
      const strength = 0.35;
      const nx =  tx * strength + rip * 0.08;
      const ny = -ty * strength + rip * 0.08;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));

      const i = (y * size + x) * 4;
      data[i]     = Math.round((nx * 0.5 + 0.5) * 255); // R
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255); // G
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255); // B
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(imgd, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.encoding = THREE.LinearEncoding;
  return tex;
}

const vinylNormalMap = buildVinylNormalMap();

// ─── THEME TOGGLE ────────────────────────────────────────────────────────────
let isDarkMode = false;
const themeBtn = document.getElementById('themeBtn');

window.toggleDarkMode = function() {
  isDarkMode = !isDarkMode;
  document.body.classList.toggle('dark-mode', isDarkMode);
  themeBtn.textContent = isDarkMode ? '○ \u00a0Light Mode' : '☾ \u00a0Dark Mode';
};

// ─── LIGHTING CONFIG ─────────────────────────────────────────────────────────
// All scene lighting in one place. Edit values here, then call
// applyLightingConfig() in the browser console to hot-reload without a reload.
//
// Shadow tuning guide:
//   bias      — negative pulls shadow toward caster. Too negative = detached
//               shadow. Too close to 0 = shadow acne. Range: -0.0001 to -0.00005
//   mapSize   — shadow map resolution. Higher = sharper (1024/2048/4096/8192).
//   radius    — PCF blur softness. 0 = hard. 4–8 = soft.
//   frustum   — orthographic box the shadow camera sees, in world units.
//               Must contain every shadow-casting object. Smaller = sharper.
//   opacity   — floor shadow darkness (0 = none, 1 = black).
const LIGHTING_CONFIG = {
  ambient: {
    color:     0xffffff,
    intensity: 0.2,
  },
  key: {
    color:     0xffffff,
    intensity: 0.5,
    position:  { x: 4, y: 8, z: 3 },
    shadow: {
      mapSize:  8192,
      radius:   3,
      bias:     -0.00008,
      near:     0.001,
      far:      10.0,
      left:    -0.2,
      right:    0.2,
      top:      0.2,
      bottom:  -0.2,
    },
  },
  fill: {
    color:     0xddeeff,
    intensity: 0.2,
    position:  { x: -4, y: 3, z: 2 },
  },
  rim: {
    color:     0xfff5e8,
    intensity: 0.4,
    position:  { x: 0, y: 4, z: -4 },
  },
  shadow: {
    opacity: 0.4,
    planeY:  0.0,
  },
};

// ─── LIGHTING & SHADOWS ──────────────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(
  LIGHTING_CONFIG.ambient.color,
  LIGHTING_CONFIG.ambient.intensity
);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(
  LIGHTING_CONFIG.key.color,
  LIGHTING_CONFIG.key.intensity
);
keyLight.position.set(
  LIGHTING_CONFIG.key.position.x,
  LIGHTING_CONFIG.key.position.y,
  LIGHTING_CONFIG.key.position.z
);
keyLight.castShadow = true;
keyLight.shadow.mapSize.setScalar(LIGHTING_CONFIG.key.shadow.mapSize);
keyLight.shadow.radius        = LIGHTING_CONFIG.key.shadow.radius;
keyLight.shadow.bias          = LIGHTING_CONFIG.key.shadow.bias;
keyLight.shadow.camera.near   = LIGHTING_CONFIG.key.shadow.near;
keyLight.shadow.camera.far    = LIGHTING_CONFIG.key.shadow.far;
keyLight.shadow.camera.left   = LIGHTING_CONFIG.key.shadow.left;
keyLight.shadow.camera.right  = LIGHTING_CONFIG.key.shadow.right;
keyLight.shadow.camera.top    = LIGHTING_CONFIG.key.shadow.top;
keyLight.shadow.camera.bottom = LIGHTING_CONFIG.key.shadow.bottom;
keyLight.shadow.camera.updateProjectionMatrix();
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(
  LIGHTING_CONFIG.fill.color,
  LIGHTING_CONFIG.fill.intensity
);
fillLight.position.set(
  LIGHTING_CONFIG.fill.position.x,
  LIGHTING_CONFIG.fill.position.y,
  LIGHTING_CONFIG.fill.position.z
);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(
  LIGHTING_CONFIG.rim.color,
  LIGHTING_CONFIG.rim.intensity
);
rimLight.position.set(
  LIGHTING_CONFIG.rim.position.x,
  LIGHTING_CONFIG.rim.position.y,
  LIGHTING_CONFIG.rim.position.z
);
scene.add(rimLight);

const shadowMat = new THREE.ShadowMaterial({
  opacity:     LIGHTING_CONFIG.shadow.opacity,
  transparent: true,
});
const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), shadowMat);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.position.y = LIGHTING_CONFIG.shadow.planeY;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

// Hot-reload lighting config without a page reload.
function applyLightingConfig() {
  ambientLight.color.set(LIGHTING_CONFIG.ambient.color);
  ambientLight.intensity = LIGHTING_CONFIG.ambient.intensity;
  keyLight.color.set(LIGHTING_CONFIG.key.color);
  keyLight.intensity = LIGHTING_CONFIG.key.intensity;
  keyLight.position.set(LIGHTING_CONFIG.key.position.x, LIGHTING_CONFIG.key.position.y, LIGHTING_CONFIG.key.position.z);
  keyLight.shadow.radius        = LIGHTING_CONFIG.key.shadow.radius;
  keyLight.shadow.bias          = LIGHTING_CONFIG.key.shadow.bias;
  keyLight.shadow.camera.near   = LIGHTING_CONFIG.key.shadow.near;
  keyLight.shadow.camera.far    = LIGHTING_CONFIG.key.shadow.far;
  keyLight.shadow.camera.left   = LIGHTING_CONFIG.key.shadow.left;
  keyLight.shadow.camera.right  = LIGHTING_CONFIG.key.shadow.right;
  keyLight.shadow.camera.top    = LIGHTING_CONFIG.key.shadow.top;
  keyLight.shadow.camera.bottom = LIGHTING_CONFIG.key.shadow.bottom;
  keyLight.shadow.camera.updateProjectionMatrix();
  keyLight.shadow.map = null;
  fillLight.color.set(LIGHTING_CONFIG.fill.color);
  fillLight.intensity = LIGHTING_CONFIG.fill.intensity;
  fillLight.position.set(LIGHTING_CONFIG.fill.position.x, LIGHTING_CONFIG.fill.position.y, LIGHTING_CONFIG.fill.position.z);
  rimLight.color.set(LIGHTING_CONFIG.rim.color);
  rimLight.intensity = LIGHTING_CONFIG.rim.intensity;
  rimLight.position.set(LIGHTING_CONFIG.rim.position.x, LIGHTING_CONFIG.rim.position.y, LIGHTING_CONFIG.rim.position.z);
  shadowPlane.material.opacity = LIGHTING_CONFIG.shadow.opacity;
  shadowPlane.position.y       = LIGHTING_CONFIG.shadow.planeY;
}

// ─── ORBIT CONTROLS ──────────────────────────────────────────────────────────
let drag = false, px = 0, py = 0;
let targetSph  = { t: -0.5, p: 1.05, r: 0.22 };
let currentSph = { t: -0.5, p: 1.05, r: 0.22 };
let targetTgt  = new THREE.Vector3(0, 0.01, 0);
let currentTgt = new THREE.Vector3(0, 0.01, 0);
let autoRot = true, rotTimer = null;
let targetViewOffsetY  = 0;
let currentViewOffsetY = 0;

function updateCam() {
  const { t, p, r } = currentSph;
  camera.position.set(
    currentTgt.x + r * Math.sin(p) * Math.sin(t),
    currentTgt.y + r * Math.cos(p),
    currentTgt.z + r * Math.sin(p) * Math.cos(t)
  );
  camera.lookAt(currentTgt);
}

const cvs = renderer.domElement;
cvs.addEventListener('mousedown', e => {
  drag = true;
  px = e.clientX; py = e.clientY;
  autoRot = false; clearTimeout(rotTimer);
});
window.addEventListener('mouseup', () => {
  drag = false;
  rotTimer = setTimeout(() => { autoRot = true; }, 4000);
});
window.addEventListener('mousemove', e => {
  if (!drag) return;
  const dx = e.clientX - px, dy = e.clientY - py;
  px = e.clientX; py = e.clientY;
  targetSph.t -= dx * 0.008;
  targetSph.p = Math.max(0.01, Math.min(Math.PI - 0.01, targetSph.p - dy * 0.008));
});
cvs.addEventListener('wheel', e => {
  e.preventDefault();
  targetSph.r = Math.max(0.08, Math.min(0.6, targetSph.r + e.deltaY * 0.0002));
  autoRot = false; clearTimeout(rotTimer);
  rotTimer = setTimeout(() => { autoRot = true; }, 3000);
}, { passive: false });

// ─── MATERIAL PROPERTIES ─────────────────────────────────────────────────────
// Tune roughness (0 = mirror, 1 = fully diffuse) and metalness (0–1) per
// material here. Changes take effect on next page load since materials are
// created during OBJ parse. All names match the MTL material names exactly.
//
// Coaster OBJ  (Signal_Record_Coaster_01.mtl)
//   Record      — vinyl body
//   Red         — Side A label
//   Blue        — Side B label
//
// Base OBJ     (Signal_Record_Coaster_Base_01.mtl)  — names may vary by export;
//   check your MTL file for the exact names used there.
//   Yellow      — main body
//   Blue        — side panel  (shared name with coaster Blue — same props apply)
//   Feet        — rubber feet
//   Pin_Mount   — spindle housing
//   Steel       — steel pin
//
const MATERIAL_PROPS = {
  // ── Coaster ──────────────────────────────────────────────────────────────
  // normalScale: strength of the radial groove normal map (0 = flat, 2 = very deep)
  Record:    { roughness: 0.0, metalness: 0.5,  normalScale: 2.0 },
  Red:       { roughness: 0.5, metalness: 0.0  },
  Blue:      { roughness: 0.5, metalness: 0.0  },

  // ── Base ─────────────────────────────────────────────────────────────────
  Yellow:    { roughness: 0.6,  metalness: 0.0  },  // main body
  Feet:      { roughness: 0.6, metalness: 0.0  },  // rubber feet — very matte
  Pin_Mount: { roughness: 0.6,  metalness: 0.0  },  // spindle housing
  // envMapIntensity: reflection strength (0 = none, 2 = very strong)
  Steel:     { roughness: 0.2, metalness: 0.95, envMapIntensity: 1.0 },

  // ── Fallback for any unlisted material ───────────────────────────────────
  _default:  { roughness: 0.72, metalness: 0.0  },
};

// ─── COLOR STATE ─────────────────────────────────────────────────────────────
// Default colors — single source of truth for reset
const DEFAULT_COLORS = {
  // Coaster
  Coaster_Body: '#1A1A1A',
  Label_A:      '#D93636',
  Label_B:      '#0F6FD7',
  // Base
  Yellow:       '#F5B82E',
  Side_Panel:   '#0F6FD7',
  Feet:         '#1A1A1A',
  Pin_Mount:    '#1A1A1A',
};

const colors = { ...DEFAULT_COLORS };

// Direct map from Signal_Record_Coaster_01.mtl material names → colors keys
// MTL defines exactly: Red, Blue, Record
const COASTER_MAT_MAP = {
  'Red':    'Label_A',
  'Blue':   'Label_B',
  'Record': 'Coaster_Body',
};

// ─── LABEL TEXTURE STATE ─────────────────────────────────────────────────────
// Stores the source Image and offscreen canvas per label slot so we can
// redraw the canvas (with updated background color) whenever the picker changes.
const labelState = {
  Red:  { img: null, canvas: null, tex: null },
  Blue: { img: null, canvas: null, tex: null },
};

// Draw img cover-cropped onto a square canvas with bgHex as background.
// Alpha areas of the image show the background color.
function drawLabelCanvas(canvas, img, bgHex) {
  const size = canvas.width;
  const ctx  = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  // Fill background with current label color
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, size, size);
  // Cover-crop: scale to fill, center, let overflow clip naturally
  const scale = Math.max(size / img.width, size / img.height);
  const dw    = img.width  * scale;
  const dh    = img.height * scale;
  ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
}

// Inject flat circular UV coordinates onto a label mesh from its vertex positions.
// Called once after the coaster model loads on Red and Blue meshes only.
// The Record mesh is intentionally left without UVs so the vinyl normal map
// is never activated — keeping the vinyl look correct.
function injectLabelUVs(mesh, mirrorU) {
  const pos = mesh.geometry.attributes.position;
  if (!pos) return;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const r  = Math.max(maxX - minX, maxZ - minZ) / 2 || 1;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) - cx) / (r * 2) + 0.5;
    uvs[i * 2]     = mirrorU ? 1.0 - u : u;
    uvs[i * 2 + 1] = (pos.getZ(i) - cz) / (r * 2) + 0.5;
  }
  mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
}

// Apply or clear the texture on all coaster stack meshes matching matName.
// When active: material color = white (so image shows true), map = canvas texture.
// When cleared: material color restored from picker, map = null.
function applyLabelTexture(matName) {
  const state    = labelState[matName];
  const colorKey = COASTER_MAT_MAP[matName];
  const hasTex   = !!state.tex;
  coasterStack.forEach(cGroup => {
    cGroup.traverse(m => {
      if (!m.isMesh || m.name !== matName) return;
      if (hasTex) {
        m.material.map   = state.tex;
        m.material.color.set(0xffffff); // white = no tint, image shows true
      } else {
        m.material.map   = null;
        if (colorKey) m.material.color.copy(hexToC(colors[colorKey]));
      }
      m.material.needsUpdate = true;
    });
  });
}

// Called when the color picker changes for a label that has an active texture.
// Redraws the canvas background so alpha areas update immediately.
function updateLabelTextureBackground(matName, bgHex) {
  const state = labelState[matName];
  if (!state.img || !state.canvas || !state.tex) return;
  drawLabelCanvas(state.canvas, state.img, bgHex);
  state.tex.needsUpdate = true;
}

window.handleLabelUpload = function(side, input) {
  const file = input.files[0];
  if (!file) return;
  const matName  = side === 'A' ? 'Red'     : 'Blue';
  const colorKey = side === 'A' ? 'Label_A' : 'Label_B';

  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const state = labelState[matName];

      // Dispose previous texture if any
      if (state.tex) { state.tex.dispose(); state.tex = null; }

      // Create offscreen canvas and draw cover-crop with current label color as bg
      const size   = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      drawLabelCanvas(canvas, img, colors[colorKey] || '#ffffff');

      const tex = new THREE.CanvasTexture(canvas);
      tex.encoding    = THREE.sRGBEncoding;
      tex.flipY       = true;
      tex.needsUpdate = true;

      state.img    = img;
      state.canvas = canvas;
      state.tex    = tex;

      applyLabelTexture(matName);

      document.getElementById('upload-btn-' + colorKey).style.display = 'none';
      document.getElementById('clear-btn-'  + colorKey).style.display = 'flex';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
};

window.clearLabelTexture = function(side) {
  const matName  = side === 'A' ? 'Red'     : 'Blue';
  const colorKey = side === 'A' ? 'Label_A' : 'Label_B';
  const state    = labelState[matName];
  if (state.tex) { state.tex.dispose(); state.tex = null; }
  state.img = null; state.canvas = null;
  applyLabelTexture(matName);
  const sw = document.getElementById('swatch-' + colorKey);
  if (sw) { sw.style.backgroundImage = ''; sw.style.background = colors[colorKey]; }
  document.getElementById('upload-btn-' + colorKey).style.display = 'flex';
  document.getElementById('clear-btn-'  + colorKey).style.display = 'none';
};

// ─── URL SYNC ────────────────────────────────────────────────────────────────
function loadFromURL() {
  const params = new URLSearchParams(window.location.search);
  let loaded = false;
  for (const key of Object.keys(colors)) {
    if (params.has(key)) {
      const hex = '#' + params.get(key);
      colors[key] = hex;
      syncColorUI(key, hex);
      loaded = true;
    }
  }
  if (params.has('stack')) {
    const s = parseInt(params.get('stack'));
    if (!isNaN(s)) { stackCount = s; loaded = true; }
  }
  if (loaded) {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  }
}

// Update all UI elements for one color key
function syncColorUI(key, hex) {
  const sw  = document.getElementById('swatch-' + key);
  const hx  = document.getElementById('hex-' + key);
  const inp = document.getElementById('color-' + key);
  if (sw)  sw.style.background = hex;
  if (hx)  hx.textContent = hex.toUpperCase();
  if (inp) inp.value = hex;
}

// ─── MODEL STATE ─────────────────────────────────────────────────────────────
let model        = null;
let coasterModel = null;
let coasterStack = [];
let stackCount   = 4;

// ─── FLIP ANIMATION STATE ────────────────────────────────────────────────────
// isFlipped: false = Side A facing up, true = Side B facing up
let isFlipped     = false;
let isAnimating   = false;

// ─── SPIN STATE  ─────────────────────────────────────────────────────────────
// RPM values: 33.333, 45, 78 \u2192 radians per frame at 60fps
// 0 = stopped
let spinRPM = 0;
const RPM_TO_RAD_PER_FRAME = ((2 * Math.PI) / 60) * 0.02; // 1 RPM at 60fps

window.setSpin = function(rpm) {
  spinRPM = rpm;
  document.querySelectorAll('.rpm-chip').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.rpm) === rpm);
  });
  syncAudio();
};

function updateSpinUI() {
  const rpmRow = document.getElementById('rpm-row');
  const volRow = document.getElementById('volume-row');
  const active = stackCount === 1;
  if (rpmRow) {
    rpmRow.style.opacity       = active ? '1' : '0.35';
    rpmRow.style.pointerEvents = active ? '' : 'none';
  }
  if (volRow) {
    volRow.style.opacity       = active ? '1' : '0.35';
    volRow.style.pointerEvents = active ? '' : 'none';
  }
  // Always reset to OFF when not active so the OFF chip stays highlighted
  if (!active) window.setSpin(0);
}

// ─── AUDIO SYSTEM ────────────────────────────────────────────────────────────
// Plays per-theme, per-side ambient tracks when qty=1 and RPM > 0.
// Playback rate shifts in real time with RPM selection.
// 33⅓ is the reference speed (1.0x). 45 and 78 scale proportionally.
// Theme switches and side flips crossfade over CROSSFADE_MS milliseconds.

const CROSSFADE_MS    = 800;
const BASE_RPM        = 33.333;
const AUDIO_BASE_PATH = './audio/';

// Track the active theme name so audio knows what to play
let activeThemeName = 'signal';

// Current audio state
let audioCtx        = null;
let currentSource   = null;  // AudioBufferSourceNode currently playing
let currentGain     = null;  // GainNode for current source
let masterGain      = null;  // Master volume GainNode
let audioVolume     = 0.8;
let restartTimer    = null;  // setTimeout handle for the 3s pause before replay

// Cache loaded AudioBuffers so we don't re-fetch on every spin/flip
const audioCache = {};

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = audioVolume;
    masterGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

function trackKey(theme, side) {
  return `${theme}-${side}`;
}

function trackUrl(theme, side) {
  return `${AUDIO_BASE_PATH}${theme}-${side}.mp3`;
}

async function loadTrack(theme, side) {
  const key = trackKey(theme, side);
  if (audioCache[key]) return audioCache[key];
  try {
    const ctx  = getAudioCtx();
    const resp = await fetch(trackUrl(theme, side));
    if (!resp.ok) return null;
    const arr  = await resp.arrayBuffer();
    const buf  = await ctx.decodeAudioData(arr);
    audioCache[key] = buf;
    return buf;
  } catch (e) {
    return null;
  }
}

function rpmToPlaybackRate(rpm) {
  if (!rpm || rpm === 0) return 1.0;
  return rpm / BASE_RPM;
}

// Fade out the current source over CROSSFADE_MS, then stop it
function fadeOutCurrent() {
  // Cancel any pending restart so a ghost track doesn't fire during the pause
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  if (!currentSource || !currentGain) return;
  const ctx  = getAudioCtx();
  const now  = ctx.currentTime;
  const fade = CROSSFADE_MS / 1000;
  currentGain.gain.cancelScheduledValues(now);
  currentGain.gain.setValueAtTime(currentGain.gain.value, now);
  currentGain.gain.linearRampToValueAtTime(0, now + fade);
  const src = currentSource;
  setTimeout(() => { try { src.stop(); } catch(e) {} }, CROSSFADE_MS + 50);
  currentSource = null;
  currentGain   = null;
}

// Start a new source, fading in over CROSSFADE_MS
async function fadeInTrack(theme, side, rpm) {
  const ctx = getAudioCtx();
  if (ctx.state === 'suspended') await ctx.resume();

  const buf = await loadTrack(theme, side);
  if (!buf) return; // no file for this theme/side — silent

  const gain  = ctx.createGain();
  const now   = ctx.currentTime;
  const fade  = CROSSFADE_MS / 1000;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(1.0, now + fade);
  gain.connect(masterGain);

  const src         = ctx.createBufferSource();
  src.buffer        = buf;
  src.loop          = false;
  src.playbackRate.value = rpmToPlaybackRate(rpm);
  src.connect(gain);
  src.start(0);

  // When the track ends, wait 3 seconds then restart from the beginning
  src.onended = () => {
    // Only restart if this source is still the active one (not interrupted)
    if (currentSource !== src) return;
    currentSource = null;
    currentGain   = null;
    restartTimer  = setTimeout(() => {
      restartTimer = null;
      // Re-check conditions — user may have stopped or changed things during pause
      if (stackCount === 1 && spinRPM !== 0) {
        syncAudio();
      }
    }, 3000);
  };

  currentSource = src;
  currentGain   = gain;
}

// Main entry point — call whenever spin state, theme, or side changes
let isSyncing = false;

async function syncAudio() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const shouldPlay = (stackCount === 1 && spinRPM !== 0);

    if (!shouldPlay) {
      fadeOutCurrent();
      return;
    }

    const side = isFlipped ? 'b' : 'a';

    // If already playing the right track, just update playback rate
    if (currentSource) {
      const wantedKey  = trackKey(activeThemeName, side);
      const playingKey = currentSource._trackKey;
      if (playingKey === wantedKey) {
        currentSource.playbackRate.value = rpmToPlaybackRate(spinRPM);
        return;
      }
    }

    // Crossfade to new track
    fadeOutCurrent();
    await fadeInTrack(activeThemeName, side, spinRPM);
    if (currentSource) currentSource._trackKey = trackKey(activeThemeName, side);
  } finally {
    isSyncing = false;
  }
}

function setVolume(val) {
  audioVolume = parseFloat(val);
  if (masterGain) masterGain.gain.value = audioVolume;
}
window.setVolume = setVolume;

// ─── COLOR HELPERS ───────────────────────────────────────────────────────────
function hexToC(hex) {
  return new THREE.Color(hex).convertSRGBToLinear();
}

function applyColors() {
  // Base model — mesh names match colors keys directly
  if (model) {
    model.traverse(m => {
      if (!m.isMesh || m.name === 'Steel') return;
      const c = colors[m.name];
      if (c) m.material.color.copy(hexToC(c));
    });
  }
  // Coaster stack — exact MTL name lookup, no guessing
  coasterStack.forEach(cGroup => {
    cGroup.traverse(m => {
      if (!m.isMesh) return;
      const colorKey = COASTER_MAT_MAP[m.name];
      if (!colorKey) return;
      if (labelState[m.name] && labelState[m.name].tex) {
        // Texture active — redraw canvas background with new color so alpha areas update
        updateLabelTextureBackground(m.name, colors[colorKey]);
        return; // material color stays white
      }
      m.material.color.copy(hexToC(colors[colorKey]));
    });
  });
}

// Apply roughness, metalness, normalScale from MATERIAL_PROPS to every mesh.
// Call applyMaterialProps() in the browser console to hot-reload changes
// without a page reload — e.g. tweak MATERIAL_PROPS.Record.roughness then call it.
function applyMaterialProps() {
  const applyToMesh = m => {
    if (!m.isMesh) return;
    const props = MATERIAL_PROPS[m.name] || MATERIAL_PROPS._default;
    m.material.roughness = props.roughness;
    m.material.metalness = props.metalness;
    // Re-apply normalScale for vinyl if props expose it
    if (m.name === 'Record' && m.material.normalScale) {
      const ns = props.normalScale !== undefined ? props.normalScale : 1.2;
      m.material.normalScale.set(ns, ns);
    }
    // Re-apply envMapIntensity for steel
    if (m.name === 'Steel' && m.material.envMapIntensity !== undefined) {
      m.material.envMapIntensity = props.envMapIntensity !== undefined ? props.envMapIntensity : 1.8;
    }
    m.material.needsUpdate = true;
  };
  if (model) model.traverse(applyToMesh);
  coasterStack.forEach(g => g.traverse(applyToMesh));
}

// ─── LOAD & ASSEMBLE ─────────────────────────────────────────────────────────
const loadEl = document.getElementById('loading');
const progEl = document.getElementById('load-progress');
const mgr    = new THREE.LoadingManager();

function loadObjMtl(objPath, mtlPath) {
  return new Promise((resolve, reject) => {
    new MTLLoader(mgr).load(mtlPath, mc => {
      mc.preload();
      new OBJLoader(mgr).setMaterials(mc).load(
        objPath, resolve,
        xhr => { if (xhr.total) progEl.textContent = Math.round((xhr.loaded / xhr.total) * 100) + '%'; },
        reject
      );
    }, undefined, reject);
  });
}

loadFromURL();

Promise.all([
  loadObjMtl('./3D/Signal_Record_Coaster_Base_01.obj', './3D/Signal_Record_Coaster_Base_01.mtl'),
  loadObjMtl('./3D/Signal_Record_Coaster_01.obj',      './3D/Signal_Record_Coaster_01.mtl'),
]).then(([baseObj, costrObj]) => {

  // 1. Base — center, scale, ground
  const box = new THREE.Box3().setFromObject(baseObj);
  const cen = box.getCenter(new THREE.Vector3());
  const sz  = box.getSize(new THREE.Vector3());
  baseObj.position.sub(cen);
  const sc = 0.1 / Math.max(sz.x, sz.y, sz.z);
  baseObj.scale.setScalar(sc);
  baseObj.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(baseObj);
  baseObj.position.y -= scaledBox.min.y;
  baseObj.updateMatrixWorld(true);
  // Second-pass: re-measure after full world matrix resolution to catch any
  // child meshes (e.g. Feet) that sit below the first measured min.y
  const trueBox = new THREE.Box3().setFromObject(baseObj);
  if (trueBox.min.y < 0) baseObj.position.y -= trueBox.min.y;
  baseObj.updateMatrixWorld(true);
  baseObj.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  scene.add(baseObj);
  model = baseObj;

  // 2. Find pin position — search for Pin_Mount mesh by name
  window.pinX     = 0;
  window.pinZ     = 0;
  window.pinBaseY = 0;
  baseObj.traverse(c => {
    if (!c.isMesh) return;
    const low = c.name.toLowerCase();
    if (low.includes('mount') || low.includes('pin') || low.includes('spindle')) {
      const pBox = new THREE.Box3().setFromObject(c);
      if (pBox.max.y > window.pinBaseY) {
        const pCen = pBox.getCenter(new THREE.Vector3());
        window.pinX     = pCen.x;
        window.pinZ     = pCen.z;
        window.pinBaseY = pBox.max.y;
      }
    }
  });
  if (window.pinBaseY <= 0) {
    window.pinBaseY = trueBox.max.y * 0.15;
  }

  // 3. Coaster — center bottom at origin, wrap, scale
  const rawCBox = new THREE.Box3().setFromObject(costrObj);
  const rawCCen = rawCBox.getCenter(new THREE.Vector3());
  costrObj.position.set(-rawCCen.x, -rawCCen.y, -rawCCen.z);
  costrObj.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  const coasterWrapper = new THREE.Group();
  coasterWrapper.add(costrObj);
  coasterWrapper.scale.setScalar(sc);
  coasterWrapper.updateMatrixWorld(true);
  const scaledCBox = new THREE.Box3().setFromObject(coasterWrapper);
  window.cThickness = scaledCBox.max.y - scaledCBox.min.y;
  window.halfCThickness = window.cThickness / 2;
  coasterModel = coasterWrapper;

  // Inject UVs onto label meshes (Red, Blue) only for image upload support.
  // Record mesh is intentionally left without UVs — keeps vinyl normals correct.
  coasterWrapper.traverse(m => {
    if (m.isMesh && m.name === 'Red')  injectLabelUVs(m, true);  // mirror to correct Side A orientation
    if (m.isMesh && m.name === 'Blue') injectLabelUVs(m, false);
  });

  // 4. Build stack and apply colors + material properties
  window.updateStack(stackCount);
  applyColors();
  applyMaterialProps();

  // 5. Pre-load default label image into both Side A and Side B
  preloadLabelImage('./images/Signal_Symbol_01.svg');

  loadEl.classList.add('hidden');
  setTimeout(() => loadEl.style.display = 'none', 600);

}).catch(err => {
  console.error('Asset load error:', err);
  progEl.textContent = 'Load Error';
});

// ─── LABEL PRELOAD ──────────────────────────────────────────────────────────────────────────
// Loads a URL into both label slots using the same pipeline as manual upload.
// Called once after the coaster model finishes loading.
function preloadLabelImage(url) {
  const img = new Image();
  img.onload = () => {
    ['Red', 'Blue'].forEach(matName => {
      const colorKey = COASTER_MAT_MAP[matName];
      const state    = labelState[matName];
      if (state.tex) { state.tex.dispose(); state.tex = null; }
      const size   = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      drawLabelCanvas(canvas, img, colors[colorKey] || '#ffffff');
      const tex        = new THREE.CanvasTexture(canvas);
      tex.encoding     = THREE.sRGBEncoding;
      tex.flipY        = true;
      tex.needsUpdate  = true;
      state.img    = img;
      state.canvas = canvas;
      state.tex    = tex;
      applyLabelTexture(matName);
      const uploadBtn = document.getElementById('upload-btn-' + colorKey);
      const clearBtn  = document.getElementById('clear-btn-'  + colorKey);
      if (uploadBtn) uploadBtn.style.display = 'none';
      if (clearBtn)  clearBtn.style.display  = 'flex';
    });
  };
  img.src = url;
}

// ─── STACK MANAGEMENT ────────────────────────────────────────────────────────
window.updateStack = function(val) {
  // If animating, snap the top coaster back before rebuilding
  if (isAnimating) cancelFlip();
  // Always reset spin to OFF whenever stack changes
  window.setSpin(0);

  stackCount = parseInt(val);

  coasterStack.forEach(c => scene.remove(c));
  coasterStack = [];

  if (!coasterModel || stackCount === 0) {
    updateFlipToggleUI();
    updateSpinUI();
    return;
  }

  for (let i = 0; i < stackCount; i++) {
    const clone = coasterModel.clone();
    clone.rotation.y = Math.random() * Math.PI * 2;
    clone.position.x = window.pinX;
    clone.position.z = window.pinZ;
    clone.position.y = window.pinBaseY + window.halfCThickness + (i * window.cThickness * 1.06);
    // Top coaster: match the current flip state so it stays consistent
    if (i === stackCount - 1 && isFlipped) {
      clone.rotation.x = Math.PI;
    }
    clone.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    scene.add(clone);
    coasterStack.push(clone);
  }
  applyColors();
  // Re-apply active label textures to freshly cloned meshes
  if (labelState.Red.tex)  applyLabelTexture('Red');
  if (labelState.Blue.tex) applyLabelTexture('Blue');
  updateFlipToggleUI();
  updateSpinUI();
};

// ─── FLIP ANIMATION ──────────────────────────────────────────────────────────
// Easing: smooth cubic in-out
function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Duration constants (ms)
const LIFT_DURATION  = 400;
const FLIP_DURATION  = 600;
const DROP_DURATION  = 400;
const TOTAL_DURATION = LIFT_DURATION + FLIP_DURATION + DROP_DURATION;


let flipAnimId  = null;
let flipStartMs = null;

window.flipTopCoaster = function() {
  if (isAnimating) return;
  if (stackCount === 0 || coasterStack.length === 0) return;

  isAnimating = true;
  const rpmBeforeFlip = spinRPM;       // save so we can restore after
  if (spinRPM !== 0) window.setSpin(0); // stop spin during flip animation
  updateFlipToggleUI();

  const coaster = coasterStack[coasterStack.length - 1];

  // Rest position Y (where it sits on the stack)
  const restY    = coaster.position.y;
  // Peak Y (lifted clear of the pin)
  const peakY    = restY + (window.cThickness * 20 || 0.06);
  // Start rotation (current, respects any prior flips)
  const startRot = coaster.rotation.x;
  // Target rotation: +PI or back to 0 depending on flip state
  const targetRot = isFlipped ? startRot - Math.PI : startRot + Math.PI;

  flipStartMs = null;

  function step(now) {
    if (!flipStartMs) flipStartMs = now;
    const elapsed = now - flipStartMs;
    const t = Math.min(elapsed / TOTAL_DURATION, 1);

    // Phase 1: Lift  (0 → LIFT_DURATION)
    // Phase 2: Flip  (LIFT_DURATION → LIFT_DURATION + FLIP_DURATION)
    // Phase 3: Drop  (LIFT_DURATION + FLIP_DURATION → TOTAL_DURATION)

    // Y position
    const liftT = Math.min(elapsed / LIFT_DURATION, 1);
    const dropT = Math.max(0, (elapsed - LIFT_DURATION - FLIP_DURATION) / DROP_DURATION);
    if (elapsed < LIFT_DURATION) {
      // Lifting
      coaster.position.y = restY + easeInOut(liftT) * (peakY - restY);
    } else if (elapsed < LIFT_DURATION + FLIP_DURATION) {
      // At peak
      coaster.position.y = peakY;
    } else {
      // Dropping
      coaster.position.y = peakY - easeInOut(dropT) * (peakY - restY);
    }

    // X rotation (only during flip phase)
    const flipElapsed = Math.max(0, elapsed - LIFT_DURATION);
    const flipT = Math.min(flipElapsed / FLIP_DURATION, 1);
    coaster.rotation.x = startRot + easeInOut(flipT) * (targetRot - startRot);

    if (t < 1) {
      flipAnimId = requestAnimationFrame(step);
    } else {
      // Snap to exact final values
      coaster.position.y = restY;
      coaster.rotation.x = targetRot;
      isFlipped   = !isFlipped;
      isAnimating = false;
      flipAnimId  = null;
      updateFlipToggleUI();
      // Restore the RPM that was active before the flip, then let syncAudio
      // pick up the new side's track at the same speed
      if (rpmBeforeFlip !== 0) window.setSpin(rpmBeforeFlip);
      else syncAudio();
    }
  }

  flipAnimId = requestAnimationFrame(step);
};

// Immediately cancel any running animation and snap the coaster back to rest
function cancelFlip() {
  if (flipAnimId) { cancelAnimationFrame(flipAnimId); flipAnimId = null; }
  isAnimating = false;
  isFlipped   = false;
  if (coasterStack.length > 0) {
    const coaster = coasterStack[coasterStack.length - 1];
    coaster.rotation.x = 0;
    coaster.position.y = window.pinBaseY + window.halfCThickness + ((coasterStack.length - 1) * window.cThickness * 1.02);
  }
}

// ─── FLIP TOGGLE UI ──────────────────────────────────────────────────────────
function updateFlipToggleUI() {
  const toggle = document.getElementById('flip-toggle');
  if (!toggle) return;
  const disabled = stackCount === 0 || isAnimating;
  toggle.disabled = disabled;
  toggle.setAttribute('aria-disabled', disabled);
  toggle.classList.toggle('flipped', isFlipped);
  toggle.classList.toggle('animating', isAnimating);
}

// ─── QUANTITY CHIPS ───────────────────────────────────────────────────────────
window.setQuantity = function(val) {
  stackCount = val;
  document.querySelectorAll('.qty-chip').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.qty) === val);
  });
  window.updateStack(val);
};

// ─── RESIZE + RENDER LOOP ────────────────────────────────────────────────────
function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

(function loop() {
  requestAnimationFrame(loop);
  if (autoRot) targetSph.t += 0.0025;
  // Spin single coaster at selected RPM
  if (spinRPM !== 0 && stackCount === 1 && coasterStack.length === 1) {
    // Reverse direction for Side A (top face) so it always appears clockwise
    const spinDir = isFlipped ? 1 : -1;
    coasterStack[0].rotation.y += spinDir * spinRPM * RPM_TO_RAD_PER_FRAME;
  }
  currentSph.t += (targetSph.t - currentSph.t) * 0.08;
  currentSph.p += (targetSph.p - currentSph.p) * 0.08;
  currentSph.r += (targetSph.r - currentSph.r) * 0.08;
  currentTgt.lerp(targetTgt, 0.08);
  currentViewOffsetY += (targetViewOffsetY - currentViewOffsetY) * 0.08;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (currentViewOffsetY > 0.001) {
    camera.setViewOffset(
      w * dpr, h * dpr,
      0, Math.round(currentViewOffsetY * h * dpr),
      w * dpr, h * dpr
    );
  } else {
    camera.clearViewOffset();
  }
  updateCam();
  scene.background.lerp(isDarkMode ? bgDarkColor : bgLightColor, 0.05);
  shadowPlane.material.opacity = THREE.MathUtils.lerp(
    shadowPlane.material.opacity, LIGHTING_CONFIG.shadow.opacity, 0.1);
  renderer.render(scene, camera);
})();

// ─── COLOR UI ────────────────────────────────────────────────────────────────
window.setColor = function(mat, hex) {
  colors[mat] = hex;
  syncColorUI(mat, hex);
  applyColors();
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
};

// ─── PRESETS ─────────────────────────────────────────────────────────────────
const PRESETS = {
  signal:  { Yellow: '#F5B82E', Side_Panel: '#0F6FD7', Feet: '#1a1a1a', Pin_Mount: '#1a1a1a', Coaster_Body: '#1A1A1A', Label_A: '#D93636', Label_B: '#0F6FD7' },
  bauhaus: { Yellow: '#F3E8CE', Side_Panel: '#C83737', Feet: '#262626', Pin_Mount: '#262626', Coaster_Body: '#1A1A1A', Label_A: '#0F6FD7', Label_B: '#F5B82E' },
  highvis: { Yellow: '#C8C8C8', Side_Panel: '#BBFF29', Feet: '#000000', Pin_Mount: '#FE8616', Coaster_Body: '#1a1a1a', Label_A: '#FE8616', Label_B: '#BBFF29' },
  glacier: { Yellow: '#2B7FE0', Side_Panel: '#DDD5C8', Feet: '#0D0D0D', Pin_Mount: '#1A2535', Coaster_Body: '#1E1E1E', Label_A: '#6B8C7A', Label_B: '#E8C84A' },
  cream:   { Yellow: '#f5e6c8', Side_Panel: '#8b4513', Feet: '#2d1b0e', Pin_Mount: '#1a0e06', Coaster_Body: '#2d1b0e', Label_A: '#8b4513', Label_B: '#f5e6c8' },
  tide:    { Yellow: '#C4C8CC', Side_Panel: '#E05050', Feet: '#2A2D30', Pin_Mount: '#1A1A1A', Coaster_Body: '#1A1A1A', Label_A: '#7AA08C', Label_B: '#A8E820' },
  mesa:    { Yellow: '#FF9A30', Side_Panel: '#8C96A0', Feet: '#2D1B0E', Pin_Mount: '#0A1628', Coaster_Body: '#0A1628', Label_A: '#4A7C59', Label_B: '#E84444' },
  slate:    { Yellow: '#B8B0A8', Side_Panel: '#E8E0D5', Feet: '#2A2D30', Pin_Mount: '#3D4550', Coaster_Body: '#1A1A1A', Label_A: '#B5896A', Label_B: '#6B8C7A' },
  cascadia: { Yellow: '#2D4A3E', Side_Panel: '#4A3728', Feet: '#1A2820', Pin_Mount: '#1A2820', Coaster_Body: '#1A1A1A', Label_A: '#C8860A', Label_B: '#7A9E8A' },
  mango:    { Yellow: '#FF6B00', Side_Panel: '#00C896', Feet: '#1A0A00', Pin_Mount: '#1A0A00', Coaster_Body: '#0A0A0A', Label_A: '#FFE000', Label_B: '#FF1493' },
  crate:    { Yellow: '#6B1A2A', Side_Panel: '#C8860A', Feet: '#1A0A0E', Pin_Mount: '#1A0A0E', Coaster_Body: '#1A0A0E', Label_A: '#F5E6C8', Label_B: '#C8860A' },
  grid:     { Yellow: '#3A3530', Side_Panel: '#1A1510', Feet: '#0D0D0D', Pin_Mount: '#0D0D0D', Coaster_Body: '#0D0D0D', Label_A: '#39FF14', Label_B: '#7B2FBE' },
  prism:    { Yellow: '#4B0082', Side_Panel: '#FF6B35', Feet: '#1A0A2E', Pin_Mount: '#1A0A2E', Coaster_Body: '#1A0A2E', Label_A: '#FFD700', Label_B: '#FF1493' },
};

window.applyPreset = function(name) {
  const p = PRESETS[name]; if (!p) return;
  for (const [mat, hex] of Object.entries(p)) {
    colors[mat] = hex;
    syncColorUI(mat, hex);
  }
  applyColors();
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('preset-' + name);
  if (btn) btn.classList.add('active');
  activeThemeName = name;
  syncAudio();
};

// ─── RANDOMIZE ───────────────────────────────────────────────────────────────
// Slot-aware curated random. Each slot draws from a pool appropriate to its
// role so results are always readable and intentional-feeling.
window.randomizeColors = function() {
  // Color pools by role
  const POOL = {
    // Chassis body — mids, lights, saturated solids. Never too dark (that's the record's job).
    body: [
      '#F5B82E','#E8C84A','#D4A843',  // ambers / yellows
      '#C4C8CC','#A8B0B8','#8C96A0',  // blue-greys
      '#D93636','#C42828','#E05050',  // reds
      '#4A7C59','#3D6B4A','#5A8C6A',  // greens
      '#f5e6c8','#EDD9A3','#E8D5B0',  // creams
      '#c8c8c8','#B8B8B8','#D8D8D8',  // silvers
      '#0F6FD7','#1A5FAA','#2B7FE0',  // blues
      '#8B6A4A','#7A5A3A','#A07850',  // browns
      '#BBFF29','#A8E820','#C8FF50',  // high-vis lime
      '#FE8616','#E07010','#FF9A30',  // oranges
      '#9B59B6','#7D3C98','#B07CC6',  // purples
      '#E8E0D5','#DDD5C8','#F0EAE0',  // porcelains
    ],
    // Side panel — should contrast with body; bias toward different hue family
    panel: [
      '#0F6FD7','#1A5FAA','#2B7FE0',
      '#D93636','#C42828','#E05050',
      '#1a1a1a','#2a2a2a','#111111',
      '#4A7C59','#3D6B4A','#5A8C6A',
      '#E8E0D5','#DDD5C8','#F0EAE0',
      '#F5B82E','#E8C84A','#D4A843',
      '#BBFF29','#A8E820',
      '#FE8616','#E07010',
      '#C4C8CC','#8C96A0',
      '#9B59B6','#7D3C98',
      '#8B6A4A','#7A5A3A',
      '#f5e6c8','#EDD9A3',
    ],
    // Darks — pin mount and feet. Always near-black or very deep tones.
    dark: [
      '#1a1a1a','#111111','#0d0d0d',
      '#2A2D30','#1E2226','#3D4550',
      '#2d1b0e','#1a0e06',
      '#1e1e1e','#262626',
      '#0a1628','#1a2535',
      '#1a1200','#2a1e00',
    ],
    // Record vinyl — almost always very dark; occasional deep jewel tone
    vinyl: [
      '#1A1A1A','#111111','#0d0d0d',
      '#1e1e1e','#222222',
      '#0a1628',           // deep navy-black
      '#1a0a0a',           // deep wine-black
      '#0a1a0a',           // deep forest-black
    ],
    // Label accents — vivid or distinctive, works on dark vinyl
    label: [
      '#D93636','#C42828','#E84444',  // reds
      '#0F6FD7','#1A5FAA','#3A8AE8',  // blues
      '#F5B82E','#E8C84A','#FFCC00',  // yellows
      '#BBFF29','#A8E820','#CCFF55',  // limes
      '#FE8616','#FF9A30','#E07010',  // oranges
      '#B5896A','#C49A7A','#A07858',  // clays
      '#6B8C7A','#7AA08C','#5A7A68',  // sages
      '#9B59B6','#B07CC6','#7D3C98',  // purples
      '#E8E0D5','#F0EAE0',            // soft whites
      '#4A7C59','#5A9A6E',            // greens
      '#c8c8c8','#B0B8C0',            // silvers
    ],
  };

  function pick(pool) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Pick body first, then choose a panel color that differs enough
  const bodyColor  = pick(POOL.body);
  let   panelColor = pick(POOL.panel);
  // Simple collision guard — retry once if panel matches body exactly
  if (panelColor === bodyColor) panelColor = pick(POOL.panel);

  // Pick two label colors that differ from each other
  const labelA = pick(POOL.label);
  let   labelB = pick(POOL.label);
  if (labelB === labelA) labelB = pick(POOL.label);

  const result = {
    Yellow:       bodyColor,
    Side_Panel:   panelColor,
    Pin_Mount:    pick(POOL.dark),
    Feet:         pick(POOL.dark),
    Coaster_Body: pick(POOL.vinyl),
    Label_A:      labelA,
    Label_B:      labelB,
  };

  for (const [mat, hex] of Object.entries(result)) {
    colors[mat] = hex;
    syncColorUI(mat, hex);
  }
  applyColors();

  // Deactivate all preset buttons — this isn't a named preset
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
};
window.resetDefaults = function() {
  // Reset all colors to defaults
  for (const [key, hex] of Object.entries(DEFAULT_COLORS)) {
    colors[key] = hex;
    syncColorUI(key, hex);
  }
  applyColors();

  // Reset preset highlight
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  const signalBtn = document.getElementById('preset-signal');
  if (signalBtn) signalBtn.classList.add('active');

  // Reset quantity to 4
  window.setQuantity(4);

  // Reset flip state
  if (isAnimating) cancelFlip();
  isFlipped = false;
  updateFlipToggleUI();
};

// ─── SHARE ───────────────────────────────────────────────────────────────────
window.shareConfig = function() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(colors)) {
    params.set(key, value.replace('#', ''));
  }
  params.set('stack', stackCount);
  const newUrl = window.location.origin + window.location.pathname + '?' + params.toString();
  window.history.replaceState({}, '', newUrl);
  navigator.clipboard.writeText(newUrl).then(() => {
    const btns = document.querySelectorAll('.reset-btn');
    const btn  = btns[btns.length - 1];
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ &nbsp;Copied Link';
    setTimeout(() => { btn.innerHTML = orig; }, 2000);
  });
};
// ─── MOBILE ───────────────────────────────────────────────────────────────────

// Drawer toggle
window.toggleDrawer = function() {
  const col = document.getElementById('left-column');
  col.classList.toggle('drawer-open');
  targetViewOffsetY = col.classList.contains('drawer-open') ? 0.25 : 0;
};

// On mobile, back the camera out so the full model is visible on load
if (window.innerWidth <= 768) {
  targetSph.r  = 0.5;
  currentSph.r = 0.5;
}

// Touch controls — single finger rotate, two finger pinch zoom
(function() {
  const vp = document.getElementById('viewport');
  let t1x = 0, t1y = 0;
  let lastPinch = null;

  function pinchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  vp.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
      t1x = e.touches[0].clientX;
      t1y = e.touches[0].clientY;
      autoRot = false;
      clearTimeout(rotTimer);
    }
    if (e.touches.length === 2) {
      lastPinch = pinchDist(e.touches);
    }
  }, { passive: true });

  vp.addEventListener('touchmove', function(e) {
    if (e.touches.length === 2) {
      // Prevent browser default pinch-to-zoom and text selection
      e.preventDefault();
      if (lastPinch !== null) {
        const dist  = pinchDist(e.touches);
        const delta = lastPinch - dist;
        targetSph.r = Math.max(0.08, Math.min(0.6, targetSph.r + delta * 0.0008));
        lastPinch   = dist;
      }
    } else if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - t1x;
      const dy = e.touches[0].clientY - t1y;
      t1x = e.touches[0].clientX;
      t1y = e.touches[0].clientY;
      targetSph.t -= dx * 0.008;
      targetSph.p = Math.max(0.01, Math.min(Math.PI - 0.01, targetSph.p - dy * 0.008));
    }
  }, { passive: false });

  vp.addEventListener('touchend', function(e) {
    if (e.touches.length < 2) lastPinch = null;
    rotTimer = setTimeout(function() { autoRot = true; }, 4000);
  }, { passive: true });
})();
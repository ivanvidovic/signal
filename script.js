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
      if (!line || line[0]==='#') continue;
      const sp = line.indexOf(' ');
      const k = sp>=0 ? line.slice(0,sp) : line;
      const v = sp>=0 ? line.slice(sp+1).trim() : '';
      if (k==='newmtl') { cur=v; info[cur]={name:cur}; }
      else if (cur) {
        if (k==='Kd') info[cur].kd=v.split(/\s+/).map(Number);
      }
    }
    return new MatCreator(info);
  }
}

class MatCreator {
  constructor(info) { this.info=info; this.mats={}; }
  preload() { for (const n in this.info) this.create(n); }
  create(name) {
    if (!this.mats[name]) {
      const d  = this.info[name] || {};
      const kd = d.kd || [1,1,1];
      let m;
      if (name === 'Steel') {
        m = new THREE.MeshStandardMaterial({
          color:      new THREE.Color(0xf5f5f5), 
          metalness:  0.7,
          roughness:  0.2,
        });
      } else {
        m = new THREE.MeshStandardMaterial({
          color:     new THREE.Color(kd[0], kd[1], kd[2]),
          metalness: 0.0,
          roughness: 0.72,
        });
      }
      m.name = name;
      this.mats[name] = m;
    }
    return this.mats[name];
  }
  get(name) { return this.mats[name] || null; }
}

// ─── OBJ LOADER ──────────────────────────────────────────────────────────────
class OBJLoader {
  constructor(mgr) { this.mgr=mgr||THREE.DefaultLoadingManager; this.mats=null; }
  setMaterials(m) { this.mats=m; return this; }
  load(url, onLoad, onProg, onErr) {
    new THREE.FileLoader(this.mgr).load(url, t=>onLoad(this.parse(t)), onProg, onErr);
  }
  parse(text) {
    const vp=[],vn=[];
    const groups={};
    let curMat='default';
    for (const raw of text.split('\n')) {
      const line=raw.trim();
      if (!line||line[0]==='#') continue;
      const p=line.split(/\s+/);
      switch(p[0]) {
        case 'v':  vp.push(+p[1],+p[2],+p[3]); break;
        case 'vn': vn.push(+p[1],+p[2],+p[3]); break;
        case 'usemtl': curMat=p.slice(1).join(' '); break;
        case 'f': {
          if (!groups[curMat]) groups[curMat]={pos:[],nor:[]};
          const fv=p.slice(1).map(s=>s.split('/').map(x=>x?+x-1:-1));
          for (let i=1;i<fv.length-1;i++) {
            for (const [vi,,ni] of [fv[0],fv[i],fv[i+1]]) {
              if (vi>=0) groups[curMat].pos.push(vp[vi*3],vp[vi*3+1],vp[vi*3+2]);
              if (ni>=0) groups[curMat].nor.push(vn[ni*3],vn[ni*3+1],vn[ni*3+2]);
            }
          }
          break;
        }
      }
    }
    const root=new THREE.Group();
    for (const [matName,data] of Object.entries(groups)) {
      if (!data.pos.length) continue;
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(data.pos,3));
      if (data.nor.length) geo.setAttribute('normal',new THREE.Float32BufferAttribute(data.nor,3));
      else geo.computeVertexNormals();
      let mat=this.mats?this.mats.get(matName):null;
      if (!mat) mat=new THREE.MeshStandardMaterial({color:0x888888, roughness:0.72, metalness:0});
      mat=mat.clone(); mat.name=matName;
      const mesh=new THREE.Mesh(geo,mat);
      mesh.name=matName;
      root.add(mesh);
    }
    return root;
  }
}

// ─── SCENE SETUP ─────────────────────────────────────────────────────────────
const wrap = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ antialias:true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85; 
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
wrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const bgLightColor = new THREE.Color('#EDE7DF');
const bgDarkColor = new THREE.Color('#272727');
scene.background = bgLightColor.clone();

const camera = new THREE.PerspectiveCamera(38, 1, 0.001, 100);
scene.add(camera);

// ─── THEME TOGGLE (DARK MODE) ────────────────────────────────────────────────
let isDarkMode = false;
const themeBtn = document.getElementById('themeBtn');

themeBtn.addEventListener('click', () => {
  isDarkMode = !isDarkMode;
  document.body.classList.toggle('dark-mode', isDarkMode);
  
  const moonIcon = themeBtn.querySelector('.icon-moon');
  const sunIcon = themeBtn.querySelector('.icon-sun');
  
  if (isDarkMode) {
    moonIcon.style.display = 'none';
    sunIcon.style.display = 'block';
  } else {
    moonIcon.style.display = 'block';
    sunIcon.style.display = 'none';
  }
});

// ─── STUDIO LIGHTING ─────────────────────────────────────────────────────────
const ambient = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
keyLight.position.set(4, 6, 3);
keyLight.castShadow = true;
keyLight.shadow.mapSize.setScalar(8192);
keyLight.shadow.camera.near   =  0.01;
keyLight.shadow.camera.far    =  10.0;
keyLight.shadow.camera.left   = -0.5;
keyLight.shadow.camera.right  =  0.5;
keyLight.shadow.camera.top    =  0.5;
keyLight.shadow.camera.bottom = -0.5;
keyLight.shadow.radius        =  4;
keyLight.shadow.bias          = -0.0004;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xddeeff, 0.3);
fillLight.position.set(-4, 3, 2);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xfff5e8, 0.5);
rimLight.position.set(0, 4, -4);
scene.add(rimLight);

// ─── SHADOW PLANE ────────────────────────────────────────────────────────────
const shadowMat = new THREE.ShadowMaterial({ opacity: 0.0, transparent: true });
const shadowPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(5, 5),
  shadowMat
);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.position.y = 0; 
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

// ─── ORBIT CONTROLS (WITH EASING) ────────────────────────────────────────────
let drag=false, rDrag=false, px=0, py=0;

// Separate target and current values to allow for smooth interpolation
let targetSph  = { t:-0.5, p:1.05, r:0.22 };
let currentSph = { t:-0.5, p:1.05, r:0.22 };

let targetTgt  = new THREE.Vector3(0,0.01,0);
let currentTgt = new THREE.Vector3(0,0.01,0);

let autoRot=true, rotTimer=null;

function updateCam() {
  const {t,p,r} = currentSph;
  camera.position.set(
    currentTgt.x + r*Math.sin(p)*Math.sin(t),
    currentTgt.y + r*Math.cos(p),
    currentTgt.z + r*Math.sin(p)*Math.cos(t)
  );
  camera.lookAt(currentTgt);
}

const cvs = renderer.domElement;
cvs.addEventListener('mousedown', e=>{
  drag=true; rDrag=e.button===2;
  px=e.clientX; py=e.clientY;
  autoRot=false; clearTimeout(rotTimer);
});
window.addEventListener('mouseup',()=>{
  drag=false;
  rotTimer=setTimeout(()=>{ autoRot=true; },4000);
});
window.addEventListener('mousemove',e=>{
  if(!drag) return;
  const dx=e.clientX-px, dy=e.clientY-py;
  px=e.clientX; py=e.clientY;
  if (rDrag) {
    const r=new THREE.Vector3();
    r.crossVectors(camera.getWorldDirection(new THREE.Vector3()),camera.up).normalize();
    targetTgt.addScaledVector(r,-dx*0.0003);
    targetTgt.addScaledVector(camera.up,dy*0.0003);
  } else {
    targetSph.t -= dx*0.008;
    targetSph.p = Math.max(0.01, Math.min(Math.PI - 0.01, targetSph.p - dy*0.008));
  }
});
cvs.addEventListener('wheel',e=>{
  e.preventDefault();
  targetSph.r = Math.max(0.08,Math.min(0.6,targetSph.r+e.deltaY*0.0002));
  autoRot=false; clearTimeout(rotTimer);
  rotTimer=setTimeout(()=>{ autoRot=true; },3000);
},{passive:false});
cvs.addEventListener('contextmenu',e=>e.preventDefault());

// ─── COLOR STATE & URL SYNC ──────────────────────────────────────────────────
const colors = {
  Yellow:    '#F5B82E',
  Blue:      '#0F6FD7',
  Feet:      '#1a1a1a',
  Pin_Mount: '#1a1a1a',
};

function loadFromURL() {
  const params = new URLSearchParams(window.location.search);
  let loaded = false;
  for (const key of Object.keys(colors)) {
    if (params.has(key)) {
      const hex = '#' + params.get(key);
      colors[key] = hex;
      const sw  = document.getElementById('swatch-'+key);
      const hx  = document.getElementById('hex-'+key);
      const inp = document.getElementById('color-'+key);
      if (sw) sw.style.background = hex;
      if (hx) hx.textContent = hex.toUpperCase();
      if (inp) inp.value = hex;
      loaded = true;
    }
  }
  if (loaded) {
    document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('active'));
  }
}
loadFromURL();

let model = null;

function hexToC(hex) {
  return new THREE.Color(hex).convertSRGBToLinear();
}

function applyColors() {
  if (!model) return;
  model.traverse(m=>{
    if (!m.isMesh) return;
    if (m.name === 'Steel') return; 
    const c = colors[m.name];
    if (c) m.material.color.copy(hexToC(c));
  });
}

// ─── LOAD ────────────────────────────────────────────────────────────────────
const loadEl = document.getElementById('loading');
const progEl = document.getElementById('load-progress');
const mgr    = new THREE.LoadingManager();

new MTLLoader(mgr).load(
  './3D/Signal_Record_Coaster_Base_01.mtl', 
  mc => {
    mc.preload();
    const objL = new OBJLoader(mgr);
    objL.setMaterials(mc);
    objL.load(
      './3D/Signal_Record_Coaster_Base_01.obj',
      obj => {
        const box = new THREE.Box3().setFromObject(obj);
        const cen = box.getCenter(new THREE.Vector3());
        const sz  = box.getSize(new THREE.Vector3());
        
        obj.position.sub(cen);
        
        const sc = 0.1/Math.max(sz.x,sz.y,sz.z);
        obj.scale.setScalar(sc);
        
        obj.updateMatrixWorld();
        
        const scaledBox = new THREE.Box3().setFromObject(obj);
        obj.position.y -= scaledBox.min.y;
        
        obj.traverse(c => {
          if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
        });
        scene.add(obj);
        model = obj;
        applyColors();
        loadEl.classList.add('hidden');
        setTimeout(()=>loadEl.style.display='none', 600);
      },
      xhr => { if(xhr.total) progEl.textContent = Math.round((xhr.loaded/xhr.total)*100)+'%'; },
      err => { console.error("OBJ Error:", err); progEl.textContent = 'OBJ Missing'; }
    );
  },
  xhr => {},
  err => { console.error("MTL Error:", err); progEl.textContent = 'MTL Missing'; }
);

// ─── RESIZE + LOOP ───────────────────────────────────────────────────────────
function resize() {
  const w=wrap.clientWidth, h=wrap.clientHeight;
  renderer.setSize(w,h);
  camera.aspect=w/h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize',resize);
resize();

(function loop() {
  requestAnimationFrame(loop);
  
  if (autoRot) targetSph.t += 0.0025;
  
  // Apply easing (lerp) to camera movements
  currentSph.t += (targetSph.t - currentSph.t) * 0.08;
  currentSph.p += (targetSph.p - currentSph.p) * 0.08;
  currentSph.r += (targetSph.r - currentSph.r) * 0.08;
  currentTgt.lerp(targetTgt, 0.08);

  updateCam();

  const targetBgColor = isDarkMode ? bgDarkColor : bgLightColor;
  scene.background.lerp(targetBgColor, 0.05);

  const targetShadowOpacity = THREE.MathUtils.clamp((camera.position.y - 0.01) * 10, 0, 0.22);
  shadowPlane.material.opacity = THREE.MathUtils.lerp(shadowPlane.material.opacity, targetShadowOpacity, 0.1);

  renderer.render(scene,camera);
})();

// ─── UI ──────────────────────────────────────────────────────────────────────
window.setColor = function(mat, hex) {
  colors[mat] = hex;
  const sw  = document.getElementById('swatch-'+mat);
  const hx  = document.getElementById('hex-'+mat);
  if (sw) sw.style.background = hex;
  if (hx) hx.textContent = hex.toUpperCase();
  applyColors();
  document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('active'));
}

const PRESETS = {
  signal:   { Yellow:'#F5B82E', Blue:'#0F6FD7',   Feet:'#1a1a1a', Pin_Mount:'#1a1a1a' },
  bauhaus:  { Yellow:'#D93636', Blue:'#1a1a1a',   Feet:'#F5B82E', Pin_Mount:'#F5B82E' },
  dessau:   { Yellow:'#E4DCCF', Blue:'#003882',   Feet:'#1C1C1C', Pin_Mount:'#1C1C1C' },
  forest:   { Yellow:'#4a7c59', Blue:'#e8dcc8',   Feet:'#2a2a1a', Pin_Mount:'#1e1e1e' },
  cream:    { Yellow:'#f5e6c8', Blue:'#8b4513',   Feet:'#2d1b0e', Pin_Mount:'#1a0e06' },
  chrome:   { Yellow:'#c8c8c8', Blue:'#D93636',   Feet:'#111111', Pin_Mount:'#333333' },
};

window.applyPreset = function(name) {
  const p = PRESETS[name]; if (!p) return;
  for (const [mat,hex] of Object.entries(p)) {
    colors[mat] = hex;
    const sw  = document.getElementById('swatch-'+mat);
    const hx  = document.getElementById('hex-'+mat);
    const inp = document.getElementById('color-'+mat);
    if (sw)  sw.style.background = hex;
    if (hx)  hx.textContent = hex.toUpperCase();
    if (inp) inp.value = hex;
  }
  applyColors();
  document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('active'));
  const btn = document.getElementById('preset-'+name);
  if (btn) btn.classList.add('active');
}

window.resetDefaults = function() { applyPreset('signal'); }

window.shareConfig = function() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(colors)) {
    params.set(key, value.replace('#', ''));
  }
  
  const newUrl = window.location.origin + window.location.pathname + '?' + params.toString();
  window.history.replaceState({}, '', newUrl);
  
  navigator.clipboard.writeText(newUrl).then(() => {
    const btn = document.querySelector('button[onclick="shareConfig()"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '✓ &nbsp;Copied Link';
    setTimeout(() => { btn.innerHTML = originalText; }, 2000);
  });
}
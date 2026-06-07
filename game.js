// ============================================================
// MOBMOBS - Track Racing
// Landscape circuit racer with multiple themed tracks, boosts,
// jumps, manual nitro and AI opponents.
//
// Controls:
//   Steer + throttle - left joystick. Push left/right to steer,
//                      push forward (up) to accelerate. The car
//                      rolls at a base speed and scales up with
//                      how far the stick is pushed.
//   Nitro            - round button on the right (or SPACE).
//                      Fires a manual boost when charged.
//   (Keyboard: A/D or arrows steer, W/S or up/down throttle.)
//   (Gamepad: left stick steers + throttles, A button fires nitro.)
//
// Drive over the cyan boost pads for a free speed surge and a
// nitro top-up. 3 laps, 4 cars, collisions on.
// ============================================================

// Three.js scene objects
let scene, camera, renderer;

// Track data
let trackCurve;
let centerPoints = [];   // gameplay samples (Vector3 with elevation, closed)
let tangents = [];       // unit tangent at each sample (horizontal)
let SAMPLES = 0;
const ROAD_WIDTH = 14;
const ROAD_HALF = ROAD_WIDTH / 2;
const TOTAL_LAPS = 3;

// Boost pads
let boostPads = [];      // { x, z, mesh }
const BOOST_FRAMES = 90; // duration of a pad boost
const BOOST_RADIUS = 5;  // pickup distance

// Nitro (manual boost)
const NITRO_FRAMES = 100;            // duration of a nitro boost
const NITRO_REGEN = 1 / (60 * 7);    // full charge in ~7 seconds

// Ramps (jumps)
let ramps = [];          // { x, z, tx, tz, rx, rz, L, H, halfW, baseY }
const GRAVITY = 0.05;    // per-frame downward accel while airborne

// Racers (player + AI)
let racers = [];
let player = null;
const AI_COLORS = [0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22];
const CAR_RADIUS = 1.9;  // collision radius

// Control input (player): steer/throttle in [-1,1], nitro is momentary
const input = { steer: 0, throttle: 0, nitro: false };

// Race state
const race = {
    started: false,
    finished: false,
    startTime: 0,
    elapsed: 0
};

let animateStarted = false;

// Joystick
const joystick = {
    element: document.getElementById('joystick'),
    base: document.querySelector('.joystick-base'),
    stick: document.querySelector('.joystick-stick'),
    centerX: 0, centerY: 0, radius: 55,
    isActive: false, pointerId: null
};

// HUD
const hud = {
    pos: document.getElementById('posValue'),
    lap: document.getElementById('lapValue'),
    time: document.getElementById('timeValue'),
    best: document.getElementById('bestValue'),
    speed: document.getElementById('speedValue'),
    speedBar: document.getElementById('speedBar'),
    speedGrad: document.getElementById('speedGrad'),
    speedStreak: document.getElementById('speedStreak'),
    nitroFill: document.getElementById('nitroFill'),
    nitroBtn: document.getElementById('nitroBtn'),
    center: document.getElementById('centerMessage'),
    fps: document.getElementById('fpsValue'),
    build: document.getElementById('buildValue')
};

// Patch / build number shown top-left. Bump this with each gameplay update.
const VERSION = 'v1.11.0';
if (hud.build) hud.build.textContent = VERSION;

// Live FPS, averaged over a short window so the readout is steady.
const fpsState = { last: performance.now(), frames: 0, acc: 0 };
function updateFps() {
    const now = performance.now();
    fpsState.acc += now - fpsState.last;
    fpsState.last = now;
    fpsState.frames++;
    if (fpsState.acc >= 500) {
        if (hud.fps) hud.fps.textContent = Math.round((fpsState.frames * 1000) / fpsState.acc);
        fpsState.frames = 0;
        fpsState.acc = 0;
    }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ------------------------------------------------------------
// Tracks
// ------------------------------------------------------------
// Each track defines a closed centreline (2D points on the XZ
// plane), an optional elevation profile (height as a function of
// lap fraction t in [0,1), must be periodic), a visual theme and
// the layout of boost pads / ramps.
//
// `ring()` builds a star-convex loop from per-angle radii so the
// generated tracks never self-intersect.
function ring(radii) {
    return radii.map((r, i) => {
        const a = (i / radii.length) * Math.PI * 2;
        return [Math.cos(a) * r, Math.sin(a) * r];
    });
}

const TWO_PI = Math.PI * 2;

const TRACKS = [
    {
        name: 'Coastal Circuit',
        desc: 'Classic sweeping tarmac · flat',
        points: [
            [95, 0], [68, 39], [50, 87], [0, 80], [-49, 85], [-65, 38],
            [-100, 0], [-68, -39], [-48, -82], [0, -82], [50, -87], [66, -38]
        ],
        elev: null,
        boosts: [0.16, 0.37, 0.55, 0.78, 0.92],
        ramps: [0.30, 0.68],
        theme: {
            sky: 0x87b9e0, fog: 0x87b9e0, fogNear: 140, fogFar: 400,
            ground: 0x4f8f3a, road: 0x35373b, skirt: 0x6b5436,
            center: 0xffe14d, foliage: 'mixed'
        }
    },
    {
        name: 'Snowy Peaks',
        desc: 'Steep alpine climbs and big drops',
        points: ring([122, 96, 118, 92, 112, 98, 120, 90, 116, 100, 110, 104]),
        // Rolling alpine elevation: gentle peaks and dips. Periodic.
        elev: (t) => 7 + 4 * Math.sin(t * TWO_PI * 2) + 2 * Math.sin(t * TWO_PI * 3 + 1.1),
        boosts: [0.12, 0.34, 0.58, 0.8],
        ramps: [0.22, 0.66],
        theme: {
            sky: 0xcfe0ee, fog: 0xd6e6f2, fogNear: 120, fogFar: 360,
            ground: 0xeef4fa, road: 0x586472, skirt: 0x8a8f98,
            center: 0xffd166, foliage: 'pine', mountains: true, snow: true
        }
    },
    {
        name: 'Emerald Forest',
        desc: 'Dark, dense woodland · gentle rolls',
        points: ring([92, 116, 86, 112, 96, 120, 88, 110, 94, 118, 84, 108]),
        elev: (t) => 4 + 2.6 * Math.sin(t * TWO_PI * 2 + 0.5) + 1.6 * Math.sin(t * TWO_PI * 4),
        boosts: [0.18, 0.42, 0.63, 0.85],
        ramps: [0.28, 0.72],
        theme: {
            sky: 0x16321f, fog: 0x123524, fogNear: 70, fogFar: 240,
            ground: 0x1f3d24, road: 0x2c2f33, skirt: 0x3a2a18,
            center: 0xbfe89a, foliage: 'deepforest', dark: true
        }
    }
];

let currentTrackIndex = 0;
let currentTrack = TRACKS[0];

function elevationAt(t) {
    return currentTrack.elev ? currentTrack.elev(((t % 1) + 1) % 1) : 0;
}

// ------------------------------------------------------------
// Scene setup (renderer/camera built once; scene rebuilt per track)
// ------------------------------------------------------------
function initRenderer() {
    camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 2000);

    const container = document.getElementById('gameContainer');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
}

// Free all GPU resources (geometries, materials, textures) held by the
// previous scene before we drop it. Three.js does NOT do this automatically
// when a Scene is garbage-collected, so without it every track (re)load
// leaks the whole world's buffers and the game gets laggier over time.
function disposeScene() {
    if (!scene) return;
    scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        const mat = obj.material;
        if (mat) {
            const mats = Array.isArray(mat) ? mat : [mat];
            mats.forEach((m) => {
                if (m.map) m.map.dispose();
                m.dispose();
            });
        }
    });
    scene.clear();
}

function buildScene() {
    const theme = currentTrack.theme;

    disposeScene();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(theme.sky);
    scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);

    const ambient = new THREE.AmbientLight(0xffffff, theme.dark ? 0.5 : 0.7);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, theme.dark ? 0.7 : 0.95);
    sun.position.set(80, 140, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const d = 160;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = 400;
    scene.add(sun);

    buildWorld();
    buildTrack();
    buildBoostPads();
    buildRamps();
    buildFoliage();
    if (theme.mountains) buildMountains();
    buildRacers();
    placeRacersAtStart();
    updateJoystickCenter();
    setupMinimap();
}

function buildWorld() {
    const groundGeo = new THREE.PlaneGeometry(1600, 1600);
    const groundMat = new THREE.MeshLambertMaterial({ color: currentTrack.theme.ground });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);
}

// ------------------------------------------------------------
// Geometry batching: bake many small meshes that share a material into a
// single BufferGeometry so the whole batch costs ONE draw call. This is the
// difference between ~2400 draw calls (one per curb / tree part) and ~15.
// ------------------------------------------------------------
function makeMerger(useColor) {
    return { pos: [], norm: [], col: useColor ? [] : null };
}

// Bake `geo` (transformed by `matrix`) into the accumulator. Optional per-part
// `color` is written as vertex colors so a batch can still carry variation.
// Consumes `geo` (disposed after copying).
function mergeGeo(acc, geo, matrix, color) {
    if (matrix) geo.applyMatrix4(matrix);
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position.array;
    const n = g.attributes.normal ? g.attributes.normal.array : null;
    for (let i = 0; i < p.length; i++) {
        acc.pos.push(p[i]);
        acc.norm.push(n ? n[i] : 0);
    }
    if (acc.col) {
        const c = color || { r: 1, g: 1, b: 1 };
        for (let v = 0; v < p.length / 3; v++) acc.col.push(c.r, c.g, c.b);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
}

function mergerMesh(acc, material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(acc.norm, 3));
    if (acc.col) geo.setAttribute('color', new THREE.Float32BufferAttribute(acc.col, 3));
    return new THREE.Mesh(geo, material);
}

// ------------------------------------------------------------
// Track
// ------------------------------------------------------------
function buildTrack() {
    const pts = currentTrack.points.map(p => new THREE.Vector3(p[0], 0, p[1]));
    trackCurve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);

    SAMPLES = 700;
    const raw = trackCurve.getSpacedPoints(SAMPLES); // length SAMPLES+1 (closed)
    centerPoints = raw.slice(0, SAMPLES);            // drop duplicate last

    // Apply the track's elevation profile.
    for (let i = 0; i < SAMPLES; i++) {
        centerPoints[i].y = elevationAt(i / SAMPLES);
    }

    // Horizontal tangents (steering/geometry use XZ only).
    tangents = [];
    for (let i = 0; i < SAMPLES; i++) {
        const a = centerPoints[i];
        const b = centerPoints[(i + 1) % SAMPLES];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        tangents.push({ x: dx / len, z: dz / len });
    }

    // Road ribbon + edges (edges follow the centreline height).
    const leftEdge = [], rightEdge = [];
    for (let i = 0; i < SAMPLES; i++) {
        const c = centerPoints[i];
        const t = tangents[i];
        const px = -t.z, pz = t.x; // left-perpendicular (already unit)
        leftEdge.push({ x: c.x + px * ROAD_HALF, y: c.y, z: c.z + pz * ROAD_HALF });
        rightEdge.push({ x: c.x - px * ROAD_HALF, y: c.y, z: c.z - pz * ROAD_HALF });
    }

    const verts = [];
    for (let i = 0; i < SAMPLES; i++) {
        const j = (i + 1) % SAMPLES;
        const l0 = leftEdge[i], r0 = rightEdge[i];
        const l1 = leftEdge[j], r1 = rightEdge[j];
        verts.push(l0.x, l0.y + 0.01, l0.z, r0.x, r0.y + 0.01, r0.z, l1.x, l1.y + 0.01, l1.z);
        verts.push(r0.x, r0.y + 0.01, r0.z, r1.x, r1.y + 0.01, r1.z, l1.x, l1.y + 0.01, l1.z);
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    roadGeo.computeVertexNormals();
    const road = new THREE.Mesh(roadGeo, new THREE.MeshLambertMaterial({ color: currentTrack.theme.road }));
    road.receiveShadow = true;
    scene.add(road);

    buildSkirts(leftEdge);
    buildSkirts(rightEdge);
    buildCurbs(leftEdge);
    buildCurbs(rightEdge);
    buildCenterLine();
    buildStartLine(centerPoints[0], tangents[0]);
}

// Vertical "embankment" walls dropping from an elevated road edge
// down to the ground, so raised sections look solid (not floating).
function buildSkirts(edge) {
    const verts = [];
    let any = false;
    for (let i = 0; i < SAMPLES; i++) {
        const a = edge[i], b = edge[(i + 1) % SAMPLES];
        if (Math.max(a.y, b.y) < 0.4) continue; // ground-level: no wall needed
        any = true;
        verts.push(a.x, a.y, a.z, b.x, b.y, b.z, b.x, 0, b.z);
        verts.push(a.x, a.y, a.z, b.x, 0, b.z, a.x, 0, a.z);
    }
    if (!any) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: currentTrack.theme.skirt, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
}

function buildCurbs(edge) {
    const stripe = 6;
    const white = makeMerger(), red = makeMerger();
    const m = new THREE.Matrix4();
    for (let i = 0; i < SAMPLES; i++) {
        const a = edge[i], b = edge[(i + 1) % SAMPLES];
        const dx = b.x - a.x, dz = b.z - a.z;
        const segLen = Math.hypot(dx, dz);
        if (segLen < 0.001) continue;
        const geo = new THREE.BoxGeometry(0.9, 0.25, segLen + 0.15);
        m.makeRotationY(Math.atan2(dx, dz));
        m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.12, (a.z + b.z) / 2);
        mergeGeo((Math.floor(i / stripe) % 2 === 0) ? white : red, geo, m);
    }
    scene.add(mergerMesh(white, new THREE.MeshLambertMaterial({ color: 0xf2f2f2 })));
    scene.add(mergerMesh(red, new THREE.MeshLambertMaterial({ color: 0xd23b2e })));
}

function buildCenterLine() {
    const dashMat = new THREE.MeshBasicMaterial({ color: currentTrack.theme.center });
    const acc = makeMerger();
    const m = new THREE.Matrix4();
    const rotX = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    const step = 6;
    for (let i = 0; i < SAMPLES; i += step * 2) {
        const a = centerPoints[i], b = centerPoints[Math.min(i + step, SAMPLES - 1)];
        const dx = b.x - a.x, dz = b.z - a.z;
        const segLen = Math.hypot(dx, dz);
        if (segLen < 0.001) continue;
        const geo = new THREE.PlaneGeometry(0.45, segLen);
        m.makeRotationY(Math.atan2(dx, dz));
        m.multiply(rotX);
        m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.02, (a.z + b.z) / 2);
        mergeGeo(acc, geo, m);
    }
    scene.add(mergerMesh(acc, dashMat));
}

function buildStartLine(point, t) {
    const angle = Math.atan2(t.x, t.z);
    const cols = 8, cellW = ROAD_WIDTH / cols, depth = 3;
    const sin = Math.sin(angle), cos = Math.cos(angle);
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < 2; r++) {
            const isWhite = (c + r) % 2 === 0;
            const cell = new THREE.Mesh(
                new THREE.PlaneGeometry(cellW, depth / 2),
                new THREE.MeshBasicMaterial({ color: isWhite ? 0xffffff : 0x111111 })
            );
            cell.rotation.x = -Math.PI / 2;
            cell.rotation.z = -angle;
            const across = (c - (cols - 1) / 2) * cellW;
            const along = (r - 0.5) * (depth / 2);
            cell.position.set(
                point.x + cos * across + sin * along,
                point.y + 0.03,
                point.z - sin * across + cos * along
            );
            scene.add(cell);
        }
    }
}

// ------------------------------------------------------------
// Boost pads
// ------------------------------------------------------------
function buildBoostPads() {
    boostPads = [];
    const fractions = currentTrack.boosts || [0.16, 0.37, 0.55, 0.78, 0.92];
    fractions.forEach(f => {
        const idx = Math.floor(f * SAMPLES) % SAMPLES;
        const c = centerPoints[idx];
        const t = tangents[idx];
        const angle = Math.atan2(t.x, t.z);

        const group = new THREE.Group();
        const pad = new THREE.Mesh(
            new THREE.PlaneGeometry(ROAD_WIDTH * 0.7, 6),
            new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.55 })
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.y = 0.04;
        group.add(pad);
        for (let k = 0; k < 2; k++) {
            const chev = new THREE.Mesh(
                new THREE.PlaneGeometry(ROAD_WIDTH * 0.5, 1.1),
                new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
            );
            chev.rotation.x = -Math.PI / 2;
            chev.position.set(0, 0.05, -1 + k * 2);
            group.add(chev);
        }
        group.position.set(c.x, c.y, c.z);
        group.rotation.y = angle;
        scene.add(group);

        boostPads.push({ x: c.x, z: c.z, mesh: group });
    });
}

// ------------------------------------------------------------
// Ramps (jump pads)
// ------------------------------------------------------------
function buildRampMesh(L, H, W) {
    const hw = W / 2;
    const LA = [-hw, 0, 0], LB = [-hw, 0, L], LC = [-hw, H, L];
    const RA = [hw, 0, 0], RB = [hw, 0, L], RC = [hw, H, L];
    const tris = [
        LA, RA, RC, LA, RC, LC,
        LA, LB, RB, LA, RB, RA,
        LB, LC, RC, LB, RC, RB,
        LA, LC, LB, RA, RB, RC
    ];
    const verts = [];
    tris.forEach(v => verts.push(v[0], v[1], v[2]));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    return geo;
}

function buildRamps() {
    ramps = [];
    const L = 9, H = 3, W = ROAD_WIDTH * 0.85;
    const fractions = currentTrack.ramps || [0.30, 0.68];
    fractions.forEach(f => {
        const idx = Math.floor(f * SAMPLES) % SAMPLES;
        const c = centerPoints[idx];
        const t = tangents[idx];
        const angle = Math.atan2(t.x, t.z);

        const geo = buildRampMesh(L, H, W);
        const yellow = new THREE.MeshLambertMaterial({ color: 0xf4c542, flatShading: true });
        const mesh = new THREE.Mesh(geo, yellow);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(c.x, c.y, c.z);
        mesh.rotation.y = angle;
        scene.add(mesh);

        const stripe = new THREE.Mesh(
            new THREE.PlaneGeometry(W, 0.8),
            new THREE.MeshBasicMaterial({ color: 0x222222 })
        );
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(0, 0.05, 0.6);
        mesh.add(stripe);

        ramps.push({
            x: c.x, z: c.z,
            tx: t.x, tz: t.z,    // forward (along ramp)
            rx: t.z, rz: -t.x,   // right (across ramp)
            L, H, halfW: W / 2,
            baseY: c.y
        });
    });
}

// Returns the ramp surface absolute height/climb-rate under a racer, or null.
function rampUnder(r, hspeed) {
    let result = null;
    for (const ramp of ramps) {
        const dx = r.x - ramp.x, dz = r.z - ramp.z;
        const along = dx * ramp.tx + dz * ramp.tz;
        if (along < 0 || along > ramp.L) continue;
        const lateral = dx * ramp.rx + dz * ramp.rz;
        if (Math.abs(lateral) > ramp.halfW) continue;
        const slope = ramp.H / ramp.L;
        const y = ramp.baseY + slope * along;
        if (!result || y > result.y) {
            result = { y, vy: slope * hspeed };
        }
    }
    return result;
}

// Road-surface height under a racer. Linearly interpolates between the two
// nearest centreline samples (matching the road mesh, which is also linear
// between samples) so the car glides over elevation instead of stair-stepping
// from one of the 700 discrete sample heights to the next.
function trackHeightAt(r) {
    const i = r.lastIndex;
    const a = centerPoints[i];
    if (!a) return 0;
    const t = tangents[i];
    // Signed distance of the car ahead of / behind sample i along the track.
    const along = (r.x - a.x) * t.x + (r.z - a.z) * t.z;
    if (along >= 0) {
        const b = centerPoints[(i + 1) % SAMPLES];
        const segLen = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        return a.y + (b.y - a.y) * clamp(along / segLen, 0, 1);
    }
    const p = centerPoints[(i - 1 + SAMPLES) % SAMPLES];
    const segLen = Math.hypot(a.x - p.x, a.z - p.z) || 1;
    return a.y + (p.y - a.y) * clamp(-along / segLen, 0, 1);
}

// ------------------------------------------------------------
// Foliage (hand-painted, low-poly trees + bushes)
// ------------------------------------------------------------
// Foliage is batched by material into shared geometries (see makeMerger):
// M.trunk, M.leaf (vertex-coloured for per-tree hue), M.cap, M.bush. Each tree
// part is transform-baked into the right batch instead of becoming its own mesh.
function addTree(x, z, scale, baseY, opts, M) {
    const rotY = Math.random() * Math.PI * 2;
    const gm = new THREE.Matrix4().compose(
        new THREE.Vector3(x, baseY, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
        new THREE.Vector3(scale, scale, scale)
    );
    const at = (ox, oy, oz) =>
        new THREE.Matrix4().multiplyMatrices(gm, new THREE.Matrix4().makeTranslation(ox, oy, oz));

    mergeGeo(M.trunk, new THREE.CylinderGeometry(0.4, 0.55, 2.2, 5), at(0, 1.1, 0));

    // Forest is darker/lusher; default greens are brighter.
    const hueShift = (Math.random() - 0.5) * 0.06;
    const light = opts.dark ? 0.24 + Math.random() * 0.06 : 0.38 + Math.random() * 0.08;
    const sat = opts.dark ? 0.55 : 0.5;
    const green = new THREE.Color().setHSL(0.30 + hueShift, sat, light);

    if (opts.pine || Math.random() < 0.5) {
        for (let i = 0; i < 3; i++) {
            mergeGeo(M.leaf, new THREE.ConeGeometry(2.0 - i * 0.45, 2.0, 6), at(0, 2.6 + i * 1.3, 0), green);
            if (opts.snow) {
                mergeGeo(M.cap, new THREE.ConeGeometry((2.0 - i * 0.45) * 0.6, 0.7, 6), at(0, 3.4 + i * 1.3, 0));
            }
        }
    } else {
        mergeGeo(M.leaf, new THREE.IcosahedronGeometry(2.1, 0), at(0, 3.4, 0), green);
        mergeGeo(M.leaf, new THREE.IcosahedronGeometry(1.5, 0), at(1.0, 2.7, 0.5), green);
    }
}

function addBush(x, z, scale, baseY, opts, M) {
    const light = opts.dark ? 0.22 : 0.34;
    const green = new THREE.Color().setHSL(0.3 + (Math.random() - 0.5) * 0.05, 0.45, light);
    const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, baseY + 0.7 * scale, z),
        new THREE.Quaternion(),
        new THREE.Vector3(scale, scale, scale)
    );
    mergeGeo(M.bush, new THREE.IcosahedronGeometry(1.2, 0), m, green);
}

function buildFoliage() {
    const kind = currentTrack.theme.foliage;
    // Per-theme placement: forest is dense/dark, snowy is sparse pines
    // hugging the slope, default is a mix scattered widely.
    const cfg = {
        mixed:      { step: 9,  skip: 0.45, near: 7,  spread: 55, bushChance: 0.22, opts: {} },
        pine:       { step: 7,  skip: 0.35, near: 4,  spread: 26, bushChance: 0.0,  opts: { pine: true, snow: true } },
        deepforest: { step: 5,  skip: 0.18, near: 5,  spread: 48, bushChance: 0.32, opts: { dark: true, pine: true } }
    }[kind] || { step: 9, skip: 0.45, near: 7, spread: 55, bushChance: 0.22, opts: {} };

    const M = {
        trunk: makeMerger(),
        leaf: makeMerger(true),   // vertex colours keep per-tree hue variation
        cap: makeMerger(),
        bush: makeMerger(true)
    };

    for (let i = 0; i < SAMPLES; i += cfg.step) {
        const c = centerPoints[i];
        const t = tangents[i];
        const px = -t.z, pz = t.x; // left perpendicular
        [-1, 1].forEach(side => {
            if (Math.random() < cfg.skip) return; // leave gaps
            const dist = ROAD_HALF + cfg.near + Math.random() * cfg.spread;
            const jitterX = (Math.random() - 0.5) * 6;
            const jitterZ = (Math.random() - 0.5) * 6;
            const x = c.x + px * side * dist + jitterX;
            const z = c.z + pz * side * dist + jitterZ;
            // Sit foliage near the local road height so it follows slopes.
            const baseY = Math.max(0, c.y - 1);
            if (Math.random() < cfg.bushChance) addBush(x, z, 0.8 + Math.random() * 0.7, baseY, cfg.opts, M);
            else addTree(x, z, 0.8 + Math.random() * 0.8, baseY, cfg.opts, M);
        });
    }

    // Emit one mesh per material batch (4 draw calls instead of hundreds).
    if (M.trunk.pos.length) scene.add(mergerMesh(M.trunk, new THREE.MeshLambertMaterial({ color: 0x7a5230, flatShading: true })));
    if (M.leaf.pos.length) scene.add(mergerMesh(M.leaf, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    if (M.cap.pos.length) scene.add(mergerMesh(M.cap, new THREE.MeshLambertMaterial({ color: 0xf5f9ff, flatShading: true })));
    if (M.bush.pos.length) scene.add(mergerMesh(M.bush, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
}

// Distant snow-capped mountains ringing the snowy track.
function buildMountains() {
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x9aa3ad, flatShading: true });
    const snowMat = new THREE.MeshLambertMaterial({ color: 0xf7fbff, flatShading: true });
    const count = 9;
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + 0.3;
        const dist = 360 + Math.random() * 120;
        const h = 90 + Math.random() * 80;
        const r = h * 0.7;
        const x = Math.cos(a) * dist, z = Math.sin(a) * dist;

        const base = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), rockMat);
        base.position.set(x, h / 2 - 10, z);
        scene.add(base);

        const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, h * 0.4, 6), snowMat);
        cap.position.set(x, h - 10 - h * 0.2, z);
        scene.add(cap);
    }
}

// ------------------------------------------------------------
// Racers
// ------------------------------------------------------------
const WHEEL_RADIUS = 0.72;

// Finish presets map to MeshPhong specular/shininess.
const FINISHES = {
    matte:    { shininess: 6,   specular: 0x141414 },
    gloss:    { shininess: 100, specular: 0x444444 },
    metallic: { shininess: 240, specular: 0xa8adb6 }
};
function bodyMaterial(color, finish) {
    const f = FINISHES[finish] || FINISHES.gloss;
    return new THREE.MeshPhongMaterial({ color, shininess: f.shininess, specular: f.specular });
}

// A detailed wheel: chunky tire, coloured rim, hub cap and a 6-spoke star.
// Returned group spins about its local X axis (the axle) to roll.
// `simple` builds a 2-mesh wheel for AI cars (fewer draw calls).
function createWheel(rimColor, simple) {
    const wheel = new THREE.Group();
    const R = WHEEL_RADIUS, W = 0.56;
    const rc = rimColor != null ? rimColor : 0xc4c9d1;

    const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(R, R, W, simple ? 12 : 22),
        new THREE.MeshPhongMaterial({ color: 0x141619, shininess: 22 })
    );
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    wheel.add(tire);

    const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(R * 0.6, R * 0.6, W + 0.05, simple ? 10 : 18),
        new THREE.MeshPhongMaterial({ color: rc, shininess: 150 })
    );
    rim.rotation.z = Math.PI / 2;
    wheel.add(rim);

    if (simple) return wheel;

    // tread ring for sidewall depth
    const tread = new THREE.Mesh(
        new THREE.CylinderGeometry(R * 1.01, R * 1.01, W * 0.6, 22),
        new THREE.MeshPhongMaterial({ color: 0x0c0d0f, shininess: 10 })
    );
    tread.rotation.z = Math.PI / 2;
    wheel.add(tread);

    const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(R * 0.18, R * 0.18, W + 0.1, 12),
        new THREE.MeshPhongMaterial({ color: 0x2a2d33, shininess: 90 })
    );
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);

    const spokeMat = new THREE.MeshPhongMaterial({ color: rc, shininess: 150 });
    for (let s = 0; s < 3; s++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 0.1, R * 1.65), spokeMat);
        spoke.rotation.x = (s / 3) * Math.PI; // 3 bars => 6-spoke look
        wheel.add(spoke);
    }
    return wheel;
}

// Build a customisable car. opts: { bodyColor, reactorColor, rimColor, finish,
// simple }. Does NOT add itself to a scene — the caller places it.
function createCarMesh(opts) {
    opts = opts || {};
    const bodyColor = opts.bodyColor != null ? opts.bodyColor : 0xe53935;
    const reactorColor = opts.reactorColor != null ? opts.reactorColor : 0x00e5ff;
    const rimColor = opts.rimColor != null ? opts.rimColor : 0xc4c9d1;
    const finish = opts.finish || 'gloss';
    const simple = !!opts.simple;

    const g = new THREE.Group();
    const bodyMat = bodyMaterial(bodyColor, finish);
    const trimMat = new THREE.MeshPhongMaterial({ color: 0x1a1d22, shininess: 60 });

    // Main body: a chassis slab + a sloped upper cowl for a sleeker profile.
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 4.2), bodyMat);
    chassis.position.y = 0.72; chassis.castShadow = true; g.add(chassis);

    const cowl = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 2.4), bodyMat);
    cowl.position.set(0, 1.08, -0.2); cowl.castShadow = true; g.add(cowl);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.34, 1.3), bodyMat);
    nose.position.set(0, 0.66, 1.8); nose.castShadow = true; g.add(nose);

    // Glass canopy (tinted, slightly see-through).
    const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(1.35, 0.5, 1.6),
        new THREE.MeshPhongMaterial({ color: 0x0e151b, shininess: 180, specular: 0x9fd8ff,
            transparent: true, opacity: 0.82 })
    );
    cabin.position.set(0, 1.42, 0.15); cabin.castShadow = true; g.add(cabin);

    if (!simple) {
        // Side skirts.
        [-1, 1].forEach(sx => {
            const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 3.4), trimMat);
            skirt.position.set(sx * 1.02, 0.5, -0.1); g.add(skirt);
        });
        // Front splitter.
        const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.1, 0.5), trimMat);
        splitter.position.set(0, 0.48, 2.35); g.add(splitter);
        // Headlights (front) and taillights (rear) as emissive strips.
        [-0.6, 0.6].forEach(sx => {
            const head = new THREE.Mesh(
                new THREE.BoxGeometry(0.42, 0.16, 0.1),
                new THREE.MeshBasicMaterial({ color: 0xfff4d6 })
            );
            head.position.set(sx, 0.74, 2.42); g.add(head);
            const tail = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.18, 0.1),
                new THREE.MeshBasicMaterial({ color: 0xff2a2a })
            );
            tail.position.set(sx, 0.92, -2.12); g.add(tail);
        });
    }

    // ---- Boost reactor (rear deck, faces the chase camera) ----
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.16, 1.75), trimMat);
    deck.position.set(0, 1.28, -1.05); g.add(deck);

    const boostSegs = [];
    const SEG = 6;
    for (let i = 0; i < SEG; i++) {
        const seg = new THREE.Mesh(
            new THREE.BoxGeometry(0.54, 0.15, 0.2),
            new THREE.MeshBasicMaterial({ color: 0x07242a })
        );
        seg.position.set(0, 1.38, -0.4 - i * 0.25); // front segment fills first
        g.add(seg);
        boostSegs.push(seg);
    }

    // Rear wing on struts.
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.55), bodyMat);
    wing.position.set(0, 1.6, -2.05); wing.castShadow = true; g.add(wing);
    [-0.85, 0.85].forEach(sx => {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.12), trimMat);
        strut.position.set(sx, 1.4, -2.0); g.add(strut);
    });

    // ---- Wheels (steerable fronts, all roll) ----
    const wheels = [];
    [
        { x: 1.07, z: 1.4, front: true },
        { x: -1.07, z: 1.4, front: true },
        { x: 1.07, z: -1.5, front: false },
        { x: -1.07, z: -1.5, front: false }
    ].forEach(d => {
        const pivot = new THREE.Group();          // front pivot steers
        pivot.position.set(d.x, WHEEL_RADIUS, d.z);
        const spinner = createWheel(rimColor, simple); // spins to roll
        pivot.add(spinner);
        g.add(pivot);
        wheels.push({ pivot, spinner, front: d.front });
    });

    g._bodyMat = bodyMat;
    g._boostSegs = boostSegs;
    g._wheels = wheels;
    g._reactorRGB = hexToRGB01(reactorColor);
    return g;
}

function makeRacer(opts) {
    const mesh = createCarMesh({
        bodyColor: opts.color,
        reactorColor: opts.reactorColor,
        rimColor: opts.rimColor,
        finish: opts.finish,
        simple: opts.simple
    });
    scene.add(mesh);
    return {
        mesh,
        baseColor: opts.color,
        isPlayer: !!opts.isPlayer,
        x: 0, z: 0, y: 0, heading: 0, speed: 0,
        vx: 0, vz: 0, vy: 0, airborne: false,
        lap: 1, progress: 0, lastProgress: 0, lastIndex: 0,
        finished: false, finishTime: null, finishOrder: 0,
        boostTime: 0,
        nitroCharge: 0,
        bestLap: null, lapStartTime: 0,
        // physics tuning (velocity-vector model = momentum + drift)
        accel: 0.013, brakePower: 0.024, reverseAccel: 0.008,
        baseThrottle: 0.45,              // fraction of top speed with stick centred
        drag: 0.99, offTrackDrag: 0.965,
        grip: 0.82, offTrackGrip: 0.9,   // fraction of sideways velocity kept (higher = more slide)
        maxSpeed: 0.95, offTrackMaxSpeed: 0.6,
        turnRate: 0.045,
        // ai
        skill: opts.skill || 1,
        lookahead: opts.lookahead || 16,
        offTrack: false
    };
}

function buildRacers() {
    racers = [];
    player = makeRacer({
        color: profile.bodyColor, reactorColor: profile.reactorColor,
        rimColor: profile.rimColor, finish: profile.finish, isPlayer: true
    });
    racers.push(player);

    const aiCount = 3;
    for (let i = 0; i < aiCount; i++) {
        racers.push(makeRacer({
            color: AI_COLORS[i % AI_COLORS.length],
            simple: true,                 // AI cars: lighter LOD (fewer draw calls)
            skill: 0.9 + Math.random() * 0.16,
            lookahead: 14 + Math.floor(Math.random() * 6)
        }));
    }
}

function placeRacersAtStart() {
    const start = centerPoints[0];
    const t = tangents[0];
    const heading = Math.atan2(t.x, t.z);
    const px = -t.z, pz = t.x; // left perpendicular

    racers.forEach((r, i) => {
        const row = Math.floor(i / 2);
        const lane = (i % 2 === 0) ? -1 : 1;
        const back = 6 + row * 8;
        const side = lane * 3.2;
        r.x = start.x - t.x * back + px * side;
        r.z = start.z - t.z * back + pz * side;
        r.heading = heading;
        r.speed = 0;
        r.vx = 0; r.vz = 0; r.vy = 0; r.airborne = false;
        r.lastIndex = 0;
        r.y = trackHeightAt(r);
        r.lap = 1; r.progress = 0; r.lastProgress = 0;
        r.finished = false; r.finishTime = null;
        r.boostTime = 0; r.nitroCharge = 0; r.bestLap = null;
        r.mesh.position.set(r.x, r.y, r.z);
        r.mesh.rotation.set(0, heading, 0);
    });

    positionCamera(true);
}

// ------------------------------------------------------------
// Track progress (windowed nearest-sample search)
// ------------------------------------------------------------
function nearestIndex(r) {
    let best = r.lastIndex, bestD = Infinity;
    for (let off = -50; off <= 50; off++) {
        const i = ((r.lastIndex + off) % SAMPLES + SAMPLES) % SAMPLES;
        const p = centerPoints[i];
        const dd = (p.x - r.x) ** 2 + (p.z - r.z) ** 2;
        if (dd < bestD) { bestD = dd; best = i; }
    }
    r.lastIndex = best;
    return { index: best, dist: Math.sqrt(bestD) };
}

function updateProgress(r) {
    const info = nearestIndex(r);
    r.offTrack = info.dist > ROAD_HALF;
    const p = info.index / SAMPLES;

    if (race.started && !r.finished) {
        if (r.lastProgress > 0.85 && p < 0.15) {
            const now = performance.now();
            if (r.lapStartTime) {
                const lapTime = (now - r.lapStartTime) / 1000;
                if (r.bestLap === null || lapTime < r.bestLap) r.bestLap = lapTime;
            }
            r.lapStartTime = now;
            r.lap++;
            if (r.lap > TOTAL_LAPS) finishRacer(r, now);
        }
    }
    r.lastProgress = p;
    r.progress = p;
}

function raceScore(r) {
    if (r.finished) return 1000 - r.finishOrder;
    return (r.lap - 1) + r.progress;
}

// ------------------------------------------------------------
// Physics step
// ------------------------------------------------------------
function stepRacer(r, ctrl) {
    const fX = Math.sin(r.heading), fZ = Math.cos(r.heading);
    let speed = Math.hypot(r.vx, r.vz);
    let fwd = r.vx * fX + r.vz * fZ;   // signed forward speed

    const rawTh = clamp(ctrl.throttle || 0, -1, 1);
    const fwdTh = Math.max(rawTh, 0);  // forward portion 0..1
    // Drive level scales top speed: centred stick still gives base speed.
    const drive = r.baseThrottle + fwdTh * (1 - r.baseThrottle); // base..1

    // Engine + steering only apply with wheels on the ground.
    if (!r.finished && race.started && !r.airborne) {
        if (rawTh >= 0) {
            // accelerate toward the (throttle-scaled) top speed
            r.vx += fX * r.accel; r.vz += fZ * r.accel;
        } else {
            // pull back on the stick to brake / reverse
            const f = (fwd > 0.02) ? r.brakePower : r.reverseAccel;
            const b = -rawTh; // 0..1
            r.vx -= fX * f * b; r.vz -= fZ * f * b;
        }

        // Manual nitro: fire when charged and not already boosting.
        if (ctrl.nitro && r.nitroCharge >= 1 && r.boostTime <= 0) {
            r.boostTime = NITRO_FRAMES;
            r.nitroCharge = 0;
            if (r.isPlayer) showCenter('<span style="color:#ff6a4d">NITRO!</span>', false);
        }

        if (r.boostTime > 0) {
            r.boostTime--;
            r.vx += fX * 0.02; r.vz += fZ * 0.02;
        }

        const speedFactor = Math.min(speed / 0.25, 1);
        const dir = fwd >= 0 ? 1 : -1;
        r.heading -= ctrl.steer * r.turnRate * speedFactor * dir;
    } else if (r.finished) {
        r.vx *= 0.92; r.vz *= 0.92;
    }

    // Recharge nitro over time while racing.
    if (race.started && !r.finished) {
        r.nitroCharge = Math.min(1, r.nitroCharge + NITRO_REGEN);
    }

    // Grip: keep forward velocity, bleed off sideways velocity.
    const f2X = Math.sin(r.heading), f2Z = Math.cos(r.heading);
    fwd = r.vx * f2X + r.vz * f2Z;
    const latX = r.vx - f2X * fwd, latZ = r.vz - f2Z * fwd;
    const grip = r.airborne ? 1 : (r.offTrack ? r.offTrackGrip : r.grip);
    r.vx = f2X * fwd + latX * grip;
    r.vz = f2Z * fwd + latZ * grip;

    // Drag + top-speed clamp (top speed scales with throttle).
    const drag = r.airborne ? 0.999 : (r.offTrack ? r.offTrackDrag : r.drag);
    r.vx *= drag; r.vz *= drag;
    speed = Math.hypot(r.vx, r.vz);
    let topSpeed = (r.offTrack ? r.offTrackMaxSpeed : r.maxSpeed) * drive;
    if (r.boostTime > 0) topSpeed = Math.max(topSpeed, 1.55);
    if (speed > topSpeed) { r.vx *= topSpeed / speed; r.vz *= topSpeed / speed; }
    if (speed < 0.0008) { r.vx = 0; r.vz = 0; }

    // Integrate horizontal position.
    r.x += r.vx; r.z += r.vz;

    // Vertical: ramps launch a jump; otherwise the car hugs the road surface.
    // Crucially, a downhill stretch does NOT make the car "fall" — only a ramp
    // does. That keeps the engine/steering live over hills (they're gated on
    // !airborne) and stops the per-frame airborne flicker on slopes.
    const hspeed = Math.hypot(r.vx, r.vz);
    const groundY = trackHeightAt(r);
    const ramp = rampUnder(r, hspeed);
    if (ramp) {
        r.y = ramp.y;
        r.vy = ramp.vy;     // ride the ramp; stored for launch off the lip
        r.airborne = false;
    } else if (r.airborne) {
        // mid-jump: integrate and fall until we meet the ground again
        r.y += r.vy;
        r.vy -= GRAVITY;
        if (r.y <= groundY) { r.y = groundY; r.vy = 0; r.airborne = false; }
    } else if (r.vy > 0.01) {
        // just left a ramp lip with upward speed -> become airborne
        r.airborne = true;
        r.y += r.vy;
        r.vy -= GRAVITY;
    } else {
        // grounded: follow the (interpolated) terrain height smoothly
        r.y = groundY;
        r.vy = 0;
    }

    r.speed = fwd; // forward speed, used by HUD + AI
}

function applyTransform(r, ctrlSteer) {
    r.mesh.position.set(r.x, r.y, r.z);
    r.mesh.rotation.y = r.heading;
    const roll = -ctrlSteer * Math.min(Math.abs(r.speed) / r.maxSpeed, 1) * 0.12;
    r.mesh.rotation.z = roll;
    r.mesh.rotation.x = (r.airborne) ? clamp(-r.vy * 1.2, -0.5, 0.5) : 0;

    // Wheels: roll proportional to forward speed; front wheels steer.
    r._wheelSpin = (r._wheelSpin || 0) + r.speed / WHEEL_RADIUS;
    const steerAngle = clamp(ctrlSteer, -1, 1) * 0.5;
    const wheels = r.mesh._wheels;
    if (wheels) {
        for (let i = 0; i < wheels.length; i++) {
            wheels[i].spinner.rotation.x = r._wheelSpin;
            if (wheels[i].front) wheels[i].pivot.rotation.y = steerAngle;
        }
    }

    updateBoostReactor(r);

    // Subtle whole-body glow while a boost is firing (no per-frame allocation).
    if (r.mesh._bodyMat) {
        const boosting = r.boostTime > 0;
        r.mesh._bodyMat.emissive.setHex(boosting ? 0x0a7d96 : 0x000000);
        r.mesh._bodyMat.emissiveIntensity = boosting ? 0.5 : 0;
    }
}

// Light the roof reactor strip to match the car's nitro state:
//   charging  -> cyan segments fill from the front as charge rises
//   ready      -> all segments shimmer toward white
//   boosting   -> whole strip surges orange and pulses
function updateBoostReactor(r) {
    const segs = r.mesh._boostSegs;
    if (!segs) return;
    const n = segs.length;
    const charge = clamp(r.nitroCharge, 0, 1);
    const lit = Math.round(charge * n);
    const boosting = r.boostTime > 0;
    const ready = charge >= 0.999;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.012);
    const rc = r.mesh._reactorRGB || [0, 0.85, 1]; // the car's chosen reactor colour
    for (let i = 0; i < n; i++) {
        const c = segs[i].material.color;
        if (boosting) {
            const s = 0.6 + 0.4 * pulse;
            c.setRGB(1.0 * s, 0.5 * s, 0.12 * s);    // orange surge (universal)
        } else if (i < lit) {
            if (ready) {
                const w = pulse * 0.55;              // shimmer toward white when full
                c.setRGB(rc[0] + (1 - rc[0]) * w, rc[1] + (1 - rc[1]) * w, rc[2] + (1 - rc[2]) * w);
            } else {
                c.setRGB(rc[0], rc[1], rc[2]);       // steady fill
            }
        } else {
            c.setRGB(rc[0] * 0.14, rc[1] * 0.14, rc[2] * 0.14); // dim/empty
        }
    }
}

// AI controller: steer toward a look-ahead point, ease off in corners,
// and pop nitro on the straights.
function aiControl(r) {
    const targetIdx = (r.lastIndex + r.lookahead) % SAMPLES;
    const target = centerPoints[targetIdx];
    const desired = Math.atan2(target.x - r.x, target.z - r.z);
    let diff = desired - r.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const sharp = Math.abs(diff);
    const targetSpeed = r.maxSpeed * r.skill * (1 - Math.min(sharp * 1.4, 0.55));

    const ctrl = { steer: 0, throttle: 0, nitro: false };
    if (r.speed < targetSpeed - 0.02) ctrl.throttle = 1;
    else if (r.speed > targetSpeed + 0.12) ctrl.throttle = -0.7;
    else ctrl.throttle = 0.35;

    // Use nitro when charged and pointing down a straight.
    if (r.nitroCharge >= 1 && sharp < 0.12) ctrl.nitro = true;

    const speedFactor = Math.min(Math.abs(r.speed) / 0.25, 1) || 1;
    ctrl.steer = clamp(-diff / (r.turnRate * speedFactor), -1, 1);
    return ctrl;
}

// ------------------------------------------------------------
// Boost pickups
// ------------------------------------------------------------
function checkBoosts(r) {
    for (const pad of boostPads) {
        const dd = (pad.x - r.x) ** 2 + (pad.z - r.z) ** 2;
        if (dd < BOOST_RADIUS * BOOST_RADIUS) {
            if (r.boostTime < BOOST_FRAMES - 20) r.boostTime = BOOST_FRAMES;
            r.nitroCharge = Math.min(1, r.nitroCharge + 0.5); // pads top up nitro
            if (r.isPlayer) showCenter('<span style="color:#00e5ff">BOOST!</span>', false);
        }
    }
}

// ------------------------------------------------------------
// Collisions (circle vs circle)
// ------------------------------------------------------------
function handleCollisions() {
    const minDist = CAR_RADIUS * 2;
    const BUMP = 0.06;
    const RESTITUTION = 1.15;
    for (let i = 0; i < racers.length; i++) {
        for (let j = i + 1; j < racers.length; j++) {
            const a = racers[i], b = racers[j];
            let dx = b.x - a.x, dz = b.z - a.z;
            let dist = Math.hypot(dx, dz);
            if (dist === 0) { dx = 0.01; dist = 0.01; }
            if (dist >= minDist) continue;

            const nx = dx / dist, nz = dz / dist;
            const overlap = (minDist - dist) / 2;
            a.x -= nx * overlap; a.z -= nz * overlap;
            b.x += nx * overlap; b.z += nz * overlap;

            const an = a.vx * nx + a.vz * nz;
            const bn = b.vx * nx + b.vz * nz;
            if (an - bn > 0) {
                const t = (an - bn) * RESTITUTION;
                a.vx -= t * nx; a.vz -= t * nz;
                b.vx += t * nx; b.vz += t * nz;
            }
            a.vx -= nx * BUMP; a.vz -= nz * BUMP;
            b.vx += nx * BUMP; b.vz += nz * BUMP;
        }
    }
}

// ------------------------------------------------------------
// Camera follows the player
// ------------------------------------------------------------
function positionCamera(snap) {
    const back = 15, height = 8.5, ahead = 9;
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    const dest = new THREE.Vector3(
        player.x - fx * back,
        height + player.y,
        player.z - fz * back
    );
    if (snap) camera.position.copy(dest);
    else camera.position.lerp(dest, 0.12);
    camera.lookAt(player.x + fx * ahead, 1 + player.y, player.z + fz * ahead);
}

// ------------------------------------------------------------
// Main update
// ------------------------------------------------------------
function update() {
    pollKeyboard();
    pollGamepad();

    racers.forEach(r => {
        let ctrl;
        if (r.isPlayer) {
            ctrl = { steer: input.steer, throttle: input.throttle, nitro: input.nitro };
        } else {
            ctrl = race.started ? aiControl(r) : { steer: 0, throttle: 0, nitro: false };
        }
        r._lastSteer = ctrl.steer;
        stepRacer(r, ctrl);
    });

    input.nitro = false; // momentary: consumed each frame

    handleCollisions();

    racers.forEach(r => {
        checkBoosts(r);
        updateProgress(r);
        applyTransform(r, r._lastSteer || 0);
    });

    positionCamera(false);

    if (race.started && !race.finished) {
        race.elapsed = (performance.now() - race.startTime) / 1000;
        if (player.finished) finishRace();
    }
    updateHUD();
}

// The simulation runs at a fixed 60 Hz regardless of render frame rate, so
// the car physics (tuned per-tick) feel identical whether the GPU is pushing
// 30 or 120 fps. Without this, a 30fps device runs the sim half as often and
// the cars crawl at half speed.
const SIM_STEP = 1000 / 60;   // ms per physics tick
const MAX_SUBSTEPS = 5;       // cap catch-up work after a stall
let _lastFrame = performance.now();
let _accum = 0;

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    let frameTime = now - _lastFrame;
    _lastFrame = now;
    if (frameTime > 250) frameTime = 250; // ignore big gaps (tab/app backgrounded)

    _accum += frameTime;
    let steps = 0;
    while (_accum >= SIM_STEP && steps < MAX_SUBSTEPS) {
        update();
        _accum -= SIM_STEP;
        steps++;
    }
    if (steps === MAX_SUBSTEPS) _accum = 0; // dropped frames: don't spiral

    renderer.render(scene, camera);
    drawMinimap();
    updateFps();
}

// ------------------------------------------------------------
// HUD
// ------------------------------------------------------------
function formatTime(sec) {
    if (sec === null || sec === undefined) return '--:--.--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const cs = Math.floor((sec * 100) % 100);
    return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function playerPosition() {
    const sorted = [...racers].sort((a, b) => raceScore(b) - raceScore(a));
    return sorted.indexOf(player) + 1;
}

// Speed display tuning: maps internal speed units to a fast-feeling MPH, and
// the bar fills toward boosted top speed so a boost visibly pegs it.
const SPEED_MPH = 215;
const SPEED_BAR_MAX = 1.6;

function updateHUD() {
    hud.pos.textContent = `${playerPosition()}/${racers.length}`;
    hud.lap.textContent = `${Math.min(player.lap, TOTAL_LAPS)}/${TOTAL_LAPS}`;
    hud.time.textContent = formatTime(race.elapsed);
    hud.best.textContent = formatTime(player.bestLap);

    const spd = Math.abs(player.speed);
    hud.speed.textContent = Math.round(spd * SPEED_MPH);

    // Energy speed bar: clip-path reveal (CSS-eased = smooth), glow/streak
    // intensify with speed, and a boost turns the whole bar hot.
    const frac = clamp(spd / SPEED_BAR_MAX, 0, 1);
    if (hud.speedBar) {
        const reveal = `inset(0 ${((1 - frac) * 100).toFixed(1)}% 0 0)`;
        hud.speedGrad.style.clipPath = reveal;
        hud.speedStreak.style.clipPath = reveal;
        hud.speedBar.style.setProperty('--i', frac.toFixed(3));
        hud.speedStreak.style.opacity = (frac * 0.6).toFixed(2);
        // Faster scroll as you speed up (only update on meaningful change).
        const dur = (1.05 - 0.82 * frac);
        if (Math.abs((hud._streakDur || 0) - dur) > 0.04) {
            hud.speedStreak.style.animationDuration = dur.toFixed(2) + 's';
            hud._streakDur = dur;
        }
        hud.speedBar.classList.toggle('boosting', player.boostTime > 0);
    }

    if (hud.nitroFill) hud.nitroFill.style.height = `${Math.round(player.nitroCharge * 100)}%`;
    if (hud.nitroBtn) hud.nitroBtn.classList.toggle('ready', player.nitroCharge >= 1);
}

// ------------------------------------------------------------
// Mini-map: top-down course outline + live racer positions
// ------------------------------------------------------------
const minimap = {
    canvas: document.getElementById('minimap'),
    ctx: null, pts: null, map: null, size: 130, dpr: 1
};
if (minimap.canvas) minimap.ctx = minimap.canvas.getContext('2d');

// Recompute the world->canvas mapping and cache the track outline for the
// current track. Called whenever a track is (re)built.
function setupMinimap() {
    const mm = minimap;
    if (!mm.ctx || !centerPoints.length) return;
    const cssSize = mm.canvas.clientWidth || 130;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    mm.size = cssSize;
    mm.dpr = dpr;
    mm.canvas.width = Math.round(cssSize * dpr);
    mm.canvas.height = Math.round(cssSize * dpr);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of centerPoints) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
    }
    const pad = 12;
    const avail = cssSize - pad * 2;
    const worldW = (maxX - minX) || 1, worldH = (maxZ - minZ) || 1;
    const scale = avail / Math.max(worldW, worldH);
    const ox = pad + (avail - worldW * scale) / 2;
    const oy = pad + (avail - worldH * scale) / 2;
    mm.map = (x, z) => ({ x: ox + (x - minX) * scale, y: oy + (z - minZ) * scale });
    mm.pts = centerPoints.map(p => mm.map(p.x, p.z));
}

function drawMinimap() {
    const mm = minimap;
    if (!mm.ctx || !mm.pts) return;
    const ctx = mm.ctx;
    ctx.setTransform(mm.dpr, 0, 0, mm.dpr, 0, 0);
    ctx.clearRect(0, 0, mm.size, mm.size);

    // Course outline.
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    mm.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();

    // Start/finish marker.
    const s = mm.pts[0];
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(s.x - 2.5, s.y - 2.5, 5, 5);

    // Racers: AI as dots, the player as a heading arrow.
    for (const r of racers) {
        const p = mm.map(r.x, r.z);
        const col = hexToCss(r.baseColor);
        if (r.isPlayer) {
            const dx = Math.sin(r.heading), dz = Math.cos(r.heading);
            const nx = -dz, nz = dx;
            ctx.beginPath();
            ctx.moveTo(p.x + dx * 7, p.y + dz * 7);
            ctx.lineTo(p.x - dx * 4 + nx * 4, p.y - dz * 4 + nz * 4);
            ctx.lineTo(p.x - dx * 4 - nx * 4, p.y - dz * 4 - nz * 4);
            ctx.closePath();
            ctx.fillStyle = col;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
            ctx.fillStyle = col;
            ctx.fill();
        }
    }
}

function showCenter(html, persist) {
    hud.center.innerHTML = html;
    hud.center.classList.add('show');
    if (!persist) {
        clearTimeout(showCenter._t);
        showCenter._t = setTimeout(() => hud.center.classList.remove('show'), 800);
    }
}
function hideCenter() { hud.center.classList.remove('show'); }

// ------------------------------------------------------------
// Race flow
// ------------------------------------------------------------
let finishCounter = 0;

function startCountdown() {
    const steps = ['3', '2', '1'];
    let i = 0;
    const tick = () => {
        if (i < steps.length) {
            showCenter(steps[i], true);
            i++;
            setTimeout(tick, 1000);
        } else {
            showCenter('<span style="color:#2ecc71">GO!</span>', false);
            beginRace();
        }
    };
    tick();
}

function beginRace() {
    race.started = true;
    race.finished = false;
    race.startTime = performance.now();
    race.elapsed = 0;
    finishCounter = 0;
    racers.forEach(r => { r.lapStartTime = performance.now(); });
}

function finishRacer(r, now) {
    r.finished = true;
    r.lap = TOTAL_LAPS;
    r.finishTime = (now - race.startTime) / 1000;
    r.finishOrder = ++finishCounter;
}

function finishRace() {
    race.finished = true;
    recordResult();
    const place = player.finishOrder || playerPosition();
    const ord = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'][place] || (place + 'th');
    const nextName = TRACKS[(currentTrackIndex + 1) % TRACKS.length].name;
    showCenter(
        `FINISH ${ord}<span class="sub">Time ${formatTime(player.finishTime || race.elapsed)} &middot; Best lap ${formatTime(player.bestLap)}</span><span class="sub" style="color:#ffd166">Tap for next track: ${nextName} &middot; ≡ for tracks</span>`,
        true
    );
    waitForRestart();
}

function waitForRestart() {
    const restart = () => {
        document.removeEventListener('pointerdown', restart);
        document.removeEventListener('keydown', restart);
        resetRace();
    };
    waitForRestart._restart = restart;
    setTimeout(() => {
        document.addEventListener('pointerdown', restart);
        document.addEventListener('keydown', restart);
    }, 900);
}

function clearRestartListeners() {
    if (waitForRestart._restart) {
        document.removeEventListener('pointerdown', waitForRestart._restart);
        document.removeEventListener('keydown', waitForRestart._restart);
        waitForRestart._restart = null;
    }
}

function resetRace() {
    // Rotate to the next track so back-to-back games aren't the same map.
    const next = (currentTrackIndex + 1) % TRACKS.length;
    startTrack(next);
}

// ------------------------------------------------------------
// Track loading + menu
// ------------------------------------------------------------
function loadTrack(i) {
    currentTrackIndex = i;
    currentTrack = TRACKS[i];
    buildScene();
    handleResize();
}

function startTrack(i) {
    clearRestartListeners();
    hideAllScreens();
    loadTrack(i);
    race.started = false;
    race.finished = false;
    race.elapsed = 0;
    hideCenter();
    startCountdown();
    if (!animateStarted) { animateStarted = true; animate(); }
}

const menuEl = document.getElementById('menu');
const trackListEl = document.getElementById('trackList');

function buildMenu() {
    trackListEl.innerHTML = '';
    TRACKS.forEach((t, i) => {
        const card = document.createElement('button');
        card.className = 'track-card';
        const swatch = `#${t.theme.ground.toString(16).padStart(6, '0')}`;
        card.innerHTML =
            `<span class="tc-name">${t.name}</span>` +
            `<span class="tc-desc">${t.desc}</span>` +
            `<span class="tc-swatch" style="background:${swatch}"></span>`;
        card.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            startTrack(i);
        });
        trackListEl.appendChild(card);
    });
}

function showMenu() {
    clearRestartListeners();
    race.started = false;
    hideCenter();
    buildMenu();
    hideAllScreens();
    menuEl.classList.add('show');
}

function hideMenu() {
    menuEl.classList.remove('show');
}

const menuBtn = document.getElementById('menuBtn');
if (menuBtn) {
    menuBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showMenu();
    });
}

// ------------------------------------------------------------
// Player profile + Home / Garage screens
// ------------------------------------------------------------
const PROFILE_KEY = 'mobmobs_profile';
const DEFAULT_PROFILE = {
    name: 'Player', bodyColor: 0xe53935, reactorColor: 0x00e5ff,
    rimColor: 0xc4c9d1, finish: 'gloss',
    races: 0, wins: 0, bestLap: null
};
const BODY_COLORS = [
    0xe53935, 0xff8f00, 0xfdd835, 0x43a047, 0x00acc1, 0x1e88e5,
    0x3949ab, 0x8e24aa, 0xec407a, 0xff7043, 0xeceff1, 0x263238
];
const REACTOR_COLORS = [0x00e5ff, 0x76ff03, 0xff3d00, 0xffea00, 0xd500f9, 0xff1493, 0xffffff, 0xff9100];
const RIM_COLORS = [0xc4c9d1, 0x2a2d33, 0xffd54f, 0xff5252, 0x40c4ff, 0x69f0ae, 0xb388ff, 0xff80ab];
const FINISH_OPTS = [
    { id: 'gloss', label: 'Gloss' },
    { id: 'matte', label: 'Matte' },
    { id: 'metallic', label: 'Metal' }
];

let profile = loadProfile();

function loadProfile() {
    try {
        const raw = localStorage.getItem(PROFILE_KEY);
        if (raw) return Object.assign({}, DEFAULT_PROFILE, JSON.parse(raw));
    } catch (e) { /* storage unavailable */ }
    return Object.assign({}, DEFAULT_PROFILE);
}
function saveProfile() {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch (e) { /* ignore */ }
}

function hexToCss(c) { return '#' + (c >>> 0).toString(16).padStart(6, '0').slice(-6); }
function hexToRGB01(c) { return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]; }

// Record race outcome into the profile (called when the player finishes).
function recordResult() {
    profile.races = (profile.races || 0) + 1;
    if ((player.finishOrder || playerPosition()) === 1) profile.wins = (profile.wins || 0) + 1;
    if (player.bestLap != null && (profile.bestLap == null || player.bestLap < profile.bestLap)) {
        profile.bestLap = player.bestLap;
    }
    saveProfile();
}

const homeEl = document.getElementById('home');
const garageEl = document.getElementById('garage');
const nameInput = document.getElementById('nameInput');
const profileAvatar = document.getElementById('profileAvatar');
const statRaces = document.getElementById('statRaces');
const statWins = document.getElementById('statWins');
const statBest = document.getElementById('statBest');
const garageCanvas = document.getElementById('garageCanvas');
const bodySwatches = document.getElementById('bodySwatches');
const rimSwatches = document.getElementById('rimSwatches');
const reactorSwatches = document.getElementById('reactorSwatches');
const finishControl = document.getElementById('finishControl');

function hideAllScreens() {
    stopGaragePreview();
    if (homeEl) homeEl.classList.remove('show');
    if (garageEl) garageEl.classList.remove('show');
    if (menuEl) menuEl.classList.remove('show');
}

function renderProfile() {
    nameInput.value = profile.name || '';
    profileAvatar.style.background = hexToCss(profile.bodyColor);
    profileAvatar.textContent = ((profile.name || 'P').trim().charAt(0) || 'P').toUpperCase();
    statRaces.textContent = profile.races || 0;
    statWins.textContent = profile.wins || 0;
    statBest.textContent = formatTime(profile.bestLap);
}

function showHome() {
    clearRestartListeners();
    race.started = false;
    hideCenter();
    renderProfile();
    hideAllScreens();
    homeEl.classList.add('show');
}

// ---- Live 3D garage preview (its own tiny renderer/scene) ----
const garagePreview = {
    renderer: null, scene: null, camera: null,
    car: null, raf: 0, angle: 0.6, dragging: false, lastX: 0, spin: 0.012
};

function initGaragePreview() {
    const gp = garagePreview;
    if (gp.renderer || !garageCanvas) return;
    gp.renderer = new THREE.WebGLRenderer({ canvas: garageCanvas, antialias: true, alpha: true });
    gp.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    gp.scene = new THREE.Scene();
    gp.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    gp.camera.position.set(0, 3.0, 8.6);
    gp.camera.lookAt(0, 0.85, 0);

    gp.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(5, 9, 6); gp.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88bbff, 0.5);
    fill.position.set(-6, 4, -5); gp.scene.add(fill);

    // Drag to spin the car.
    garageCanvas.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        gp.dragging = true; gp.lastX = e.clientX;
    });
    window.addEventListener('pointermove', (e) => {
        if (!gp.dragging) return;
        gp.angle += (e.clientX - gp.lastX) * 0.01;
        gp.lastX = e.clientX;
    });
    window.addEventListener('pointerup', () => { gp.dragging = false; });
}

function sizeGaragePreview() {
    const gp = garagePreview;
    if (!gp.renderer) return;
    const w = garageCanvas.clientWidth || 320;
    const h = garageCanvas.clientHeight || 200;
    gp.renderer.setSize(w, h, false);
    gp.camera.aspect = w / h;
    gp.camera.updateProjectionMatrix();
}

function refreshGarageCar() {
    const gp = garagePreview;
    if (!gp.scene) return;
    if (gp.car) {
        gp.scene.remove(gp.car);
        gp.car.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
        });
    }
    gp.car = createCarMesh({
        bodyColor: profile.bodyColor, reactorColor: profile.reactorColor,
        rimColor: profile.rimColor, finish: profile.finish
    });
    // Fully light the reactor strip so the chosen colour reads in the preview.
    const rc = gp.car._reactorRGB;
    gp.car._boostSegs.forEach(s => s.material.color.setRGB(rc[0], rc[1], rc[2]));
    gp.scene.add(gp.car);
}

function garageLoop() {
    const gp = garagePreview;
    gp.raf = requestAnimationFrame(garageLoop);
    if (!gp.dragging) gp.angle += gp.spin;
    if (gp.car) gp.car.rotation.y = gp.angle;
    gp.renderer.render(gp.scene, gp.camera);
}

function startGaragePreview() {
    initGaragePreview();
    sizeGaragePreview();
    refreshGarageCar();
    if (!garagePreview.raf) garageLoop();
}

function stopGaragePreview() {
    if (garagePreview.raf) { cancelAnimationFrame(garagePreview.raf); garagePreview.raf = 0; }
}

function buildSwatches(container, colors, key) {
    container.innerHTML = '';
    colors.forEach(c => {
        const b = document.createElement('button');
        b.className = 'swatch' + (c === profile[key] ? ' selected' : '');
        b.style.background = hexToCss(c);
        b.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            profile[key] = c;
            saveProfile();
            buildSwatches(container, colors, key); // refresh selection ring
            refreshGarageCar();
        });
        container.appendChild(b);
    });
}

function buildFinishControl() {
    finishControl.innerHTML = '';
    FINISH_OPTS.forEach(opt => {
        const b = document.createElement('button');
        b.className = 'seg-btn' + (opt.id === profile.finish ? ' selected' : '');
        b.textContent = opt.label;
        b.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            profile.finish = opt.id;
            saveProfile();
            buildFinishControl();
            refreshGarageCar();
        });
        finishControl.appendChild(b);
    });
}

function showGarage() {
    hideCenter();
    buildSwatches(bodySwatches, BODY_COLORS, 'bodyColor');
    buildSwatches(rimSwatches, RIM_COLORS, 'rimColor');
    buildSwatches(reactorSwatches, REACTOR_COLORS, 'reactorColor');
    buildFinishControl();
    hideAllScreens();
    garageEl.classList.add('show');
    startGaragePreview();
}

if (nameInput) {
    nameInput.addEventListener('input', () => {
        profile.name = nameInput.value;
        saveProfile();
    });
    // Don't let typing in the name field steer/boost the car.
    ['keydown', 'keyup', 'pointerdown'].forEach(ev =>
        nameInput.addEventListener(ev, (e) => e.stopPropagation()));
}

[['playBtn', showMenu], ['garageBtn', showGarage],
 ['garageBackBtn', showHome], ['menuBackBtn', showHome]].forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
});

// ------------------------------------------------------------
// Resize / fullscreen
// ------------------------------------------------------------
function handleResize() {
    if (garageEl && garageEl.classList.contains('show')) sizeGaragePreview();
    if (!renderer || !camera) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    updateJoystickCenter();
    setupMinimap();
}

// ------------------------------------------------------------
// Joystick: steering (X) + throttle (push up)
// ------------------------------------------------------------
function updateJoystickCenter() {
    const rect = joystick.base.getBoundingClientRect();
    joystick.centerX = rect.left + rect.width / 2;
    joystick.centerY = rect.top + rect.height / 2;
}

function setJoystickFromPoint(clientX, clientY) {
    const dx = clientX - joystick.centerX;
    const dy = clientY - joystick.centerY;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, joystick.radius);
    const angle = Math.atan2(dy, dx);
    const ox = Math.cos(angle) * clamped;
    const oy = Math.sin(angle) * clamped;
    joystick.stick.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px))`;
    input.steer = clamp(ox / joystick.radius, -1, 1);
    input.throttle = clamp(-oy / joystick.radius, -1, 1); // up = forward
}

function resetJoystick() {
    joystick.isActive = false;
    joystick.pointerId = null;
    joystick.element.classList.remove('active');
    joystick.stick.style.transform = 'translate(-50%, -50%)';
    if (!keyboardActive()) { input.steer = 0; input.throttle = 0; }
}

joystick.base.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    joystick.isActive = true;
    joystick.pointerId = e.pointerId;
    joystick.element.classList.add('active');
    updateJoystickCenter();
    setJoystickFromPoint(e.clientX, e.clientY);
});
document.addEventListener('pointermove', (e) => {
    if (joystick.isActive && e.pointerId === joystick.pointerId) {
        e.preventDefault();
        setJoystickFromPoint(e.clientX, e.clientY);
    }
}, { passive: false });
document.addEventListener('pointerup', (e) => {
    if (joystick.isActive && e.pointerId === joystick.pointerId) resetJoystick();
});
document.addEventListener('pointercancel', (e) => {
    if (joystick.isActive && e.pointerId === joystick.pointerId) resetJoystick();
});

// ------------------------------------------------------------
// Nitro button
// ------------------------------------------------------------
const nitroBtnEl = document.getElementById('nitroBtn');
if (nitroBtnEl) {
    const fire = (e) => { e.preventDefault(); e.stopPropagation(); input.nitro = true; nitroBtnEl.classList.add('pressed'); };
    const release = (e) => { e.preventDefault(); nitroBtnEl.classList.remove('pressed'); };
    nitroBtnEl.addEventListener('pointerdown', fire);
    nitroBtnEl.addEventListener('pointerup', release);
    nitroBtnEl.addEventListener('pointerleave', release);
    nitroBtnEl.addEventListener('pointercancel', release);
}

// ------------------------------------------------------------
// Keyboard (desktop)
// ------------------------------------------------------------
const keys = { up: false, down: false, left: false, right: false };
function keyboardActive() { return keys.up || keys.down || keys.left || keys.right; }

function pollKeyboard() {
    if (joystick.isActive) return; // touch takes priority

    const kbThrottle = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    const kbSteer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    input.throttle = kbThrottle;
    input.steer = kbSteer;

    if (keyboardActive()) {
        joystick.element.classList.add('active');
        joystick.stick.style.transform =
            `translate(calc(-50% + ${kbSteer * joystick.radius}px), calc(-50% + ${-kbThrottle * joystick.radius}px))`;
    } else {
        joystick.element.classList.remove('active');
        joystick.stick.style.transform = 'translate(-50%, -50%)';
    }
}

const keyMap = {
    'w': 'up', 'arrowup': 'up', 's': 'down', 'arrowdown': 'down',
    'a': 'left', 'arrowleft': 'left', 'd': 'right', 'arrowright': 'right'
};
document.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); input.nitro = true; return; }
    const k = keyMap[e.key.toLowerCase()];
    if (k) { e.preventDefault(); keys[k] = true; }
});
document.addEventListener('keyup', (e) => {
    const k = keyMap[e.key.toLowerCase()];
    if (k) { e.preventDefault(); keys[k] = false; }
});

// ------------------------------------------------------------
// Gamepad (Nintendo Switch Pro Controller, Xbox, etc.)
// Left stick steers (and throttles: push up to accelerate, down to
// brake/reverse). The A button fires nitro.
// ------------------------------------------------------------
const gamepad = { index: null, nitroLatch: false };
const GP_DEADZONE = 0.18;

window.addEventListener('gamepadconnected', (e) => { gamepad.index = e.gamepad.index; });
window.addEventListener('gamepaddisconnected', (e) => {
    if (gamepad.index === e.gamepad.index) gamepad.index = null;
});

function activeGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (gamepad.index !== null && pads[gamepad.index]) return pads[gamepad.index];
    for (const p of pads) { if (p) { gamepad.index = p.index; return p; } }
    return null;
}

function pollGamepad() {
    if (joystick.isActive) return; // on-screen touch joystick takes priority
    const gp = activeGamepad();
    if (!gp) return;

    // Left stick: axes[0] = steer (left/right), axes[1] = throttle (up = forward).
    const ax = gp.axes[0] || 0;
    const ay = gp.axes[1] || 0;
    const steer = Math.abs(ax) > GP_DEADZONE ? ax : 0;
    const throttle = Math.abs(ay) > GP_DEADZONE ? -ay : 0; // stick up is negative

    // A button = boost. On the Switch Pro Controller's standard mapping the
    // physical A button (right face position) is button index 1.
    const aBtn = !!(gp.buttons[1] && gp.buttons[1].pressed);
    if (aBtn && !gamepad.nitroLatch) input.nitro = true; // edge-triggered (one fire per press)
    gamepad.nitroLatch = aBtn;

    if (steer === 0 && throttle === 0) return; // let keyboard/idle stand
    input.steer = clamp(steer, -1, 1);
    input.throttle = clamp(throttle, -1, 1);

    // Reflect stick position on the on-screen joystick for feedback.
    joystick.element.classList.add('active');
    joystick.stick.style.transform =
        `translate(calc(-50% + ${input.steer * joystick.radius}px), calc(-50% + ${-input.throttle * joystick.radius}px))`;
}

window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => setTimeout(handleResize, 200));

// Rotate hint is just a suggestion — let the player dismiss it.
const rotateHint = document.getElementById('rotateHint');
if (rotateHint) {
    rotateHint.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        rotateHint.classList.add('dismissed');
    });
}

// ------------------------------------------------------------
// Fullscreen handling
// ------------------------------------------------------------
const fsBtn = document.getElementById('fsBtn');
const fsTip = document.getElementById('fsTip');

function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.matchMedia('(display-mode: fullscreen)').matches ||
           window.navigator.standalone === true;
}

function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement;
}

function requestFs() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return false;
    try {
        const p = req.call(el);
        const lockLandscape = () => {
            if (screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('landscape').catch(() => {});
            }
        };
        if (p && p.then) p.then(lockLandscape).catch(() => {});
        else lockLandscape();
        return true;
    } catch (err) {
        return false;
    }
}

function exitFs() {
    const ex = document.exitFullscreen || document.webkitExitFullscreen;
    if (ex) ex.call(document);
}

if (isStandalone()) {
    if (fsBtn) fsBtn.classList.add('hidden');
}

if (fsBtn) {
    fsBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (fsElement()) {
            exitFs();
            return;
        }
        const ok = requestFs();
        if (!ok) {
            fsTip.classList.toggle('show');
        }
    });
}

if (fsTip) {
    fsTip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        fsTip.classList.remove('show');
    });
}

document.addEventListener('fullscreenchange', handleResize);
document.addEventListener('webkitfullscreenchange', handleResize);

// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------
function startGame() {
    if (typeof THREE === 'undefined') {
        console.error('Three.js failed to load.');
        return;
    }
    initRenderer();
    loadTrack(0);            // render a track behind the menus
    handleResize();
    animateStarted = true;
    animate();
    showHome();              // land on the home screen first
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startGame);
} else {
    setTimeout(startGame, 100);
}

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
    boostFill: document.getElementById('boostFill'),
    nitroFill: document.getElementById('nitroFill'),
    nitroBtn: document.getElementById('nitroBtn'),
    center: document.getElementById('centerMessage'),
    fps: document.getElementById('fpsValue'),
    build: document.getElementById('buildValue')
};

// Patch / build number shown top-left. Bump this with each gameplay update.
const VERSION = 'v1.5.0';
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
function createCarMesh(color) {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshPhongMaterial({ color, shininess: 80 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 4), bodyMat);
    body.position.y = 0.7; body.castShadow = true; g.add(body);

    const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.6, 1.8),
        new THREE.MeshPhongMaterial({ color: 0x222831, shininess: 120 })
    );
    cabin.position.set(0, 1.25, -0.2); cabin.castShadow = true; g.add(cabin);

    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.15, 0.5), bodyMat);
    spoiler.position.set(0, 1.2, -2); g.add(spoiler);

    const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 14);
    const wheelMat = new THREE.MeshPhongMaterial({ color: 0x101010 });
    [[1.05, 0.55, 1.3], [-1.05, 0.55, 1.3], [1.05, 0.55, -1.3], [-1.05, 0.55, -1.3]].forEach(p => {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(p[0], p[1], p[2]);
        w.castShadow = true; g.add(w);
    });

    g._bodyMat = bodyMat; // keep handle for boost tint
    scene.add(g);
    return g;
}

function makeRacer(opts) {
    return {
        mesh: createCarMesh(opts.color),
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
    player = makeRacer({ color: 0xe53935, isPlayer: true });
    racers.push(player);

    const aiCount = 3;
    for (let i = 0; i < aiCount; i++) {
        racers.push(makeRacer({
            color: AI_COLORS[i % AI_COLORS.length],
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
    if (r.mesh._bodyMat) {
        r.mesh._bodyMat.emissive = new THREE.Color(r.boostTime > 0 ? 0x00e5ff : 0x000000);
        r.mesh._bodyMat.emissiveIntensity = r.boostTime > 0 ? 0.6 : 0;
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

function updateHUD() {
    hud.pos.textContent = `${playerPosition()} / ${racers.length}`;
    hud.lap.textContent = `${Math.min(player.lap, TOTAL_LAPS)} / ${TOTAL_LAPS}`;
    hud.time.textContent = formatTime(race.elapsed);
    hud.best.textContent = formatTime(player.bestLap);
    hud.speed.textContent = Math.round(Math.abs(player.speed) * 320);
    hud.boostFill.style.width = `${Math.round((player.boostTime / BOOST_FRAMES) * 100)}%`;
    if (hud.nitroFill) hud.nitroFill.style.height = `${Math.round(player.nitroCharge * 100)}%`;
    if (hud.nitroBtn) hud.nitroBtn.classList.toggle('ready', player.nitroCharge >= 1);
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
    const place = player.finishOrder || playerPosition();
    const ord = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'][place] || (place + 'th');
    showCenter(
        `FINISH ${ord}<span class="sub">Time ${formatTime(player.finishTime || race.elapsed)} &middot; Best lap ${formatTime(player.bestLap)}</span><span class="sub" style="color:#ffd166">Tap to race again &middot; ≡ for tracks</span>`,
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
    race.started = false;
    race.finished = false;
    race.elapsed = 0;
    placeRacersAtStart();
    hideCenter();
    startCountdown();
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
    hideMenu();
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
// Resize / fullscreen
// ------------------------------------------------------------
function handleResize() {
    if (!renderer || !camera) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    updateJoystickCenter();
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
    loadTrack(0);            // render a track behind the menu
    handleResize();
    animateStarted = true;
    animate();
    showMenu();              // let the player pick a track first
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startGame);
} else {
    setTimeout(startGame, 100);
}

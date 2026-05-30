// ============================================================
// MOBMOBS - Track Racing
// A top-down/chase-cam circuit racer built with Three.js.
// Steer with the left joystick (or A/D / arrow keys),
// accelerate with GAS (or W / Up), slow with BRAKE (or S / Down).
// ============================================================

// Fixed internal game resolution (portrait orientation)
const GAME_WIDTH = 375;
const GAME_HEIGHT = 667;

// Three.js scene objects
let scene, camera, renderer;
let carMesh;
let trackCurve;          // THREE.CatmullRomCurve3 (centerline, closed)
let trackSamples = [];   // precomputed centerline points for progress lookup

// Track geometry constants
const ROAD_WIDTH = 12;           // full road width
const ROAD_HALF = ROAD_WIDTH / 2;
const TOTAL_LAPS = 3;

// Car / physics state
const car = {
    x: 0, z: 0,            // world position
    heading: 0,            // radians; forward = (sin, cos)
    speed: 0,              // units per frame (can be negative for reverse)
    // tuning
    accel: 0.012,
    brakePower: 0.022,
    reverseAccel: 0.008,
    drag: 0.985,
    offTrackDrag: 0.93,
    maxSpeed: 0.95,
    maxReverse: -0.35,
    offTrackMaxSpeed: 0.35,
    turnRate: 0.045
};

// Race state
const race = {
    started: false,
    finished: false,
    lap: 1,
    progress: 0,           // 0..1 around the lap
    lastProgress: 0,
    startTime: 0,
    elapsed: 0,
    bestLap: null,
    lapStartTime: 0
};

// Control inputs (normalized)
const input = {
    steer: 0,       // -1 (left) .. 1 (right)
    gas: false,
    brake: false
};

// Joystick state
const joystick = {
    element: document.getElementById('joystick'),
    base: document.querySelector('.joystick-base'),
    stick: document.querySelector('.joystick-stick'),
    centerX: 0,
    centerY: 0,
    radius: 55,
    isActive: false,
    pointerId: null
};

// HUD elements
const hud = {
    lap: document.getElementById('lapValue'),
    time: document.getElementById('timeValue'),
    best: document.getElementById('bestValue'),
    speed: document.getElementById('speedValue'),
    center: document.getElementById('centerMessage')
};

// ------------------------------------------------------------
// Scene setup
// ------------------------------------------------------------
function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87b9e0); // sky blue
    scene.fog = new THREE.Fog(0x87b9e0, 90, 200);

    const aspect = GAME_WIDTH / GAME_HEIGHT;
    camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 1000);
    camera.position.set(0, 14, 20);
    camera.lookAt(0, 0, 0);

    const container = document.getElementById('gameContainer');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(GAME_WIDTH, GAME_HEIGHT);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(40, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120;
    sun.shadow.camera.bottom = -120;
    sun.shadow.camera.far = 200;
    scene.add(sun);

    buildWorld();
    buildTrack();
    buildCar();
    placeCarAtStart();
    updateJoystickCenter();
}

// Grass ground plane
function buildWorld() {
    const groundGeo = new THREE.PlaneGeometry(600, 600);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x4f8f3a });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);
}

// ------------------------------------------------------------
// Track building
// ------------------------------------------------------------
// Control points define a closed circuit (in the XZ plane).
const TRACK_POINTS = [
    [0, -60],
    [38, -52],
    [54, -22],
    [40, 4],
    [56, 30],
    [40, 56],
    [4, 60],
    [-30, 52],
    [-40, 26],
    [-22, 6],
    [-44, -16],
    [-52, -44],
    [-28, -62]
];

function buildTrack() {
    const pts = TRACK_POINTS.map(p => new THREE.Vector3(p[0], 0, p[1]));
    trackCurve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);

    const divisions = 400;
    const centerPoints = trackCurve.getPoints(divisions);
    const tangents = [];
    for (let i = 0; i <= divisions; i++) {
        tangents.push(trackCurve.getTangentAt(i / divisions));
    }
    trackSamples = centerPoints;

    // Build the road ribbon as a triangle strip between left/right edges.
    const roadVerts = [];
    const roadUVs = [];
    const leftEdge = [];
    const rightEdge = [];

    for (let i = 0; i <= divisions; i++) {
        const c = centerPoints[i];
        const t = tangents[i];
        // perpendicular in XZ plane
        const nx = -t.z;
        const nz = t.x;
        const len = Math.hypot(nx, nz) || 1;
        const px = nx / len;
        const pz = nz / len;

        const lx = c.x + px * ROAD_HALF;
        const lz = c.z + pz * ROAD_HALF;
        const rx = c.x - px * ROAD_HALF;
        const rz = c.z - pz * ROAD_HALF;

        leftEdge.push(new THREE.Vector3(lx, 0, lz));
        rightEdge.push(new THREE.Vector3(rx, 0, rz));
    }

    const roadGeo = new THREE.BufferGeometry();
    for (let i = 0; i < divisions; i++) {
        const l0 = leftEdge[i], r0 = rightEdge[i];
        const l1 = leftEdge[i + 1], r1 = rightEdge[i + 1];
        const v = i / divisions;
        const v2 = (i + 1) / divisions;

        // two triangles per segment
        roadVerts.push(l0.x, 0.01, l0.z,  r0.x, 0.01, r0.z,  l1.x, 0.01, l1.z);
        roadUVs.push(0, v,  1, v,  0, v2);
        roadVerts.push(r0.x, 0.01, r0.z,  r1.x, 0.01, r1.z,  l1.x, 0.01, l1.z);
        roadUVs.push(1, v,  1, v2,  0, v2);
    }
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVerts, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUVs, 2));
    roadGeo.computeVertexNormals();

    const roadMat = new THREE.MeshLambertMaterial({ color: 0x35373b });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.receiveShadow = true;
    scene.add(road);

    // Curbs: red/white striped edges built from short boxes.
    buildCurbs(leftEdge, divisions, true);
    buildCurbs(rightEdge, divisions, false);

    // Center dashed line
    buildCenterLine(centerPoints, divisions);

    // Start / finish line near t = 0
    buildStartLine(centerPoints[0], tangents[0]);
}

function buildCurbs(edge, divisions, isLeft) {
    const stripe = Math.max(1, Math.floor(divisions / 80));
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    const redMat = new THREE.MeshLambertMaterial({ color: 0xd23b2e });
    for (let i = 0; i < divisions; i++) {
        const a = edge[i];
        const b = edge[i + 1];
        const midX = (a.x + b.x) / 2;
        const midZ = (a.z + b.z) / 2;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const segLen = Math.hypot(dx, dz);
        if (segLen < 0.001) continue;
        const angle = Math.atan2(dx, dz);
        const geo = new THREE.BoxGeometry(0.8, 0.25, segLen + 0.2);
        const mat = (Math.floor(i / stripe) % 2 === 0) ? whiteMat : redMat;
        const seg = new THREE.Mesh(geo, mat);
        seg.position.set(midX, 0.12, midZ);
        seg.rotation.y = angle;
        seg.castShadow = true;
        scene.add(seg);
    }
}

function buildCenterLine(centerPoints, divisions) {
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffe14d });
    const step = 4;
    for (let i = 0; i < divisions; i += step * 2) {
        const a = centerPoints[i];
        const b = centerPoints[Math.min(i + step, divisions)];
        const midX = (a.x + b.x) / 2;
        const midZ = (a.z + b.z) / 2;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const segLen = Math.hypot(dx, dz);
        if (segLen < 0.001) continue;
        const angle = Math.atan2(dx, dz);
        const geo = new THREE.PlaneGeometry(0.4, segLen);
        const dash = new THREE.Mesh(geo, dashMat);
        dash.rotation.x = -Math.PI / 2;
        dash.rotation.z = -angle;
        dash.position.set(midX, 0.02, midZ);
        scene.add(dash);
    }
}

function buildStartLine(point, tangent) {
    const angle = Math.atan2(tangent.x, tangent.z);
    // Checkerboard finish line
    const cols = 8;
    const cellW = ROAD_WIDTH / cols;
    const depth = 2.4;
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < 2; r++) {
            const isWhite = (c + r) % 2 === 0;
            const geo = new THREE.PlaneGeometry(cellW, depth / 2);
            const mat = new THREE.MeshBasicMaterial({ color: isWhite ? 0xffffff : 0x111111 });
            const cell = new THREE.Mesh(geo, mat);
            cell.rotation.x = -Math.PI / 2;
            cell.rotation.z = -angle;
            // local offset across road (x) and along track (z)
            const offAcross = (c - (cols - 1) / 2) * cellW;
            const offAlong = (r - 0.5) * (depth / 2);
            // rotate local offset into world
            const sin = Math.sin(angle), cos = Math.cos(angle);
            const perpX = cos, perpZ = -sin; // perpendicular to tangent
            cell.position.set(
                point.x + perpX * offAcross + sin * offAlong,
                0.03,
                point.z + perpZ * offAcross + cos * offAlong
            );
            scene.add(cell);
        }
    }
}

// ------------------------------------------------------------
// Car building
// ------------------------------------------------------------
function buildCar() {
    carMesh = new THREE.Group();

    // Body
    const bodyGeo = new THREE.BoxGeometry(2, 0.8, 4);
    const bodyMat = new THREE.MeshPhongMaterial({ color: 0xe53935, shininess: 80 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.7;
    body.castShadow = true;
    carMesh.add(body);

    // Cabin
    const cabinGeo = new THREE.BoxGeometry(1.5, 0.6, 1.8);
    const cabinMat = new THREE.MeshPhongMaterial({ color: 0x222831, shininess: 120 });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 1.25, -0.2);
    cabin.castShadow = true;
    carMesh.add(cabin);

    // Spoiler
    const spoilerGeo = new THREE.BoxGeometry(2.1, 0.15, 0.5);
    const spoiler = new THREE.Mesh(spoilerGeo, bodyMat);
    spoiler.position.set(0, 1.2, -2);
    carMesh.add(spoiler);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 16);
    const wheelMat = new THREE.MeshPhongMaterial({ color: 0x101010 });
    const wheelPos = [
        [1.05, 0.55, 1.3], [-1.05, 0.55, 1.3],
        [1.05, 0.55, -1.3], [-1.05, 0.55, -1.3]
    ];
    wheelPos.forEach(p => {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(p[0], p[1], p[2]);
        w.castShadow = true;
        carMesh.add(w);
    });

    scene.add(carMesh);
}

function placeCarAtStart() {
    const start = trackCurve.getPointAt(0);
    const tan = trackCurve.getTangentAt(0);
    car.x = start.x;
    car.z = start.z;
    car.heading = Math.atan2(tan.x, tan.z);
    car.speed = 0;
    carMesh.position.set(car.x, 0, car.z);
    carMesh.rotation.y = car.heading;

    // snap camera behind car
    positionCamera(true);
}

// ------------------------------------------------------------
// Progress & lap tracking
// ------------------------------------------------------------
function computeProgress() {
    // Find nearest centerline sample to the car.
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < trackSamples.length; i++) {
        const s = trackSamples[i];
        const d = (s.x - car.x) ** 2 + (s.z - car.z) ** 2;
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return {
        progress: best / (trackSamples.length - 1),
        distance: Math.sqrt(bestDist)
    };
}

function updateRaceProgress() {
    const info = computeProgress();
    car.offTrack = info.distance > ROAD_HALF;
    const p = info.progress;

    // Detect forward crossing of the start/finish line (wrap 0.9 -> 0.1)
    if (race.started && !race.finished) {
        if (race.lastProgress > 0.85 && p < 0.15) {
            // completed a lap
            const now = performance.now();
            const lapTime = (now - race.lapStartTime) / 1000;
            race.lapStartTime = now;
            if (race.bestLap === null || lapTime < race.bestLap) {
                race.bestLap = lapTime;
            }
            race.lap++;
            if (race.lap > TOTAL_LAPS) {
                finishRace();
            }
        }
    }
    race.lastProgress = p;
    race.progress = p;
}

// ------------------------------------------------------------
// Physics update
// ------------------------------------------------------------
function update() {
    pollKeyboard();

    if (race.started && !race.finished) {
        // Acceleration
        if (input.gas) {
            car.speed += car.accel;
        } else if (input.brake) {
            if (car.speed > 0.01) {
                car.speed -= car.brakePower;
            } else {
                car.speed -= car.reverseAccel; // reverse
            }
        }

        // Drag
        const drag = car.offTrack ? car.offTrackDrag : car.drag;
        car.speed *= drag;

        // Speed clamps
        const topSpeed = car.offTrack ? car.offTrackMaxSpeed : car.maxSpeed;
        if (car.speed > topSpeed) car.speed = topSpeed;
        if (car.speed < car.maxReverse) car.speed = car.maxReverse;
        if (Math.abs(car.speed) < 0.0008) car.speed = 0;

        // Steering — turn rate scales with speed; reversed in reverse.
        const speedFactor = Math.min(Math.abs(car.speed) / 0.25, 1);
        const dir = car.speed >= 0 ? 1 : -1;
        car.heading -= input.steer * car.turnRate * speedFactor * dir;

        // Integrate position
        car.x += Math.sin(car.heading) * car.speed;
        car.z += Math.cos(car.heading) * car.speed;
    }

    // Apply transform
    carMesh.position.set(car.x, 0, car.z);
    carMesh.rotation.y = car.heading;
    // slight body roll into turns for feel
    const roll = -input.steer * Math.min(Math.abs(car.speed) / car.maxSpeed, 1) * 0.12;
    carMesh.rotation.z = roll;

    updateRaceProgress();
    positionCamera(false);

    if (race.started && !race.finished) {
        race.elapsed = (performance.now() - race.startTime) / 1000;
    }
    updateHUD();
}

function positionCamera(snap) {
    // Chase camera: behind and above the car, looking ahead.
    const back = 14;
    const height = 8;
    const ahead = 8;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);

    const targetX = car.x - fx * back;
    const targetZ = car.z - fz * back;
    const lookX = car.x + fx * ahead;
    const lookZ = car.z + fz * ahead;

    const dest = new THREE.Vector3(targetX, height, targetZ);
    if (snap) {
        camera.position.copy(dest);
    } else {
        camera.position.lerp(dest, 0.12);
    }
    camera.lookAt(lookX, 1, lookZ);
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

function updateHUD() {
    const lapShown = Math.min(race.lap, TOTAL_LAPS);
    hud.lap.textContent = `${lapShown} / ${TOTAL_LAPS}`;
    hud.time.textContent = formatTime(race.elapsed);
    hud.best.textContent = formatTime(race.bestLap);
    // Convert internal speed to a readable km/h figure.
    const kmh = Math.round(Math.abs(car.speed) * 320);
    hud.speed.textContent = kmh;
}

function showCenter(html, persist) {
    hud.center.innerHTML = html;
    hud.center.classList.add('show');
    if (!persist) {
        clearTimeout(showCenter._t);
        showCenter._t = setTimeout(() => hud.center.classList.remove('show'), 900);
    }
}

function hideCenter() {
    hud.center.classList.remove('show');
}

// ------------------------------------------------------------
// Race flow: countdown -> race -> finish
// ------------------------------------------------------------
function startCountdown() {
    const steps = ['3', '2', '1', 'GO!'];
    let i = 0;
    const tick = () => {
        if (i < 3) {
            showCenter(steps[i], true);
        } else {
            showCenter('<span style="color:#2ecc71">GO!</span>', false);
            beginRace();
            return;
        }
        i++;
        setTimeout(tick, 1000);
    };
    tick();
}

function beginRace() {
    race.started = true;
    race.finished = false;
    race.startTime = performance.now();
    race.lapStartTime = performance.now();
    race.elapsed = 0;
    race.lap = 1;
    race.lastProgress = 0;
}

function finishRace() {
    race.finished = true;
    race.lap = TOTAL_LAPS;
    car.speed = 0;
    showCenter(
        `FINISH<span class="sub">Total ${formatTime(race.elapsed)} &middot; Best lap ${formatTime(race.bestLap)}</span><span class="sub" style="color:#ffd166">Tap to race again</span>`,
        true
    );
    // Allow restart on next tap/key.
    waitForRestart();
}

function waitForRestart() {
    const restart = () => {
        document.removeEventListener('pointerdown', restart);
        document.removeEventListener('keydown', restart);
        resetRace();
    };
    setTimeout(() => {
        document.addEventListener('pointerdown', restart);
        document.addEventListener('keydown', restart);
    }, 800);
}

function resetRace() {
    race.started = false;
    race.finished = false;
    race.lap = 1;
    race.progress = 0;
    race.lastProgress = 0;
    race.elapsed = 0;
    race.bestLap = null;
    placeCarAtStart();
    hideCenter();
    startCountdown();
}

// ------------------------------------------------------------
// Render loop
// ------------------------------------------------------------
function animate() {
    requestAnimationFrame(animate);
    update();
    renderer.render(scene, camera);
}

// ------------------------------------------------------------
// Resize handling
// ------------------------------------------------------------
function handleResize() {
    if (!renderer || !camera) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(vw / GAME_WIDTH, vh / GAME_HEIGHT);
    renderer.domElement.style.width = (GAME_WIDTH * scale) + 'px';
    renderer.domElement.style.height = (GAME_HEIGHT * scale) + 'px';
    camera.aspect = GAME_WIDTH / GAME_HEIGHT;
    camera.updateProjectionMatrix();
    updateJoystickCenter();
}

// ------------------------------------------------------------
// Joystick (steering) input
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
    // Horizontal axis steers.
    input.steer = Math.max(-1, Math.min(1, ox / joystick.radius));
}

function resetJoystick() {
    joystick.isActive = false;
    joystick.pointerId = null;
    joystick.element.classList.remove('active');
    joystick.stick.style.transform = 'translate(-50%, -50%)';
    if (!keyboardSteering()) input.steer = 0;
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
    if (joystick.isActive && e.pointerId === joystick.pointerId) {
        resetJoystick();
    }
});
document.addEventListener('pointercancel', (e) => {
    if (joystick.isActive && e.pointerId === joystick.pointerId) {
        resetJoystick();
    }
});

// ------------------------------------------------------------
// Pedal buttons (gas / brake)
// ------------------------------------------------------------
function bindPedal(id, prop) {
    const el = document.getElementById(id);
    const press = (e) => { e.preventDefault(); input[prop] = true; el.classList.add('pressed'); };
    const release = (e) => { e.preventDefault(); input[prop] = false; el.classList.remove('pressed'); };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointerleave', release);
    el.addEventListener('pointercancel', release);
}
bindPedal('gasBtn', 'gas');
bindPedal('brakeBtn', 'brake');

// ------------------------------------------------------------
// Keyboard controls (desktop)
// ------------------------------------------------------------
const keys = { up: false, down: false, left: false, right: false };

function keyboardSteering() {
    return keys.left || keys.right;
}

function pollKeyboard() {
    // Gas / brake from keyboard merge with pedals.
    if (keys.up) input.gas = true;
    else if (!document.getElementById('gasBtn').classList.contains('pressed')) input.gas = false;

    if (keys.down) input.brake = true;
    else if (!document.getElementById('brakeBtn').classList.contains('pressed')) input.brake = false;

    if (keyboardSteering()) {
        const s = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        input.steer = s;
        // reflect on the visual stick
        joystick.stick.style.transform =
            `translate(calc(-50% + ${s * joystick.radius}px), -50%)`;
        joystick.element.classList.add('active');
    } else if (!joystick.isActive) {
        joystick.element.classList.remove('active');
        joystick.stick.style.transform = 'translate(-50%, -50%)';
    }
}

const keyMap = {
    'w': 'up', 'arrowup': 'up',
    's': 'down', 'arrowdown': 'down',
    'a': 'left', 'arrowleft': 'left',
    'd': 'right', 'arrowright': 'right'
};

document.addEventListener('keydown', (e) => {
    const k = keyMap[e.key.toLowerCase()];
    if (k) { e.preventDefault(); keys[k] = true; }
});
document.addEventListener('keyup', (e) => {
    const k = keyMap[e.key.toLowerCase()];
    if (k) { e.preventDefault(); keys[k] = false; }
});

window.addEventListener('resize', handleResize);

// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------
function startGame() {
    if (typeof THREE === 'undefined') {
        console.error('Three.js failed to load.');
        return;
    }
    initScene();
    handleResize();
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    animate();
    startCountdown();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startGame);
} else {
    setTimeout(startGame, 100);
}

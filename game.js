// ============================================================
// MOBMOBS - Track Racing
// Landscape circuit racer with boosts and AI opponents.
//
// Controls:
//   Steer  - left joystick  (or A/D / arrow Left-Right)
//   Gas    - GAS pedal       (or W / Up)
//   Brake  - BRAKE pedal     (or S / Down)
// Drive over the cyan boost pads for a speed surge. 3 laps,
// 4 cars, collisions on. Finish for your race position.
// ============================================================

// Three.js scene objects
let scene, camera, renderer;

// Track data
let trackCurve;
let centerPoints = [];   // gameplay samples (evenly spaced, closed)
let tangents = [];       // unit tangent at each sample
let SAMPLES = 0;
const ROAD_WIDTH = 14;
const ROAD_HALF = ROAD_WIDTH / 2;
const TOTAL_LAPS = 3;

// Boost pads
let boostPads = [];      // { x, z, mesh }
const BOOST_FRAMES = 90; // duration of a boost
const BOOST_RADIUS = 5;  // pickup distance

// Racers (player + AI)
let racers = [];
let player = null;
const AI_COLORS = [0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22];
const CAR_RADIUS = 1.9;  // collision radius

// Control input (player)
const input = { steer: 0, gas: false, brake: false };

// Race state
const race = {
    started: false,
    finished: false,
    startTime: 0,
    elapsed: 0
};

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
    center: document.getElementById('centerMessage')
};

// ------------------------------------------------------------
// Scene
// ------------------------------------------------------------
function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87b9e0);
    scene.fog = new THREE.Fog(0x87b9e0, 140, 400);

    camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 2000);

    const container = document.getElementById('gameContainer');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(80, 140, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
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
    buildRacers();
    placeRacersAtStart();
    updateJoystickCenter();
}

function buildWorld() {
    const groundGeo = new THREE.PlaneGeometry(1400, 1400);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x4f8f3a });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);
}

// ------------------------------------------------------------
// Track
// ------------------------------------------------------------
// A long, sweeping closed circuit (points placed around the
// origin with varying radius so it never self-intersects).
const TRACK_POINTS = [
    [95, 0], [68, 39], [50, 87], [0, 80], [-49, 85], [-65, 38],
    [-100, 0], [-68, -39], [-48, -82], [0, -82], [50, -87], [66, -38]
];

function buildTrack() {
    const pts = TRACK_POINTS.map(p => new THREE.Vector3(p[0], 0, p[1]));
    trackCurve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);

    SAMPLES = 700;
    const raw = trackCurve.getSpacedPoints(SAMPLES); // length SAMPLES+1 (closed)
    centerPoints = raw.slice(0, SAMPLES);            // drop duplicate last
    tangents = [];
    for (let i = 0; i < SAMPLES; i++) {
        const a = centerPoints[i];
        const b = centerPoints[(i + 1) % SAMPLES];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        tangents.push({ x: dx / len, z: dz / len });
    }

    // Road ribbon + edges
    const leftEdge = [], rightEdge = [];
    for (let i = 0; i < SAMPLES; i++) {
        const c = centerPoints[i];
        const t = tangents[i];
        const px = -t.z, pz = t.x; // left-perpendicular (already unit)
        leftEdge.push({ x: c.x + px * ROAD_HALF, z: c.z + pz * ROAD_HALF });
        rightEdge.push({ x: c.x - px * ROAD_HALF, z: c.z - pz * ROAD_HALF });
    }

    const verts = [];
    for (let i = 0; i < SAMPLES; i++) {
        const j = (i + 1) % SAMPLES;
        const l0 = leftEdge[i], r0 = rightEdge[i];
        const l1 = leftEdge[j], r1 = rightEdge[j];
        verts.push(l0.x, 0.01, l0.z, r0.x, 0.01, r0.z, l1.x, 0.01, l1.z);
        verts.push(r0.x, 0.01, r0.z, r1.x, 0.01, r1.z, l1.x, 0.01, l1.z);
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    roadGeo.computeVertexNormals();
    const road = new THREE.Mesh(roadGeo, new THREE.MeshLambertMaterial({ color: 0x35373b }));
    road.receiveShadow = true;
    scene.add(road);

    buildCurbs(leftEdge);
    buildCurbs(rightEdge);
    buildCenterLine();
    buildStartLine(centerPoints[0], tangents[0]);
}

function buildCurbs(edge) {
    const stripe = 6;
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    const redMat = new THREE.MeshLambertMaterial({ color: 0xd23b2e });
    for (let i = 0; i < SAMPLES; i++) {
        const a = edge[i], b = edge[(i + 1) % SAMPLES];
        const dx = b.x - a.x, dz = b.z - a.z;
        const segLen = Math.hypot(dx, dz);
        if (segLen < 0.001) continue;
        const geo = new THREE.BoxGeometry(0.9, 0.25, segLen + 0.15);
        const mat = (Math.floor(i / stripe) % 2 === 0) ? whiteMat : redMat;
        const seg = new THREE.Mesh(geo, mat);
        seg.position.set((a.x + b.x) / 2, 0.12, (a.z + b.z) / 2);
        seg.rotation.y = Math.atan2(dx, dz);
        scene.add(seg);
    }
}

function buildCenterLine() {
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffe14d });
    const step = 6;
    for (let i = 0; i < SAMPLES; i += step * 2) {
        const a = centerPoints[i], b = centerPoints[Math.min(i + step, SAMPLES - 1)];
        const dx = b.x - a.x, dz = b.z - a.z;
        const segLen = Math.hypot(dx, dz);
        if (segLen < 0.001) continue;
        const geo = new THREE.PlaneGeometry(0.45, segLen);
        const dash = new THREE.Mesh(geo, dashMat);
        dash.rotation.x = -Math.PI / 2;
        dash.rotation.z = -Math.atan2(dx, dz);
        dash.position.set((a.x + b.x) / 2, 0.02, (a.z + b.z) / 2);
        scene.add(dash);
    }
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
                0.03,
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
    const fractions = [0.16, 0.37, 0.55, 0.78, 0.92];
    fractions.forEach(f => {
        const idx = Math.floor(f * SAMPLES) % SAMPLES;
        const c = centerPoints[idx];
        const t = tangents[idx];
        const angle = Math.atan2(t.x, t.z);

        const group = new THREE.Group();
        // glowing pad
        const pad = new THREE.Mesh(
            new THREE.PlaneGeometry(ROAD_WIDTH * 0.7, 6),
            new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.55 })
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.y = 0.04;
        group.add(pad);
        // chevrons
        for (let k = 0; k < 2; k++) {
            const chev = new THREE.Mesh(
                new THREE.PlaneGeometry(ROAD_WIDTH * 0.5, 1.1),
                new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
            );
            chev.rotation.x = -Math.PI / 2;
            chev.position.set(0, 0.05, -1 + k * 2);
            group.add(chev);
        }
        group.position.set(c.x, 0, c.z);
        group.rotation.y = angle;
        scene.add(group);

        boostPads.push({ x: c.x, z: c.z, mesh: group });
    });
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
        x: 0, z: 0, heading: 0, speed: 0,
        lap: 1, progress: 0, lastProgress: 0, lastIndex: 0,
        finished: false, finishTime: null, finishOrder: 0,
        boostTime: 0,
        bestLap: null, lapStartTime: 0,
        // physics tuning
        accel: 0.012, brakePower: 0.022, reverseAccel: 0.008,
        drag: 0.985, offTrackDrag: 0.93,
        maxSpeed: 0.95, maxReverse: -0.35, offTrackMaxSpeed: 0.35,
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
        r.lap = 1; r.progress = 0; r.lastProgress = 0;
        r.lastIndex = 0; r.finished = false; r.finishTime = null;
        r.boostTime = 0; r.bestLap = null;
        r.mesh.position.set(r.x, 0, r.z);
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
    // higher = further along
    if (r.finished) return 1000 - r.finishOrder; // finished cars rank by order
    return (r.lap - 1) + r.progress;
}

// ------------------------------------------------------------
// Physics step
// ------------------------------------------------------------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function stepRacer(r, ctrl) {
    if (r.finished) {
        r.speed *= 0.9;
    } else if (race.started) {
        // throttle
        if (ctrl.gas) {
            r.speed += r.accel;
        } else if (ctrl.brake) {
            r.speed += (r.speed > 0.01) ? -r.brakePower : -r.reverseAccel;
        }

        // boost
        let topSpeed = r.offTrack ? r.offTrackMaxSpeed : r.maxSpeed;
        if (r.boostTime > 0) {
            r.boostTime--;
            topSpeed = Math.max(topSpeed, 1.55);
            r.speed += 0.02;
        }

        // drag + clamps
        r.speed *= r.offTrack ? r.offTrackDrag : r.drag;
        r.speed = clamp(r.speed, r.maxReverse, topSpeed);
        if (Math.abs(r.speed) < 0.0008) r.speed = 0;

        // steering
        const speedFactor = Math.min(Math.abs(r.speed) / 0.25, 1);
        const dir = r.speed >= 0 ? 1 : -1;
        r.heading -= ctrl.steer * r.turnRate * speedFactor * dir;
    }

    r.x += Math.sin(r.heading) * r.speed;
    r.z += Math.cos(r.heading) * r.speed;
}

function applyTransform(r, ctrlSteer) {
    r.mesh.position.set(r.x, 0, r.z);
    r.mesh.rotation.y = r.heading;
    const roll = -ctrlSteer * Math.min(Math.abs(r.speed) / r.maxSpeed, 1) * 0.12;
    r.mesh.rotation.z = roll;
    // boost tint
    if (r.mesh._bodyMat) {
        r.mesh._bodyMat.emissive = new THREE.Color(r.boostTime > 0 ? 0x00e5ff : 0x000000);
        r.mesh._bodyMat.emissiveIntensity = r.boostTime > 0 ? 0.6 : 0;
    }
}

// AI controller: steer toward a look-ahead point, ease off in corners.
function aiControl(r) {
    const targetIdx = (r.lastIndex + r.lookahead) % SAMPLES;
    const target = centerPoints[targetIdx];
    const desired = Math.atan2(target.x - r.x, target.z - r.z);
    let diff = desired - r.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const sharp = Math.abs(diff);
    // target speed lower for sharp upcoming turns; scaled by skill
    const targetSpeed = r.maxSpeed * r.skill * (1 - Math.min(sharp * 1.4, 0.55));

    const ctrl = { steer: 0, gas: false, brake: false };
    if (r.speed < targetSpeed) ctrl.gas = true;
    else if (r.speed > targetSpeed + 0.15) ctrl.brake = true;

    // convert desired heading change into a steer command consistent
    // with the physics model (heading -= steer*turnRate*...)
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
            if (r.isPlayer) showCenter('<span style="color:#00e5ff">BOOST!</span>', false);
        }
    }
}

// ------------------------------------------------------------
// Collisions (circle vs circle, push apart + dampen)
// ------------------------------------------------------------
function handleCollisions() {
    const minDist = CAR_RADIUS * 2;
    for (let i = 0; i < racers.length; i++) {
        for (let j = i + 1; j < racers.length; j++) {
            const a = racers[i], b = racers[j];
            let dx = b.x - a.x, dz = b.z - a.z;
            let dist = Math.hypot(dx, dz);
            if (dist === 0) { dx = 0.01; dist = 0.01; }
            if (dist < minDist) {
                const nx = dx / dist, nz = dz / dist;
                const overlap = (minDist - dist) / 2;
                a.x -= nx * overlap; a.z -= nz * overlap;
                b.x += nx * overlap; b.z += nz * overlap;
                // dampen speeds and trade a little momentum
                const avg = (a.speed + b.speed) / 2;
                a.speed = a.speed * 0.6 + avg * 0.2;
                b.speed = b.speed * 0.6 + avg * 0.2;
            }
        }
    }
}

// ------------------------------------------------------------
// Camera follows the player
// ------------------------------------------------------------
function positionCamera(snap) {
    const back = 15, height = 8.5, ahead = 9;
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    const dest = new THREE.Vector3(player.x - fx * back, height, player.z - fz * back);
    if (snap) camera.position.copy(dest);
    else camera.position.lerp(dest, 0.12);
    camera.lookAt(player.x + fx * ahead, 1, player.z + fz * ahead);
}

// ------------------------------------------------------------
// Main update
// ------------------------------------------------------------
function update() {
    pollKeyboard();

    // step every racer
    racers.forEach(r => {
        let ctrl;
        if (r.isPlayer) {
            ctrl = { steer: input.steer, gas: input.gas, brake: input.brake };
        } else {
            ctrl = race.started ? aiControl(r) : { steer: 0, gas: false, brake: false };
        }
        r._lastSteer = ctrl.steer;
        stepRacer(r, ctrl);
    });

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

function animate() {
    requestAnimationFrame(animate);
    update();
    renderer.render(scene, camera);
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
        `FINISH ${ord}<span class="sub">Time ${formatTime(player.finishTime || race.elapsed)} &middot; Best lap ${formatTime(player.bestLap)}</span><span class="sub" style="color:#ffd166">Tap to race again</span>`,
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
    setTimeout(() => {
        document.addEventListener('pointerdown', restart);
        document.addEventListener('keydown', restart);
    }, 900);
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
// Joystick steering
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
    if (joystick.isActive && e.pointerId === joystick.pointerId) resetJoystick();
});
document.addEventListener('pointercancel', (e) => {
    if (joystick.isActive && e.pointerId === joystick.pointerId) resetJoystick();
});

// ------------------------------------------------------------
// Pedals
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
// Keyboard (desktop)
// ------------------------------------------------------------
const keys = { up: false, down: false, left: false, right: false };
function keyboardSteering() { return keys.left || keys.right; }

function pollKeyboard() {
    if (keys.up) input.gas = true;
    else if (!document.getElementById('gasBtn').classList.contains('pressed')) input.gas = false;
    if (keys.down) input.brake = true;
    else if (!document.getElementById('brakeBtn').classList.contains('pressed')) input.brake = false;

    if (keyboardSteering()) {
        const s = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        input.steer = s;
        joystick.stick.style.transform = `translate(calc(-50% + ${s * joystick.radius}px), -50%)`;
        joystick.element.classList.add('active');
    } else if (!joystick.isActive) {
        joystick.element.classList.remove('active');
        joystick.stick.style.transform = 'translate(-50%, -50%)';
    }
}

const keyMap = {
    'w': 'up', 'arrowup': 'up', 's': 'down', 'arrowdown': 'down',
    'a': 'left', 'arrowleft': 'left', 'd': 'right', 'arrowright': 'right'
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
//   - Android / desktop: real Fullscreen API (hides browser UI) + lock landscape
//   - iOS Safari: API unavailable, so guide the player to Add to Home Screen
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
    // Already launched as a fullscreen app — no button needed.
    if (fsBtn) fsBtn.classList.add('hidden');
}

if (fsBtn) {
    fsBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (fsElement()) {
            exitFs();
            return;
        }
        const ok = requestFs();
        if (!ok) {
            // iOS Safari: show the Add-to-Home-Screen tip instead.
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

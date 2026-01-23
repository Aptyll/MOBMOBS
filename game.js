// Fixed internal game resolution (portrait orientation)
const GAME_WIDTH = 375;
const GAME_HEIGHT = 667;

// Three.js scene setup
let scene, camera, renderer;
let playerMesh;

// Player state
const player = {
    position: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, z: 0 },
    speed: 0.1,
    size: 1
};

// Joystick state
const joystick = {
    element: document.getElementById('joystick'),
    base: document.querySelector('.joystick-base'),
    stick: document.querySelector('.joystick-stick'),
    centerX: 0,
    centerY: 0,
    radius: 50,
    isActive: false,
    inputSource: null // 'keyboard', 'mouse', 'touch', or null
};

// World generation settings
const WORLD_SIZE = 100;
const GRID_CELL_SIZE = 2; // Size of each grid cell

// Initialize Three.js scene
function initScene() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f0f0f);
    scene.fog = new THREE.Fog(0x0f0f0f, 20, 80);

    // Create camera (perspective camera for 3D)
    const aspect = GAME_WIDTH / GAME_HEIGHT;
    camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    camera.position.set(0, 8, 10);
    camera.lookAt(0, 0, 0);

    // Create renderer
    const container = document.getElementById('gameContainer');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(GAME_WIDTH, GAME_HEIGHT);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for performance
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Create player (3D cube)
    const playerGeometry = new THREE.BoxGeometry(player.size, player.size, player.size);
    const playerMaterial = new THREE.MeshPhongMaterial({ 
        color: 0x4a9eff,
        emissive: 0x1a3a5f,
        shininess: 100
    });
    playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
    playerMesh.position.set(player.position.x, player.position.y, player.position.z);
    playerMesh.castShadow = true;
    scene.add(playerMesh);

    // Generate procedural world
    generateWorld();

    // Update joystick center position
    updateJoystickCenter();
}

// Procedurally generate minimalist geometric world
function generateWorld() {
    // Create grid floor using custom lines for proper horizontal grid
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
    const gridGroup = new THREE.Group();
    
    const gridLines = WORLD_SIZE / GRID_CELL_SIZE;
    const halfSize = WORLD_SIZE / 2;
    
    // Create horizontal grid lines (along X axis)
    for (let i = 0; i <= gridLines; i++) {
        const z = -halfSize + (i * GRID_CELL_SIZE);
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-halfSize, 0, z),
            new THREE.Vector3(halfSize, 0, z)
        ]);
        const line = new THREE.Line(geometry, gridMaterial);
        gridGroup.add(line);
    }
    
    // Create vertical grid lines (along Z axis)
    for (let i = 0; i <= gridLines; i++) {
        const x = -halfSize + (i * GRID_CELL_SIZE);
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x, 0, -halfSize),
            new THREE.Vector3(x, 0, halfSize)
        ]);
        const line = new THREE.Line(geometry, gridMaterial);
        gridGroup.add(line);
    }
    
    scene.add(gridGroup);
    
    // Add a solid floor plane for shadows
    const floorGeometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
    const floorMaterial = new THREE.MeshPhongMaterial({ 
        color: 0x0f0f0f,
        transparent: true,
        opacity: 0.5
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);
}

// Update camera to follow player
function updateCamera() {
    const cameraOffset = new THREE.Vector3(0, 8, 10);
    camera.position.lerp(
        new THREE.Vector3(
            player.position.x + cameraOffset.x,
            player.position.y + cameraOffset.y,
            player.position.z + cameraOffset.z
        ),
        0.1
    );
    camera.lookAt(player.position.x, player.position.y + 1, player.position.z);
}

// Update game logic
function update() {
    // Check for keyboard input and update velocity directly
    let inputX = 0;
    let inputY = 0;
    const usingKeyboard = keys.w || keys.a || keys.s || keys.d;
    
    if (keys.d) inputX += 1;
    if (keys.a) inputX -= 1;
    if (keys.w) inputY -= 1; // Negative Y = up = forward
    if (keys.s) inputY += 1; // Positive Y = down = backward
    
    // Normalize diagonal movement
    if (inputX !== 0 && inputY !== 0) {
        const length = Math.sqrt(inputX * inputX + inputY * inputY);
        inputX /= length;
        inputY /= length;
    }
    
    // Update velocity directly from keyboard input (instant response)
    if (inputX !== 0 || inputY !== 0) {
        player.velocity.x = inputX * player.speed;
        player.velocity.z = inputY * player.speed;
        
        // Update joystick visual from keyboard input (consistent, predictable)
        if (usingKeyboard) {
            joystick.inputSource = 'keyboard';
            if (!joystick.isActive) {
                joystick.isActive = true;
                joystick.element.classList.add('active');
                updateJoystickCenter();
            }
            // Update visual directly from keyboard input (not affected by cursor)
            updateJoystickFromInput({ x: inputX, y: inputY });
        }
    } else {
        // Apply friction only when no input
        player.velocity.x *= 0.9;
        player.velocity.z *= 0.9;
        
        // Reset joystick if keyboard was the source and no keys are pressed
        if (joystick.inputSource === 'keyboard' && !usingKeyboard) {
            resetJoystick();
        }
    }
    
    // Update player position
    player.position.x += player.velocity.x;
    player.position.z += player.velocity.z;

    // Keep player within world bounds
    const bound = WORLD_SIZE / 2 - 1;
    player.position.x = Math.max(-bound, Math.min(bound, player.position.x));
    player.position.z = Math.max(-bound, Math.min(bound, player.position.z));

    // Update player mesh position
    playerMesh.position.set(
        player.position.x,
        player.position.y,
        player.position.z
    );

    // Rotate player based on movement direction
    if (Math.abs(player.velocity.x) > 0.01 || Math.abs(player.velocity.z) > 0.01) {
        const angle = Math.atan2(player.velocity.x, player.velocity.z);
        playerMesh.rotation.y = angle;
    }

    // Update camera
    updateCamera();
}

// Render loop
function animate() {
    requestAnimationFrame(animate);
    update();
    renderer.render(scene, camera);
}

// Handle canvas scaling
function handleResize() {
    if (!renderer || !camera) return;
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Calculate scale to fit viewport while maintaining aspect ratio
    const scaleX = viewportWidth / GAME_WIDTH;
    const scaleY = viewportHeight / GAME_HEIGHT;
    const scale = Math.min(scaleX, scaleY);
    
    // Set canvas display size
    renderer.domElement.style.width = (GAME_WIDTH * scale) + 'px';
    renderer.domElement.style.height = (GAME_HEIGHT * scale) + 'px';
    
    // Update camera aspect ratio
    camera.aspect = GAME_WIDTH / GAME_HEIGHT;
    camera.updateProjectionMatrix();
    
    updateJoystickCenter();
}

// Joystick input handling
function getJoystickInput(x, y) {
    const dx = x - joystick.centerX;
    const dy = y - joystick.centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance < 5) {
        return { x: 0, y: 0, distance: 0 };
    }
    
    const angle = Math.atan2(dy, dx);
    const clampedDistance = Math.min(distance, joystick.radius);
    const clampedX = Math.cos(angle) * clampedDistance;
    const clampedY = Math.sin(angle) * clampedDistance;
    
    return {
        x: clampedX / joystick.radius,
        y: clampedY / joystick.radius,
        distance: clampedDistance
    };
}

function updateJoystickVisual(x, y) {
    const input = getJoystickInput(x, y);
    updateJoystickFromInput(input);
}

function updateJoystickFromInput(input) {
    const offsetX = input.x * joystick.radius;
    const offsetY = input.y * joystick.radius;
    
    joystick.stick.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
    
    // Update velocity only if not using keyboard (keyboard is handled in update loop)
    const usingKeyboard = keys.w || keys.a || keys.s || keys.d;
    if (!usingKeyboard && joystick.inputSource !== 'keyboard') {
        player.velocity.x = input.x * player.speed;
        player.velocity.z = input.y * player.speed; // Fixed: up on joystick moves forward
    }
}

function resetJoystick() {
    joystick.isActive = false;
    joystick.inputSource = null;
    joystick.element.classList.remove('active');
    joystick.stick.style.transform = 'translate(-50%, -50%)';
    // Only reset velocity if not using keyboard
    const usingKeyboard = keys.w || keys.a || keys.s || keys.d;
    if (!usingKeyboard) {
        player.velocity.x = 0;
        player.velocity.z = 0;
    }
}

function resetJoystickIfNotActive() {
    // Only reset if no keys are pressed and joystick isn't being dragged
    const hasKeysPressed = keys.w || keys.a || keys.s || keys.d;
    if (!hasKeysPressed && joystick.isActive) {
        // Check if mouse/touch is actually active by checking if base has active state
        // This is a simple check - if mouse is down, it will prevent reset
        resetJoystick();
    }
}

function updateJoystickCenter() {
    const rect = joystick.base.getBoundingClientRect();
    joystick.centerX = rect.left + rect.width / 2;
    joystick.centerY = rect.top + rect.height / 2;
}

// Touch events
joystick.base.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    joystick.inputSource = 'touch';
    joystick.isActive = true;
    joystick.element.classList.add('active');
    updateJoystickCenter();
    updateJoystickVisual(touch.clientX, touch.clientY);
});

joystick.base.addEventListener('touchmove', (e) => {
    e.preventDefault();
    // Only update if touch is the active input source (not keyboard)
    if (joystick.isActive && joystick.inputSource === 'touch') {
        const touch = e.touches[0];
        updateJoystickVisual(touch.clientX, touch.clientY);
    }
});

joystick.base.addEventListener('touchend', (e) => {
    e.preventDefault();
    // Only reset if no keyboard keys are pressed
    const hasKeysPressed = keys.w || keys.a || keys.s || keys.d;
    if (!hasKeysPressed) {
        resetJoystick();
    }
});

joystick.base.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    // Only reset if no keyboard keys are pressed
    const hasKeysPressed = keys.w || keys.a || keys.s || keys.d;
    if (!hasKeysPressed) {
        resetJoystick();
    }
});

// Mouse events (for desktop)
joystick.base.addEventListener('mousedown', (e) => {
    e.preventDefault();
    joystick.inputSource = 'mouse';
    joystick.isActive = true;
    joystick.element.classList.add('active');
    updateJoystickCenter();
    updateJoystickVisual(e.clientX, e.clientY);
});

document.addEventListener('mousemove', (e) => {
    // Only update if mouse is the active input source (not keyboard)
    if (joystick.isActive && joystick.inputSource === 'mouse') {
        e.preventDefault();
        updateJoystickVisual(e.clientX, e.clientY);
    }
});

document.addEventListener('mouseup', (e) => {
    // Only reset if no keyboard keys are pressed
    const hasKeysPressed = keys.w || keys.a || keys.s || keys.d;
    if (joystick.isActive && !hasKeysPressed) {
        e.preventDefault();
        resetJoystick();
    }
});

// Keyboard controls for desktop (WASD)
const keys = {
    w: false,
    a: false,
    s: false,
    d: false
};

function updateKeyboardJoystick() {
    // This function is now mainly for initial activation
    // The actual visual update happens in the update() loop for consistency
    const hasKeysPressed = keys.w || keys.a || keys.s || keys.d;
    
    if (hasKeysPressed) {
        joystick.inputSource = 'keyboard';
        if (!joystick.isActive) {
            joystick.isActive = true;
            joystick.element.classList.add('active');
            updateJoystickCenter();
        }
    }
}

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
        e.preventDefault();
        if (!keys[key]) {
            keys[key] = true;
            updateKeyboardJoystick();
        }
    }
});

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
        e.preventDefault();
        keys[key] = false;
        updateKeyboardJoystick();
    }
});

// Handle window resize
window.addEventListener('resize', () => {
    handleResize();
});

// Initialize and start
function startGame() {
    if (typeof THREE === 'undefined') {
        console.error('Three.js is not loaded. Please check the script tag.');
        return;
    }
    
    initScene();
    handleResize();
    
    // Prevent context menu
    if (renderer && renderer.domElement) {
        renderer.domElement.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }
    
    animate();
}

// Wait for Three.js to load, then start the game
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startGame);
} else {
    // DOM already loaded, but wait a tick to ensure Three.js script has executed
    setTimeout(startGame, 100);
}

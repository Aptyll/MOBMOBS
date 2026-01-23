// Fixed internal game resolution (portrait orientation)
const GAME_WIDTH = 375;
const GAME_HEIGHT = 667;

// Canvas and context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game state
const player = {
    x: GAME_WIDTH / 2,
    y: GAME_HEIGHT / 2,
    size: 20,
    speed: 2
};

let velocity = { x: 0, y: 0 };

// Grid settings
const GRID_SIZE = 30;

// Joystick state
const joystick = {
    element: document.getElementById('joystick'),
    base: document.querySelector('.joystick-base'),
    stick: document.querySelector('.joystick-stick'),
    centerX: 0,
    centerY: 0,
    radius: 50,
    isActive: false,
    currentX: 0,
    currentY: 0
};

// Initialize canvas size and scaling
function initCanvas() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Calculate scale to fit viewport while maintaining aspect ratio
    const scaleX = viewportWidth / GAME_WIDTH;
    const scaleY = viewportHeight / GAME_HEIGHT;
    const scale = Math.min(scaleX, scaleY);
    
    // Set canvas display size (CSS pixels)
    canvas.style.width = (GAME_WIDTH * scale) + 'px';
    canvas.style.height = (GAME_HEIGHT * scale) + 'px';
    
    // Set canvas internal resolution (accounting for device pixel ratio for crisp rendering)
    const dpr = window.devicePixelRatio || 1;
    canvas.width = GAME_WIDTH * dpr;
    canvas.height = GAME_HEIGHT * dpr;
    
    // Scale context to handle device pixel ratio
    ctx.scale(dpr, dpr);
    
    // Update joystick center position
    updateJoystickCenter();
}

// Update joystick center position
function updateJoystickCenter() {
    const rect = joystick.base.getBoundingClientRect();
    joystick.centerX = rect.left + rect.width / 2;
    joystick.centerY = rect.top + rect.height / 2;
}

// Draw grid
function drawGrid() {
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    
    // Vertical lines
    for (let x = 0; x <= GAME_WIDTH; x += GRID_SIZE) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, GAME_HEIGHT);
        ctx.stroke();
    }
    
    // Horizontal lines
    for (let y = 0; y <= GAME_HEIGHT; y += GRID_SIZE) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(GAME_WIDTH, y);
        ctx.stroke();
    }
}

// Draw player
function drawPlayer() {
    ctx.fillStyle = '#4a9eff';
    ctx.fillRect(
        player.x - player.size / 2,
        player.y - player.size / 2,
        player.size,
        player.size
    );
    
    // Add a subtle border
    ctx.strokeStyle = '#6bb0ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(
        player.x - player.size / 2,
        player.y - player.size / 2,
        player.size,
        player.size
    );
}

// Update game logic
function update() {
    // Update player position
    player.x += velocity.x;
    player.y += velocity.y;
    
    // Keep player within bounds
    player.x = Math.max(player.size / 2, Math.min(GAME_WIDTH - player.size / 2, player.x));
    player.y = Math.max(player.size / 2, Math.min(GAME_HEIGHT - player.size / 2, player.y));
}

// Render everything
function render() {
    // Clear canvas with dark background
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    
    // Draw grid
    drawGrid();
    
    // Draw player
    drawPlayer();
}

// Game loop
function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
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
    const offsetX = input.x * joystick.radius;
    const offsetY = input.y * joystick.radius;
    
    joystick.stick.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
    
    // Update velocity
    velocity.x = input.x * player.speed;
    velocity.y = input.y * player.speed;
}

function resetJoystick() {
    joystick.isActive = false;
    joystick.element.classList.remove('active');
    joystick.stick.style.transform = 'translate(-50%, -50%)';
    velocity.x = 0;
    velocity.y = 0;
}

// Touch events
joystick.base.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    joystick.isActive = true;
    joystick.element.classList.add('active');
    updateJoystickCenter();
    updateJoystickVisual(touch.clientX, touch.clientY);
});

joystick.base.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (joystick.isActive) {
        const touch = e.touches[0];
        updateJoystickVisual(touch.clientX, touch.clientY);
    }
});

joystick.base.addEventListener('touchend', (e) => {
    e.preventDefault();
    resetJoystick();
});

joystick.base.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    resetJoystick();
});

// Mouse events (for desktop)
joystick.base.addEventListener('mousedown', (e) => {
    e.preventDefault();
    joystick.isActive = true;
    joystick.element.classList.add('active');
    updateJoystickCenter();
    updateJoystickVisual(e.clientX, e.clientY);
});

document.addEventListener('mousemove', (e) => {
    if (joystick.isActive) {
        e.preventDefault();
        updateJoystickVisual(e.clientX, e.clientY);
    }
});

document.addEventListener('mouseup', (e) => {
    if (joystick.isActive) {
        e.preventDefault();
        resetJoystick();
    }
});

// Handle window resize
window.addEventListener('resize', () => {
    initCanvas();
});

// Prevent context menu on long press
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

// Initialize and start
initCanvas();
gameLoop();

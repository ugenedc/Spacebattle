const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: process.env.CLIENT_ORIGIN || "*",
        methods: ["GET", "POST"]
    }
});
const path = require('path');
const cors = require('cors');

// Logger setup
const logger = {
    info: (message) => {
        console.log(`[${new Date().toISOString()}] INFO: ${message}`);
    },
    error: (message, error) => {
        console.error(`[${new Date().toISOString()}] ERROR: ${message}`);
        if (error) {
            console.error(error);
        }
    },
    warn: (message) => {
        console.warn(`[${new Date().toISOString()}] WARN: ${message}`);
    },
    debug: (message) => {
        console.debug(`[${new Date().toISOString()}] DEBUG: ${message}`);
    }
};

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Express error:', err);
    res.status(500).send('Internal Server Error');
});

// Process error handlers
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', reason);
});

// Enable CORS using the environment variable
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "*" }));

// Serve static files from the client directory
app.use(express.static(path.join(__dirname, '../client')));
app.use('/assets', express.static(path.join(__dirname, '../client/assets')));

// Game world dimensions
const GAME_WIDTH = 1600;
const GAME_HEIGHT = 1200;

// Game state
const players = new Map();
const asteroids = new Map();
const powerups = new Map();
let asteroidId = 0;
let powerupId = 0;

// Game constants
const PLAYER_HEALTH = 100;
const RESPAWN_TIME = 3000; // 3 seconds
const MAX_ASTEROIDS = 20;
const MAX_POWERUPS = 5;
const ASTEROID_SPAWN_INTERVAL = 5000; // 5 seconds
const POWERUP_SPAWN_INTERVAL = 15000; // 15 seconds

// Power-up types
const POWERUP_TYPES = ['spread', 'laser', 'health'];

// Generate power-ups
function generatePowerup() {
    if (powerups.size >= MAX_POWERUPS) return;

    const powerup = {
        id: powerupId++,
        type: POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)],
        x: Math.random() * GAME_WIDTH,
        y: Math.random() * GAME_HEIGHT
    };
    powerups.set(powerup.id, powerup);
    io.emit('powerupSpawned', powerup);
}

// Spawn power-ups periodically
setInterval(() => {
    if (powerups.size < MAX_POWERUPS) {
        generatePowerup();
    }
}, POWERUP_SPAWN_INTERVAL);

function createAsteroid(x, y, size = 2, velocityX = null, velocityY = null) {
    const asteroid = {
        id: `asteroid_${Date.now()}_${Math.random()}`,
        x: x || Math.random() * GAME_WIDTH,
        y: y || Math.random() * GAME_HEIGHT,
        rotation: Math.random() * Math.PI * 2,
        size: size, // 2 = large, 1 = medium, 0 = small
        variation: Math.floor(Math.random() * 3), // Random asteroid shape
        velocityX: velocityX || (Math.random() - 0.5) * (200 - size * 30), // Faster for smaller asteroids
        velocityY: velocityY || (Math.random() - 0.5) * (200 - size * 30)
    };
    asteroids.set(asteroid.id, asteroid);
    io.emit('newAsteroid', asteroid); // Emit to all clients immediately
    return asteroid;
}

function updateAsteroids() {
    asteroids.forEach((asteroid) => {
        // Update position
        asteroid.x += asteroid.velocityX * (1/60);
        asteroid.y += asteroid.velocityY * (1/60);
        
        // Wrap around screen edges with padding
        const pad = 50;
        if (asteroid.x < -pad) asteroid.x = GAME_WIDTH + pad;
        if (asteroid.x > GAME_WIDTH + pad) asteroid.x = -pad;
        if (asteroid.y < -pad) asteroid.y = GAME_HEIGHT + pad;
        if (asteroid.y > GAME_HEIGHT + pad) asteroid.y = -pad;
        
        // Update rotation
        asteroid.rotation += (asteroid.size === 2 ? 0.01 : asteroid.size === 1 ? 0.02 : 0.03);
    });
}

// Initialize asteroids with better distribution
function initializeAsteroids() {
    asteroids.clear();
    
    // Create initial asteroids with better spacing
    for (let i = 0; i < 5; i++) {
        createAsteroid(
            GAME_WIDTH * (0.2 + 0.6 * Math.random()),  // Keep away from edges
            GAME_HEIGHT * (0.2 + 0.6 * Math.random()), // Keep away from edges
            2  // Large asteroids
        );
    }
    
    for (let i = 0; i < 3; i++) {
        createAsteroid(
            GAME_WIDTH * (0.2 + 0.6 * Math.random()),
            GAME_HEIGHT * (0.2 + 0.6 * Math.random()),
            1  // Medium asteroids
        );
    }
    
    for (let i = 0; i < 2; i++) {
        createAsteroid(
            GAME_WIDTH * (0.2 + 0.6 * Math.random()),
            GAME_HEIGHT * (0.2 + 0.6 * Math.random()),
            0  // Small asteroids
        );
    }
}

// Handle asteroid being hit with improved fragment creation
function handleAsteroidHit(asteroidId, hitData) {
    const asteroid = asteroids.get(asteroidId);
    if (!asteroid) return;

    // Remove the hit asteroid
    asteroids.delete(asteroidId);
    io.emit('asteroidDestroyed', asteroidId);

    // Create fragments for non-small asteroids
    if (asteroid.size > 0) {
        const numFragments = asteroid.size === 2 ? 3 : 2;
        const newSize = asteroid.size - 1;
        
        for (let i = 0; i < numFragments; i++) {
            // Calculate spread angle for fragments
            const spreadAngle = (2 * Math.PI / numFragments) * i + Math.random() * 0.5;
            const speed = 150 + Math.random() * 50; // Faster fragments
            
            // Create fragment with offset position and spread velocity
            createAsteroid(
                asteroid.x + Math.cos(spreadAngle) * 20,
                asteroid.y + Math.sin(spreadAngle) * 20,
                newSize,
                Math.cos(spreadAngle) * speed,
                Math.sin(spreadAngle) * speed
            );
        }
    }

    // Award points based on asteroid size
    if (hitData.playerId) {
        const player = players.get(hitData.playerId);
        if (player) {
            const points = (3 - asteroid.size) * 100; // 300 for small, 200 for medium, 100 for large
            player.score += points;
            io.emit('scoreUpdate', {
                playerId: hitData.playerId,
                score: player.score,
                points: points // Send points for visual feedback
            });
        }
    }
}

// Define the port
const PORT = process.env.PORT || 3000;

io.on('connection', (socket) => {
    logger.info(`Player connected: ${socket.id}`);

    socket.on('error', (error) => {
        logger.error(`Socket error for player ${socket.id}:`, error);
    });

    // Handle player joining
    socket.on('playerJoin', (playerData) => {
        try {
            const player = {
                id: socket.id,
                name: playerData.name,
                x: Math.random() * GAME_WIDTH,
                y: Math.random() * GAME_HEIGHT,
                rotation: 0,
                velocityX: 0,
                velocityY: 0,
                score: 0,
                health: PLAYER_HEALTH,
                isAlive: true
            };
            players.set(socket.id, player);
            logger.info(`Player ${player.name} (${socket.id}) joined the game`);

            // Send current game state to new player
            socket.emit('gameState', {
                players: Array.from(players.values()),
                asteroids: Array.from(asteroids.values())
            });

            // Notify other players
            socket.broadcast.emit('newPlayer', player);
        } catch (error) {
            logger.error(`Error handling player join for ${socket.id}:`, error);
        }
    });

    // Handle power-up collection
    socket.on('powerupCollected', (data) => {
        const powerup = powerups.get(data.id);
        if (powerup) {
            powerups.delete(data.id);
            io.emit('powerupCollected', data.id);

            // Handle health power-up
            if (powerup.type === 'health') {
                const player = players.get(socket.id);
                if (player) {
                    player.health = Math.min(player.health + 50, PLAYER_HEALTH);
                    io.emit('playerHealthUpdate', {
                        id: player.id,
                        health: player.health
                    });
                }
            }
        }
    });

    // Handle player hit with different weapon types
    socket.on('playerHit', (data) => {
        const hitPlayer = players.get(data.hitPlayerId);
        if (hitPlayer && hitPlayer.isAlive) {
            // Different damage for different weapon types
            let damage = 20; // default damage
            switch (data.weaponType) {
                case 'spread':
                    damage = 15; // Less damage for spread shots
                    break;
                case 'laser':
                    damage = 25; // More damage for laser
                    break;
            }
            
            hitPlayer.health -= damage;
            
            if (hitPlayer.health <= 0) {
                hitPlayer.isAlive = false;
                io.emit('playerKilled', {
                    id: hitPlayer.id,
                    killerId: data.shooterId
                });

                // Update killer's score
                const killer = players.get(data.shooterId);
                if (killer) {
                    killer.score += 100;
                    io.emit('scoreUpdate', {
                        playerId: killer.id,
                        score: killer.score
                    });
                }

                // Respawn player after delay
                setTimeout(() => {
                    if (players.has(hitPlayer.id)) {
                        hitPlayer.health = PLAYER_HEALTH;
                        hitPlayer.isAlive = true;
                        hitPlayer.x = Math.random() * GAME_WIDTH;
                        hitPlayer.y = Math.random() * GAME_HEIGHT;
                        io.emit('playerRespawned', hitPlayer);
                    }
                }, RESPAWN_TIME);
            }

            io.emit('playerHealthUpdate', {
                id: hitPlayer.id,
                health: hitPlayer.health
            });
        }
    });

    // Handle player movement
    socket.on('playerMove', (moveData) => {
        const player = players.get(socket.id);
        if (player && player.isAlive) {
            player.rotation = moveData.rotation;
            player.velocityX = moveData.velocityX;
            player.velocityY = moveData.velocityY;
            io.emit('playerMoved', player);
        }
    });

    // Handle shooting
    socket.on('playerShoot', (shootData) => {
        const player = players.get(socket.id);
        if (player && player.isAlive) {
            io.emit('bulletFired', {
                playerId: socket.id,
                x: shootData.x,
                y: shootData.y,
                rotation: shootData.rotation
            });
        }
    });

    // Handle asteroid hits
    socket.on('asteroidHit', (data) => {
        handleAsteroidHit(data.asteroidId, {
            playerId: socket.id,
            ...data
        });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        try {
            logger.info(`Player disconnected: ${socket.id}`);
            players.delete(socket.id);
            io.emit('playerLeft', socket.id);
        } catch (error) {
            logger.error(`Error handling disconnect for ${socket.id}:`, error);
        }
    });
});

// Start the server
http.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    initializeAsteroids(); // Initialize asteroids when server starts
    logger.info('Initial asteroids spawned');
});

// Game loop for asteroid updates
setInterval(() => {
    updateAsteroids();
    io.emit('gameUpdate', {
        players: Array.from(players.values()),
        asteroids: Array.from(asteroids.values())
    });
}, 1000 / 60); // 60 times per second

// Periodically spawn new asteroids
setInterval(() => {
    if (asteroids.size < MAX_ASTEROIDS) {
        createAsteroid();
        logger.debug('New asteroid spawned');
    }
}, ASTEROID_SPAWN_INTERVAL); 
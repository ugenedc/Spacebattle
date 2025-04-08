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

// Serve static files from the BUILT client directory (dist)
app.use(express.static(path.join(__dirname, '../dist')));

// Game world dimensions
const GAME_WIDTH = 2000;
const GAME_HEIGHT = 1500;

// Game state
const players = new Map();
const asteroids = new Map();
const powerups = new Map();
let asteroidId = 0;
let powerupId = 0;

// Game constants
const PLAYER_HEALTH = 100;
const RESPAWN_TIME = 3000; // 3 seconds
const MAX_ASTEROIDS = 25; // Increased from 20
const MAX_POWERUPS = 5;
const ASTEROID_SPAWN_INTERVAL = 4000; // Decreased from 5000 (4 seconds)
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
        velocityX: velocityX || (Math.random() - 0.5) * (50 - size * 5), // Much slower 
        velocityY: velocityY || (Math.random() - 0.5) * (50 - size * 5)  // Much slower 
    };
    asteroids.set(asteroid.id, asteroid);
    io.emit('newAsteroid', asteroid);
    return asteroid;
}

function updateAsteroids() {
    asteroids.forEach((asteroid, asteroidId) => {
        // Update position
        asteroid.x += asteroid.velocityX * (1/60);
        asteroid.y += asteroid.velocityY * (1/60);
        
        // Remove asteroids that drift too far off-screen
        const removalPadding = 200; // How far off screen before removing
        if (asteroid.x < -removalPadding || 
            asteroid.x > GAME_WIDTH + removalPadding || 
            asteroid.y < -removalPadding || 
            asteroid.y > GAME_HEIGHT + removalPadding) {
            
            asteroids.delete(asteroidId); // Remove from server state
            io.emit('asteroidDestroyed', asteroidId); // Tell clients to remove it
            logger.debug(`Asteroid ${asteroidId} drifted off screen and was removed.`);
            return; // Stop processing this asteroid
        }
        
        // Update rotation
        asteroid.rotation += (asteroid.size === 2 ? 0.01 : asteroid.size === 1 ? 0.02 : 0.03);
    });
}

// Initialize asteroids with better distribution (only large ones now)
function initializeAsteroids() {
    asteroids.clear();
    
    // Create initial large asteroids only
    const initialCount = 15; // Slightly more asteroids for bigger map
    for (let i = 0; i < initialCount; i++) {
        createAsteroid(
            GAME_WIDTH * (0.1 + 0.8 * Math.random()),  // Spread across map
            GAME_HEIGHT * (0.1 + 0.8 * Math.random()), // Spread across map
            2  // Large asteroids only
        );
    }
    
    // Remove medium and small initial asteroids
    // for (let i = 0; i < 3; i++) { ... }
    // for (let i = 0; i < 2; i++) { ... }
}

// Handle asteroid being hit with improved fragment creation
function handleAsteroidHit(asteroidId, hitData) {
    const asteroid = asteroids.get(asteroidId);
    if (!asteroid) return;

    // Get player who shot (if any)
    const player = players.get(hitData.playerId);

    // Remove the hit asteroid
    asteroids.delete(asteroidId);
    io.emit('asteroidDestroyed', asteroidId);

    // Award points based on asteroid size BEFORE splitting
    if (player) {
        const points = (3 - asteroid.size) * 50; // Adjusted points: L:50, M:100, S:150
        player.score += points;
        io.emit('scoreUpdate', {
            playerId: hitData.playerId,
            score: player.score,
            points: points 
        });
    }
    
    // Create fragments if it wasn't a small asteroid
    if (asteroid.size > 0) {
        const numFragments = asteroid.size === 2 ? 2 : 2; // Large -> 2 Medium, Medium -> 2 Small
        const newSize = asteroid.size - 1;
        
        for (let i = 0; i < numFragments; i++) {
            // Calculate slightly randomized velocity for fragments based on original + bullet impact
            const baseSpeed = 50; // Base speed for fragments
            const randomAngleOffset = (Math.random() - 0.5) * Math.PI / 2; // +/- 45 degrees randomness
            // Try to get bullet velocity if available (might need adjustment based on hitData structure)
            const bulletAngle = Math.atan2(hitData.velocityY || 0, hitData.velocityX || 0);
            const fragmentAngle = bulletAngle + randomAngleOffset + (i * Math.PI); // Opposite directions +/- randomness

            createAsteroid(
                asteroid.x, // Fragments start at parent's position
                asteroid.y,
                newSize,
                (asteroid.velocityX * 0.5) + Math.cos(fragmentAngle) * baseSpeed, // Inherit some velocity + fragment burst
                (asteroid.velocityY * 0.5) + Math.sin(fragmentAngle) * baseSpeed
            );
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
        const shooter = players.get(data.shooterId);

        if (hitPlayer && hitPlayer.isAlive) {
            // Calculate knockback direction (from shooter towards hit player)
            let knockbackDirection = { x: 0, y: 0 };
            if (shooter) { // Ensure shooter exists to calculate direction
                const dx = hitPlayer.x - shooter.x;
                const dy = hitPlayer.y - shooter.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist > 0) { // Avoid division by zero
                    knockbackDirection.x = dx / dist;
                    knockbackDirection.y = dy / dist;
                }
            } else { // Fallback if shooter data isn't available (e.g. disconnected?)
                // Could use bullet vector if available in `data`, or just apply damage without knockback
            }
            
            const knockbackForce = 30; // Adjust force as needed

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
            
            // Apply knockback before clamping
            hitPlayer.x += knockbackDirection.x * knockbackForce;
            hitPlayer.y += knockbackDirection.y * knockbackForce;

            // Clamp position AFTER applying knockback
            const halfShipWidth = 12;
            hitPlayer.x = Math.max(halfShipWidth, Math.min(GAME_WIDTH - halfShipWidth, hitPlayer.x));
            hitPlayer.y = Math.max(halfShipWidth, Math.min(GAME_HEIGHT - halfShipWidth, hitPlayer.y));
            
            if (hitPlayer.health <= 0 && hitPlayer.isAlive) { // Only trigger death once
                hitPlayer.isAlive = false;
                // Emit player killed event TO ALL clients
                io.emit('playerKilled', { 
                    playerId: hitPlayer.id, 
                    killerId: data.shooterId 
                });

                // Update killer's score (if not self-kill)
                if (data.shooterId !== hitPlayer.id) {
                    const killer = players.get(data.shooterId);
                    if (killer) {
                        killer.score += 100;
                        io.emit('scoreUpdate', {
                            playerId: killer.id,
                            score: killer.score
                        });
                    }
                }

                // Respawn player after delay
                setTimeout(() => {
                    // Check if player still exists in the map (didn't disconnect)
                    if (players.has(hitPlayer.id)) { 
                        hitPlayer.health = PLAYER_HEALTH;
                        hitPlayer.isAlive = true;
                        hitPlayer.x = Math.random() * GAME_WIDTH; // New random position
                        hitPlayer.y = Math.random() * GAME_HEIGHT;
                        hitPlayer.rotation = 0; // Reset rotation
                        hitPlayer.velocityX = 0;
                        hitPlayer.velocityY = 0;
                        // Emit respawn event TO ALL clients
                        io.emit('playerRespawned', hitPlayer); 
                    }
                }, RESPAWN_TIME);
            } else if (hitPlayer.isAlive) { // Only update health if still alive
                // Send health update only (not needed if killed)
                // Also send updated position due to knockback
                io.emit('playerHealthUpdate', { 
                    id: hitPlayer.id, 
                    health: hitPlayer.health,
                    x: hitPlayer.x, // Include position
                    y: hitPlayer.y
                });
            }
        }
    });

    // Handle player movement (listen for 'playerMovement' from client)
    socket.on('playerMovement', (moveData) => {
        const player = players.get(socket.id);
        if (player && player.isAlive) {
            // Update player state on the server
            // Clamp position to game bounds
            const halfShipWidth = 12; // Approx half width based on texture size
            player.x = Math.max(halfShipWidth, Math.min(GAME_WIDTH - halfShipWidth, moveData.x));
            player.y = Math.max(halfShipWidth, Math.min(GAME_HEIGHT - halfShipWidth, moveData.y));
            player.rotation = moveData.rotation;
            player.velocityX = moveData.velocityX;
            player.velocityY = moveData.velocityY;
            
            // Broadcast the updated player state to other clients
            socket.broadcast.emit('playerMoved', player);
        }
    });

    // Handle shooting
    socket.on('playerShoot', (shootData) => {
        const player = players.get(socket.id);
        if (player && player.isAlive) {
            // Use socket.broadcast.emit to send to everyone EXCEPT the sender
            socket.broadcast.emit('bulletFired', {
                playerId: socket.id,
                x: shootData.x,
                y: shootData.y,
                rotation: shootData.rotation,
                weaponType: shootData.weaponType // Include weaponType
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
            logger.info(`Player ${socket.id} disconnected`);
            // Remove player from server state
            players.delete(socket.id);
            // Notify all other clients that this player left
            io.emit('playerLeft', socket.id); 
        } catch (error) {
            logger.error(`Error handling disconnection for player ${socket.id}:`, error);
        }
    });
});

http.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
    initializeAsteroids(); // Initialize asteroids when server starts
    logger.info('Initial asteroids spawned'); 
});

// Game loop for asteroid updates (This should remain)
setInterval(() => {
    updateAsteroids();
    io.emit('gameUpdate', {
        players: Array.from(players.values()),
        asteroids: Array.from(asteroids.values())
    });
}, 1000 / 60); // 60 times per second

// Periodically spawn new asteroids (This should also remain)
setInterval(() => {
    if (asteroids.size < MAX_ASTEROIDS) {
        // Spawn large asteroids randomly near edges
        const edge = Math.floor(Math.random() * 4);
        let spawnX, spawnY;
        const padding = 100; // How far off-screen to spawn
        switch (edge) {
            case 0: // Top
                spawnX = Math.random() * GAME_WIDTH;
                spawnY = -padding;
                break;
            case 1: // Right
                spawnX = GAME_WIDTH + padding;
                spawnY = Math.random() * GAME_HEIGHT;
                break;
            case 2: // Bottom
                spawnX = Math.random() * GAME_WIDTH;
                spawnY = GAME_HEIGHT + padding;
                break;
            case 3: // Left
                spawnX = -padding;
                spawnY = Math.random() * GAME_HEIGHT;
                break;
        }
        createAsteroid(spawnX, spawnY, 2); // Spawn large asteroid
        logger.debug('New large asteroid spawned from edge');
    }
}, ASTEROID_SPAWN_INTERVAL);
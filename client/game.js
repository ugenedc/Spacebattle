import Phaser from 'phaser';
import { io } from 'socket.io-client';
import Logger from './logger';

let game;
let socket;
let playerName;

// Initialize logger
Logger.init();

// Global error handler
window.onerror = function(msg, url, lineNo, columnNo, error) {
    Logger.error('Global error:', { message: msg, url, lineNo, columnNo, error });
    return false;
};

// Unhandled promise rejection handler
window.onunhandledrejection = function(event) {
    Logger.error('Unhandled promise rejection:', event.reason);
};

class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' });
        this.playersMap = new Map(); // For tracking player data
        this.playerInterpolationTargets = new Map(); // For smooth movement of other players
        this.asteroidsMap = new Map(); // For tracking asteroid data
        this.bulletsGroup = null; // Phaser group for bullets
        this.playersGroup = null; // Phaser group for player sprites
        this.asteroidsGroup = null; // Phaser group for asteroid sprites
        this.playerShip = null;
        this.score = 0;
        this.playerTexts = new Map();
        this.healthBars = new Map();
        this.weaponType = 'normal';
        this.particles = null;
        this.thrustParticles = null;
        this.isInitialized = false;
        this.target = null;
        this.isMoving = false;
        this.arrivalThreshold = 5; // Distance threshold for arrival
        this.targetIndicator = null;
        this.scoreText = null; // Add this to track score text object
        this.grid = null; // Add this to track the grid TileSprite
        this.boundaryRect = null; // Add this to track the boundary rectangle
        this.lastShotTime = 0; // Track the time of the last shot
        this.shootCooldown = 300; // Cooldown in milliseconds (e.g., 300ms)
    }

    preload() {
        try {
            Logger.info('Starting preload...');
            
            // Create game object textures
            this.createShipTexture();
            for (let i = 0; i < 3; i++) {
                this.createAsteroidTexture(i);
            }
            this.createBulletTexture();
            
            // Create background grid texture
            this.createGridTexture(100, 0x008800); // Grid size 100, dark green

            Logger.info('Preload setup completed');
        } catch (error) {
            Logger.error('Error in preload:', error);
        }
    }

    createGridTexture(cellSize, color) {
        const graphics = this.add.graphics();
        graphics.lineStyle(1, color, 0.5); // 1px line, specified color, 50% alpha

        // Draw the lines for one cell
        graphics.beginPath();
        graphics.moveTo(0, 0);
        graphics.lineTo(cellSize, 0);
        graphics.lineTo(cellSize, cellSize);
        graphics.lineTo(0, cellSize);
        graphics.lineTo(0, 0);
        graphics.strokePath();

        // It's better practice to draw only the necessary lines for tiling
        // Draw right and bottom lines only for a tileable pattern
        graphics.clear();
        graphics.lineStyle(1, color, 0.3); // Make it slightly more subtle
        graphics.moveTo(cellSize - 1, 0);
        graphics.lineTo(cellSize - 1, cellSize);
        graphics.moveTo(0, cellSize - 1);
        graphics.lineTo(cellSize, cellSize - 1);
        graphics.strokePath();

        graphics.generateTexture('gridTexture', cellSize, cellSize);
        graphics.destroy();
    }

    createShipTexture() {
        const graphics = this.add.graphics();
        
        // Draw a clean white triangle ship
        graphics.lineStyle(2, 0xffffff);
        
        // Set texture size and ship size
        const textureSize = 32;
        const shipWidth = textureSize * 0.75;  // Ship takes up 75% of texture width
        const shipHeight = textureSize * 0.75; // Ship takes up 75% of texture height
        
        // Calculate center point
        const centerX = textureSize / 2;
        const centerY = textureSize / 2;
        
        // Draw the ship pointing upward (this will align with the rotation angle)
        graphics.beginPath();
        graphics.moveTo(centerX, centerY - shipHeight/2);          // Top point
        graphics.lineTo(centerX - shipWidth/2, centerY + shipHeight/2); // Bottom left
        graphics.lineTo(centerX + shipWidth/2, centerY + shipHeight/2); // Bottom right
        graphics.closePath();
        graphics.strokePath();
        
        // Fill with solid white
        graphics.fillStyle(0xffffff, 1);
        graphics.fill();
        
        // Generate texture
        graphics.generateTexture('ship', textureSize, textureSize);
        graphics.destroy();
    }

    createAsteroidTexture(variation) {
        const graphics = this.add.graphics();
        
        // Draw in bright green with thicker lines for visibility
        graphics.lineStyle(3, 0x00ff00);
        
        // Create different asteroid shapes with properly scaled sizes
        const textureSize = 96;
        const baseSize = textureSize * 0.3; // Scale down to ensure visibility within texture bounds
        
        // Center offset to place the asteroid in the middle of the texture
        const centerX = textureSize / 2;
        const centerY = textureSize / 2;
        
        switch(variation) {
            case 0: // Large asteroid
                graphics.beginPath();
                graphics.moveTo(centerX - baseSize, centerY - baseSize * 0.8);
                graphics.lineTo(centerX + baseSize * 0.8, centerY - baseSize);
                graphics.lineTo(centerX + baseSize, centerY);
                graphics.lineTo(centerX + baseSize * 0.8, centerY + baseSize);
                graphics.lineTo(centerX - baseSize * 0.8, centerY + baseSize * 0.8);
                graphics.lineTo(centerX - baseSize, centerY);
                graphics.closePath();
                break;
            case 1: // Medium asteroid
                graphics.beginPath();
                graphics.moveTo(centerX, centerY - baseSize);
                graphics.lineTo(centerX + baseSize, centerY - baseSize * 0.5);
                graphics.lineTo(centerX + baseSize * 0.8, centerY + baseSize * 0.8);
                graphics.lineTo(centerX - baseSize * 0.8, centerY + baseSize);
                graphics.lineTo(centerX - baseSize, centerY - baseSize * 0.5);
                graphics.closePath();
                break;
            case 2: // Small asteroid
                graphics.beginPath();
                graphics.moveTo(centerX - baseSize * 0.6, centerY - baseSize * 0.6);
                graphics.lineTo(centerX + baseSize * 0.6, centerY - baseSize * 0.4);
                graphics.lineTo(centerX + baseSize * 0.6, centerY + baseSize * 0.2);
                graphics.lineTo(centerX, centerY + baseSize * 0.6);
                graphics.lineTo(centerX - baseSize * 0.6, centerY + baseSize * 0.4);
                graphics.closePath();
                break;
        }
        
        graphics.strokePath();
        
        // Generate texture
        const textureName = `asteroid${variation}`;
        graphics.generateTexture(textureName, textureSize, textureSize);
        graphics.destroy();
        
        return textureName;
    }

    createBulletTexture() {
        // Create a circle shape for the bullet
        const graphics = this.add.graphics();
        graphics.fillStyle(0xffffff);
        graphics.fillCircle(4, 4, 4);
        
        graphics.generateTexture('bullet', 8, 8);
        graphics.destroy();
    }

    create() {
        try {
            Logger.info('Starting scene creation...');
            
            // Set physics world bounds explicitly (matching config)
            this.physics.world.setBounds(0, 0, this.physics.world.bounds.width, this.physics.world.bounds.height);
            
            // Set camera bounds
            this.cameras.main.setBounds(0, 0, this.physics.world.bounds.width, this.physics.world.bounds.height);

            // Set background color
            this.cameras.main.setBackgroundColor('#000000');
            
            // Add the TileSprite background grid
            // Make it larger than the typical screen to cover camera movement
            this.grid = this.add.tileSprite(0, 0, this.game.config.width * 2, this.game.config.height * 2, 'gridTexture');
            this.grid.setOrigin(0, 0);
            this.grid.setScrollFactor(1); // Grid scrolls with the camera

            // Draw the world boundary rectangle
            const boundaryColor = 0x00ff00; // Bright Green
            const boundaryThickness = 4; // Make it thicker
            const boundaryAlpha = 0.8; // Make it more opaque
            this.boundaryRect = this.add.graphics();
            this.boundaryRect.lineStyle(boundaryThickness, boundaryColor, boundaryAlpha);
            // Adjust strokeRect slightly to account for line thickness if needed, but 0,0 should be fine
            this.boundaryRect.strokeRect(0, 0, this.physics.world.bounds.width, this.physics.world.bounds.height);
            this.boundaryRect.setDepth(0); // Try depth 0 (same as default sprites) 

            // Initialize game object groups
            this.bulletsGroup = this.add.group();
            this.playersGroup = this.add.group();
            this.asteroidsGroup = this.add.group();
            
            // Initialize movement target
            this.target = null;
            this.isMoving = false;
            
            // Track mouse position for movement
            this.input.on('pointerdown', (pointer) => {
                this.target = new Phaser.Math.Vector2(pointer.worldX, pointer.worldY);
                this.isMoving = true;
                
                if (this.targetIndicator) {
                    this.targetIndicator.destroy();
                }
                this.targetIndicator = this.add.circle(pointer.worldX, pointer.worldY, 3, 0x00ff00, 0.5);
            });
            
            this.input.on('pointermove', (pointer) => {
                if (pointer.isDown) {
                    this.target.x = pointer.worldX;
                    this.target.y = pointer.worldY;
                }
            });
            
            // Setup socket connection
            // Use the deployed server URL in production, otherwise use localhost for development
            const serverURL = window.location.hostname === "localhost" 
                              ? `http://localhost:3000` 
                              : window.location.origin; 
            
            Logger.info(`Attempting to connect to server at ${serverURL}`);
            
            socket = io(serverURL, {
                reconnection: true,
                reconnectionAttempts: 10,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                timeout: 10000,
                autoConnect: true
            });
            
            socket.on('connect', () => {
                Logger.info('Connected to game server');
                this.setupGame(socket);
            });

            socket.on('connect_error', (error) => {
                Logger.error('Connection error:', error.message);
            });

            socket.on('disconnect', (reason) => {
                Logger.warn(`Disconnected from server. Reason: ${reason}`);
                // Don't destroy game objects on temporary disconnects
                if (reason === 'io server disconnect') {
                    socket.connect();
                }
            });

            socket.on('reconnect', (attemptNumber) => {
                Logger.info(`Reconnected to server after ${attemptNumber} attempts`);
                if (this.playerShip) {
                    this.setupGame(socket);
                }
            });

            socket.on('reconnect_attempt', (attemptNumber) => {
                Logger.info(`Attempting to reconnect... (attempt ${attemptNumber})`);
            });

            socket.on('reconnect_error', (error) => {
                Logger.error('Reconnection error:', error.message);
            });

            socket.on('reconnect_failed', () => {
                Logger.error('Failed to reconnect to server after all attempts');
            });

            // Setup input controls
            this.cursors = this.input.keyboard.createCursorKeys();
            this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
            Logger.debug('Input controls initialized');

            // Create score display
            this.scoreText = this.add.text(16, 16, 'Score: 0', {
                fontSize: '32px',
                fill: '#fff'
            }).setScrollFactor(0);
            Logger.debug('Score display created');

            // Add collision detection
            this.physics.add.collider(this.bulletsGroup, this.asteroidsGroup, this.handleAsteroidHit, null, this);
            this.physics.add.collider(this.bulletsGroup, this.playersGroup, this.handlePlayerHit, null, this);
            Logger.debug('Collision detection setup complete');

            // Initialize particle systems
            try {
                this.setupParticleSystems();
                Logger.debug('Particle systems initialized');
            } catch (error) {
                Logger.error('Error setting up particle systems:', error);
            }

            // Initialize sounds with error handling
            try {
                this.setupSounds();
                Logger.debug('Sound system initialized');
            } catch (error) {
                Logger.error('Error setting up sound system:', error);
            }

            // Create leaderboard
            this.createLeaderboard();
            Logger.debug('Leaderboard created');

            // Add player-player collision
            this.physics.add.collider(this.playersGroup, this.playersGroup);

            // Make sure the grid updates its position with the camera
            this.cameras.main.on('scroll', () => {
                // This might not be strictly necessary if scrollFactor is 1, but can help ensure alignment
                 this.grid.setTilePosition(this.cameras.main.scrollX, this.cameras.main.scrollY);
            });

            this.isInitialized = true;
            Logger.info('Scene creation completed successfully');
        } catch (error) {
            Logger.error('Critical error in scene creation:', error);
        }
    }

    setupParticleSystems() {
        // Initialize particle systems using new API
        this.explosionParticles = this.add.particles(0, 0, 'bullet', {
            speed: { min: 50, max: 200 },
            scale: { start: 0.5, end: 0 },
            blendMode: 'ADD',
            lifespan: 800,
            gravityY: 0,
            quantity: 1,
            emitting: false
        });

        this.thrustParticles = this.add.particles(0, 0, 'bullet', {
            speed: 100,
            scale: { start: 0.2, end: 0 },
            blendMode: 'ADD',
            lifespan: 500,
            gravityY: 0,
            quantity: 1,
            emitting: false
        });
    }

    setupSounds() {
        // Create dummy sound objects until we have real sound files
        this.sounds = {
            shoot: { play: () => {}, stop: () => {} },
            explosion: { play: () => {}, stop: () => {} },
            powerup: { play: () => {}, stop: () => {} },
            hit: { play: () => {}, stop: () => {} },
            thrust: { play: () => {}, stop: () => {} }
        };
        Logger.debug('Dummy sound system initialized');
    }

    setupGame(socket) {
        try {
            Logger.debug('Setting up game with socket connection');
            socket.emit('playerJoin', { name: playerName });
            this.setupSocketEvents();
            Logger.debug('Game setup completed');
        } catch (error) {
            Logger.error('Error in game setup:', error);
        }
    }

    setupSocketEvents() {
        try {
            Logger.debug('Setting up socket events');
            
            socket.on('gameState', (state) => {
                Logger.debug(`Received game state with ${state.players.length} players and ${state.asteroids.length} asteroids`);
                this.handleGameState(state);
            });

            socket.on('newPlayer', (playerInfo) => {
                Logger.debug(`New player joined: ${playerInfo.name}`);
                this.addPlayer(playerInfo);
            });

            socket.on('playerMoved', (playerInfo) => {
                // Only update OTHER players based on this event
                if (playerInfo.id !== socket.id) { 
                    const targetData = this.playerInterpolationTargets.get(playerInfo.id) || {};
                    targetData.x = playerInfo.x;
                    targetData.y = playerInfo.y;
                    targetData.rotation = playerInfo.rotation;
                    this.playerInterpolationTargets.set(playerInfo.id, targetData);
                    // Don't set position directly here anymore
                    // const player = this.playersMap.get(playerInfo.id);
                    // if (player) {
                    //     player.sprite.setPosition(playerInfo.x, playerInfo.y);
                    //     player.sprite.setRotation(playerInfo.rotation);
                    // }
                }
            });

            socket.on('playerLeft', (playerId) => {
                const player = this.playersMap.get(playerId);
                if (player) {
                    player.sprite.destroy();
                    this.playersMap.delete(playerId);
                    this.playerInterpolationTargets.delete(playerId); // Clean up target data
                }
            });

            socket.on('playerDamaged', (data) => {
                const player = this.playersMap.get(data.playerId);
                if (player) {
                    // Update player health
                    player.info.health = data.health;

                    // Update player position due to knockback (for other players)
                    if (data.playerId !== socket.id && data.x !== undefined && data.y !== undefined) {
                        const targetData = this.playerInterpolationTargets.get(data.playerId) || {};
                        targetData.x = data.x;
                        targetData.y = data.y;
                        // Don't update rotation here, just position from knockback
                        this.playerInterpolationTargets.set(data.playerId, targetData);
                    } else if (data.playerId === socket.id && data.x !== undefined && data.y !== undefined) {
                        // If it's the local player, snap position immediately
                        this.playerShip.setPosition(data.x, data.y);
                    }
                    
                    // Update health bar
                    const healthBar = this.healthBars.get(data.playerId);
                    if (healthBar) {
                        this.updateHealthBar(healthBar, data.x, data.y - 20, data.health);
                    }
                    
                    // If this is the local player being damaged, add screen shake effect
                    if (data.playerId === socket.id) {
                        this.cameras.main.shake(100, 0.01);
                    }
                }
            });

            socket.on('playerKilled', (data) => {
                const player = this.playersMap.get(data.playerId);
                if (player) {
                    // Create a large, white explosion effect for player death
                    this.createExplosion(player.sprite.x, player.sprite.y, 0xffffff, 1.5); // White tint, larger scale
                    
                    // Make the ship sprite inactive/invisible
                    player.sprite.setActive(false).setVisible(false);
                    player.info.isAlive = false; // Update local state

                    // Remove associated text/healthbar
                    const nameText = this.playerTexts.get(data.playerId);
                    const healthBar = this.healthBars.get(data.playerId);
                    if (nameText) nameText.destroy();
                    if (healthBar) healthBar.destroy();
                    this.playerTexts.delete(data.playerId);
                    this.healthBars.delete(data.playerId);

                    // If this is the local player, show respawn message
                    if (data.playerId === socket.id) {
                        this.handleLocalPlayerDeath();
                    }
                }
            });

            socket.on('playerRespawned', (playerInfo) => {
                const player = this.playersMap.get(playerInfo.id);
                 // Clear any old interpolation target on respawn
                this.playerInterpolationTargets.delete(playerInfo.id); 
                if (player) {
                    // Reactivate/show the sprite and update position/state
                    player.sprite.setActive(true).setVisible(true);
                    player.sprite.setPosition(playerInfo.x, playerInfo.y);
                    player.sprite.setRotation(playerInfo.rotation);
                    player.sprite.body.setVelocity(0, 0); // Reset velocity
                    player.info = playerInfo; // Update local info object

                    // Trigger respawn effect
                    this.createRespawnEffect(playerInfo.x, playerInfo.y);

                    // Re-add name text and health bar
                    const nameText = this.add.text(playerInfo.x, playerInfo.y - 30, playerInfo.name, {
                        fontSize: '16px',
                        fill: '#fff',
                        backgroundColor: '#00000080',
                        padding: { x: 4, y: 2 }
                    }).setOrigin(0.5);
                    this.playerTexts.set(playerInfo.id, nameText);

                    const healthBar = this.add.graphics();
                    this.updateHealthBar(healthBar, playerInfo.x, playerInfo.y - 20, playerInfo.health);
                    this.healthBars.set(playerInfo.id, healthBar);

                } else {
                     // If player wasn't in map (e.g., joined while someone was dead), add them now
                     this.addPlayer(playerInfo);
                }
            });

            socket.on('bulletFired', (bulletInfo) => {
                // Don't add bullets fired by the local player (they are created locally)
                // if (bulletInfo.playerId !== socket.id) { // This check is redundant if server uses broadcast
                    this.addBullet(bulletInfo);
                // }
            });

            socket.on('asteroidDestroyed', (asteroidId) => {
                const asteroid = this.asteroidsMap.get(asteroidId);
                if (asteroid) {
                    asteroid.sprite.destroy();
                    this.asteroidsMap.delete(asteroidId);
                }
            });

            socket.on('scoreUpdate', (data) => {
                if (data.playerId === socket.id) {
                    this.score = data.score;
                    this.updateScoreBoard();
                }
            });

            socket.on('gameUpdate', (state) => {
                const receivedAsteroidIds = new Set(); // Keep track of asteroids received in this update

                state.players.forEach(playerInfo => {
                    // Store interpolation targets for OTHER players
                    // Always update health for all (including self)
                    if (playerInfo.id !== socket.id) {
                        const targetData = this.playerInterpolationTargets.get(playerInfo.id) || {};
                        targetData.x = playerInfo.x;
                        targetData.y = playerInfo.y;
                        targetData.rotation = playerInfo.rotation;
                        this.playerInterpolationTargets.set(playerInfo.id, targetData);
                        // Don't set position directly here anymore
                        // const player = this.playersMap.get(playerInfo.id);
                        // if (player) { ... }
                    } 
                    
                    // Update health if it has changed (for self and others)
                    const player = this.playersMap.get(playerInfo.id);
                    if (player && player.info.health !== playerInfo.health) {
                        player.info.health = playerInfo.health;
                        const healthBar = this.healthBars.get(playerInfo.id);
                        if (healthBar) {
                            this.updateHealthBar(healthBar, playerInfo.x, playerInfo.y - 20, playerInfo.health);
                        }
                    }
                });

                // Update asteroids (always controlled by server)
                state.asteroids.forEach(asteroidInfo => {
                    receivedAsteroidIds.add(asteroidInfo.id); // Mark this asteroid ID as received
                    const asteroid = this.asteroidsMap.get(asteroidInfo.id);
                    if (asteroid) {
                        // Update existing asteroid
                        asteroid.sprite.setPosition(asteroidInfo.x, asteroidInfo.y);
                        asteroid.sprite.setRotation(asteroidInfo.rotation);
                    } else {
                        // Asteroid exists on server but not client, add it
                        this.addAsteroid(asteroidInfo); 
                    }
                });

                // Remove asteroids that exist on client but NOT on server (synchronize deletions)
                this.asteroidsMap.forEach((asteroidData, asteroidId) => {
                    if (!receivedAsteroidIds.has(asteroidId)) {
                        Logger.debug(`Removing asteroid ${asteroidId} not present in gameUpdate`);
                        if (asteroidData.sprite) {
                            asteroidData.sprite.destroy();
                        }
                        this.asteroidsMap.delete(asteroidId);
                    }
                });
            });

            Logger.debug('Socket events setup completed');
        } catch (error) {
            Logger.error('Error setting up socket events:', error);
        }
    }

    handleGameState(state) {
        try {
            state.players.forEach(playerInfo => {
                if (playerInfo.id === socket.id) {
                    if (!this.playerShip) {
                        Logger.debug(`Creating player ship for ${playerInfo.name}`);
                        this.addPlayer(playerInfo);
                    }
                } else {
                    if (!this.playersMap.has(playerInfo.id)) {
                        Logger.debug(`Adding other player: ${playerInfo.name}`);
                        this.addPlayer(playerInfo);
                    }
                }
            });

            state.asteroids.forEach(asteroidInfo => {
                if (!this.asteroidsMap.has(asteroidInfo.id)) {
                    Logger.debug(`Adding asteroid: ${asteroidInfo.id}`);
                    this.addAsteroid(asteroidInfo);
                }
            });
        } catch (error) {
            Logger.error('Error handling game state:', error);
        }
    }

    addPlayer(playerInfo) {
        Logger.debug(`Adding player: ${playerInfo.name}`);
        const ship = this.add.sprite(playerInfo.x, playerInfo.y, 'ship');
        ship.setRotation(playerInfo.rotation);
        
        // Enable arcade physics properly
        this.physics.world.enable(ship);
        ship.body.setCollideWorldBounds(true);
        ship.body.setBounce(0.5);
        ship.body.setDrag(0.95);
        ship.body.setAngularDrag(0.98);
        ship.body.setMaxVelocity(300);
        ship.body.setMass(1);
        
        this.playersGroup.add(ship);
        this.playersMap.set(playerInfo.id, {
            sprite: ship,
            info: playerInfo
        });

        if (playerInfo.id === socket.id) {
            this.playerShip = ship;
            this.cameras.main.startFollow(ship);
            Logger.debug('Player ship created and physics enabled');
        }

        // Add player name text
        const nameText = this.add.text(ship.x, ship.y - 30, playerInfo.name, {
            fontSize: '16px',
            fill: '#fff',
            backgroundColor: '#00000080',
            padding: { x: 4, y: 2 }
        }).setOrigin(0.5);
        this.playerTexts.set(playerInfo.id, nameText);

        // Add health bar
        const healthBar = this.add.graphics();
        this.updateHealthBar(healthBar, ship.x, ship.y - 20, playerInfo.health);
        this.healthBars.set(playerInfo.id, healthBar);
    }

    updateHealthBar(healthBar, x, y, health) {
        healthBar.clear();
        // Background (gray)
        healthBar.fillStyle(0x333333);
        healthBar.fillRect(x - 25, y, 50, 5);
        // Health (green to red based on health)
        const color = Phaser.Display.Color.GetColor(
            255 * (1 - health/100),
            255 * (health/100),
            0
        );
        healthBar.fillStyle(color);
        healthBar.fillRect(x - 25, y, 50 * (health/100), 5);
    }

    addAsteroid(asteroidInfo) {
        const variation = asteroidInfo.variation || Math.floor(Math.random() * 3);
        const textureName = this.createAsteroidTexture(variation);
        const asteroid = this.physics.add.sprite(asteroidInfo.x, asteroidInfo.y, textureName);
        
        // Set random rotation speed (slower for larger asteroids)
        asteroid.rotationSpeed = Phaser.Math.FloatBetween(-0.02, 0.02) * (asteroidInfo.size === 2 ? 0.5 : asteroidInfo.size === 1 ? 1 : 1.5);
        
        // Set scale based on size
        let scale;
        let physicsRadius;
        switch(asteroidInfo.size) {
            case 2: // Large
                scale = 1;
                physicsRadius = 32;
                break;
            case 1: // Medium
                scale = 0.7;
                physicsRadius = 24;
                break;
            case 0: // Small
                scale = 0.5;
                physicsRadius = 16;
                break;
            default:
                scale = 1;
                physicsRadius = 32;
        }
        
        // Apply scale
        asteroid.setScale(scale);
        
        // Enable physics with proper body size
        this.physics.world.enable(asteroid);
        asteroid.body.setCircle(physicsRadius);
        asteroid.body.setOffset(48 - physicsRadius, 48 - physicsRadius); // Center the physics body
        
        // Set velocity
        asteroid.body.setVelocity(asteroidInfo.velocityX || 0, asteroidInfo.velocityY || 0);
        
        // Enable collisions but no world bounds
        asteroid.body.setCollideWorldBounds(false);
        asteroid.body.setBounce(1, 1);
        
        // Add to group and map
        this.asteroidsGroup.add(asteroid);
        this.asteroidsMap.set(asteroidInfo.id, {
            sprite: asteroid,
            info: asteroidInfo
        });

        // Create explosion emitter
        asteroid.explosionEmitter = this.add.particles(0, 0, 'bullet', {
            speed: { min: 30, max: 80 },
            scale: { start: 0.2, end: 0 },
            blendMode: 'ADD',
            lifespan: 400,
            tint: 0x00ff00,
            on: false
        });
    }

    addBullet(bulletInfo) {
        const bullet = this.physics.add.sprite(bulletInfo.x, bulletInfo.y, 'bullet');
        
        // Set position directly from bulletInfo (already calculated by shooter)
        bullet.setPosition(bulletInfo.x, bulletInfo.y);

        // Set up bullet physics body
        this.physics.world.enable(bullet);
        bullet.body.setCircle(4); // Match the bullet's visual size
        bullet.body.setCollideWorldBounds(false); // Bullets should not collide with world bounds
        
        // Set bullet velocity in direction of bullet's rotation
        const speed = 600; // INCREASED bullet speed
        // Use the rotation provided in bulletInfo directly
        const velocity = this.physics.velocityFromRotation(bulletInfo.rotation, speed);
        bullet.setVelocity(velocity.x, velocity.y);
        
        // Store owner and type for collision logic
        bullet.ownerId = bulletInfo.playerId; 
        bullet.weaponType = bulletInfo.weaponType || 'normal';

        // Add to group for collisions
        this.bulletsGroup.add(bullet); 

        // Set bullet lifetime
        this.time.delayedCall(2000, () => {
            if (bullet) { // Check if bullet still exists
               bullet.destroy();
            }
        });

        return bullet;
    }

    handleAsteroidHit(bullet, asteroidSprite) {
        // Find the asteroid ID from the sprite
        const hitAsteroidData = Array.from(this.asteroidsMap.entries())
            .find(([_, value]) => value.sprite === asteroidSprite);
        
        if (!hitAsteroidData) return;
        const [hitAsteroidId, hitAsteroidObj] = hitAsteroidData;

        // Play explosion sound
        this.sounds.explosion.play();
        
        // Create explosion effect at asteroid position (standard green)
        this.createExplosion(asteroidSprite.x, asteroidSprite.y); // Default green tint
        
        // Tell the server about the hit, including bullet velocity
        socket.emit('asteroidHit', { 
            asteroidId: hitAsteroidId,
            velocityX: bullet.body.velocity.x, // Send bullet velocity
            velocityY: bullet.body.velocity.y
        });
        
        // Destroy bullet immediately
        bullet.destroy();
        // Asteroid sprite destruction is handled by the 'asteroidDestroyed' event from server
    }

    handlePlayerHit(bullet, playerSprite) {
        // Find the hit player's ID
        const hitPlayerData = Array.from(this.playersMap.entries())
            .find(([_, value]) => value.sprite === playerSprite);
            
        if (!hitPlayerData) return;
        
        const [hitPlayerId, hitPlayerObj] = hitPlayerData;
        
        if (bullet.ownerId !== hitPlayerId) { // Don't hit self
            // Create hit effect
            this.createHitEffect(playerSprite.x, playerSprite.y);
            
            // Play hit sound
            this.sounds.hit.play();
            
            // Emit hit event to server with damage amount
            socket.emit('playerHit', { 
                hitPlayerId: hitPlayerId,
                shooterId: bullet.ownerId,
                damage: 10 // Standard damage amount
            });
            
            // Destroy the bullet
            bullet.destroy();
        }
    }

    createHitEffect(x, y) {
        // Create a red flash effect for player hits
        const particles = this.add.particles(x, y, 'bullet', {
            speed: { min: 50, max: 150 },
            scale: { start: 0.4, end: 0 },
            blendMode: 'ADD',
            lifespan: 300,
            gravityY: 0,
            quantity: 6,
            tint: 0xff0000, // Red color for player hits
            emitting: false
        });
        
        particles.explode(8);
        
        // Clean up particles
        this.time.delayedCall(300, () => {
            particles.destroy();
        });
    }

    updateScoreBoard() {
        if (this.scoreText) {
            this.scoreText.setText(`Score: ${this.score}`);
        }
    }

    createLeaderboard() {
        const leaderboard = document.createElement('div');
        leaderboard.id = 'leaderboard';
        leaderboard.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.7);
            padding: 10px;
            border-radius: 5px;
            color: white;
            font-family: Arial, sans-serif;
            min-width: 200px;
        `;
        document.body.appendChild(leaderboard);
        this.updateLeaderboard();
    }

    wrapObject(object) {
        // This function should now ONLY be used for asteroids if we want them to wrap
        // Since we removed asteroid wrapping on the server, this function is currently unused.
        // We can keep it for potential future use or remove it.
        const pad = 32;
        const width = this.game.config.width;
        const height = this.game.config.height;

        if (object.x < -pad) {
            object.x = width + pad;
        } else if (object.x > width + pad) {
            object.x = -pad;
        }

        if (object.y < -pad) {
            object.y = height + pad;
        } else if (object.y > height + pad) {
            object.y = -pad;
        }
    }

    updateLeaderboard() {
        const scores = Array.from(this.playersMap.values())
            .map(player => ({
                name: player.info.name,
                score: player.info.score || 0
            }))
            .sort((a, b) => b.score - a.score);

        const leaderboardText = scores
            .slice(0, 5)
            .map((entry, index) => `${index + 1}. ${entry.name}: ${entry.score}`)
            .join('\n');

        if (this.leaderboardText) {
            this.leaderboardText.setText(leaderboardText);
        }
    }

    createExplosion(x, y, tint = 0x00ff00, scaleMultiplier = 1) {
        // Enhanced explosion effect
        const particleCount = Math.floor(15 * scaleMultiplier);
        const particles = this.add.particles(x, y, 'bullet', { // Use bullet texture for debris
            speed: { min: 50 * scaleMultiplier, max: 150 * scaleMultiplier },
            scale: { start: 0.3 * scaleMultiplier, end: 0 },
            alpha: { start: 1, end: 0 }, 
            blendMode: 'ADD', 
            lifespan: 600, 
            gravityY: 0,
            quantity: particleCount, // More particles based on scale
            tint: tint, // Use provided tint
            emitting: false
        });
        
        particles.explode(particleCount);
        
        // Play sound (already exists)
        this.sounds.explosion.play();
        
        // Clean up particles
        this.time.delayedCall(800, () => { // Slightly longer cleanup
            particles.destroy();
        });
    }

    handlePowerupCollect(powerup) {
        this.sounds.powerup.play();
        switch (powerup.type) {
            case 'spread':
                this.weaponType = 'spread';
                setTimeout(() => this.weaponType = 'normal', 10000); // 10 seconds
                break;
            case 'laser':
                this.weaponType = 'laser';
                setTimeout(() => this.weaponType = 'normal', 10000);
                break;
            case 'health':
                socket.emit('healPlayer', { amount: 50 });
                break;
        }
        socket.emit('powerupCollected', { id: powerup.id });
    }

    shoot() {
        const now = this.time.now; // Get current game time
        if (!this.playerShip || !this.playerShip.active || now < this.lastShotTime + this.shootCooldown) {
            // Check if ship exists, is active, AND if cooldown has passed
            return; 
        }
        
        this.lastShotTime = now; // Update last shot time

        if (!this.playerShip || !this.playerShip.active) return; // Check if ship exists and is active

        // Calculate bullet spawn position at ship's nose
        const offset = 20;
        // Use ship's current rotation (already adjusted for direction)
        const rotation = this.playerShip.rotation; 
        const spawnX = this.playerShip.x + Math.cos(rotation - Math.PI/2) * offset;
        const spawnY = this.playerShip.y + Math.sin(rotation - Math.PI/2) * offset;

        // Create bullet locally
        const bullet = this.physics.add.sprite(spawnX, spawnY, 'bullet');
        this.bulletsGroup.add(bullet);
        
        // Set bullet velocity in direction of ship's rotation
        const speed = 600; // INCREASED bullet speed locally too
        // Use adjusted rotation for velocity to match ship's visual orientation
        const velocity = this.physics.velocityFromRotation(rotation - Math.PI/2, speed); 
        bullet.setVelocity(velocity.x, velocity.y);
        
        // Set bullet properties
        bullet.ownerId = socket.id;
        bullet.weaponType = this.weaponType;

        // Emit shoot event TO SERVER
        socket.emit('playerShoot', {
            x: spawnX, // Send the calculated spawn position
            y: spawnY,
            rotation: rotation - Math.PI/2, // Send the bullet's travel angle
            weaponType: this.weaponType
        });

        // Play sound effect
        this.sounds.shoot.play({ volume: 0.5 });

        // Destroy bullet after 2 seconds
        this.time.delayedCall(2000, () => {
             if (bullet) { // Check if bullet still exists
               bullet.destroy();
            }
        });
    }

    handleLocalPlayerDeath() {
        // Create a respawn message
        const respawnText = this.add.text(
            this.cameras.main.centerX,
            this.cameras.main.centerY,
            'You were destroyed!\nRespawning in 3 seconds...',
            {
                fontSize: '32px',
                fill: '#ff0000',
                align: 'center'
            }
        ).setOrigin(0.5).setScrollFactor(0);

        // Fade out and remove after 3 seconds
        this.tweens.add({
            targets: respawnText,
            alpha: 0,
            duration: 2000,
            ease: 'Power2',
            delay: 1000,
            onComplete: () => {
                respawnText.destroy();
            }
        });
    }

    createRespawnEffect(x, y) {
        // Create a shimmering/teleport-in effect
        const particles = this.add.particles(x, y, 'ship', { // Use ship texture for effect
            speed: { min: 20, max: 50 },
            scale: { start: 0.5, end: 0 },
            alpha: { start: 0.7, end: 0 },
            blendMode: 'ADD',
            lifespan: 600,
            gravityY: 0,
            quantity: 15,
            tint: 0x00ffff, // Cyan color for respawn
            emitting: false
        });
        
        particles.explode(15);
        
        // Play a distinct sound (if you add one)
        // this.sounds.respawn.play(); 
        
        // Clean up particles
        this.time.delayedCall(600, () => {
            particles.destroy();
        });
    }

    update() {
        if (!this.isInitialized) { // Don't check playerShip here, needs to run for interpolation
            return;
        }

        try {
            // Interpolate other players' positions for smoother movement
            this.playersMap.forEach((player, id) => {
                if (id !== socket.id && player.sprite.active) { // Don't interpolate self or inactive sprites
                    const target = this.playerInterpolationTargets.get(id);
                    const sprite = player.sprite;
                    if (target) {
                        const lerpFactor = 0.2; // Adjust for more/less smoothing (lower = smoother)
                        sprite.x = Phaser.Math.Linear(sprite.x, target.x, lerpFactor);
                        sprite.y = Phaser.Math.Linear(sprite.y, target.y, lerpFactor);
                        // Interpolate rotation using shortest direction
                        sprite.rotation = Phaser.Math.Angle.RotateTo(sprite.rotation, target.rotation, lerpFactor * 0.5); // Rotate slightly slower
                    }
                }

                // Update UI elements for all players (including self)
                const nameText = this.playerTexts.get(id);
                const healthBar = this.healthBars.get(id);
                if (player.sprite.active && nameText && healthBar) { // Only if sprite is active
                    nameText.setPosition(player.sprite.x, player.sprite.y - 30);
                    this.updateHealthBar(healthBar, player.sprite.x, player.sprite.y - 20, player.info.health);
                }
            });

            // Handle LOCAL player ship movement to target
            if (this.playerShip && this.playerShip.active && this.playerShip.body) { // Check if active
                if (this.target && this.isMoving) {
                    // Calculate distance to target
                    const distance = Phaser.Math.Distance.Between(
                        this.playerShip.x, this.playerShip.y,
                        this.target.x, this.target.y
                    );

                    // Calculate angle to target (add PI/2 to adjust for ship's default orientation)
                    const targetAngle = Phaser.Math.Angle.Between(
                        this.playerShip.x, this.playerShip.y,
                        this.target.x, this.target.y
                    ) + Math.PI/2;

                    // Smooth rotation towards target
                    const currentAngle = this.playerShip.rotation;
                    const angleDiff = Phaser.Math.Angle.Wrap(targetAngle - currentAngle);
                    
                    if (Math.abs(angleDiff) > 0.02) {
                        const rotationSpeed = 0.1;
                        this.playerShip.rotation += Phaser.Math.Angle.Wrap(angleDiff * rotationSpeed);
                    }

                    if (distance > this.arrivalThreshold) {
                        // Calculate desired velocity based on distance
                        let speed = Math.min(distance * 2, 300);
                        // Use targetAngle - PI/2 for velocity to match ship's orientation
                        const velocity = this.physics.velocityFromRotation(targetAngle - Math.PI/2, speed);
                        
                        // Set velocity directly
                        this.playerShip.body.setVelocity(velocity.x, velocity.y);

                        // Update thrust particles position to match ship's orientation
                        if (this.thrustParticles) {
                            const thrustOffset = 20;
                            this.thrustParticles.setPosition(
                                this.playerShip.x - Math.cos(this.playerShip.rotation - Math.PI/2) * thrustOffset,
                                this.playerShip.y - Math.sin(this.playerShip.rotation - Math.PI/2) * thrustOffset
                            );
                            if (!this.thrustParticles.emitting) {
                                this.thrustParticles.start();
                                this.sounds.thrust.play();
                            }
                        }
                    } else {
                        // We've arrived at the target
                        this.playerShip.body.setVelocity(0, 0);
                        this.isMoving = false;
                        
                        // Stop thrust effects
                        if (this.thrustParticles) {
                            this.thrustParticles.stop();
                            this.sounds.thrust.stop();
                        }
                        
                        // Remove target indicator
                        if (this.targetIndicator) {
                            this.targetIndicator.destroy();
                            this.targetIndicator = null;
                        }
                    }
                }

                // Handle shooting with spacebar
                if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
                    this.shoot();
                }
                
                // Clamp local player position to game bounds
                const halfShipWidth = 12; // Match server approx
                const gameWidth = this.physics.world.bounds.width;
                const gameHeight = this.physics.world.bounds.height;
                this.playerShip.x = Phaser.Math.Clamp(this.playerShip.x, halfShipWidth, gameWidth - halfShipWidth);
                this.playerShip.y = Phaser.Math.Clamp(this.playerShip.y, halfShipWidth, gameHeight - halfShipWidth);
                
                // Emit player movement for the local ship
                socket.emit('playerMovement', {
                    x: this.playerShip.x,
                    y: this.playerShip.y,
                    rotation: this.playerShip.rotation,
                    velocityX: this.playerShip.body.velocity.x,
                    velocityY: this.playerShip.body.velocity.y
                });
            }

            // Update asteroids (rotation only, position is set by server gameUpdate)
            this.asteroidsMap.forEach((asteroidObj) => {
                const asteroid = asteroidObj.sprite;
                if (asteroid) {
                    // Update rotation
                    if (asteroid.rotationSpeed) {
                        asteroid.rotation += asteroid.rotationSpeed;
                    }
                    
                    // Wrap around screen edges
                    this.wrapObject(asteroid);
                }
            });

        } catch (error) {
            Logger.error('Error in update loop:', error);
        }
    }
}

window.startGame = () => {
    try {
        Logger.info('Starting game initialization');
        playerName = document.getElementById('player-name').value.trim();
        if (!playerName) {
            Logger.warn('No player name provided');
            return;
        }

        document.getElementById('login-screen').style.display = 'none';
        
        const config = {
            type: Phaser.AUTO,
            parent: 'game-container',
            width: window.innerWidth,
            height: window.innerHeight,
            backgroundColor: '#000000',
            physics: {
                default: 'arcade',
                arcade: {
                    // Define game bounds for physics and camera
                    // These should ideally match or be obtained from server constants
                    width: 2000, 
                    height: 1500,
                    debug: false,
                    gravity: { x: 0, y: 0 },
                    fps: 60
                }
            },
            scene: MainScene
        };

        game = new Phaser.Game(config);
        Logger.info('Phaser game instance created');

        window.addEventListener('resize', () => {
            game.scale.resize(window.innerWidth, window.innerHeight);
            Logger.debug('Window resized, game scale updated');
        });
    } catch (error) {
        Logger.error('Critical error starting game:', error);
    }
}; 
# Asteroids MMO

A multiplayer Asteroids-style game built with Phaser 3 and Socket.IO.

## Features

- Real-time multiplayer gameplay
- Player name customization
- Score tracking
- Asteroid destruction and splitting
- Smooth player movement and shooting mechanics

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd asteroids-mmo
```

2. Install dependencies:
```bash
npm install
```

## Running the Game

1. Start the server:
```bash
npm run dev
```

2. In a new terminal, start the client:
```bash
npm run client
```

3. Open your browser and navigate to `http://localhost:1234`

## How to Play

- Use arrow keys to control your ship
- Left/Right arrows to rotate
- Up arrow to thrust
- Spacebar to shoot
- Destroy asteroids to earn points
- Larger asteroids split into smaller ones when destroyed

## Game Assets

The game requires the following assets in the `client/assets/images` directory:
- ship.png
- asteroid.png
- bullet.png
- space.png

## Deployment

The game can be deployed to any platform that supports Node.js applications, such as Heroku or Render.

## License

MIT 
# Cardle - Multiplayer Wordle with Power Cards

A turn-based multiplayer word guessing game inspired by Wordle, where players take turns guessing a 5-letter word. Before each turn, players choose from 3 random power cards that can help them or hinder their opponent.

## Features

- **Turn-based Multiplayer**: Two players compete to guess the word first
- **Power Cards**: Choose from 3 random cards each turn:
  - **False Feedback**: Next opponent guess shows incorrect feedback
  - **Hidden Feedback**: Your next guess feedback is only visible to you
  - **Hidden Guess**: Your next guess is completely hidden from opponent
- **Real-time Gameplay**: Uses Socket.io for instant updates
- **Beautiful UI**: Modern, responsive design

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

## Deployment

This game requires a server (Node.js + Socket.io) to run. Here are deployment options:

### Option 1: Render (Free Tier)
1. Push your code to GitHub
2. Go to [render.com](https://render.com) and sign up
3. Click "New +" → "Web Service"
4. Connect your GitHub repository
5. Render will auto-detect Node.js
6. Use these settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node
7. Click "Create Web Service"
8. Your game will be live at `https://your-app-name.onrender.com`

### Option 2: Railway (Free Tier)
1. Push your code to GitHub
2. Go to [railway.app](https://railway.app) and sign up
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Railway will auto-detect and deploy
6. Your game will be live at `https://your-app-name.up.railway.app`

### Option 3: Fly.io (Free Tier)
1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Run `fly launch` in your project directory
3. Follow the prompts
4. Deploy with `fly deploy`

### Important Notes
- The game uses Socket.io, which requires a persistent server connection
- Free tiers may have limitations (sleeping after inactivity, etc.)
- For production, consider paid hosting for better reliability

## How to Play

1. **Create or Join a Game**:
   - Enter your name
   - Click "Create Game" to start a new game (share the Game ID with a friend)
   - Or click "Join Game" and enter an existing Game ID

2. **Gameplay**:
   - Wait for both players to join
   - On your turn, choose one of 3 power cards
   - Enter a 5-letter word guess
   - See the feedback (green = correct position, yellow = correct letter wrong position, gray = not in word)
   - First player to guess the word wins!

3. **Card Effects**:
   - Cards activate immediately after selection
   - Effects apply to your next action or your opponent's next turn
   - Use cards strategically to gain an advantage!

## Technologies

- Node.js & Express
- Socket.io for real-time communication
- HTML5, CSS3, JavaScript
- Modern responsive design

## Game Rules

- Each player has 6 attempts to guess the word
- Players take turns guessing
- Cards are randomly selected from a pool of effects
- The game ends when someone guesses correctly or both players run out of guesses

Enjoy playing Cardle!


const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));

// Game state storage
const games = new Map();
const players = new Map();

// Word list (5-letter words)
const WORDS = [
    'APPLE', 'BEACH', 'CHAIR', 'DANCE', 'EARTH', 'FLAME', 'GLASS', 'HEART',
    'IMAGE', 'JOKER', 'KNIFE', 'LEMON', 'MUSIC', 'NIGHT', 'OCEAN', 'PAPER',
    'QUICK', 'RIVER', 'STORM', 'TABLE', 'UNITY', 'VALUE', 'WATER', 'YOUTH',
    'ZEBRA', 'BRAVE', 'CLOUD', 'DREAM', 'EAGLE', 'FROST', 'GHOST', 'HAPPY',
    'IVORY', 'JUMBO', 'KNEEL', 'LIGHT', 'MAGIC', 'NOBLE', 'OLIVE', 'PEACE',
    'QUART', 'ROBOT', 'SMILE', 'TIGER', 'ULTRA', 'VIVID', 'WHEAT', 'XENON',
    'YACHT', 'ZONAL', 'BREAD', 'CRANE', 'DROVE', 'ELBOW', 'FOCUS', 'GRAPE',
    'HORSE', 'INBOX', 'JUMPS', 'KINGS', 'LUNCH', 'MONEY', 'NURSE', 'OPERA',
    'PILOT', 'QUERY', 'RADIO', 'SCOUT', 'TREND', 'USAGE', 'VOCAL', 'WOMAN',
    'YIELD', 'ZONED'
];

function generateGameId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRandomWord() {
    return WORDS[Math.floor(Math.random() * WORDS.length)];
}

function calculateFeedback(guess, target) {
    const feedback = [];
    const targetLetters = target.split('');
    const guessLetters = guess.split('');
    const used = new Array(5).fill(false);
    
    // First pass: mark correct positions
    for (let i = 0; i < 5; i++) {
        if (guessLetters[i] === targetLetters[i]) {
            feedback[i] = 'correct';
            used[i] = true;
        }
    }
    
    // Second pass: mark present letters
    for (let i = 0; i < 5; i++) {
        if (feedback[i] !== 'correct') {
            const letterIndex = targetLetters.findIndex((letter, idx) => 
                letter === guessLetters[i] && !used[idx]
            );
            if (letterIndex !== -1) {
                feedback[i] = 'present';
                used[letterIndex] = true;
            } else {
                feedback[i] = 'absent';
            }
        }
    }
    
    return feedback;
}

function applyCardEffect(feedback, card, isOpponent) {
    if (!card) return feedback;
    
    if (card.id === 'falseFeedback' && isOpponent) {
        // Return incorrect feedback
        return feedback.map(() => {
            const rand = Math.random();
            if (rand < 0.33) return 'correct';
            if (rand < 0.66) return 'present';
            return 'absent';
        });
    }
    
    return feedback;
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('createGame', (data) => {
        const gameId = generateGameId();
        const word = getRandomWord();
        
        const game = {
            gameId: gameId,
            word: word,
            players: [{
                id: socket.id,
                name: data.playerName,
                guesses: [],
                row: 0
            }],
            currentTurn: socket.id,
            activeEffects: [],
            status: 'waiting'
        };
        
        games.set(gameId, game);
        players.set(socket.id, { gameId: gameId, playerId: socket.id });
        
        socket.join(gameId);
        socket.emit('gameCreated', { gameId: gameId, playerId: socket.id });
        socket.emit('playerJoined', { players: game.players });
    });
    
    socket.on('joinGame', (data) => {
        const game = games.get(data.gameId);
        
        if (!game) {
            socket.emit('error', { message: 'Game not found' });
            return;
        }
        
        if (game.players.length >= 2) {
            socket.emit('error', { message: 'Game is full' });
            return;
        }
        
        game.players.push({
            id: socket.id,
            name: data.playerName,
            guesses: [],
            row: 0
        });
        
        players.set(socket.id, { gameId: data.gameId, playerId: socket.id });
        socket.join(data.gameId);
        
        io.to(data.gameId).emit('playerJoined', { players: game.players });
        
        if (game.players.length === 2) {
            setTimeout(() => {
                io.to(data.gameId).emit('gameStarted', game);
            }, 1000);
        }
    });
    
    socket.on('selectCard', (data) => {
        const game = games.get(data.gameId);
        if (!game || game.currentTurn !== socket.id) return;
        
        const player = game.players.find(p => p.id === socket.id);
        
        // Notify the player who selected
        socket.emit('cardSelected', {
            playerId: socket.id,
            card: data.card
        });
        
        // Notify all players in the game about the card being played
        io.to(data.gameId).emit('cardPlayed', {
            card: data.card,
            playerName: player ? player.name : 'Player',
            playerId: socket.id
        });
    });
    
    socket.on('submitGuess', (data) => {
        const game = games.get(data.gameId);
        if (!game) return;
        
        if (game.currentTurn !== socket.id) {
            socket.emit('error', { message: 'Not your turn' });
            return;
        }
        
        const player = game.players.find(p => p.id === socket.id);
        if (!player) return;
        
        const guess = data.guess.toUpperCase();
        
        // Validate word (simple check - in production, use a dictionary)
        if (guess.length !== 5 || !/^[A-Z]+$/.test(guess)) {
            socket.emit('error', { message: 'Invalid word' });
            return;
        }
        
        // Calculate feedback (always store real feedback)
        const realFeedback = calculateFeedback(guess, game.word);
        
        // Find opponent
        const opponent = game.players.find(p => p.id !== socket.id);
        if (!opponent) return;
        
        // Store guess with real feedback
        player.guesses.push({
            guess: guess,
            feedback: realFeedback,
            row: player.row
        });
        
        // Apply card effects to game state for NEXT turn
        if (data.card) {
            if (data.card.id === 'falseFeedback') {
                // This will affect opponent's NEXT guess
                game.activeEffects.push({
                    type: 'falseFeedback',
                    target: opponent.id,
                    description: 'Next opponent guess will show false feedback'
                });
            } else if (data.card.id === 'hiddenFeedback') {
                // This affects THIS guess
                game.activeEffects.push({
                    type: 'hiddenFeedback',
                    target: socket.id,
                    description: 'Your feedback is hidden from opponent',
                    used: false
                });
            } else if (data.card.id === 'hiddenGuess') {
                // This affects THIS guess
                game.activeEffects.push({
                    type: 'hiddenGuess',
                    target: socket.id,
                    description: 'Your guess is hidden from opponent',
                    used: false
                });
            }
        }
        
        // Check for win
        if (guess === game.word) {
            game.status = 'finished';
            io.to(data.gameId).emit('gameOver', {
                winner: socket.id,
                word: game.word
            });
            return;
        }
        
        // Check for active effects on THIS guess
        const shouldHideGuess = game.activeEffects.some(e => 
            e.type === 'hiddenGuess' && e.target === socket.id && !e.used
        );
        
        const shouldHideFeedback = game.activeEffects.some(e => 
            e.type === 'hiddenFeedback' && e.target === socket.id && !e.used
        );
        
        // Check if opponent used falseFeedback on this player
        const falseFeedbackActive = game.activeEffects.some(e => 
            e.type === 'falseFeedback' && e.target === socket.id
        );
        
        // Determine what feedback to show
        let displayFeedback = realFeedback;
        if (falseFeedbackActive) {
            // Apply false feedback for opponent's view
            displayFeedback = applyCardEffect(realFeedback, { id: 'falseFeedback' }, true);
        }
        
        // Send to guesser (always show real feedback to the guesser)
        socket.emit('guessSubmitted', {
            playerId: socket.id,
            guess: guess,
            feedback: realFeedback, // Real feedback for the guesser
            row: player.row,
            hidden: false
        });
        
        // Send to opponent
        const opponentSocket = io.sockets.sockets.get(opponent.id);
        if (opponentSocket) {
            opponentSocket.emit('guessSubmitted', {
                playerId: socket.id,
                guess: shouldHideGuess ? null : guess,
                feedback: shouldHideFeedback ? null : (falseFeedbackActive ? displayFeedback : realFeedback),
                row: player.row,
                hidden: shouldHideGuess || shouldHideFeedback
            });
        }
        
        player.row++;
        
        // Switch turns
        game.currentTurn = opponent.id;
        
        // Remove used effects (mark as used and remove)
        game.activeEffects = game.activeEffects.filter(e => {
            if (e.target === socket.id && (e.type === 'hiddenGuess' || e.type === 'hiddenFeedback')) {
                return false; // Remove used effects
            }
            if (e.type === 'falseFeedback' && e.target === socket.id) {
                return false; // Remove falseFeedback after it's been applied
            }
            return true;
        });
        
        io.to(data.gameId).emit('turnChanged', game);
        
        // Check if game should end (max guesses reached)
        if (player.row >= 6) {
            game.status = 'finished';
            io.to(data.gameId).emit('gameOver', {
                winner: isOpponent.id,
                word: game.word
            });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const playerData = players.get(socket.id);
        if (playerData) {
            const game = games.get(playerData.gameId);
            if (game) {
                game.players = game.players.filter(p => p.id !== socket.id);
                if (game.players.length === 0) {
                    games.delete(playerData.gameId);
                } else {
                    io.to(playerData.gameId).emit('playerLeft', {});
                }
            }
            players.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});


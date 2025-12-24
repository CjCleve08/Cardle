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
        console.log('Applying false feedback. Original:', feedback);
        // 50% chance per letter to be changed to a random feedback state
        const modifiedFeedback = [...feedback]; // Create a copy
        
        for (let i = 0; i < feedback.length; i++) {
            // 25% chance to change this letter
            if (Math.random() < 0.25) {
                // Randomly change to any feedback state (correct, present, or absent)
                // It can be the same or different - completely random
                const options = ['correct', 'present', 'absent'];
                modifiedFeedback[i] = options[Math.floor(Math.random() * options.length)];
            }
            // If not changed (75% chance), keep the original feedback
        }
        
        console.log('False feedback result. Modified:', modifiedFeedback);
        return modifiedFeedback;
    }
    
    return feedback;
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Debug: Allow clients to request the word for their game
    socket.on('getWord', () => {
        const playerData = players.get(socket.id);
        if (playerData) {
            const game = games.get(playerData.gameId);
            if (game) {
                socket.emit('wordResponse', { word: game.word, gameId: game.gameId });
            }
        }
    });
    
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
            status: 'waiting',
            totalGuesses: 0  // Shared counter for board rows
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
        
        // Send the player their ID when they join
        socket.emit('playerJoinedGame', { playerId: socket.id, gameId: data.gameId });
        
        io.to(data.gameId).emit('playerJoined', { players: game.players });
        
        if (game.players.length === 2) {
            setTimeout(() => {
                console.log('Game starting. Current turn:', game.currentTurn);
                console.log('Players:', game.players.map(p => ({ id: p.id, name: p.name })));
                const gameStateForClients = {
                    gameId: game.gameId,
                    currentTurn: game.currentTurn,
                    players: game.players,
                    status: game.status,
                    activeEffects: game.activeEffects,
                    totalGuesses: game.totalGuesses
                };
                // Send gameStarted to all players, but include each player's own ID
                game.players.forEach(player => {
                    const playerSocket = io.sockets.sockets.get(player.id);
                    if (playerSocket) {
                        playerSocket.emit('gameStarted', {
                            ...gameStateForClients,
                            yourPlayerId: player.id  // Include the player's own ID
                        });
                    }
                });
            }, 1000);
        }
    });
    
    socket.on('selectCard', (data) => {
        const game = games.get(data.gameId);
        if (!game || game.currentTurn !== socket.id) return;
        
        const player = game.players.find(p => p.id === socket.id);
        
        // Check if this is a hidden card selection (after hideCard was used)
        const isHiddenSelection = data.hidden === true;
        
        // If hideCard is selected, show splash to everyone and allow second card selection
        if (data.card.id === 'hideCard' && !isHiddenSelection) {
            // Show hideCard splash to everyone
            io.to(data.gameId).emit('cardPlayed', {
                card: data.card,
                playerName: player ? player.name : 'Player',
                playerId: socket.id
            });
            
            // Notify the player they can select another card
            socket.emit('cardSelected', {
                playerId: socket.id,
                card: data.card,
                allowSecondCard: true // Signal to show card selection again
            });
            
            // Store that hideCard was used (so next card selection is hidden)
            if (!game.hiddenCardSelections) {
                game.hiddenCardSelections = new Map();
            }
            game.hiddenCardSelections.set(socket.id, true);
            return;
        }
        
        // If this is a hidden selection (second card after hideCard), don't show to opponent
        if (isHiddenSelection && game.hiddenCardSelections && game.hiddenCardSelections.get(socket.id)) {
            // Only notify the player who selected (no splash to opponent)
            socket.emit('cardSelected', {
                playerId: socket.id,
                card: data.card,
                hidden: true
            });
            
            // Clear the hidden card flag
            game.hiddenCardSelections.delete(socket.id);
            return;
        }
        
        // Normal card selection - notify everyone
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
        
        // Store guess with real feedback - use shared row counter for board display
        const boardRow = game.totalGuesses;
        player.guesses.push({
            guess: guess,
            feedback: realFeedback,
            row: boardRow
        });
        game.totalGuesses++; // Increment shared counter
        
        // Apply card effects to game state
        if (data.card) {
            if (data.card.id === 'falseFeedback') {
                // This affects THIS guess - opponent will see false feedback for this guess
                game.activeEffects.push({
                    type: 'falseFeedback',
                    target: socket.id, // Target the current player's guess
                    description: 'This guess will show false feedback to opponent',
                    used: false
                });
            } else if (data.card.id === 'hiddenFeedback') {
                // This affects THIS guess - hide feedback from opponent
                game.activeEffects.push({
                    type: 'hiddenFeedback',
                    target: socket.id,
                    description: 'Your feedback is hidden from opponent',
                    used: false
                });
            } else if (data.card.id === 'hiddenGuess') {
                // This affects THIS guess - hide guess from opponent
                game.activeEffects.push({
                    type: 'hiddenGuess',
                    target: socket.id,
                    description: 'Your guess is hidden from opponent',
                    used: false
                });
            } else if (data.card.id === 'extraGuess') {
                // Extra turn allows back-to-back guesses (player gets another turn)
                game.activeEffects.push({
                    type: 'extraGuess',
                    target: socket.id,
                    description: 'You get an additional turn immediately after this one',
                    used: false
                });
            } else if (data.card.id === 'hideCard') {
                // Hide card doesn't need to be stored as an effect
                // It's handled in the selectCard event handler
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
        
        // Check for active effects on THIS guess (for the current player making the guess)
        const shouldHideGuess = game.activeEffects.some(e => 
            e.type === 'hiddenGuess' && e.target === socket.id && !e.used
        );
        
        const shouldHideFeedback = game.activeEffects.some(e => 
            e.type === 'hiddenFeedback' && e.target === socket.id && !e.used
        );
        
        // Check if falseFeedback was applied to THIS guess (by the current player using the card)
        const falseFeedbackActive = game.activeEffects.some(e => 
            e.type === 'falseFeedback' && e.target === socket.id && !e.used
        );
        
        // Calculate false feedback if active (for opponent's view only)
        let falseFeedback = null;
        if (falseFeedbackActive) {
            // Apply false feedback - this will be shown to the opponent
            falseFeedback = applyCardEffect(realFeedback, { id: 'falseFeedback' }, true);
            console.log('False feedback calculated. Real:', realFeedback, 'False:', falseFeedback);
        }
        
        // Send to guesser (always show real feedback to the guesser)
        socket.emit('guessSubmitted', {
            playerId: socket.id,
            guess: guess,
            feedback: realFeedback, // Real feedback for the guesser
            row: boardRow,
            hidden: false
        });
        
        // Send to opponent
        const opponentSocket = io.sockets.sockets.get(opponent.id);
        if (opponentSocket) {
            let opponentFeedback = null;
            if (shouldHideFeedback) {
                // Hidden feedback: show all grey (absent) for opponent, but guess is visible
                opponentFeedback = ['absent', 'absent', 'absent', 'absent', 'absent'];
            } else if (falseFeedbackActive && falseFeedback) {
                // False feedback: show modified feedback to opponent
                opponentFeedback = falseFeedback;
                console.log('Sending false feedback to opponent. Real was:', realFeedback, 'Sending:', opponentFeedback);
            } else {
                // Normal feedback
                opponentFeedback = realFeedback;
            }
            
            // Only mark as hidden if the guess itself is hidden, not if just feedback is hidden
            opponentSocket.emit('guessSubmitted', {
                playerId: socket.id,
                guess: shouldHideGuess ? null : guess,
                feedback: opponentFeedback,
                row: boardRow,
                hidden: shouldHideGuess  // Only hide if guess is hidden, not feedback
            });
        }
        
        // Check if this was an extra guess (allows back-to-back guesses)
        const isExtraGuess = game.activeEffects.some(e => 
            e.type === 'extraGuess' && e.target === socket.id && !e.used
        );
        
        if (!isExtraGuess) {
            player.row++; // Track individual player's guess count
            // Switch turns normally
            game.currentTurn = opponent.id;
            console.log(`Turn switched: ${socket.id} -> ${opponent.id}. Current turn is now: ${game.currentTurn}`);
        } else {
            // Extra guess: don't count toward limit, don't switch turns
            // Player gets another turn immediately
            // Mark extra guess as used
            game.activeEffects = game.activeEffects.filter(e => 
                !(e.type === 'extraGuess' && e.target === socket.id && !e.used)
            );
            // Keep the turn with the same player
            game.currentTurn = socket.id;
            console.log(`Extra guess used - ${socket.id} gets another turn. Turn stays with: ${game.currentTurn}`);
        }
        
        // Remove used effects (mark as used and remove)
        game.activeEffects = game.activeEffects.filter(e => {
            // Remove hiddenGuess, hiddenFeedback, and falseFeedback after they've been used on this guess
            if (e.target === socket.id && (e.type === 'hiddenGuess' || e.type === 'hiddenFeedback' || e.type === 'falseFeedback')) {
                if (e.type === 'falseFeedback') {
                    console.log('Removing falseFeedback effect after it was applied to player:', socket.id);
                }
                return false; // Remove used effects
            }
            return true;
        });
        
        // Emit turn change to all players in the game (don't send the word)
        // Send personalized turnChanged events to each player with their own ID
        game.players.forEach(player => {
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                const gameStateForClient = {
                    gameId: game.gameId,
                    currentTurn: game.currentTurn,
                    players: game.players,
                    status: game.status,
                    activeEffects: game.activeEffects,
                    totalGuesses: game.totalGuesses,
                    yourPlayerId: player.id  // Include each player's own ID
                };
                const isTheirTurn = game.currentTurn === player.id;
                console.log(`Emitting turnChanged to player ${player.id} (${player.name}). Current turn: ${game.currentTurn}, Is their turn: ${isTheirTurn}`);
                if (isExtraGuess && isTheirTurn) {
                    console.log('  -> Extra guess: player gets another turn!');
                }
                playerSocket.emit('turnChanged', gameStateForClient);
            }
        });
        
        // No longer limit guesses - game continues until someone wins
        // Removed the 6 guess limit check
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


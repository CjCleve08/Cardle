const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Card Configuration System
// This defines all card behaviors in one place for easy extensibility
const CARD_CONFIG = {
    'falseFeedback': {
        metadata: {
            id: 'falseFeedback',
            title: 'False Feedback',
            description: 'Next word your opponent guesses will show incorrect feedback',
            type: 'hurt'
        },
        modifier: {
            isModifier: false,
            splashBehavior: 'show',
            chainBehavior: 'none',
            needsRealCardStorage: false
        },
        effects: {
            onGuess: (game, playerId) => {
                game.activeEffects.push({
                    type: 'falseFeedback',
                    target: playerId,
                    description: 'This guess will show false feedback to opponent',
                    used: false
                });
            },
            onFeedback: (feedback, isOpponent) => {
                if (!isOpponent) return feedback;
                const modifiedFeedback = [...feedback];
                for (let i = 0; i < feedback.length; i++) {
                    if (Math.random() < 0.25) {
                        const options = ['correct', 'present', 'absent'];
                        modifiedFeedback[i] = options[Math.floor(Math.random() * options.length)];
                    }
                }
                return modifiedFeedback;
            }
        }
    },
    'hiddenFeedback': {
        metadata: {
            id: 'hiddenFeedback',
            title: 'Hidden Feedback',
            description: 'Next word you guess will only show feedback to you',
            type: 'help'
        },
        modifier: {
            isModifier: false,
            splashBehavior: 'show',
            chainBehavior: 'none',
            needsRealCardStorage: false
        },
        effects: {
            onGuess: (game, playerId) => {
                game.activeEffects.push({
                    type: 'hiddenFeedback',
                    target: playerId,
                    description: 'Your feedback is hidden from opponent',
                    used: false
                });
            }
        }
    },
    'hiddenGuess': {
        metadata: {
            id: 'hiddenGuess',
            title: 'Hidden Guess',
            description: 'Your next guess will be hidden from your opponent',
            type: 'help'
        },
        modifier: {
            isModifier: false,
            splashBehavior: 'show',
            chainBehavior: 'none',
            needsRealCardStorage: false
        },
        effects: {
            onGuess: (game, playerId) => {
                game.activeEffects.push({
                    type: 'hiddenGuess',
                    target: playerId,
                    description: 'Your guess is hidden from opponent',
                    used: false
                });
            }
        }
    },
    'extraGuess': {
        metadata: {
            id: 'extraGuess',
            title: 'Extra Turn',
            description: 'Get an additional turn immediately after this one',
            type: 'help'
        },
        modifier: {
            isModifier: false,
            splashBehavior: 'show',
            chainBehavior: 'none',
            needsRealCardStorage: false
        },
        effects: {
            onGuess: (game, playerId) => {
                game.activeEffects.push({
                    type: 'extraGuess',
                    target: playerId,
                    description: 'You get an additional turn immediately after this one',
                    used: false
                });
            }
        }
    },
    'hideCard': {
        metadata: {
            id: 'hideCard',
            title: 'Hide Card',
            description: 'Play another card secretly - your opponent won\'t know which one',
            type: 'help'
        },
        modifier: {
            isModifier: true,
            splashBehavior: 'show',
            chainBehavior: 'hide',
            needsRealCardStorage: false
        },
        effects: {}
    },
    'phonyCard': {
        metadata: {
            id: 'phonyCard',
            title: 'Phony Card',
            description: 'Play a card that shows a fake card to your opponent',
            type: 'hurt'
        },
        modifier: {
            isModifier: true,
            splashBehavior: 'silent',
            chainBehavior: 'fake',
            needsRealCardStorage: true
        },
        effects: {}
    },
    'gamblersCard': {
        metadata: {
            id: 'gamblersCard',
            title: 'Gambler\'s Card',
            description: '50% chance to reveal a letter, 50% chance to hide your next guess from yourself',
            type: 'help'
        },
        modifier: {
            isModifier: false,
            splashBehavior: 'show',
            chainBehavior: 'none',
            needsRealCardStorage: false
        },
        effects: {
            onGuess: (game, playerId) => {
                // 50/50 chance
                const isLucky = Math.random() < 0.5;
                
                if (isLucky) {
                    // Reveal a random letter position
                    const word = game.word;
                    const randomPosition = Math.floor(Math.random() * 5);
                    const revealedLetter = word[randomPosition];
                    
                    // Store the reveal info to send when guess is submitted
                    game.activeEffects.push({
                        type: 'gamblerReveal',
                        target: playerId,
                        letter: revealedLetter,
                        position: randomPosition,
                        description: `Revealed letter: ${revealedLetter} at position ${randomPosition + 1}`,
                        used: false
                    });
                } else {
                    // Hide next guess from player
                    game.activeEffects.push({
                        type: 'gamblerHide',
                        target: playerId,
                        description: 'Your next guess will be hidden from you',
                        used: false
                    });
                }
            }
        }
    },
    'cardLock': {
        metadata: {
            id: 'cardLock',
            title: 'Card Lock',
            description: 'Prevents your opponent from using a card on their next turn',
            type: 'hurt'
        },
        modifier: {
            isModifier: false,
            splashBehavior: 'show',
            chainBehavior: 'none',
            needsRealCardStorage: false
        },
        effects: {
            onGuess: (game, playerId) => {
                // Find the opponent
                const opponent = game.players.find(p => p.id !== playerId);
                if (opponent) {
                    // Add card lock effect targeting the opponent
                    game.activeEffects.push({
                        type: 'cardLock',
                        target: opponent.id,
                        description: 'You cannot use a card on your next turn',
                        used: false
                    });
                }
            }
        }
    },
    'handReveal': {
        metadata: {
            id: 'handReveal',
            title: 'Hand Reveal',
            description: 'Reveal your opponent\'s current hand of cards',
            type: 'help'
        },
        modifier: {
            isModifier: false,
            splashBehavior: 'show',
            chainBehavior: 'none',
            needsRealCardStorage: false
        },
        effects: {
            // Hand reveal is handled in selectCard, not onGuess
        }
    }
};

// Helper functions for card configuration
function isModifierCard(cardId) {
    return CARD_CONFIG[cardId]?.modifier?.isModifier === true;
}

function getSplashBehavior(cardId) {
    return CARD_CONFIG[cardId]?.modifier?.splashBehavior || 'show';
}

function getChainBehavior(cardId) {
    return CARD_CONFIG[cardId]?.modifier?.chainBehavior || 'none';
}

function needsRealCardStorage(cardId) {
    return CARD_CONFIG[cardId]?.modifier?.needsRealCardStorage === true;
}

function getModifierCards() {
    return Object.keys(CARD_CONFIG).filter(id => isModifierCard(id));
}

function getAllCardsMetadata() {
    return Object.values(CARD_CONFIG).map(config => config.metadata);
}

function processCardChain(cardChain, realCard) {
    let cardToShowOpponent = realCard;
    let shouldHideFromOpponent = false;
    
    // Check chain behaviors in reverse order (last modifier takes precedence)
    // hideCard takes precedence over phonyCard
    const hasHideCard = cardChain.some(c => getChainBehavior(c.id) === 'hide');
    const hasPhonyCard = cardChain.some(c => getChainBehavior(c.id) === 'fake');
    
    if (hasHideCard) {
        shouldHideFromOpponent = true;
    } else if (hasPhonyCard) {
        // Generate a fake card from all available cards
        const allCards = getAllCardsMetadata();
        const fakeCardOptions = allCards.filter(c => c.id !== realCard.id);
        if (fakeCardOptions.length > 0) {
            cardToShowOpponent = fakeCardOptions[Math.floor(Math.random() * fakeCardOptions.length)];
        }
    }
    
    return { cardToShowOpponent, shouldHideFromOpponent };
}

// Inject card config into HTML (must be before static middleware)
app.get('/', (req, res) => {
    const htmlPath = path.join(__dirname, 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    
    // Inject card config as a script tag before client.js
    const configScript = `<script>window.CARD_CONFIG = ${JSON.stringify(CARD_CONFIG)};</script>`;
    html = html.replace('<script src="client.js"></script>', configScript + '\n    <script src="client.js"></script>');
    
    res.send(html);
});

// Serve static files (after route handlers)
app.use(express.static(__dirname));

// Game state storage
const games = new Map();
const players = new Map();

// Matchmaking queue
const matchmakingQueue = [];

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
    
    // First pass: mark correct positions (green)
    for (let i = 0; i < 5; i++) {
        if (guessLetters[i] === targetLetters[i]) {
            feedback[i] = 'correct';
            used[i] = true; // Mark this position in target as used
        }
    }
    
    // Second pass: mark present letters (yellow)
    // Only mark as present if the letter appears in target AND hasn't been used yet
    for (let i = 0; i < 5; i++) {
        if (feedback[i] !== 'correct') {
            // Count how many times this letter appears in target (not yet used)
            const letter = guessLetters[i];
            let foundMatch = false;
            
            // Look for this letter in target that hasn't been used
            for (let j = 0; j < 5; j++) {
                if (targetLetters[j] === letter && !used[j]) {
                feedback[i] = 'present';
                    used[j] = true; // Mark this position in target as used
                    foundMatch = true;
                    break; // Only use one instance of the letter
                }
            }
            
            if (!foundMatch) {
                feedback[i] = 'absent';
            }
        }
    }
    
    return feedback;
}

function applyCardEffect(feedback, card, isOpponent) {
    if (!card || !CARD_CONFIG[card.id]) return feedback;
    
    const config = CARD_CONFIG[card.id];
    if (config.effects?.onFeedback) {
        return config.effects.onFeedback(feedback, isOpponent);
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
    
    // Matchmaking handlers
    socket.on('findMatch', (data) => {
        // Check if player is already in queue
        const existingIndex = matchmakingQueue.findIndex(p => p.id === socket.id);
        if (existingIndex !== -1) {
            socket.emit('matchmakingStatus', { status: 'alreadyInQueue' });
            return;
        }
        
        // Check if player is already in a game
        const playerData = players.get(socket.id);
        if (playerData && games.get(playerData.gameId)) {
            socket.emit('error', { message: 'You are already in a game' });
            return;
        }
        
        // Add player to queue
        const player = {
            id: socket.id,
            name: data.playerName
        };
        
        matchmakingQueue.push(player);
        socket.emit('matchmakingStatus', { status: 'searching' });
        
        console.log(`Player ${data.playerName} (${socket.id}) joined matchmaking queue. Queue size: ${matchmakingQueue.length}`);
        
        // Check if we can match players
        if (matchmakingQueue.length >= 2) {
            // Match the first two players
            const player1 = matchmakingQueue.shift();
            const player2 = matchmakingQueue.shift();
            
            // Create a game for them
            const gameId = generateGameId();
            const word = getRandomWord();
            
            const game = {
                gameId: gameId,
                word: word,
                players: [
                    {
                        id: player1.id,
                        name: player1.name,
                        guesses: [],
                        row: 0
                    },
                    {
                        id: player2.id,
                        name: player2.name,
                        guesses: [],
                        row: 0
                    }
                ],
                currentTurn: player1.id, // Randomly choose first player (or could use Math.random())
                activeEffects: [],
                status: 'waiting',
                totalGuesses: 0
            };
            
            games.set(gameId, game);
            players.set(player1.id, { gameId: gameId, playerId: player1.id });
            players.set(player2.id, { gameId: gameId, playerId: player2.id });
            
            // Join both players to the game room
            const player1Socket = io.sockets.sockets.get(player1.id);
            const player2Socket = io.sockets.sockets.get(player2.id);
            
            if (player1Socket) {
                player1Socket.join(gameId);
                player1Socket.emit('matchmakingStatus', { status: 'matched' });
                player1Socket.emit('playerJoinedGame', { playerId: player1.id, gameId: gameId });
            }
            
            if (player2Socket) {
                player2Socket.join(gameId);
                player2Socket.emit('matchmakingStatus', { status: 'matched' });
                player2Socket.emit('playerJoinedGame', { playerId: player2.id, gameId: gameId });
            }
            
            // Notify both players
            io.to(gameId).emit('playerJoined', { players: game.players });
            
            // Start the game
            setTimeout(() => {
                console.log('Matchmade game starting. Current turn:', game.currentTurn);
                console.log('Players:', game.players.map(p => ({ id: p.id, name: p.name })));
                const gameStateForClients = {
                    gameId: game.gameId,
                    currentTurn: game.currentTurn,
                    players: game.players,
                    status: game.status,
                    activeEffects: game.activeEffects,
                    totalGuesses: game.totalGuesses
                };
                
                game.players.forEach(player => {
                    const playerSocket = io.sockets.sockets.get(player.id);
                    if (playerSocket) {
                        playerSocket.emit('gameStarted', {
                            ...gameStateForClients,
                            yourPlayerId: player.id
                        });
                    }
                });
            }, 1000);
        }
    });
    
    socket.on('cancelMatchmaking', () => {
        const index = matchmakingQueue.findIndex(p => p.id === socket.id);
        if (index !== -1) {
            matchmakingQueue.splice(index, 1);
            socket.emit('matchmakingStatus', { status: 'cancelled' });
            console.log(`Player ${socket.id} left matchmaking queue. Queue size: ${matchmakingQueue.length}`);
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
        
        // Check if player is card locked
        const isCardLocked = game.activeEffects.some(e => 
            e.type === 'cardLock' && e.target === socket.id && !e.used
        );
        if (isCardLocked) {
            socket.emit('error', { message: 'You cannot use a card this turn - Card Lock is active!' });
            return;
        }
        
        const player = game.players.find(p => p.id === socket.id);
        
        // Initialize card chain tracking if needed
        if (!game.cardChains) {
            game.cardChains = new Map();
        }
        
        // Get or initialize the card chain for this player
        let cardChain = game.cardChains.get(socket.id) || [];
        
        // Check if this card is a modifier card using config
        const cardIsModifier = isModifierCard(data.card.id);
        
        // If it's a modifier card, add it to the chain and allow another selection
        if (cardIsModifier) {
            cardChain.push(data.card);
            game.cardChains.set(socket.id, cardChain);
            
            // Show splash based on config
            const splashBehavior = getSplashBehavior(data.card.id);
            if (splashBehavior === 'show') {
                io.to(data.gameId).emit('cardPlayed', {
                    card: data.card,
                    playerName: player ? player.name : 'Player',
                    playerId: socket.id
                });
            }
            // 'silent' or 'custom' behaviors don't emit splash here
            
            // Notify the player they can select another card
            socket.emit('cardSelected', {
                playerId: socket.id,
                card: data.card,
                allowSecondCard: true
            });
            return;
        }
        
        // This is a regular card (final card in the chain)
        // Add it to the chain
        cardChain.push(data.card);
        
        // Process the card chain using config
        const realCard = data.card; // The last card is always the real card
        const { cardToShowOpponent, shouldHideFromOpponent } = processCardChain(cardChain, realCard);
        
        // Find opponent
        const opponent = game.players.find(p => p.id !== socket.id);
        
        // Store the real card for when guess is submitted (if needed by config)
        if (cardChain.some(c => needsRealCardStorage(c.id))) {
            if (!game.phonyCardRealCards) {
                game.phonyCardRealCards = new Map();
            }
            game.phonyCardRealCards.set(socket.id, realCard);
        }
        
        // Check if this is a hand reveal card - trigger it immediately
        if (realCard.id === 'handReveal' && opponent) {
            const opponentSocket = io.sockets.sockets.get(opponent.id);
            if (opponentSocket) {
                opponentSocket.emit('requestHand', {
                    gameId: data.gameId,
                    requesterId: socket.id
                });
            }
        }
        
        // Notify the player with the real card
        socket.emit('cardSelected', {
            playerId: socket.id,
            card: realCard,
            hidden: shouldHideFromOpponent,
            isRealCard: true
        });
        
        // Show card to opponent (fake if phonyCard was used, hidden if hideCard was used)
        if (opponent && !shouldHideFromOpponent) {
            const opponentSocket = io.sockets.sockets.get(opponent.id);
            if (opponentSocket) {
                opponentSocket.emit('cardPlayed', {
                    card: cardToShowOpponent,
            playerName: player ? player.name : 'Player',
            playerId: socket.id
        });
            }
        }
        
        // Clear the card chain
        game.cardChains.delete(socket.id);
    });
    
    socket.on('sendHand', (data) => {
        // Opponent is sending their hand in response to a reveal request
        const game = games.get(data.gameId);
        if (!game) return;
        
        const requesterSocket = io.sockets.sockets.get(data.requesterId);
        if (requesterSocket) {
            requesterSocket.emit('opponentHandRevealed', {
                cards: data.cards,
                opponentName: game.players.find(p => p.id === socket.id)?.name || 'Opponent'
            });
        }
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
        
        // Check if phonyCard was used - if so, use the real card instead
        let actualCard = data.card;
        if (game.phonyCardRealCards && game.phonyCardRealCards.has(socket.id)) {
            actualCard = game.phonyCardRealCards.get(socket.id);
            game.phonyCardRealCards.delete(socket.id);
            console.log('Phony card used - real card is:', actualCard, 'but opponent saw fake card');
        }
        
        // Apply card effects to game state using config (use actual card, not the fake one)
        if (actualCard && CARD_CONFIG[actualCard.id]) {
            const config = CARD_CONFIG[actualCard.id];
            // Only apply effects if it's not a modifier card (modifiers are handled in selectCard)
            if (!isModifierCard(actualCard.id) && config.effects?.onGuess) {
                config.effects.onGuess(game, socket.id);
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
        
        // Check if gamblerHide is active (hides guess from player themselves)
        const shouldHideFromSelf = game.activeEffects.some(e => 
            e.type === 'gamblerHide' && e.target === socket.id && !e.used
        );
        
        // Check if gamblerReveal is active (reveals a letter)
        const gamblerReveal = game.activeEffects.find(e => 
            e.type === 'gamblerReveal' && e.target === socket.id && !e.used
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
        
        // Send to guesser (hide if gamblerHide is active, otherwise show normally)
        if (shouldHideFromSelf) {
            // Hide guess from player themselves (gambler's card bad luck)
            socket.emit('guessSubmitted', {
                playerId: socket.id,
                guess: null, // Hide the guess
                feedback: null, // Hide the feedback
                row: boardRow,
                hidden: true
            });
        } else {
            // Normal display for guesser
        socket.emit('guessSubmitted', {
            playerId: socket.id,
            guess: guess,
            feedback: realFeedback, // Real feedback for the guesser
                row: boardRow,
            hidden: false
        });
        }
        
        // Send letter reveal if gambler was lucky
        if (gamblerReveal) {
            socket.emit('letterRevealed', {
                letter: gamblerReveal.letter,
                position: gamblerReveal.position,
                message: `Letter revealed: ${gamblerReveal.letter} at position ${gamblerReveal.position + 1}`
            });
        }
        
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
            
            // Clear card lock effect when the locked player's turn ends
            // (when turn switches away from them)
            game.activeEffects = game.activeEffects.filter(e => 
                !(e.type === 'cardLock' && e.target === socket.id)
            );
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
            // Remove hiddenGuess, hiddenFeedback, falseFeedback, gamblerHide, and gamblerReveal after they've been used on this guess
            if (e.target === socket.id && (
                e.type === 'hiddenGuess' || 
                e.type === 'hiddenFeedback' || 
                e.type === 'falseFeedback' ||
                e.type === 'gamblerHide' ||
                e.type === 'gamblerReveal'
            )) {
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
    
    socket.on('chatMessage', (data) => {
        const game = games.get(data.gameId);
        if (!game) return;
        
        // Verify player is in the game
        const player = game.players.find(p => p.id === socket.id);
        if (!player) return;
        
        // Validate message
        const message = (data.message || '').trim();
        if (!message || message.length > 200) return;
        
        // Broadcast message to all players in the game
        io.to(data.gameId).emit('chatMessage', {
            playerId: socket.id,
            playerName: player.name,
            message: message,
            timestamp: Date.now()
        });
    });
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Remove from matchmaking queue if present
        const queueIndex = matchmakingQueue.findIndex(p => p.id === socket.id);
        if (queueIndex !== -1) {
            matchmakingQueue.splice(queueIndex, 1);
            console.log(`Player ${socket.id} removed from matchmaking queue. Queue size: ${matchmakingQueue.length}`);
        }
        
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


const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Card Configuration System
// This defines all card behaviors in one place for easy extensibility
const CARD_CONFIG = {
    'falseFeedback': {
        metadata: {
            id: 'falseFeedback',
            title: 'Bluff',
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
                    if (Math.random() < 0.40) {
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
            title: 'Poker Face',
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
            title: 'Blank',
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
            title: 'Hit Me',
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
            title: 'Sneaky Set',
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
            title: 'Dummy Hand',
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
            title: 'Bust Special',
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
                // 50% chance for letter reveal, 50% chance for hidden guess
                const isLucky = Math.random() < 0.50;
                
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
            title: 'Forced Miss',
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
            title: 'Dead Hand',
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
    },
    'blindGuess': {
        metadata: {
            id: 'blindGuess',
            title: 'Null',
            description: 'Your opponent\'s next guess will be hidden from them',
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
                    // Add blind guess effect targeting the opponent
                    game.activeEffects.push({
                        type: 'blindGuess',
                        target: opponent.id,
                        description: 'Your next guess will be hidden from you',
                        used: false
                    });
                }
            }
        }
    },
    'cardSteal': {
        metadata: {
            id: 'cardSteal',
            title: 'Finesse',
            description: 'Pick a card from your opponent\'s hand to play as your own',
            type: 'help'
        },
        modifier: {
            isModifier: false,
            splashBehavior: 'show',
            chainBehavior: 'none',
            needsRealCardStorage: false
        },
        effects: {
            // Card steal is handled in selectCard, not onGuess
        }
    },
    'greenToGrey': {
        metadata: {
            id: 'greenToGrey',
            title: 'False Shuffle',
            description: 'Your opponent\'s next green letters will show as grey',
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
                    // Add greenToGrey effect targeting the opponent
                    game.activeEffects.push({
                        type: 'greenToGrey',
                        target: opponent.id,
                        description: 'Your green letters will show as grey on your next guess',
                        used: false
                    });
                }
            },
            onFeedback: (feedback, isOpponent) => {
                // Modify feedback for the guesser (when isOpponent is false)
                // This card targets the opponent, so when they guess, we modify their feedback
                if (isOpponent) return feedback;
                const modifiedFeedback = [...feedback];
                // Change all 'correct' (green) to 'absent' (grey)
                for (let i = 0; i < feedback.length; i++) {
                    if (modifiedFeedback[i] === 'correct') {
                        modifiedFeedback[i] = 'absent';
                    }
                }
                return modifiedFeedback;
            }
        }
    },
    'cardBlock': {
        metadata: {
            id: 'cardBlock',
            title: 'Oppressive Fold',
            description: 'A random card in your opponent\'s hand is blocked and cannot be used',
            type: 'hurt'
        },
        modifier: {
            isModifier: false,
            splashBehavior: 'show',
            chainBehavior: 'none',
            needsRealCardStorage: false
        },
        effects: {
            // Card block is handled in selectCard, not onGuess
        }
    },
    'effectClear': {
        metadata: {
            id: 'effectClear',
            title: 'Counter',
            description: 'Cancels all negative effects currently affecting you',
            type: 'help'
        },
        modifier: {
            isModifier: false,
            splashBehavior: 'show',
            chainBehavior: 'none',
            needsRealCardStorage: false
        },
        effects: {
            // Effect clear is handled in selectCard, not onGuess
        }
    },
    'timeRush': {
        metadata: {
            id: 'timeRush',
            title: 'Quick Deal',
            description: 'Your opponent\'s next turn will only have 20 seconds',
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
                    // Add timeRush effect targeting the opponent
                    game.activeEffects.push({
                        type: 'timeRush',
                        target: opponent.id,
                        description: 'Your next turn will only have 20 seconds',
                        used: false
                    });
                }
            }
        }
    },
    'wordScramble': {
        metadata: {
            id: 'wordScramble',
            title: 'Undertrick',
            description: 'Your opponent\'s next guess letters will appear in random order',
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
                    // Add wordScramble effect targeting the opponent
                    game.activeEffects.push({
                        type: 'wordScramble',
                        target: opponent.id,
                        description: 'Your next guess letters will appear in random order',
                        used: false
                    });
                }
            }
        }
    },
    'cardMirror': {
        metadata: {
            id: 'cardMirror',
            title: 'Follow Suit',
            description: 'Copy and play the last card your opponent used',
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
                const opponent = game.players.find(p => p.id !== playerId);
                if (!opponent) return;
                
                // Resolve the actual card being mirrored (following Card Mirror chains)
                const actualMirroredCard = resolveMirroredCard(game, opponent.id);
                
                if (!actualMirroredCard) {
                    // No card to mirror - do nothing (or could add a message)
                    console.log('Card Mirror: No card to mirror for player', playerId, '- opponent has no last played card');
                    return;
                }
                
                // Get the card config for the mirrored card
                const mirroredCardConfig = CARD_CONFIG[actualMirroredCard.id];
                if (!mirroredCardConfig) {
                    console.log('Card Mirror: Could not find config for mirrored card:', actualMirroredCard.id);
                    return;
                }
                
                // Apply the mirrored card's effect
                if (mirroredCardConfig.effects && mirroredCardConfig.effects.onGuess) {
                    console.log('Card Mirror: Applying effect from resolved card:', actualMirroredCard.id, '(followed Card Mirror chain)');
                    // Apply the effect as if the current player used it
                    mirroredCardConfig.effects.onGuess(game, playerId);
                } else {
                    console.log('Card Mirror: Mirrored card has no onGuess effect:', actualMirroredCard.id);
                }
            }
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

// Helper function to send system chat messages
function sendSystemChatMessage(gameId, message) {
    io.to(gameId).emit('chatMessage', {
        playerId: 'system',
        playerName: 'System',
        message: message,
        timestamp: Date.now(),
        isSystem: true
    });
}

// Helper function to get card display name
function getCardDisplayName(card) {
    if (!card || !card.id) return 'Unknown Card';
    const config = CARD_CONFIG[card.id];
    return config?.metadata?.title || card.title || 'Unknown Card';
}

// Helper function to resolve Card Mirror chains recursively
// Given a player ID, returns the actual card being mirrored (following Card Mirror chains)
function resolveMirroredCard(game, playerId, visitedPlayers = new Set()) {
    // Prevent infinite loops
    if (visitedPlayers.has(playerId)) {
        console.warn('Card Mirror: Circular reference detected for player', playerId);
        return null;
    }
    visitedPlayers.add(playerId);
    
    if (!game.lastPlayedCards) {
        return null;
    }
    
    const lastCard = game.lastPlayedCards.get(playerId);
    if (!lastCard) {
        return null;
    }
    
    // If it's not Card Mirror, return it directly
    if (lastCard.id !== 'cardMirror') {
        return lastCard;
    }
    
    // If it's Card Mirror, check what it actually mirrored
    if (!game.mirroredCards) {
        return null;
    }
    
    const actualMirroredCard = game.mirroredCards.get(playerId);
    if (!actualMirroredCard) {
        // Card Mirror was played but we don't have record of what it mirrored
        // Fallback: look at opponent's last card (for backwards compatibility or edge cases)
        const opponent = game.players.find(p => p.id !== playerId);
        if (opponent) {
            const opponentLastCard = game.lastPlayedCards.get(opponent.id);
            if (opponentLastCard && opponentLastCard.id !== 'cardMirror') {
                return opponentLastCard;
            }
        }
        return null;
    }
    
    // If the card that was mirrored is also Card Mirror, recursively resolve it
    if (actualMirroredCard.id === 'cardMirror') {
        // Find the opponent (the player whose card was mirrored)
        const opponent = game.players.find(p => p.id !== playerId);
        if (opponent) {
            // Recursively resolve what the opponent's Card Mirror was mirroring
            const newVisited = new Set(visitedPlayers);
            return resolveMirroredCard(game, opponent.id, newVisited);
        }
        return actualMirroredCard;
    }
    
    return actualMirroredCard;
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
const spectators = new Map(); // gameId -> Set of socket IDs
const userToGame = new Map(); // firebaseUid -> gameId (for friend status checking)
const rematchRequests = new Map(); // gameId -> Set of player socket IDs who requested rematch

// Matchmaking queue
const matchmakingQueue = [];

// Track bot matchmaking timeouts
const matchmakingTimeouts = new Map(); // socket.id -> timeout

// Bot names pool
const BOT_NAMES = [
    'Alex', 'Jordan', 'Casey', 'Sam', 'Taylor', 'Morgan', 'Riley', 'Jamie',
    'Quinn', 'Avery', 'Blake', 'Cameron', 'Dakota', 'Emery', 'Finley', 'Hayden',
    'Parker', 'River', 'Sage', 'Skylar'
];

// Bot games tracking
const botGames = new Map(); // gameId -> { botId, botTurnProcessor }

// Word list (5-letter words) - will be loaded from API or fallback to default
let WORDS = [
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

// Load expanded word list from API
function loadWordList() {
    return new Promise((resolve) => {
        // Try multiple sources - JSON first, then TXT
        const sources = [
            { url: 'https://raw.githubusercontent.com/cheaderthecoder/5-Letter-words/main/words.json', type: 'json' },
            { url: 'https://darkermango.github.io/5-Letter-words/words.json', type: 'json' },
            { url: 'https://raw.githubusercontent.com/cheaderthecoder/5-Letter-words/main/words.txt', type: 'txt' },
            { url: 'https://darkermango.github.io/5-Letter-words/words.txt', type: 'txt' }
        ];
        
        let sourceIndex = 0;
        
        function tryNextSource() {
            if (sourceIndex >= sources.length) {
                console.log('All word list sources failed, using fallback word list');
                resolve();
                return;
            }
            
            const source = sources[sourceIndex];
            console.log(`Attempting to load words from: ${source.url} (${source.type})`);
            
            const request = https.get(source.url, (res) => {
                if (res.statusCode !== 200) {
                    console.log(`Failed to load word list: HTTP ${res.statusCode}`);
                    sourceIndex++;
                    tryNextSource();
                    return;
                }
                
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        let words = [];
                        
                        if (source.type === 'json') {
                            const parsed = JSON.parse(data);
                            // Handle both array format and object with words property
                            if (Array.isArray(parsed)) {
                                words = parsed;
                            } else if (parsed.words && Array.isArray(parsed.words)) {
                                words = parsed.words;
                            } else if (parsed.data && Array.isArray(parsed.data)) {
                                words = parsed.data;
                            } else {
                                console.log('Unexpected JSON format');
                                sourceIndex++;
                                tryNextSource();
                                return;
                            }
                        } else if (source.type === 'txt') {
                            // Parse TXT format - one word per line
                            words = data.split('\n')
                                .map(line => line.trim())
                                .filter(line => line.length > 0);
                        }
                        
                        if (words.length > 0) {
                            // Filter to valid 5-letter uppercase words
                            const validWords = words
                                .filter(word => typeof word === 'string')
                                .map(word => word.toUpperCase().trim())
                                .filter(word => word.length === 5 && /^[A-Z]+$/.test(word));
                            
                            if (validWords.length > 0) {
                                WORDS = validWords;
                                console.log(`✓ Successfully loaded ${WORDS.length} words from API`);
                                resolve();
                                return;
                            } else {
                                console.log('No valid 5-letter words found in response');
                            }
                        } else {
                            console.log('No words found in response');
                        }
                    } catch (error) {
                        console.log(`Failed to parse word list: ${error.message}`);
                    }
                    
                    // Try next source
                    sourceIndex++;
                    tryNextSource();
                });
            });
            
            request.on('error', (error) => {
                console.log(`Failed to load word list from ${source.url}: ${error.message}`);
                sourceIndex++;
                tryNextSource();
            });
            
            request.setTimeout(10000, () => {
                console.log(`Timeout loading word list from ${source.url}`);
                request.destroy();
                sourceIndex++;
                tryNextSource();
            });
        }
        
        tryNextSource();
    });
}

// Load words on server start
loadWordList();

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

function scrambleWord(word) {
    // Convert word to array, shuffle, and join back
    const letters = word.split('');
    // Fisher-Yates shuffle algorithm
    for (let i = letters.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    return letters.join('');
}

function scrambleWordAndGetPermutation(word) {
    // Create an array of indices to track the permutation
    const indices = Array.from({ length: word.length }, (_, i) => i);
    const letters = word.split('');
    
    // Fisher-Yates shuffle algorithm - shuffle both letters and indices together
    for (let i = letters.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [letters[i], letters[j]] = [letters[j], letters[i]];
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    return {
        scrambledWord: letters.join(''),
        permutation: indices // permutation[i] tells us which original position is now at position i
    };
}

function applyPermutationToArray(array, permutation) {
    // permutation[i] tells us which original position is now at position i
    // So we create a new array where newArray[i] = oldArray[permutation[i]]
    return permutation.map(originalIndex => array[originalIndex]);
}

// ==================== BOT AI SYSTEM ====================

function getRandomBotName() {
    return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + 
           Math.floor(Math.random() * 1000).toString();
}

// Bot Wordle Solver - filters possible words based on feedback
class BotWordleSolver {
    constructor(wordList) {
        this.wordList = [...wordList]; // Copy the word list
        this.possibleWords = [...wordList];
        this.knownCorrect = new Array(5).fill(null); // Position -> letter
        this.knownPresent = {}; // Letter -> set of positions it's NOT in
        this.knownAbsent = new Set(); // Letters that aren't in the word
    }
    
    updateKnowledge(guess, feedback) {
        // Process feedback to update knowledge
        const guessLetters = guess.split('');
        
        for (let i = 0; i < 5; i++) {
            if (feedback[i] === 'correct') {
                this.knownCorrect[i] = guessLetters[i];
            } else if (feedback[i] === 'present') {
                if (!this.knownPresent[guessLetters[i]]) {
                    this.knownPresent[guessLetters[i]] = new Set();
                }
                this.knownPresent[guessLetters[i]].add(i);
            } else if (feedback[i] === 'absent') {
                // Only mark as absent if it doesn't appear as correct or present elsewhere
                let appearsElsewhere = false;
                for (let j = 0; j < 5; j++) {
                    if (j !== i && (feedback[j] === 'correct' || feedback[j] === 'present') && 
                        guessLetters[j] === guessLetters[i]) {
                        appearsElsewhere = true;
                        break;
                    }
                }
                if (!appearsElsewhere) {
                    this.knownAbsent.add(guessLetters[i]);
                }
            }
        }
        
        // Filter possible words
        this.possibleWords = this.wordList.filter(word => {
            const wordLetters = word.split('');
            
            // Check correct positions
            for (let i = 0; i < 5; i++) {
                if (this.knownCorrect[i] !== null && wordLetters[i] !== this.knownCorrect[i]) {
                    return false;
                }
            }
            
            // Check absent letters
            for (let letter of this.knownAbsent) {
                if (wordLetters.includes(letter)) {
                    // But allow if it's in a known correct position
                    let isInCorrectPosition = false;
                    for (let i = 0; i < 5; i++) {
                        if (this.knownCorrect[i] === letter) {
                            isInCorrectPosition = true;
                            break;
                        }
                    }
                    if (!isInCorrectPosition) {
                        return false;
                    }
                }
            }
            
            // Check present letters (must be in word but not in excluded positions)
            for (let letter in this.knownPresent) {
                if (!wordLetters.includes(letter)) {
                    return false;
                }
                // Check it's not in any excluded positions
                for (let excludedPos of this.knownPresent[letter]) {
                    if (wordLetters[excludedPos] === letter) {
                        return false;
                    }
                }
            }
            
            return true;
        });
    }
    
    getBestGuess() {
        if (this.possibleWords.length === 0) {
            // Fallback: pick a random word
            return this.wordList[Math.floor(Math.random() * this.wordList.length)];
        }
        
        // Make bot less perfect - add more randomness and mistakes
        // Sometimes pick a suboptimal word even when we know the answer
        const randomFactor = Math.random();
        
        // If only one possibility, still sometimes pick wrong word (10% chance)
        if (this.possibleWords.length === 1) {
            if (randomFactor < 0.1) {
                // Pick a random word that matches some known letters (wrong answer)
                const partialMatches = this.wordList.filter(word => {
                    let matches = 0;
                    for (let i = 0; i < 5; i++) {
                        if (this.knownCorrect[i] !== null && word[i] === this.knownCorrect[i]) {
                            matches++;
                        }
                    }
                    return matches >= 2 && !this.possibleWords.includes(word);
                });
                if (partialMatches.length > 0) {
                    return partialMatches[Math.floor(Math.random() * partialMatches.length)];
                }
            }
            return this.possibleWords[0];
        }
        
        // If very few possibilities (2-3), sometimes pick wrong one (20% chance)
        if (this.possibleWords.length <= 3 && randomFactor < 0.2) {
            // Pick randomly from all words that share some letters
            const similarWords = this.wordList.filter(word => {
                if (this.possibleWords.includes(word)) return false;
                let matches = 0;
                for (let i = 0; i < 5; i++) {
                    if (this.knownCorrect[i] !== null && word[i] === this.knownCorrect[i]) {
                        matches++;
                    }
                }
                return matches >= 1;
            });
            if (similarWords.length > 0 && Math.random() < 0.5) {
                return similarWords[Math.floor(Math.random() * similarWords.length)];
            }
        }
        
        // Otherwise, pick randomly from a larger pool of candidates (makes it less optimal)
        // Instead of top 5, pick from top 10-20% of remaining words
        const candidatePoolSize = Math.max(
            3, 
            Math.min(
                Math.ceil(this.possibleWords.length * 0.15), // 15% of remaining words
                10
            )
        );
        const candidates = this.possibleWords
            .slice(0, candidatePoolSize)
            .sort(() => Math.random() - 0.5); // Shuffle a bit
        
        return candidates[Math.floor(Math.random() * candidates.length)];
    }
}

// Bot card selection logic - ALWAYS returns a card (unless card locked)
function botSelectCard(game, botId, botHand) {
    if (!botHand || botHand.length === 0) {
        // If no cards, draw one immediately (shouldn't happen, but safety)
        const allCardsMetadata = getAllCardsMetadata();
        if (allCardsMetadata.length > 0) {
            return allCardsMetadata[Math.floor(Math.random() * allCardsMetadata.length)];
        }
        return null; // Last resort
    }
    
    // Check if bot is card locked
    const isCardLocked = game.activeEffects.some(e => 
        e.type === 'cardLock' && e.target === botId && !e.used
    );
    if (isCardLocked) {
        return null; // Can't play cards when locked
    }
    
    // Filter available cards (remove blocked ones if any)
    let availableCards = botHand;
    if (game.blockedCards && game.blockedCards.has(botId)) {
        const blockedCardId = game.blockedCards.get(botId);
        availableCards = botHand.filter(card => card.id !== blockedCardId);
    }
    
    // Check if bot has negative effects - prioritize effectClear if available
    const hasNegativeEffects = game.activeEffects.some(e => 
        e.target === botId && !e.used && (
            e.type === 'timeRush' ||
            e.type === 'blindGuess' ||
            e.type === 'greenToGrey' ||
            e.type === 'falseFeedback' ||
            e.type === 'wordScramble' ||
            e.type === 'cardLock'
        )
    );
    
    // If bot has negative effects, prioritize effectClear if available
    if (hasNegativeEffects) {
        const effectClearCard = availableCards.find(card => card.id === 'effectClear');
        if (effectClearCard) {
            // 80% chance to use effectClear if available and has negative effects
            if (Math.random() < 0.8) {
                return effectClearCard;
            }
        }
    }
    
    // ALWAYS play a card - no random skipping
    // Prefer offensive cards if opponent is ahead, defensive if bot is ahead
    const botPlayer = game.players.find(p => p.id === botId);
    const opponent = game.players.find(p => p.id !== botId);
    const botGuesses = botPlayer ? botPlayer.guesses.length : 0;
    const opponentGuesses = opponent ? opponent.guesses.length : 0;
    const isAhead = botGuesses < opponentGuesses;
    
    if (availableCards.length === 0) {
        // All cards blocked - draw a new one
        const allCardsMetadata = getAllCardsMetadata();
        if (allCardsMetadata.length > 0) {
            return allCardsMetadata[Math.floor(Math.random() * allCardsMetadata.length)];
        }
        return null; // Last resort
    }
    
    // Simple card selection strategy
    if (isAhead) {
        // Bot is ahead - prefer defensive/helpful cards, but will use any if needed
        const helpfulCards = availableCards.filter(c => 
            ['hiddenFeedback', 'hiddenGuess', 'extraGuess', 'gamblersCard', 'effectClear'].includes(c.id)
        );
        if (helpfulCards.length > 0) {
            return helpfulCards[Math.floor(Math.random() * helpfulCards.length)];
        }
    } else {
        // Bot is behind - prefer offensive cards, but will use any if needed
        const offensiveCards = availableCards.filter(c => 
            ['falseFeedback', 'cardLock', 'blindGuess', 'timeRush', 'wordScramble'].includes(c.id)
        );
        if (offensiveCards.length > 0) {
            return offensiveCards[Math.floor(Math.random() * offensiveCards.length)];
        }
    }
    
    // Default: always return a random card from available
    return availableCards[Math.floor(Math.random() * availableCards.length)];
}

// Create a bot game
function createBotGame(humanSocket, humanName, firebaseUid = null) {
    const botId = 'BOT_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const botName = getRandomBotName();
    const gameId = generateGameId();
    const word = getRandomWord();
    
    // Create game state
    const game = {
        gameId: gameId,
        word: word,
        players: [
            {
                id: humanSocket.id,
                name: humanName,
                firebaseUid: firebaseUid || null,
                guesses: [],
                row: 0
            },
            {
                id: botId,
                name: botName,
                guesses: [],
                row: 0,
                isBot: true
            }
        ],
        currentTurn: Math.random() > 0.5 ? humanSocket.id : botId, // Random first turn
        activeEffects: [],
        status: 'waiting',
        totalGuesses: 0,
        lastPlayedCards: new Map(),
        mirroredCards: new Map(),
        isBotGame: true
    };
    
    games.set(gameId, game);
    players.set(humanSocket.id, { gameId: gameId, playerId: humanSocket.id });
    players.set(botId, { gameId: gameId, playerId: botId, isBot: true });
    
    // Initialize bot solver
    const botSolver = new BotWordleSolver(WORDS);
    
    // Join human to game room
    humanSocket.join(gameId);
    humanSocket.emit('matchmakingStatus', { status: 'matched' });
    humanSocket.emit('playerJoinedGame', { playerId: humanSocket.id, gameId: gameId });
    
    // Notify human that opponent joined
    io.to(gameId).emit('playerJoined', { players: game.players });
    
    // Initialize bot hand with random cards from all available cards
    const allCardsMetadata = getAllCardsMetadata();
    const botHand = [];
    // Draw 3 random cards for bot (similar to human)
    for (let i = 0; i < 3; i++) {
        const randomCard = allCardsMetadata[Math.floor(Math.random() * allCardsMetadata.length)];
        botHand.push(randomCard);
    }
    
    // Store bot game info (including initialized hand)
    botGames.set(gameId, {
        botId: botId,
        botSolver: botSolver,
        botHand: botHand
    });
    
    // Start the game after a delay
    setTimeout(() => {
        game.status = 'playing';
        const gameStateForClients = {
            gameId: game.gameId,
            currentTurn: game.currentTurn,
            players: game.players.map(p => ({
                id: p.id,
                name: p.name,
                firebaseUid: p.firebaseUid || null,
                guesses: p.guesses || [],
                row: p.row || 0,
                isBot: p.isBot || false
            })),
            status: game.status,
            activeEffects: game.activeEffects,
            totalGuesses: game.totalGuesses
        };
        
        console.log('Bot game starting. Players with firebaseUid:', gameStateForClients.players.map(p => ({ name: p.name, firebaseUid: p.firebaseUid })));
        
        // Send game started to human
        console.log(`Sending gameStarted (bot) to ${humanSocket.id} with players:`, gameStateForClients.players.map(p => ({ name: p.name, firebaseUid: p.firebaseUid })));
        humanSocket.emit('gameStarted', {
            ...gameStateForClients,
            yourPlayerId: humanSocket.id
        });
        
        // Track user's game for friend status
        if (firebaseUid) {
            userToGame.set(firebaseUid, gameId);
            console.log('Bot game started: Tracked user', firebaseUid, 'in game', gameId);
        }
        
        // If it's the bot's turn, process it
        if (game.currentTurn === botId) {
            processBotTurn(gameId);
        }
    }, 1500);
}

// Process bot's turn
function processBotTurn(gameId) {
    const game = games.get(gameId);
    if (!game || game.status !== 'playing') return;
    
    const botData = botGames.get(gameId);
    if (!botData) return;
    
    const botId = botData.botId;
    const botSolver = botData.botSolver;
    
    if (game.currentTurn !== botId) {
        return; // Not bot's turn
    }
    
    // Get bot player
    const botPlayer = game.players.find(p => p.id === botId);
    if (!botPlayer) return;
    
    // Human-like delay: 5-12 seconds to "think" (longer for more realism)
    const thinkTime = 5000 + Math.random() * 7000;
    
    setTimeout(() => {
        // Check if game still exists and it's still bot's turn
        const currentGame = games.get(gameId);
        if (!currentGame || currentGame.currentTurn !== botId || currentGame.status !== 'playing') {
            return;
        }
        
        // ALWAYS select a card - bot must play a card every turn
        let selectedCard = null;
        if (botData.botHand && botData.botHand.length > 0) {
            selectedCard = botSelectCard(currentGame, botId, botData.botHand);
        }
        
        // If bot selected a card (should always happen unless card locked), simulate card selection
        if (selectedCard) {
            // Handle modifier cards (phonyCard, hideCard)
            const cardIsModifier = isModifierCard(selectedCard.id);
            
            if (cardIsModifier) {
                // For modifier cards, select a second card
                const remainingCards = botData.botHand.filter(c => c.id !== selectedCard.id);
                if (remainingCards.length > 0) {
                    // Select a random card to combine with modifier
                    const secondCard = remainingCards[Math.floor(Math.random() * remainingCards.length)];
                    // Store the card chain
                    if (!currentGame.cardChains) {
                        currentGame.cardChains = new Map();
                    }
                    currentGame.cardChains.set(botId, [selectedCard, secondCard]);
                    selectedCard = secondCard; // The real card to use
                }
            }
            
            // Remove used card from bot hand and draw new one
            const cardIndex = botData.botHand.findIndex(c => c.id === selectedCard.id);
            if (cardIndex !== -1) {
                botData.botHand.splice(cardIndex, 1);
                // Draw new card
                const allCardsMetadata = getAllCardsMetadata();
                const newCard = allCardsMetadata[Math.floor(Math.random() * allCardsMetadata.length)];
                botData.botHand.push(newCard);
            }
            
            // Track the last played card for this bot
            if (!currentGame.lastPlayedCards) {
                currentGame.lastPlayedCards = new Map();
            }
            
            // If Card Mirror, store what card it's actually mirroring (opponent's last card at this moment)
            const opponent = currentGame.players.find(p => p.id !== botId);
            if (selectedCard.id === 'cardMirror' && opponent) {
                if (!currentGame.mirroredCards) {
                    currentGame.mirroredCards = new Map();
                }
                const opponentLastCard = currentGame.lastPlayedCards.get(opponent.id);
                if (opponentLastCard) {
                    currentGame.mirroredCards.set(botId, opponentLastCard);
                }
            }
            currentGame.lastPlayedCards.set(botId, selectedCard);
            
            // Check if this is an effect clear card - remove all active effects on the bot
            if (selectedCard.id === 'effectClear') {
                // Count effects before clearing (log them for debugging)
                const effectsBefore = currentGame.activeEffects.filter(e => e.target === botId && !e.used);
                const effectTypes = effectsBefore.map(e => e.type);
                
                console.log(`Effect Clear (Bot): Bot ${botId} playing Purge. Current active effects targeting them:`, effectTypes);
                
                // Remove all active effects targeting this bot
                const effectsAfter = currentGame.activeEffects.filter(e => {
                    // Keep effects that don't target this bot, or are already used
                    if (e.target !== botId || e.used) {
                        return true;
                    }
                    // Remove all effects targeting this bot
                    console.log(`Effect Clear (Bot): Removing effect ${e.type} from bot ${botId}`);
                    return false;
                });
                
                currentGame.activeEffects = effectsAfter;
                
                // Also clear blocked card if any
                if (currentGame.blockedCards && currentGame.blockedCards.has(botId)) {
                    currentGame.blockedCards.delete(botId);
                    console.log(`Effect Clear (Bot): Cleared blocked card for bot ${botId}`);
                }
                
                // Notify if effects were cleared
                if (effectsBefore.length > 0) {
                    console.log(`Effect Clear (Bot): Successfully removed ${effectsBefore.length} active effect(s) from bot ${botId}`);
                    
                    // Notify human opponent with updated active effects
                    if (opponent) {
                        const humanSocket = io.sockets.sockets.get(opponent.id);
                        if (humanSocket) {
                            humanSocket.emit('activeEffectsUpdated', {
                                activeEffects: currentGame.activeEffects,
                                gameId: gameId
                            });
                            humanSocket.emit('opponentEffectsCleared', {
                                playerName: botPlayerForCard.name,
                                count: effectsBefore.length
                            });
                        }
                    }
                } else {
                    console.log(`Effect Clear (Bot): No active effects to clear for bot ${botId}`);
                }
            }
            
            // Emit card played event for human to see
            const botPlayerForCard = currentGame.players.find(p => p.id === botId);
            if (botPlayerForCard) {
                const humanSocket = io.sockets.sockets.get(currentGame.players.find(p => p.id !== botId).id);
                if (humanSocket) {
                    // Show card to opponent (might be fake if phonyCard was used, or resolved if mirror card)
                    const splashBehavior = getSplashBehavior(selectedCard.id);
                    if (splashBehavior === 'show') {
                        // If cardMirror, show the opponent's last card instead (following Card Mirror chains)
                        let cardToShow = selectedCard;
                        if (selectedCard.id === 'cardMirror' && opponent) {
                            const resolvedCard = resolveMirroredCard(currentGame, opponent.id);
                            if (resolvedCard) {
                                cardToShow = resolvedCard;
                            }
                        }
                        
                        humanSocket.emit('cardPlayed', {
                            card: cardToShow,
                            playerName: botPlayerForCard.name,
                            playerId: botId
                        });
                        
                        // Send system notification to chat
                        const cardName = getCardDisplayName(cardToShow);
                        sendSystemChatMessage(currentGame.gameId, `${botPlayerForCard.name} played ${cardName}`);
                    }
                }
            }
        }
        
        // Now wait additional time for the bot to "think" about what word to guess
        // This simulates the human behavior of thinking after selecting a card
        const wordThinkTime = 3000 + Math.random() * 5000; // 3-8 seconds to think about the word
        
        setTimeout(() => {
            // Check if game still exists and it's still bot's turn
            const currentGameCheck = games.get(gameId);
            if (!currentGameCheck || currentGameCheck.currentTurn !== botId || currentGameCheck.status !== 'playing') {
                return;
            }
            
            // Make a word guess
            let guess;
            let extraThinkTime = 0;
            
            if (botPlayer.guesses.length === 0) {
                // First guess: use a common starter word
                const starterWords = ['APPLE', 'ARISE', 'AUDIO', 'EARTH', 'STARE', 'CRANE', 'SLATE', 'TRACE'];
                guess = starterWords[Math.floor(Math.random() * starterWords.length)];
            } else {
                // Use solver to get best guess (now less optimal)
                guess = botSolver.getBestGuess();
                
                // Occasionally add extra delay to "think harder" (seems more human)
                if (Math.random() < 0.4 && currentGameCheck.totalGuesses > 2) {
                    extraThinkTime = 2000 + Math.random() * 3000;
                }
            }
            
            // Simulate typing time - humans take time to type out the word
            // Typing delay: ~100-200ms per letter, plus some variation
            const typingDelay = (guess.length * 100) + Math.random() * (guess.length * 100) + extraThinkTime;
            
            // Submit the guess after typing delay
            setTimeout(() => {
                submitBotGuess(gameId, botId, guess, selectedCard);
            }, typingDelay);
            
        }, wordThinkTime);
        
    }, thinkTime);
}

// Submit bot's guess (similar to human submitGuess)
function submitBotGuess(gameId, botId, guess, card) {
    const game = games.get(gameId);
    if (!game || game.currentTurn !== botId) return;
    
    const botPlayer = game.players.find(p => p.id === botId);
    if (!botPlayer) return;
    
    // Calculate feedback
    const realFeedback = calculateFeedback(guess, game.word);
    
    // Update bot's solver knowledge
    const botData = botGames.get(gameId);
    if (botData && botData.botSolver) {
        botData.botSolver.updateKnowledge(guess, realFeedback);
    }
    
    // Store guess
    const boardRow = game.totalGuesses;
    botPlayer.guesses.push({
        guess: guess,
        feedback: realFeedback,
        row: boardRow
    });
    game.totalGuesses++;
    
    // Handle card chain if exists (from modifier cards)
    let actualCard = card;
    if (game.cardChains && game.cardChains.has(botId)) {
        const cardChain = game.cardChains.get(botId);
        const realCard = cardChain[cardChain.length - 1]; // Last card is always real
        const { cardToShowOpponent, shouldHideFromOpponent } = processCardChain(cardChain, realCard);
        actualCard = realCard;
        
        // Store real card if phonyCard was used
        if (cardChain.some(c => needsRealCardStorage(c.id))) {
            if (!game.phonyCardRealCards) {
                game.phonyCardRealCards = new Map();
            }
            game.phonyCardRealCards.set(botId, realCard);
        }
        
        // Clear card chain
        game.cardChains.delete(botId);
    }
    
    // Apply card effects using actual card (not fake one)
    if (actualCard && CARD_CONFIG[actualCard.id]) {
        const config = CARD_CONFIG[actualCard.id];
        if (!isModifierCard(actualCard.id) && config.effects?.onGuess) {
            config.effects.onGuess(game, botId);
        }
    }
    
    // Track last played card
    if (!game.lastPlayedCards) {
        game.lastPlayedCards = new Map();
    }
    game.lastPlayedCards.set(botId, actualCard);
    
    // Check for win
    if (guess === game.word) {
        game.status = 'finished';
        
        // Clean up bot game if it's a bot game
        if (game.isBotGame) {
            botGames.delete(gameId);
        }
        
        // Find opponent (human)
        const opponent = game.players.find(p => p.id !== botId);
        if (!opponent) return;
        
        // First, send the winning guess so it displays on the board
        // Then delay gameOver to allow the animation to complete
        const opponentSocket = io.sockets.sockets.get(opponent.id);
        if (opponentSocket) {
            const shouldHideGuess = game.activeEffects.some(e => 
                e.type === 'hiddenGuess' && e.target === botId && !e.used
            );
            const shouldHideFeedback = game.activeEffects.some(e => 
                e.type === 'hiddenFeedback' && e.target === botId && !e.used
            );
            const falseFeedbackActive = game.activeEffects.some(e => 
                e.type === 'falseFeedback' && e.target === botId && !e.used
            );
            
            let opponentFeedback = shouldHideFeedback ? 
                ['absent', 'absent', 'absent', 'absent', 'absent'] : realFeedback;
            
            if (falseFeedbackActive) {
                opponentFeedback = applyCardEffect(realFeedback, { id: 'falseFeedback' }, true);
            }
            
            // Send winning guess to human player
            opponentSocket.emit('guessSubmitted', {
                playerId: botId,
                guess: shouldHideGuess ? null : guess,
                feedback: opponentFeedback,
                row: boardRow,
                hidden: shouldHideGuess
            });
        }
        
            // Delay gameOver to allow the winning guess animation to complete (2 seconds)
            setTimeout(() => {
            game.status = 'finished';
            // Clean up user-to-game tracking
            game.players.forEach(player => {
                if (player.firebaseUid) {
                    userToGame.delete(player.firebaseUid);
                }
            });
            io.to(gameId).emit('gameOver', {
                winner: botId,
                word: game.word,
                gameId: gameId
            });
            }, 2000);
        return;
    }
    
    // Find opponent (human)
    const opponent = game.players.find(p => p.id !== botId);
    if (!opponent) return;
    
    // Check active effects
    const shouldHideGuess = game.activeEffects.some(e => 
        e.type === 'hiddenGuess' && e.target === botId && !e.used
    );
    const shouldHideFeedback = game.activeEffects.some(e => 
        e.type === 'hiddenFeedback' && e.target === botId && !e.used
    );
    const falseFeedbackActive = game.activeEffects.some(e => 
        e.type === 'falseFeedback' && e.target === botId && !e.used
    );
    
    // Send to human (opponent)
    const opponentSocket = io.sockets.sockets.get(opponent.id);
    if (opponentSocket) {
        let opponentFeedback = shouldHideFeedback ? 
            ['absent', 'absent', 'absent', 'absent', 'absent'] : realFeedback;
        
        if (falseFeedbackActive) {
            opponentFeedback = applyCardEffect(realFeedback, { id: 'falseFeedback' }, true);
        }
        
        opponentSocket.emit('guessSubmitted', {
            playerId: botId,
            guess: shouldHideGuess ? null : guess,
            feedback: opponentFeedback,
            row: boardRow,
            hidden: shouldHideGuess
        });
        
        // Also send to spectators
        const gameSpectators = spectators.get(gameId);
        if (gameSpectators && gameSpectators.size > 0) {
            gameSpectators.forEach(spectatorSocketId => {
                const spectatorSocket = io.sockets.sockets.get(spectatorSocketId);
                if (spectatorSocket) {
                    spectatorSocket.emit('guessSubmitted', {
                        playerId: botId,
                        guess: guess,
                        feedback: realFeedback,
                        row: boardRow,
                        hidden: false  // Spectators see all guesses
                    });
                }
            });
        }
    }
    
    // Check for extra guess
    const isExtraGuess = game.activeEffects.some(e => 
        e.type === 'extraGuess' && e.target === botId && !e.used
    );
    
    // Remove used effects
    game.activeEffects = game.activeEffects.filter(e => {
        if (e.target === botId && (
            e.type === 'hiddenGuess' || 
            e.type === 'hiddenFeedback' || 
            e.type === 'falseFeedback' ||
            e.type === 'extraGuess' ||
            e.type === 'cardLock'
        )) {
            return false;
        }
        return true;
    });
    
    // Switch turns
    if (!isExtraGuess) {
        game.currentTurn = opponent.id;
    } else {
        game.activeEffects = game.activeEffects.filter(e => 
            !(e.type === 'extraGuess' && e.target === botId)
        );
        game.currentTurn = botId; // Bot gets another turn
    }
    
    // Emit turn change
    const humanSocket = io.sockets.sockets.get(opponent.id);
    if (humanSocket) {
        humanSocket.emit('turnChanged', {
            currentTurn: game.currentTurn,
            players: game.players,
            status: game.status,
            activeEffects: game.activeEffects,
            totalGuesses: game.totalGuesses,
            yourPlayerId: opponent.id
        });
    }
    
    // If it's still bot's turn (extra guess), process again
    if (game.currentTurn === botId) {
        setTimeout(() => processBotTurn(gameId), 1000);
    }
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
            name: data.playerName,
            firebaseUid: data.firebaseUid || null
        };
        
        matchmakingQueue.push(player);
        socket.emit('matchmakingStatus', { status: 'searching' });
        
        console.log(`Player ${data.playerName} (${socket.id}) joined matchmaking queue. Queue size: ${matchmakingQueue.length}`);
        
        // Set timeout to match with bot if no player found (20 seconds)
        const botTimeout = setTimeout(() => {
            const queueIndex = matchmakingQueue.findIndex(p => p.id === socket.id);
            if (queueIndex === -1) return; // Already matched
            
            const queuedPlayer = matchmakingQueue[queueIndex];
            matchmakingQueue.splice(queueIndex, 1);
            matchmakingTimeouts.delete(socket.id);
            
            console.log(`No match found for ${data.playerName}, creating bot game...`);
            createBotGame(socket, data.playerName, queuedPlayer.firebaseUid || null);
        }, 20000); // 20 second timeout
        
        matchmakingTimeouts.set(socket.id, botTimeout);
        
        // Check if we can match players
        if (matchmakingQueue.length >= 2) {
            // Match the first two players
            const player1 = matchmakingQueue.shift();
            const player2 = matchmakingQueue.shift();
            
            // Clear bot timeouts for matched players
            const timeout1 = matchmakingTimeouts.get(player1.id);
            const timeout2 = matchmakingTimeouts.get(player2.id);
            if (timeout1) {
                clearTimeout(timeout1);
                matchmakingTimeouts.delete(player1.id);
            }
            if (timeout2) {
                clearTimeout(timeout2);
                matchmakingTimeouts.delete(player2.id);
            }
            
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
                        firebaseUid: player1.firebaseUid || null,
                        guesses: [],
                        row: 0
                    },
                    {
                        id: player2.id,
                        name: player2.name,
                        firebaseUid: player2.firebaseUid || null,
                        guesses: [],
                        row: 0
                    }
                ],
                currentTurn: player1.id, // Randomly choose first player (or could use Math.random())
                activeEffects: [],
                status: 'waiting',
                totalGuesses: 0,
                lastPlayedCards: new Map(),  // Track last card played by each player
                mirroredCards: new Map()  // Track what card each Card Mirror actually mirrored (playerId -> card)
            };
            
            games.set(gameId, game);
            players.set(player1.id, { gameId: gameId, playerId: player1.id });
            players.set(player2.id, { gameId: gameId, playerId: player2.id });
            
            // Track users' games for friend status (even when waiting)
            if (player1.firebaseUid) {
                userToGame.set(player1.firebaseUid, gameId);
                console.log('Matchmade game created: Tracked user', player1.firebaseUid, 'in game', gameId, '(waiting)');
            }
            if (player2.firebaseUid) {
                userToGame.set(player2.firebaseUid, gameId);
                console.log('Matchmade game created: Tracked user', player2.firebaseUid, 'in game', gameId, '(waiting)');
            }
            
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
                console.log('Players with firebaseUid:', game.players.map(p => ({ id: p.id, name: p.name, firebaseUid: p.firebaseUid })));
                const gameStateForClients = {
                    gameId: game.gameId,
                    currentTurn: game.currentTurn,
                    players: game.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        firebaseUid: p.firebaseUid || null,
                        guesses: p.guesses || [],
                        row: p.row || 0,
                        isBot: p.isBot || false
                    })),
                    status: game.status,
                    activeEffects: game.activeEffects,
                    totalGuesses: game.totalGuesses
                };
                
                game.players.forEach(player => {
                    const playerSocket = io.sockets.sockets.get(player.id);
                    if (playerSocket) {
                        console.log(`Sending gameStarted to ${player.id} (${player.name}) with players:`, gameStateForClients.players.map(p => ({ name: p.name, firebaseUid: p.firebaseUid })));
                        playerSocket.emit('gameStarted', {
                            ...gameStateForClients,
                            yourPlayerId: player.id
                        });
                        // Track user's game for friend status
                        if (player.firebaseUid) {
                            userToGame.set(player.firebaseUid, game.gameId);
                            console.log('Matchmade game started: Tracked user', player.firebaseUid, 'in game', game.gameId);
                        }
                    }
                });
            }, 1000);
        }
    });
    
    socket.on('cancelMatchmaking', () => {
        const index = matchmakingQueue.findIndex(p => p.id === socket.id);
        if (index !== -1) {
            matchmakingQueue.splice(index, 1);
            
            // Clear bot timeout
            const timeout = matchmakingTimeouts.get(socket.id);
            if (timeout) {
                clearTimeout(timeout);
                matchmakingTimeouts.delete(socket.id);
            }
            
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
                firebaseUid: data.firebaseUid || null,
                guesses: [],
                row: 0
            }],
            currentTurn: socket.id,
            activeEffects: [],
            status: 'waiting',
            totalGuesses: 0,  // Shared counter for board rows
            lastPlayedCards: new Map(),  // Track last card played by each player
            mirroredCards: new Map()  // Track what card each Card Mirror actually mirrored (playerId -> card)
        };
        
        games.set(gameId, game);
        players.set(socket.id, { gameId: gameId, playerId: socket.id });
        
        // Track user's game for friend status (even when waiting)
        if (data.firebaseUid) {
            userToGame.set(data.firebaseUid, gameId);
            console.log('Game created: Tracked user', data.firebaseUid, 'in game', gameId, '(waiting)');
        }
        
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
            firebaseUid: data.firebaseUid || null,
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
                console.log('Players with firebaseUid:', game.players.map(p => ({ id: p.id, name: p.name, firebaseUid: p.firebaseUid })));
                const gameStateForClients = {
                    gameId: game.gameId,
                    currentTurn: game.currentTurn,
                    players: game.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        firebaseUid: p.firebaseUid || null,
                        guesses: p.guesses || [],
                        row: p.row || 0,
                        isBot: p.isBot || false
                    })),
                    status: game.status,
                    activeEffects: game.activeEffects,
                    totalGuesses: game.totalGuesses
                };
                // Send gameStarted to all players, but include each player's own ID
                game.status = 'playing';
                game.players.forEach(player => {
                    const playerSocket = io.sockets.sockets.get(player.id);
                    if (playerSocket) {
                        console.log(`Sending gameStarted to ${player.id} (${player.name}) with players:`, gameStateForClients.players.map(p => ({ name: p.name, firebaseUid: p.firebaseUid })));
                        playerSocket.emit('gameStarted', {
                            ...gameStateForClients,
                            yourPlayerId: player.id  // Include the player's own ID
                        });
                        // Track user's game for friend status
                        if (player.firebaseUid) {
                            userToGame.set(player.firebaseUid, game.gameId);
                            console.log('Game started: Tracked user', player.firebaseUid, 'in game', game.gameId);
                        } else {
                            console.log('Game started: Player', player.id, 'has no firebaseUid');
                        }
                    }
                });
            }, 1000);
        }
    });
    
    socket.on('checkFriendsInGames', async (data) => {
        // Check which friends (by firebaseUid) are currently in games
        console.log('checkFriendsInGames: Received request for', data.friendIds?.length || 0, 'friends');
        console.log('checkFriendsInGames: userToGame map has', userToGame.size, 'entries');
        console.log('checkFriendsInGames: Current games:', Array.from(games.keys()));
        
        if (!data.friendIds || !Array.isArray(data.friendIds)) {
            socket.emit('friendsInGames', { friendsInGames: {} });
            return;
        }
        
        const friendsInGames = {};
        
        // Check each friend's game status
        data.friendIds.forEach(friendFirebaseUid => {
            const gameId = userToGame.get(friendFirebaseUid);
            console.log('checkFriendsInGames: Friend', friendFirebaseUid, 'is in game:', gameId);
            
            if (gameId) {
                const game = games.get(gameId);
                console.log('checkFriendsInGames: Game', gameId, 'exists:', !!game, 'status:', game?.status);
                
                if (game && (game.status === 'playing' || game.status === 'waiting')) {
                    friendsInGames[friendFirebaseUid] = {
                        gameId: gameId,
                        status: game.status,
                        players: game.players.map(p => ({
                            id: p.id,
                            name: p.name,
                            firebaseUid: p.firebaseUid
                        }))
                    };
                    console.log('checkFriendsInGames: Added friend', friendFirebaseUid, 'to friendsInGames');
                } else {
                    // Game ended or doesn't exist, remove from tracking
                    userToGame.delete(friendFirebaseUid);
                    console.log('checkFriendsInGames: Removed friend', friendFirebaseUid, 'from tracking (game ended)');
                }
            }
        });
        
        console.log('checkFriendsInGames: Returning', Object.keys(friendsInGames).length, 'friends in games');
        socket.emit('friendsInGames', { friendsInGames: friendsInGames });
    });
    
    socket.on('spectateGame', (data) => {
        const game = games.get(data.gameId);
        
        if (!game) {
            socket.emit('error', { message: 'Game not found' });
            return;
        }
        
        // Check if game is in a viewable state
        if (game.status !== 'playing' && game.status !== 'waiting') {
            socket.emit('error', { message: 'Game is not currently active' });
            return;
        }
        
        // Initialize spectators set for this game if needed
        if (!spectators.has(data.gameId)) {
            spectators.set(data.gameId, new Set());
        }
        
        // Add spectator to the game
        spectators.get(data.gameId).add(socket.id);
        socket.join(data.gameId);
        
        // Get spectator name if available (from data or player record)
        let spectatorName = 'Someone';
        if (data.spectatorName) {
            spectatorName = data.spectatorName;
        } else {
            // Try to get name from players map if spectator was previously a player
            const playerRecord = players.get(socket.id);
            if (playerRecord && playerRecord.name) {
                spectatorName = playerRecord.name;
            }
        }
        
        // Send system message to players that someone is spectating
        sendSystemChatMessage(data.gameId, `${spectatorName} is now spectating the game`);
        
        // Send current game state to spectator
        const spectatorGameState = {
            gameId: game.gameId,
            players: game.players.map(p => ({
                id: p.id,
                name: p.name,
                guesses: p.guesses,
                row: p.row
            })),
            currentTurn: game.currentTurn,
            status: game.status,
            totalGuesses: game.totalGuesses,
            activeEffects: game.activeEffects,
            word: game.word, // Spectators can see the word
            isSpectator: true
        };
        
        socket.emit('gameStateForSpectator', spectatorGameState);
        
        console.log(`Spectator ${socket.id} (${spectatorName}) joined game ${data.gameId}`);
    });
    
    socket.on('leaveSpectate', (data) => {
        const gameId = data.gameId;
        
        // Remove spectator from the game
        if (spectators.has(gameId)) {
            spectators.get(gameId).delete(socket.id);
            if (spectators.get(gameId).size === 0) {
                spectators.delete(gameId);
            }
        }
        
        socket.leave(gameId);
        console.log(`Spectator ${socket.id} left game ${gameId}`);
    });
    
    socket.on('requestRematch', (data) => {
        console.log(`Rematch requested by ${socket.id} for game ${data.gameId}`);
        const game = games.get(data.gameId);
        if (!game) {
            console.log(`Game ${data.gameId} not found`);
            socket.emit('error', { message: 'Game not found' });
            return;
        }
        
        // Check if player was in this game
        const player = game.players.find(p => p.id === socket.id);
        if (!player) {
            console.log(`Player ${socket.id} was not in game ${data.gameId}`);
            socket.emit('error', { message: 'You were not in this game' });
            return;
        }
        
        // Initialize rematch requests for this game if needed
        if (!rematchRequests.has(data.gameId)) {
            rematchRequests.set(data.gameId, new Set());
        }
        
        const requests = rematchRequests.get(data.gameId);
        requests.add(socket.id);
        console.log(`Rematch requests for game ${data.gameId}:`, Array.from(requests), `(${requests.size}/${game.players.length})`);
        
        // Notify all players about the rematch request
        game.players.forEach(p => {
            const playerSocket = io.sockets.sockets.get(p.id);
            if (playerSocket) {
                playerSocket.emit('rematchRequested', {
                    playerId: socket.id,
                    playerName: player.name || 'Player'
                });
            }
        });
        
        // Check if both players have requested rematch
        if (requests.size >= 2 && game.players.length === 2) {
            console.log(`Both players requested rematch for game ${data.gameId}, creating new game...`);
            // Both players want rematch - create new game
            const player1 = game.players[0];
            const player2 = game.players[1];
            
            // Create new game
            const newGameId = generateGameId();
            const newWord = getRandomWord();
            
            const newGame = {
                gameId: newGameId,
                word: newWord,
                players: [
                    {
                        id: player1.id,
                        name: player1.name,
                        firebaseUid: player1.firebaseUid || null,
                        guesses: [],
                        row: 0
                    },
                    {
                        id: player2.id,
                        name: player2.name,
                        firebaseUid: player2.firebaseUid || null,
                        guesses: [],
                        row: 0
                    }
                ],
                currentTurn: Math.random() > 0.5 ? player1.id : player2.id,
                activeEffects: [],
                status: 'waiting',
                totalGuesses: 0,
                lastPlayedCards: new Map(),
                mirroredCards: new Map(),
                spectators: []
            };
            
            games.set(newGameId, newGame);
            players.set(player1.id, { gameId: newGameId, playerId: player1.id });
            players.set(player2.id, { gameId: newGameId, playerId: player2.id });
            
            // Track users' games for friend status
            if (player1.firebaseUid) {
                userToGame.set(player1.firebaseUid, newGameId);
            }
            if (player2.firebaseUid) {
                userToGame.set(player2.firebaseUid, newGameId);
            }
            
            // Join both players to the new game room
            const player1Socket = io.sockets.sockets.get(player1.id);
            const player2Socket = io.sockets.sockets.get(player2.id);
            
            if (player1Socket) {
                player1Socket.leave(data.gameId);
                player1Socket.join(newGameId);
            }
            
            if (player2Socket) {
                player2Socket.leave(data.gameId);
                player2Socket.join(newGameId);
            }
            
            // Notify both players
            io.to(newGameId).emit('playerJoined', { players: newGame.players });
            
            // Clean up old game and rematch requests
            games.delete(data.gameId);
            rematchRequests.delete(data.gameId);
            
            // Start the new game
            setTimeout(() => {
                newGame.status = 'playing';
                const gameStateForClients = {
                    gameId: newGame.gameId,
                    currentTurn: newGame.currentTurn,
                    players: newGame.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        firebaseUid: p.firebaseUid || null,
                        guesses: p.guesses || [],
                        row: p.row || 0,
                        isBot: p.isBot || false
                    })),
                    status: newGame.status,
                    activeEffects: newGame.activeEffects,
                    totalGuesses: newGame.totalGuesses
                };
                
                console.log('Rematch game starting. Players with firebaseUid:', gameStateForClients.players.map(p => ({ name: p.name, firebaseUid: p.firebaseUid })));
                
                newGame.players.forEach(player => {
                    const playerSocket = io.sockets.sockets.get(player.id);
                    if (playerSocket) {
                        console.log(`Sending gameStarted (rematch) to ${player.id} (${player.name}) with players:`, gameStateForClients.players.map(p => ({ name: p.name, firebaseUid: p.firebaseUid })));
                        playerSocket.emit('gameStarted', {
                            ...gameStateForClients,
                            yourPlayerId: player.id
                        });
                    }
                });
            }, 1000);
            
            // Notify players that rematch was accepted
            if (player1Socket) {
                player1Socket.emit('rematchAccepted', { gameId: newGameId });
                console.log(`Sent rematchAccepted to player1 ${player1.id}`);
            }
            if (player2Socket) {
                player2Socket.emit('rematchAccepted', { gameId: newGameId });
                console.log(`Sent rematchAccepted to player2 ${player2.id}`);
            }
            
            console.log(`Rematch game ${newGameId} created successfully`);
        } else {
            console.log(`Not enough rematch requests: ${requests.size} < 2, or game has ${game.players.length} players`);
        }
    });
    
    socket.on('cancelRematch', (data) => {
        if (rematchRequests.has(data.gameId)) {
            const requests = rematchRequests.get(data.gameId);
            requests.delete(socket.id);
            
            // Notify other players that rematch was cancelled
            const game = games.get(data.gameId);
            if (game) {
                game.players.forEach(p => {
                    if (p.id !== socket.id) {
                        const playerSocket = io.sockets.sockets.get(p.id);
                        if (playerSocket) {
                            playerSocket.emit('rematchCancelled');
                        }
                    }
                });
            }
            
            // Clean up if no requests left
            if (requests.size === 0) {
                rematchRequests.delete(data.gameId);
            }
        }
    });
    
    // Username management
    const usernames = new Map(); // username -> firebaseUid (for quick lookup)
    
    // Load existing usernames from Firestore on server start
    // Note: This would require Firebase Admin SDK. For now, we'll check via client Firestore.
    
    socket.on('checkUsernameAvailable', async (data) => {
        const { username, firebaseUid } = data;
        
        if (!username || username.trim().length === 0) {
            socket.emit('usernameCheckResult', { available: false, message: 'Username cannot be empty' });
            return;
        }
        
        // Validate username format (alphanumeric, underscore, hyphen, 3-20 chars)
        const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
        if (!usernameRegex.test(username.trim())) {
            socket.emit('usernameCheckResult', { 
                available: false, 
                message: 'Username must be 3-20 characters and contain only letters, numbers, underscores, or hyphens' 
            });
            return;
        }
        
        // Check if username is already taken
        // We'll use a Firestore query via the client, but for server-side we can track in memory
        // For production, you'd want to use Firebase Admin SDK
        socket.emit('usernameCheckResult', { 
            available: true, 
            message: 'Username is available',
            username: username.trim()
        });
    });
    
    socket.on('updateUsername', async (data) => {
        const { username, firebaseUid } = data;
        
        if (!username || !firebaseUid) {
            socket.emit('usernameUpdateResult', { success: false, message: 'Missing username or user ID' });
            return;
        }
        
        // Validate username format
        const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
        if (!usernameRegex.test(username.trim())) {
            socket.emit('usernameUpdateResult', { 
                success: false, 
                message: 'Invalid username format' 
            });
            return;
        }
        
        // Update in-memory tracking
        const trimmedUsername = username.trim().toLowerCase();
        const existingUid = usernames.get(trimmedUsername);
        if (existingUid && existingUid !== firebaseUid) {
            socket.emit('usernameUpdateResult', { 
                success: false, 
                message: 'Username is already taken' 
            });
            return;
        }
        
        // Remove old username from map if it exists
        for (const [uname, uid] of usernames.entries()) {
            if (uid === firebaseUid) {
                usernames.delete(uname);
                break;
            }
        }
        
        // Add new username
        usernames.set(trimmedUsername, firebaseUid);
        
        socket.emit('usernameUpdateResult', { 
            success: true, 
            message: 'Username updated successfully',
            username: username.trim()
        });
    });
    
    socket.on('cancelPrivateGame', () => {
        const playerData = players.get(socket.id);
        if (!playerData) {
            socket.emit('privateGameCancelled', { success: false, message: 'You are not in a game' });
            return;
        }
        
        const game = games.get(playerData.gameId);
        if (!game) {
            socket.emit('privateGameCancelled', { success: false, message: 'Game not found' });
            players.delete(socket.id);
            return;
        }
        
        // Only allow cancellation if game hasn't started (status is 'waiting')
        if (game.status !== 'waiting') {
            socket.emit('privateGameCancelled', { success: false, message: 'Game has already started' });
            return;
        }
        
        // Remove player from game
        game.players = game.players.filter(p => p.id !== socket.id);
        players.delete(socket.id);
        socket.leave(playerData.gameId);
        
        // If only one player left (or none), delete the game and notify remaining player
        if (game.players.length <= 1) {
            // Notify remaining player if there is one
            if (game.players.length === 1) {
                const remainingPlayer = game.players[0];
                const remainingSocket = io.sockets.sockets.get(remainingPlayer.id);
                if (remainingSocket) {
                    remainingSocket.emit('playerLeftPrivateGame', { 
                        message: 'Other player left the game',
                        gameId: playerData.gameId
                    });
                }
            }
            
            // Delete the game
            games.delete(playerData.gameId);
        } else {
            // Notify other players that this player left
            io.to(playerData.gameId).emit('playerLeft', { 
                playerId: socket.id,
                players: game.players
            });
        }
        
        socket.emit('privateGameCancelled', { success: true, message: 'Game cancelled successfully' });
        console.log(`Player ${socket.id} cancelled private game ${playerData.gameId}`);
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
        
        // Check if the selected card is blocked
        if (game.blockedCards && game.blockedCards.has(socket.id)) {
            const blockedCardId = game.blockedCards.get(socket.id);
            if (data.card.id === blockedCardId) {
                socket.emit('error', { message: 'This card is blocked and cannot be used!' });
                return;
            }
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
                
                // Send system notification to chat
                const cardName = getCardDisplayName(data.card);
                sendSystemChatMessage(data.gameId, `${player ? player.name : 'Player'} played ${cardName}`);
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
            console.log('Stored real card for phony card chain. Player:', socket.id, 'Real card:', realCard.id, 'Chain cards:', cardChain.map(c => c.id));
        }
        
        // Check if this is a hand reveal card - trigger it immediately
        if (realCard.id === 'handReveal' && opponent) {
            // Check if opponent is a bot
            if (opponent.isBot) {
                // Bot's hand is stored in botGames
                const botData = botGames.get(data.gameId);
                if (botData && botData.botHand) {
                    const requesterSocket = io.sockets.sockets.get(socket.id);
                    if (requesterSocket) {
                        requesterSocket.emit('opponentHandRevealed', {
                            cards: botData.botHand.slice(0, 3).map(card => ({
                                id: card.id,
                                title: card.title,
                                description: card.description
                            })),
                            opponentName: opponent.name
                        });
                    }
                }
            } else {
            const opponentSocket = io.sockets.sockets.get(opponent.id);
            if (opponentSocket) {
                opponentSocket.emit('requestHand', {
                    gameId: data.gameId,
                    requesterId: socket.id
                });
                }
            }
        }
        
        // Check if this is a card steal card - trigger it immediately
        if (realCard.id === 'cardSteal' && opponent) {
            // Check if opponent is a bot
            if (opponent.isBot) {
                // Bot's hand is stored in botGames
                const botData = botGames.get(data.gameId);
                if (botData && botData.botHand) {
                    const requesterSocket = io.sockets.sockets.get(socket.id);
                    if (requesterSocket) {
                        requesterSocket.emit('opponentHandForSteal', {
                            cards: botData.botHand.slice(0, 3).map(card => ({
                                id: card.id,
                                title: card.title,
                                description: card.description
                            })),
                            opponentName: opponent.name,
                            gameId: data.gameId
                        });
                    }
                }
            } else {
            const opponentSocket = io.sockets.sockets.get(opponent.id);
            if (opponentSocket) {
                opponentSocket.emit('requestHandForSteal', {
                    gameId: data.gameId,
                    requesterId: socket.id
                });
                }
            }
        }
        
        // Show splash based on config (for the player who played it)
        // If cardMirror, show the opponent's last card instead (following Card Mirror chains)
        let cardForSplash = realCard;
        if (realCard.id === 'cardMirror' && opponent) {
            const resolvedCard = resolveMirroredCard(game, opponent.id);
            if (resolvedCard) {
                cardForSplash = resolvedCard;
            }
        }
        
        const splashBehavior = getSplashBehavior(realCard.id);
        if (splashBehavior === 'show' && !shouldHideFromOpponent) {
            socket.emit('cardPlayed', {
                card: cardForSplash,
                playerName: player ? player.name : 'Player',
                playerId: socket.id
            });
        }
        
        // Check if this is a card block card - trigger it immediately
        if (realCard.id === 'cardBlock' && opponent) {
            // Check if opponent is a bot
            if (opponent.isBot) {
                // Bot's hand is stored in botGames - block a random card
                const botData = botGames.get(data.gameId);
                if (botData && botData.botHand && botData.botHand.length > 0) {
                    // Initialize blocked cards tracking if needed
                    if (!game.blockedCards) {
                        game.blockedCards = new Map();
                    }
                    
                    // Pick a random card from bot's hand to block
                    const randomIndex = Math.floor(Math.random() * botData.botHand.length);
                    const blockedCardId = botData.botHand[randomIndex].id;
                    game.blockedCards.set(opponent.id, blockedCardId);
                }
            } else {
            const opponentSocket = io.sockets.sockets.get(opponent.id);
            if (opponentSocket) {
                opponentSocket.emit('requestHandForBlock', {
                    gameId: data.gameId,
                    requesterId: socket.id
                });
                }
            }
        }
        
        // Check if this is an effect clear card - remove all active effects on the player
        // Do this IMMEDIATELY when the card is selected, before guess submission
        if (realCard.id === 'effectClear') {
            // Count effects before clearing (log them for debugging)
            const effectsBefore = game.activeEffects.filter(e => e.target === socket.id && !e.used);
            const effectTypes = effectsBefore.map(e => e.type);
            
            console.log(`Effect Clear: Player ${socket.id} playing Purge. Current active effects targeting them:`, effectTypes);
            
            // Remove all active effects targeting this player
            const effectsAfter = game.activeEffects.filter(e => {
                // Keep effects that don't target this player, or are already used
                if (e.target !== socket.id || e.used) {
                    return true;
                }
                // Remove all effects targeting this player
                console.log(`Effect Clear: Removing effect ${e.type} from player ${socket.id}`);
                return false;
            });
            
            game.activeEffects = effectsAfter;
            
            // Also clear blocked card if any
            if (game.blockedCards && game.blockedCards.has(socket.id)) {
                game.blockedCards.delete(socket.id);
                console.log(`Effect Clear: Cleared blocked card for player ${socket.id}`);
            }
            
            // Notify the player if effects were cleared
            if (effectsBefore.length > 0) {
                console.log(`Effect Clear: Successfully removed ${effectsBefore.length} active effect(s) from player ${socket.id}`);
                // Send updated active effects to the player so they can update their gameState
                socket.emit('activeEffectsUpdated', {
                    activeEffects: game.activeEffects,
                    gameId: data.gameId
                });
                
                // Also notify opponent about updated effects
                if (opponent) {
                    const opponentSocket = io.sockets.sockets.get(opponent.id);
                    if (opponentSocket) {
                        opponentSocket.emit('activeEffectsUpdated', {
                            activeEffects: game.activeEffects,
                            gameId: data.gameId
                        });
                        // Also send notification message
                        opponentSocket.emit('opponentEffectsCleared', {
                            playerName: player ? player.name : 'Player',
                            count: effectsBefore.length
                        });
                    }
                }
            } else {
                console.log(`Effect Clear: No active effects to clear for player ${socket.id}`);
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
        // If cardMirror, show the opponent's last card instead (following Card Mirror chains)
        let cardToShowOpponentForSplash = cardToShowOpponent;
        if (realCard.id === 'cardMirror' && opponent) {
            const resolvedCard = resolveMirroredCard(game, opponent.id);
            if (resolvedCard) {
                cardToShowOpponentForSplash = resolvedCard;
            }
        }
        
        if (opponent && !shouldHideFromOpponent) {
            const opponentSocket = io.sockets.sockets.get(opponent.id);
            if (opponentSocket) {
                opponentSocket.emit('cardPlayed', {
                    card: cardToShowOpponentForSplash,
            playerName: player ? player.name : 'Player',
            playerId: socket.id
        });
            }
        }
        
        // Send system notification to chat (only once, for visible cards)
        if (!shouldHideFromOpponent && splashBehavior === 'show') {
            const cardName = getCardDisplayName(cardToShowOpponentForSplash);
            sendSystemChatMessage(data.gameId, `${player ? player.name : 'Player'} played ${cardName}`);
        }
        
        // Clear the card chain and track the last played card
        game.cardChains.delete(socket.id);
        
        // Track the last played card for this player (store the real card, not the fake one shown to opponent)
        if (!game.lastPlayedCards) {
            game.lastPlayedCards = new Map();
        }
        // If Card Mirror, store what card it's actually mirroring (opponent's last card at this moment)
        if (realCard.id === 'cardMirror' && opponent) {
            if (!game.mirroredCards) {
                game.mirroredCards = new Map();
            }
            const opponentLastCard = game.lastPlayedCards.get(opponent.id);
            if (opponentLastCard) {
                game.mirroredCards.set(socket.id, opponentLastCard);
            }
        }
        game.lastPlayedCards.set(socket.id, realCard);
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
    
    socket.on('sendHandForSteal', (data) => {
        // Opponent is sending their hand in response to a card steal request
        const game = games.get(data.gameId);
        if (!game) return;
        
        const requesterSocket = io.sockets.sockets.get(data.requesterId);
        if (requesterSocket) {
            requesterSocket.emit('opponentHandForSteal', {
                cards: data.cards,
                opponentName: game.players.find(p => p.id === socket.id)?.name || 'Opponent',
                gameId: data.gameId
            });
        }
    });
    
    socket.on('sendHandForBlock', (data) => {
        // Opponent is sending their hand in response to a card block request
        const game = games.get(data.gameId);
        if (!game) return;
        
        // Initialize blocked cards tracking if needed
        if (!game.blockedCards) {
            game.blockedCards = new Map();
        }
        
        // Pick a random card from the opponent's hand to block
        if (data.cards && data.cards.length > 0) {
            const randomIndex = Math.floor(Math.random() * data.cards.length);
            const blockedCardId = data.cards[randomIndex].id;
            
            // Block this card for the opponent
            game.blockedCards.set(socket.id, blockedCardId);
            
            // Notify the opponent that a card has been blocked (but don't tell them which one)
            socket.emit('cardBlocked', {
                blockedCardId: blockedCardId
            });
        }
    });
    
    socket.on('selectOpponentCard', (data) => {
        // Player is selecting a card from opponent's hand to play
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
        
        // Check if the selected card is blocked
        if (game.blockedCards && game.blockedCards.has(socket.id)) {
            const blockedCardId = game.blockedCards.get(socket.id);
            if (data.card.id === blockedCardId) {
                socket.emit('error', { message: 'This card is blocked and cannot be used!' });
                return;
            }
        }
        
        const player = game.players.find(p => p.id === socket.id);
        
        // Initialize card chain tracking if needed
        if (!game.cardChains) {
            game.cardChains = new Map();
        }
        
        // Get or initialize the card chain for this player
        let cardChain = game.cardChains.get(socket.id) || [];
        
        // The selected card from opponent's hand
        const stolenCard = data.card;
        
        // Check if this card is a modifier card using config
        const cardIsModifier = isModifierCard(stolenCard.id);
        
        // If it's a modifier card, add it to the chain and allow another selection
        if (cardIsModifier) {
            cardChain.push(stolenCard);
            game.cardChains.set(socket.id, cardChain);
            
            // Show splash based on config
            const splashBehavior = getSplashBehavior(stolenCard.id);
            if (splashBehavior === 'show') {
                io.to(data.gameId).emit('cardPlayed', {
                    card: stolenCard,
                    playerName: player ? player.name : 'Player',
                    playerId: socket.id
                });
            }
            
            // Notify the player they can select another card
            socket.emit('cardSelected', {
                playerId: socket.id,
                card: stolenCard,
                allowSecondCard: true
            });
            return;
        }
        
        // This is a regular card (final card in the chain)
        // Add it to the chain
        cardChain.push(stolenCard);
        
        // Process the card chain using config
        const realCard = stolenCard; // The last card is always the real card
        const { cardToShowOpponent, shouldHideFromOpponent } = processCardChain(cardChain, realCard);
        
        // Find opponent
        const opponent = game.players.find(p => p.id !== socket.id);
        
        // Store the real card for when guess is submitted (if needed by config)
        if (cardChain.some(c => needsRealCardStorage(c.id))) {
            if (!game.phonyCardRealCards) {
                game.phonyCardRealCards = new Map();
            }
            game.phonyCardRealCards.set(socket.id, realCard);
            console.log('Stored real card for phony card chain (stolen card). Player:', socket.id, 'Real card:', realCard.id, 'Chain cards:', cardChain.map(c => c.id));
        }
        
        // Show splash based on config (for the player who stole it)
        // If cardMirror, show the opponent's last card instead (following Card Mirror chains)
        let cardForSplash = realCard;
        if (realCard.id === 'cardMirror' && opponent) {
            const resolvedCard = resolveMirroredCard(game, opponent.id);
            if (resolvedCard) {
                cardForSplash = resolvedCard;
            }
        }
        
        const splashBehavior = getSplashBehavior(realCard.id);
        if (splashBehavior === 'show' && !shouldHideFromOpponent) {
            socket.emit('cardPlayed', {
                card: cardForSplash,
                playerName: player ? player.name : 'Player',
                playerId: socket.id
            });
        }
        
        // Notify the player with the real card
        socket.emit('cardSelected', {
            playerId: socket.id,
            card: realCard,
            hidden: shouldHideFromOpponent,
            isRealCard: true
        });
        
        // Show card to opponent (fake if phonyCard was used, hidden if hideCard was used)
        // If cardMirror, show the opponent's last card instead (following Card Mirror chains)
        let cardToShowOpponentForSplash = cardToShowOpponent;
        if (realCard.id === 'cardMirror' && opponent) {
            const resolvedCard = resolveMirroredCard(game, opponent.id);
            if (resolvedCard) {
                cardToShowOpponentForSplash = resolvedCard;
            }
        }
        
        if (opponent && !shouldHideFromOpponent) {
            const opponentSocket = io.sockets.sockets.get(opponent.id);
            if (opponentSocket) {
                opponentSocket.emit('cardPlayed', {
                    card: cardToShowOpponentForSplash,
                    playerName: player ? player.name : 'Player',
                    playerId: socket.id
                });
            }
            
            // Also send to spectators
            const gameSpectators = spectators.get(data.gameId);
            if (gameSpectators && gameSpectators.size > 0) {
                gameSpectators.forEach(spectatorSocketId => {
                    const spectatorSocket = io.sockets.sockets.get(spectatorSocketId);
                    if (spectatorSocket) {
                        spectatorSocket.emit('cardPlayed', {
                            card: cardToShowOpponentForSplash,
                            playerName: player ? player.name : 'Player',
                            playerId: socket.id
                        });
                    }
                });
            }
        }
        
        // Clear the card chain and track the last played card (for stolen card)
        game.cardChains.delete(socket.id);
        
        // Track the last played card for this player (stolen card)
        if (!game.lastPlayedCards) {
            game.lastPlayedCards = new Map();
        }
        // If Card Mirror, store what card it's actually mirroring (opponent's last card at this moment)
        if (realCard.id === 'cardMirror' && opponent) {
            if (!game.mirroredCards) {
                game.mirroredCards = new Map();
            }
            const opponentLastCard = game.lastPlayedCards.get(opponent.id);
            if (opponentLastCard) {
                game.mirroredCards.set(socket.id, opponentLastCard);
            }
        }
        game.lastPlayedCards.set(socket.id, realCard);
    });
    
    socket.on('turnTimeout', (data) => {
        const game = games.get(data.gameId);
        if (!game) {
            console.log('Turn timeout: Game not found for gameId:', data.gameId);
            return;
        }
        
        const player = game.players.find(p => p.id === socket.id);
        if (!player) {
            console.log('Turn timeout: Player not found in game');
            return;
        }
        
        // Only allow timeout if it's actually this player's turn
        if (game.currentTurn !== socket.id) {
            console.log('Turn timeout: Not player\'s turn, ignoring');
            return; // Not their turn, ignore
        }
        
        // Find opponent
        const opponent = game.players.find(p => p.id !== socket.id);
        if (!opponent) {
            console.log('Turn timeout: Opponent not found');
            return;
        }
        
        // Switch turn to opponent
        game.currentTurn = opponent.id;
        console.log(`Turn timeout - switched from ${socket.id} to ${opponent.id}`);
        
        // Notify both players with their respective player IDs
        game.players.forEach(player => {
            // Skip bot players (they're handled separately)
            if (player.isBot) return;
            
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                playerSocket.emit('turnChanged', {
                    currentTurn: game.currentTurn,
                    players: game.players,
                    status: game.status,
                    activeEffects: game.activeEffects,
                    totalGuesses: game.totalGuesses,
                    yourPlayerId: player.id
                });
            }
        });
        
        // Check if it's a bot's turn in a bot game
        if (game.isBotGame && game.currentTurn.startsWith('BOT_')) {
            setTimeout(() => processBotTurn(game.gameId), 500);
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
        // IMPORTANT: If phonyCard was used, the stored real card takes precedence over data.card
        // This ensures we always apply the correct card effect, not the fake card shown to opponent
        let actualCard = data.card;
        if (game.phonyCardRealCards && game.phonyCardRealCards.has(socket.id)) {
            actualCard = game.phonyCardRealCards.get(socket.id);
            game.phonyCardRealCards.delete(socket.id);
            console.log('Phony card used - real card is:', actualCard?.id, 'Client sent card:', data.card?.id || 'null/undefined', 'but opponent saw fake card');
            
            // Safety check: if client sent a modifier card but we have a stored real card, warn about potential issue
            if (data.card && isModifierCard(data.card.id) && data.card.id === 'phonyCard') {
                console.log('Warning: Client sent phonyCard in submitGuess, but stored real card will be used:', actualCard?.id);
            }
        } else if (data.card) {
            actualCard = data.card;
            
            // Warning: if client sent a modifier card (like phonyCard), this shouldn't happen
            // unless there was an error storing the real card
            if (isModifierCard(data.card.id) && data.card.id === 'phonyCard') {
                console.warn('Warning: phonyCard sent in submitGuess but no stored real card found. This may indicate a bug.');
            }
        }
        
        // Apply card effects to game state using config (use actual card, not the fake one)
        if (actualCard && CARD_CONFIG[actualCard.id]) {
            const config = CARD_CONFIG[actualCard.id];
            // Only apply effects if it's not a modifier card (modifiers are handled in selectCard)
            if (!isModifierCard(actualCard.id) && config.effects?.onGuess) {
                console.log('Applying card effect for:', actualCard.id);
                config.effects.onGuess(game, socket.id);
            } else if (isModifierCard(actualCard.id)) {
                console.log('Skipping modifier card effect:', actualCard.id, '(modifiers handled in selectCard)');
            } else {
                console.log('No onGuess effect for card:', actualCard.id);
            }
        } else if (actualCard) {
            console.log('Warning: Card not found in CARD_CONFIG:', actualCard.id);
        }
        
        // Check for win
        if (guess === game.word) {
            game.status = 'finished';
            
            // Clean up bot game if it's a bot game
            if (game.isBotGame) {
                botGames.delete(data.gameId);
            }
            
            // First, send the winning guess so it displays on the board
            // Then delay gameOver to allow the animation to complete
            const shouldHideFromSelf = game.activeEffects.some(e => 
                e.type === 'gamblerHide' && e.target === socket.id && !e.used
            );
            const shouldHideFromSelfBlind = game.activeEffects.some(e => 
                e.type === 'blindGuess' && e.target === socket.id && !e.used
            );
            const greenToGreyActive = game.activeEffects.some(e => 
                e.type === 'greenToGrey' && e.target === socket.id && !e.used
            );
            const wordScrambleActive = game.activeEffects.some(e => 
                e.type === 'wordScramble' && e.target === socket.id && !e.used
            );
            
            // Send winning guess to player
            if (!shouldHideFromSelf && !shouldHideFromSelfBlind) {
                const guesserFeedback = greenToGreyActive ? 
                    applyCardEffect(realFeedback, { id: 'greenToGrey' }, false) : realFeedback;
                let guesserGuess = guess;
                let scrambledFeedback = guesserFeedback;
                if (wordScrambleActive) {
                    const scrambled = scrambleWordAndGetPermutation(guess);
                    guesserGuess = scrambled.scrambledWord;
                    scrambledFeedback = applyPermutationToArray(guesserFeedback, scrambled.permutation);
                }
                socket.emit('guessSubmitted', {
                    playerId: socket.id,
                    guess: guesserGuess,
                    feedback: scrambledFeedback,
                    row: boardRow,
                    hidden: false
                });
            }
            
            // Send winning guess to opponent
            const opponentSocket = io.sockets.sockets.get(opponent.id);
            if (opponentSocket) {
                const shouldHideGuess = game.activeEffects.some(e => 
                    e.type === 'hiddenGuess' && e.target === socket.id && !e.used
                );
                const shouldHideFeedback = game.activeEffects.some(e => 
                    e.type === 'hiddenFeedback' && e.target === socket.id && !e.used
                );
                const falseFeedbackActive = game.activeEffects.some(e => 
                    e.type === 'falseFeedback' && e.target === socket.id && !e.used
                );
                
                let opponentFeedback = shouldHideFeedback ? 
                    ['absent', 'absent', 'absent', 'absent', 'absent'] : realFeedback;
                if (falseFeedbackActive) {
                    opponentFeedback = applyCardEffect(realFeedback, { id: 'falseFeedback' }, true);
                }
                
                opponentSocket.emit('guessSubmitted', {
                    playerId: socket.id,
                    guess: shouldHideGuess ? null : guess,
                    feedback: opponentFeedback,
                    row: boardRow,
                    hidden: shouldHideGuess
                });
            }
            
            // Delay gameOver to allow the winning guess animation to complete (2 seconds)
            setTimeout(() => {
            game.status = 'finished';
            // Clean up user-to-game tracking
            game.players.forEach(player => {
                if (player.firebaseUid) {
                    userToGame.delete(player.firebaseUid);
                }
            });
            io.to(data.gameId).emit('gameOver', {
                winner: socket.id,
                word: game.word,
                gameId: data.gameId
            });
            }, 2000);
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
        
        // Check if blindGuess is active (hides opponent's guess from themselves)
        const shouldHideFromSelfBlind = game.activeEffects.some(e => 
            e.type === 'blindGuess' && e.target === socket.id && !e.used
        );
        
        // Check if gamblerReveal is active (reveals a letter)
        const gamblerReveal = game.activeEffects.find(e => 
            e.type === 'gamblerReveal' && e.target === socket.id && !e.used
        );
        
        // Check if falseFeedback was applied to THIS guess (by the current player using the card)
        // Note: If player played Purge (effectClear) before submitting, this effect should be gone
        const falseFeedbackActive = game.activeEffects.some(e => 
            e.type === 'falseFeedback' && e.target === socket.id && !e.used
        );
        console.log(`SubmitGuess: Player ${socket.id} submitting guess. falseFeedback active: ${falseFeedbackActive}. Active effects:`, 
            game.activeEffects.filter(e => e.target === socket.id && !e.used).map(e => e.type));
        
        // Check if greenToGrey is active (targets the opponent making the guess)
        const greenToGreyActive = game.activeEffects.some(e => 
            e.type === 'greenToGrey' && e.target === socket.id && !e.used
        );
        
        // Check if wordScramble is active (targets the opponent making the guess)
        const wordScrambleActive = game.activeEffects.some(e => 
            e.type === 'wordScramble' && e.target === socket.id && !e.used
        );
        
        // Calculate false feedback if active (for opponent's view only)
        let falseFeedback = null;
        if (falseFeedbackActive) {
            // Apply false feedback - this will be shown to the opponent
            falseFeedback = applyCardEffect(realFeedback, { id: 'falseFeedback' }, true);
            console.log('False feedback calculated. Real:', realFeedback, 'False:', falseFeedback);
        } else {
            console.log('False feedback NOT active - player will see correct feedback to opponent (may have used Purge)');
        }
        
        // Calculate greenToGrey feedback if active (converts green to grey for the player making the guess)
        let greenToGreyFeedback = null;
        if (greenToGreyActive) {
            greenToGreyFeedback = applyCardEffect(realFeedback, { id: 'greenToGrey' }, false);
            console.log('Green to grey feedback calculated. Real:', realFeedback, 'Modified:', greenToGreyFeedback);
        }
        
        // Send to guesser (hide if gamblerHide or blindGuess is active, otherwise show normally)
        if (shouldHideFromSelf || shouldHideFromSelfBlind) {
            // Hide guess from player themselves (gambler's card bad luck or blind guess card)
            socket.emit('guessSubmitted', {
                playerId: socket.id,
                guess: null, // Hide the guess
                feedback: null, // Hide the feedback
                row: boardRow,
                hidden: true
            });
        } else {
            // Normal display for guesser (apply greenToGrey if active, wordScramble if active)
            const guesserFeedback = greenToGreyActive && greenToGreyFeedback ? greenToGreyFeedback : realFeedback;
            // Scramble the guess and feedback if wordScramble is active (player sees scrambled letters)
            let guesserGuess = guess;
            let scrambledFeedback = guesserFeedback;
            if (wordScrambleActive) {
                const scrambled = scrambleWordAndGetPermutation(guess);
                guesserGuess = scrambled.scrambledWord;
                // Apply the same permutation to the feedback so colors align with scrambled letters
                scrambledFeedback = applyPermutationToArray(guesserFeedback, scrambled.permutation);
            }
        socket.emit('guessSubmitted', {
            playerId: socket.id,
            guess: guesserGuess, // Scrambled if wordScramble active, otherwise real guess
                feedback: scrambledFeedback, // Feedback aligned with scrambled letters if wordScramble active
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
        
            // Send to opponent and spectators
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
            
            // Also send to spectators (they see everything)
            const gameSpectators = spectators.get(data.gameId);
            if (gameSpectators && gameSpectators.size > 0) {
                gameSpectators.forEach(spectatorSocketId => {
                    const spectatorSocket = io.sockets.sockets.get(spectatorSocketId);
                    if (spectatorSocket) {
                        spectatorSocket.emit('guessSubmitted', {
                            playerId: socket.id,
                            guess: guess,
                            feedback: realFeedback,
                            row: boardRow,
                            hidden: false  // Spectators see all guesses
                        });
                    }
                });
            }
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
            // Remove hiddenGuess, hiddenFeedback, falseFeedback, gamblerHide, gamblerReveal, blindGuess, greenToGrey, timeRush, and wordScramble after they've been used on this guess
            if (e.target === socket.id && (
                e.type === 'hiddenGuess' || 
                e.type === 'hiddenFeedback' || 
                e.type === 'falseFeedback' ||
                e.type === 'gamblerHide' ||
                e.type === 'gamblerReveal' ||
                e.type === 'blindGuess' ||
                e.type === 'greenToGrey' ||
                e.type === 'timeRush' ||
                e.type === 'wordScramble'
            )) {
                if (e.type === 'falseFeedback') {
                    console.log('Removing falseFeedback effect after it was applied to player:', socket.id);
                }
                if (e.type === 'timeRush') {
                    console.log('Removing timeRush effect after it was applied to player:', socket.id);
                }
                return false; // Remove used effects
            }
            return true;
        });
        
        // Emit turn change to all players in the game (don't send the word)
        // Send personalized turnChanged events to each player with their own ID
        game.players.forEach(player => {
            // Skip bot players (they're handled separately)
            if (player.isBot) return;
            
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
        
        // Check if it's a bot's turn in a bot game
        if (game.isBotGame && game.currentTurn.startsWith('BOT_')) {
            setTimeout(() => processBotTurn(game.gameId), 500);
        }
        
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
        
        // Clear bot timeout if exists
        const timeout = matchmakingTimeouts.get(socket.id);
        if (timeout) {
            clearTimeout(timeout);
            matchmakingTimeouts.delete(socket.id);
        }
        
        // Remove from matchmaking queue if present
        const queueIndex = matchmakingQueue.findIndex(p => p.id === socket.id);
        if (queueIndex !== -1) {
            matchmakingQueue.splice(queueIndex, 1);
            console.log(`Player ${socket.id} removed from matchmaking queue. Queue size: ${matchmakingQueue.length}`);
        }
        
        // Remove from spectators if applicable
        spectators.forEach((spectatorSet, gameId) => {
            if (spectatorSet.has(socket.id)) {
                spectatorSet.delete(socket.id);
                if (spectatorSet.size === 0) {
                    spectators.delete(gameId);
                }
            }
        });
        
        const playerData = players.get(socket.id);
        if (playerData) {
            const game = games.get(playerData.gameId);
            if (game) {
                game.players = game.players.filter(p => p.id !== socket.id);
                
                // Clean up user-to-game tracking
                const player = game.players.find(p => p.id === socket.id);
                if (player && player.firebaseUid) {
                    userToGame.delete(player.firebaseUid);
                }
                
                // Clean up bot games
                if (game.isBotGame) {
                    botGames.delete(game.gameId);
                }
                
                if (game.players.length === 0) {
                    games.delete(playerData.gameId);
                    userToGame.forEach((gameIdForUser, firebaseUid) => {
                        if (gameIdForUser === playerData.gameId) {
                            userToGame.delete(firebaseUid);
                        }
                    });
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


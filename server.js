const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const https = require('https');
const nodemailer = require('nodemailer');

// Load email configuration
let emailConfig = null;
try {
    emailConfig = require('./email-config.js');
} catch (error) {
    console.log('email-config.js not found, using environment variables or defaults');
}

const app = express();
app.use(express.json()); // Parse JSON bodies
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
                    // CRITICAL: Remove any existing cardLock effect for this target first (prevent duplicates)
                    game.activeEffects = game.activeEffects.filter(e => 
                        !(e.type === 'cardLock' && e.target === opponent.id && !e.used)
                    );
                    
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
            // timeRush effect is applied immediately when card is selected (handled in selectCard)
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
    },
    'snackTime': {
        metadata: {
            id: 'snackTime',
            title: 'Snack Time',
            description: 'Put all cards from your deck into your hand and pick from all available cards',
            type: 'help'
        },
        modifier: {
            isModifier: false,
            splashBehavior: 'show',
            chainBehavior: 'none',
            needsRealCardStorage: false
        },
        effects: {
            // Snack Time is handled in selectCard, not onGuess
        }
    },
    'remJob': {
        metadata: {
            id: 'remJob',
            title: 'Rem-Job',
            description: '99% chance to hide your next guess from you, 1% chance to instantly win',
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
                // 1% chance to instantly win the game
                if (Math.random() < 0.01) {
                    // Set flag to trigger instant win in submitGuess handler
                    game.remJobInstantWin = playerId;
                } else {
                    // 99% chance: hide next guess from player themselves
                    game.activeEffects.push({
                        type: 'remJobHide',
                        target: playerId,
                        description: 'Your next guess will be hidden from you',
                        used: false
                    });
                }
            }
        }
    },
    'hiddenKeyboard': {
        metadata: {
            id: 'hiddenKeyboard',
            title: 'Carde Blanche',
            description: 'Your opponent\'s keyboard letters will be hidden on their next turn',
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
                    // Add keyboard hide effect targeting the opponent
                    game.activeEffects.push({
                        type: 'hiddenKeyboard',
                        target: opponent.id,
                        description: 'Your keyboard letters will be hidden on your next turn',
                        used: false
                    });
                }
            }
        }
    },
    'blackHand': {
        metadata: {
            id: 'blackHand',
            title: 'Black Hand',
            description: 'Flips all your opponent\'s cards around for their next turn',
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
                    // CRITICAL: Remove any existing blackHand effect for this target first (prevent duplicates)
                    game.activeEffects = game.activeEffects.filter(e => 
                        !(e.type === 'blackHand' && e.target === opponent.id && !e.used)
                    );
                    
                    // Add black hand effect targeting the opponent
                    game.activeEffects.push({
                        type: 'blackHand',
                        target: opponent.id,
                        description: 'Your cards are flipped for this turn',
                        used: false
                    });
                }
            }
        }
    },
    'amnesia': {
        metadata: {
            id: 'amnesia',
            title: 'Amnesia',
            description: 'Blocks out all previous guesses for your opponent\'s next turn',
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
                    // CRITICAL: Remove any existing amnesia effect for this target first (prevent duplicates)
                    game.activeEffects = game.activeEffects.filter(e => 
                        !(e.type === 'amnesia' && e.target === opponent.id && !e.used)
                    );
                    
                    // Add amnesia effect targeting the opponent
                    game.activeEffects.push({
                        type: 'amnesia',
                        target: opponent.id,
                        description: 'All previous guesses are hidden for your turn',
                        used: false
                    });
                }
            }
        }
    },
    'moonshine': {
        metadata: {
            id: 'moonshine',
            title: 'Moonshine',
            description: 'Adds a drunk effect to your opponent\'s screen for their next turn',
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
                    // CRITICAL: Remove any existing moonshine effect for this target first (prevent duplicates)
                    game.activeEffects = game.activeEffects.filter(e => 
                        !(e.type === 'moonshine' && e.target === opponent.id && !e.used)
                    );
                    
                    // Add moonshine effect targeting the opponent
                    game.activeEffects.push({
                        type: 'moonshine',
                        target: opponent.id,
                        description: 'Your screen has a drunk effect for this turn',
                        used: false
                    });
                }
            }
        }
    },
    'slowMotion': {
        metadata: {
            id: 'slowMotion',
            title: 'Slow Motion',
            description: 'Adds 30 seconds to your current timer',
            type: 'help'
        },
        modifier: {
            isModifier: false,
            splashBehavior: 'show',
            chainBehavior: 'none',
            needsRealCardStorage: false
        },
        effects: {
            // slowMotion effect is applied immediately when card is selected (handled in selectCard/client)
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
function sendSystemChatMessage(gameId, message, cardData = null) {
    io.to(gameId).emit('chatMessage', {
        playerId: 'system',
        playerName: 'System',
        message: message,
        timestamp: Date.now(),
        isSystem: true,
        cardData: cardData // Include card data if this is a card play notification
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

// Email configuration
// To enable email sending, configure these environment variables or update the values below:
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// For Gmail: Use an App Password (not your regular password)
// For other services: Check their SMTP settings
let emailTransporter = null;

function initializeEmailTransporter() {
    // Priority: email-config.js > environment variables > defaults
    const smtpHost = emailConfig?.host || process.env.SMTP_HOST || '';
    const smtpPort = emailConfig?.port || process.env.SMTP_PORT || 587;
    const smtpUser = emailConfig?.user || process.env.SMTP_USER || '';
    const smtpPass = emailConfig?.pass || process.env.SMTP_PASS || '';
    const smtpFrom = emailConfig?.from || process.env.SMTP_FROM || smtpUser || 'noreply@cardle.com';
    
    console.log('\n=== Email Configuration Check ===');
    console.log(`SMTP Host: ${smtpHost || '(not set)'}`);
    console.log(`SMTP Port: ${smtpPort}`);
    console.log(`SMTP User: ${smtpUser || '(not set)'}`);
    console.log(`SMTP Pass: ${smtpPass ? '***' + smtpPass.slice(-4) : '(not set)'}`);
    console.log(`From Address: ${smtpFrom}`);
    console.log('================================\n');
    
    if (smtpHost && smtpUser && smtpPass) {
        try {
            emailTransporter = nodemailer.createTransport({
                host: smtpHost,
                port: parseInt(smtpPort),
                secure: smtpPort == 465, // true for 465, false for other ports
                auth: {
                    user: smtpUser,
                    pass: smtpPass
                },
                // Add connection timeout
                connectionTimeout: 10000,
                greetingTimeout: 10000,
                socketTimeout: 10000
            });
            
            // Verify connection (async, but don't block)
            emailTransporter.verify(function(error, success) {
                if (error) {
                    console.error('❌ SMTP connection verification failed:', error);
                    console.error('   Error code:', error.code);
                    console.error('   Error command:', error.command);
                    console.error('   Please check your email-config.js settings');
                    console.error('   Make sure:');
                    console.error('   1. Gmail App Password is correct');
                    console.error('   2. 2-Step Verification is enabled on your Google account');
                    console.error('   3. App Password was generated from: https://myaccount.google.com/apppasswords');
                    emailTransporter = null; // Disable if verification fails
                } else {
                    console.log('✅ Email transporter initialized and verified successfully');
                    console.log('   Ready to send emails!');
                }
            });
        } catch (error) {
            console.error('❌ Error creating email transporter:', error);
            emailTransporter = null;
        }
    } else {
        console.log('⚠️  Email transporter not configured. Emails will be logged to console.');
        console.log('To enable email sending:');
        console.log('  1. Edit email-config.js and fill in your SMTP settings, OR');
        console.log('  2. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS environment variables');
    }
}

initializeEmailTransporter();

// Test endpoint to check email configuration
app.get('/api/test-email-config', (req, res) => {
    const smtpHost = emailConfig?.host || process.env.SMTP_HOST || '';
    const smtpPort = emailConfig?.port || process.env.SMTP_PORT || 587;
    const smtpUser = emailConfig?.user || process.env.SMTP_USER || '';
    const smtpPass = emailConfig?.pass || process.env.SMTP_PASS || '';
    const isConfigured = !!(smtpHost && smtpUser && smtpPass);
    
    res.json({
        configured: isConfigured,
        hasTransporter: !!emailTransporter,
        host: smtpHost || '(not set)',
        port: smtpPort,
        user: smtpUser || '(not set)',
        passSet: !!smtpPass
    });
});

// API endpoint to send verification email
app.post('/api/send-verification-email', async (req, res) => {
    try {
        const { email, code, name } = req.body;
        
        if (!email || !code) {
            return res.status(400).json({ error: 'Email and code are required' });
        }
        
        const emailSubject = 'Verify Your Cardle Account';
        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #6aaa64; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                    .code-box { background: #ffffff; border: 2px solid #6aaa64; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
                    .code { font-size: 32px; font-weight: bold; color: #6aaa64; letter-spacing: 8px; }
                    .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Welcome to Cardle!</h1>
                    </div>
                    <div class="content">
                        <p>Hi ${name || 'there'},</p>
                        <p>Thank you for signing up! Please verify your email address by entering the following code:</p>
                        <div class="code-box">
                            <div class="code">${code}</div>
                        </div>
                        <p>This code will expire in 15 minutes.</p>
                        <p>If you didn't create an account, please ignore this email.</p>
                    </div>
                    <div class="footer">
                        <p>© Cardle - Multiplayer Wordle Game</p>
                    </div>
                </div>
            </body>
            </html>
        `;
        
        const emailText = `
Welcome to Cardle!

Hi ${name || 'there'},

Thank you for signing up! Please verify your email address by entering the following code:

${code}

This code will expire in 15 minutes.

If you didn't create an account, please ignore this email.

© Cardle - Multiplayer Wordle Game
        `;
        
        if (emailTransporter) {
            // Send email via SMTP
            // For Gmail, the "from" address must match the authenticated user
            const smtpUser = emailConfig?.user || process.env.SMTP_USER || '';
            const fromAddress = emailConfig?.from || process.env.SMTP_FROM || smtpUser || 'noreply@cardle.com';
            
            console.log(`📧 Attempting to send verification email to ${email}`);
            console.log(`   From: ${fromAddress}`);
            console.log(`   Code: ${code}`);
            
            try {
                const info = await emailTransporter.sendMail({
                    from: `"Cardle" <${fromAddress}>`, // Use name and email format
                    to: email,
                    subject: emailSubject,
                    text: emailText,
                    html: emailHtml
                });
                console.log(`✅ Verification email sent successfully to ${email}`);
                console.log(`   Message ID: ${info.messageId}`);
                console.log(`   Response: ${info.response || 'N/A'}`);
                console.log(`   Verification Code: ${code}`);
            } catch (emailError) {
                console.error('❌ Error sending email:', emailError);
                console.error('   Error code:', emailError.code);
                console.error('   Error command:', emailError.command);
                console.error('   Error response:', emailError.response);
                console.error('   Error responseCode:', emailError.responseCode);
                console.error('   Full error:', JSON.stringify(emailError, null, 2));
                
                // Still log the code so user can verify manually
                console.log('\n=== VERIFICATION CODE (EMAIL FAILED - CHECK CODE BELOW) ===');
                console.log(`To: ${email}`);
                console.log(`Code: ${code}`);
                console.log('===========================================================\n');
                
                // Return error but don't throw - let the request complete
                return res.status(500).json({ 
                    error: 'Failed to send verification email',
                    code: code, // Include code in response for debugging
                    details: emailError.message 
                });
            }
        } else {
            // Log to console if email is not configured
            console.log('\n=== VERIFICATION EMAIL (NOT SENT - EMAIL NOT CONFIGURED) ===');
            console.log(`To: ${email}`);
            console.log(`Subject: ${emailSubject}`);
            console.log(`Code: ${code}`);
            console.log('===========================================================\n');
            
            // Still return success but include the code
            return res.json({ 
                success: true, 
                message: 'Verification code generated (email not configured - check server console)',
                code: code // Include code for development
            });
        }
        
        res.json({ success: true, message: 'Verification email sent' });
    } catch (error) {
        console.error('Error sending verification email:', error);
        res.status(500).json({ error: 'Failed to send verification email' });
    }
});

// Serve static files (after route handlers)
app.use(express.static(__dirname));

// Game state storage
const games = new Map();
const players = new Map();
const spectators = new Map(); // gameId -> Set of socket IDs
const userToGame = new Map(); // firebaseUid -> gameId (for friend status checking)
const rematchRequests = new Map(); // gameId -> Set of player socket IDs who requested rematch
const onlineUsers = new Map(); // socket.id -> firebaseUid (track all online users)
const pendingChallenges = new Map(); // challengeId -> { challengerSocketId, challengerFirebaseUid, challengerName, targetFirebaseUid, targetName }
const firebaseUidToSocket = new Map(); // firebaseUid -> socket.id (for finding socket by firebaseUid)
const pendingGameResults = new Map(); // firebaseUid -> { gameOverData, timestamp } - stores game results for disconnected players

// Matchmaking queues
const matchmakingQueue = []; // Ranked matchmaking
const casualMatchmakingQueue = []; // Casual matchmaking

// Track bot matchmaking timeouts
const matchmakingTimeouts = new Map(); // socket.id -> timeout
const casualMatchmakingTimeouts = new Map(); // socket.id -> timeout

// Bot names pool - realistic gaming usernames (inspired by popular 2024 trends)
const BOT_NAME_BASES = [
    'Quantum', 'Cyber', 'Neo', 'Pixel', 'Vortex', 'Nova', 'Phantom', 'Specter',
    'Crimson', 'Blaze', 'Iron', 'Venom', 'Titan', 'Frost', 'Ember', 'Glacier',
    'Violet', 'Icy', 'Storm', 'Candy', 'Kitty', 'Fluffy', 'Bunny', 'Snuggle',
    'Shadow', 'Night', 'Dark', 'Light', 'Fire', 'Ice', 'Thunder',
    'Dragon', 'Wolf', 'Eagle', 'Phoenix', 'Tiger', 'Lion', 'Falcon', 'Raven',
    'Blade', 'Sword', 'Arrow', 'Shield', 'Knight', 'Warrior', 'Hunter', 'Ranger',
    'Ghost', 'Demon', 'Angel', 'Spirit', 'Mystic', 'Sage', 'Wizard', 'Mage',
    'Ninja', 'Samurai', 'Viking', 'Spartan', 'Gladiator', 'Champion', 'Legend', 'Hero'
];

// Real first names (more common gaming usernames)
const BOT_FIRST_NAMES = [
    'Alex', 'Jordan', 'Casey', 'Sam', 'Taylor', 'Morgan', 'Riley', 'Jamie',
    'Quinn', 'Avery', 'Blake', 'Cameron', 'Dakota', 'Emery', 'Finley', 'Hayden',
    'Parker', 'River', 'Sage', 'Skylar', 'Chris', 'Mike', 'Tom', 'John', 'Matt',
    'Dan', 'Ben', 'Jake', 'Ryan', 'Kevin', 'Steve', 'Dave', 'Mark', 'Luke',
    'Emma', 'Sarah', 'Jessica', 'Emily', 'Olivia', 'Sophia', 'Mia', 'Isabella',
    'Ava', 'Charlotte', 'Amelia', 'Harper', 'Evelyn', 'Abigail', 'Ella', 'Lily',
    'Zoe', 'Grace', 'Luna', 'Aria', 'Chloe', 'Layla', 'Nora', 'Hannah'
];

// Real last names
const BOT_LAST_NAMES = [
    'Jones', 'Smith', 'Johnson', 'Williams', 'Brown', 'Davis', 'Miller', 'Wilson',
    'Moore', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin',
    'Thompson', 'Garcia', 'Martinez', 'Robinson', 'Clark', 'Rodriguez', 'Lewis', 'Lee',
    'Walker', 'Hall', 'Allen', 'Young', 'King', 'Wright', 'Lopez', 'Hill',
    'Scott', 'Green', 'Adams', 'Baker', 'Gonzalez', 'Nelson', 'Carter', 'Mitchell',
    'Perez', 'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker', 'Evans', 'Edwards'
];

// Silly/funny names
const BOT_SILLY_NAMES = [
    'Salivia', 'Pickle', 'Noodle', 'Bubble', 'Waffle', 'Pancake', 'Toast', 'Bagel',
    'Cheese', 'Burrito', 'Taco', 'Pizza', 'Sushi', 'Ramen', 'Cookie', 'Cupcake',
    'Banana', 'Potato', 'Tomato', 'Carrot', 'Broccoli', 'Cucumber', 'Zucchini', 'Eggplant',
    'Penguin', 'Duck', 'Goose', 'Chicken', 'Turkey', 'Cow', 'Pig', 'Sheep',
    'Squirrel', 'Raccoon', 'Possum', 'Beaver', 'Moose', 'Elk', 'Deer', 'Bear',
    'Frog', 'Toad', 'Lizard', 'Snake', 'Turtle', 'Tortoise', 'Crab', 'Lobster',
    'Spoon', 'Fork', 'Knife', 'Plate', 'Bowl', 'Cup', 'Mug', 'Bottle',
    'Sock', 'Shoe', 'Hat', 'Glove', 'Scarf', 'Shirt', 'Pants', 'Jacket'
];

const BOT_NAME_SUFFIXES = [
    'Pro', 'Master', 'Elite', 'Ace', 'King', 'Queen', 'Lord',
    'X', 'XX', '99', '24', '23', 'Gamer', 'Player', 'Warrior', 'Slayer', 'Killer'
];

const BOT_NAME_PREFIXES = [
    'xX', 'Xx', 'x', 'X', 'The', 'Mr', 'Ms'
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

// Server-side chip calculation (SECURITY: prevents client-side manipulation)
function calculateChipPoints(won, guesses, currentChipPoints) {
    // Initialize chip points if not set
    if (currentChipPoints === undefined || currentChipPoints === null) {
        currentChipPoints = 0;
    }
    
    if (won) {
        // Base points for winning: 20
        let pointsEarned = 20;
        
        // Bonus for fewer guesses (efficiency bonus)
        // Max 6 guesses for full bonus, 7+ gets no bonus
        if (guesses > 0 && guesses <= 6) {
            const efficiencyBonus = (7 - guesses) * 5; // 30 max bonus for 1 guess
            pointsEarned += efficiencyBonus;
        }
        
        return currentChipPoints + pointsEarned;
    } else {
        // Loss penalty: -15 points (minimum 0)
        const pointsLost = 15;
        return Math.max(0, currentChipPoints - pointsLost);
    }
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
    // Helper function to truncate name to 12 characters
    const truncateTo12 = (name) => {
        if (name.length <= 12) return name;
        return name.substring(0, 12);
    };
    
    const patterns = [
        // Pattern 1: Just first name (simple, realistic - 30% chance)
        () => {
            const firstName = BOT_FIRST_NAMES[Math.floor(Math.random() * BOT_FIRST_NAMES.length)];
            return truncateTo12(firstName);
        },
        // Pattern 2: Just last name (simple, realistic)
        () => {
            const lastName = BOT_LAST_NAMES[Math.floor(Math.random() * BOT_LAST_NAMES.length)];
            return truncateTo12(lastName);
        },
        // Pattern 3: Just silly name (simple, like "Salivia")
        () => {
            const silly = BOT_SILLY_NAMES[Math.floor(Math.random() * BOT_SILLY_NAMES.length)];
            return truncateTo12(silly);
        },
        // Pattern 4: First name + last name (no space, realistic)
        () => {
            const firstName = BOT_FIRST_NAMES[Math.floor(Math.random() * BOT_FIRST_NAMES.length)];
            const lastName = BOT_LAST_NAMES[Math.floor(Math.random() * BOT_LAST_NAMES.length)];
            return truncateTo12(firstName + lastName);
        },
        // Pattern 5: First name + underscore + last name
        () => {
            const firstName = BOT_FIRST_NAMES[Math.floor(Math.random() * BOT_FIRST_NAMES.length)];
            const lastName = BOT_LAST_NAMES[Math.floor(Math.random() * BOT_LAST_NAMES.length)];
            return truncateTo12(firstName + '_' + lastName);
        },
        // Pattern 6: First name + 1-2 digit number (realistic)
        () => {
            const firstName = BOT_FIRST_NAMES[Math.floor(Math.random() * BOT_FIRST_NAMES.length)];
            const num = Math.floor(Math.random() * 99) + 1;
            return truncateTo12(firstName + num);
        },
        // Pattern 7: Last name + 1-2 digit number
        () => {
            const lastName = BOT_LAST_NAMES[Math.floor(Math.random() * BOT_LAST_NAMES.length)];
            const num = Math.floor(Math.random() * 99) + 1;
            return truncateTo12(lastName + num);
        },
        // Pattern 8: First name + underscore + 1-2 digit number
        () => {
            const firstName = BOT_FIRST_NAMES[Math.floor(Math.random() * BOT_FIRST_NAMES.length)];
            const num = Math.floor(Math.random() * 99) + 1;
            return truncateTo12(firstName + '_' + num);
        },
        // Pattern 9: Silly name + 1-2 digit number
        () => {
            const silly = BOT_SILLY_NAMES[Math.floor(Math.random() * BOT_SILLY_NAMES.length)];
            const num = Math.floor(Math.random() * 99) + 1;
            return truncateTo12(silly + num);
        },
        // Pattern 10: Gaming base (no numbers, just the word) - more common
        () => {
            const base = BOT_NAME_BASES[Math.floor(Math.random() * BOT_NAME_BASES.length)];
            return truncateTo12(base);
        },
        // Pattern 11: Gaming base + 1-3 digit number (most common pattern)
        () => {
            const base = BOT_NAME_BASES[Math.floor(Math.random() * BOT_NAME_BASES.length)];
            const num = Math.floor(Math.random() * 999) + 1;
            return truncateTo12(base + num);
        },
        // Pattern 12: Gaming base + underscore + 1-3 digit number
        () => {
            const base = BOT_NAME_BASES[Math.floor(Math.random() * BOT_NAME_BASES.length)];
            const num = Math.floor(Math.random() * 999) + 1;
            return truncateTo12(base + '_' + num);
        },
        // Pattern 13: Gaming base + suffix (no numbers)
        () => {
            const base = BOT_NAME_BASES[Math.floor(Math.random() * BOT_NAME_BASES.length)];
            const suffix = BOT_NAME_SUFFIXES[Math.floor(Math.random() * BOT_NAME_SUFFIXES.length)];
            return truncateTo12(base + suffix);
        },
        // Pattern 18: Two gaming bases combined (e.g., "QuantumNova", "CyberPhantom")
        () => {
            const base1 = BOT_NAME_BASES[Math.floor(Math.random() * BOT_NAME_BASES.length)];
            const base2 = BOT_NAME_BASES[Math.floor(Math.random() * BOT_NAME_BASES.length)];
            return truncateTo12(base1 + base2);
        },
        // Pattern 19: Gaming base + short number + suffix
        () => {
            const base = BOT_NAME_BASES[Math.floor(Math.random() * BOT_NAME_BASES.length)];
            const num = Math.floor(Math.random() * 99) + 1;
            const suffix = BOT_NAME_SUFFIXES[Math.floor(Math.random() * BOT_NAME_SUFFIXES.length)];
            return truncateTo12(base + num + suffix);
        },
        // Pattern 14: Short gaming base + short suffix
        () => {
            // Use shorter bases for this pattern
            const shortBases = ['Fire', 'Ice', 'Dark', 'Light', 'Wolf', 'Eagle', 'Blade', 'Ghost', 'Ninja', 'King'];
            const base = shortBases[Math.floor(Math.random() * shortBases.length)];
            const suffix = BOT_NAME_SUFFIXES[Math.floor(Math.random() * BOT_NAME_SUFFIXES.length)];
            return truncateTo12(base + suffix);
        },
        // Pattern 15: Two short words combined
        () => {
            const shortBases = ['Fire', 'Ice', 'Dark', 'Light', 'Wolf', 'Eagle', 'Blade', 'Ghost', 'Ninja', 'King', 'Star', 'Moon'];
            const base1 = shortBases[Math.floor(Math.random() * shortBases.length)];
            const base2 = shortBases[Math.floor(Math.random() * shortBases.length)];
            if (base1 === base2) {
                const num = Math.floor(Math.random() * 9) + 1;
                return truncateTo12(base1 + num);
            }
            return truncateTo12(base1 + base2);
        },
        // Pattern 16: First name + last initial
        () => {
            const firstName = BOT_FIRST_NAMES[Math.floor(Math.random() * BOT_FIRST_NAMES.length)];
            const lastName = BOT_LAST_NAMES[Math.floor(Math.random() * BOT_LAST_NAMES.length)];
            return truncateTo12(firstName + lastName.charAt(0));
        },
        // Pattern 17: Short first name + short last name
        () => {
            const shortFirst = BOT_FIRST_NAMES.filter(n => n.length <= 5);
            const shortLast = BOT_LAST_NAMES.filter(n => n.length <= 6);
            if (shortFirst.length > 0 && shortLast.length > 0) {
                const firstName = shortFirst[Math.floor(Math.random() * shortFirst.length)];
                const lastName = shortLast[Math.floor(Math.random() * shortLast.length)];
                return truncateTo12(firstName + lastName);
            }
            // Fallback
            const firstName = BOT_FIRST_NAMES[Math.floor(Math.random() * BOT_FIRST_NAMES.length)];
            return truncateTo12(firstName);
        }
    ];
    
    // Randomly select a pattern
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    return pattern();
}

// Bot Wordle Solver - filters possible words based on feedback
class BotWordleSolver {
    constructor(wordList, skillLevel = 0.5) {
        this.wordList = [...wordList]; // Copy the word list
        this.possibleWords = [...wordList];
        this.knownCorrect = new Array(5).fill(null); // Position -> letter
        this.knownPresent = {}; // Letter -> set of positions it's NOT in
        this.knownAbsent = new Set(); // Letters that aren't in the word
        this.skillLevel = Math.max(0, Math.min(1, skillLevel)); // 0.0 (bad) to 1.0 (perfect)
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
        
        // Skill-based mistakes: lower skill = more mistakes
        const mistakeChance = 1 - this.skillLevel; // 0.0 (perfect) to 1.0 (always mistakes)
        const randomFactor = Math.random();
        
        // If only one possibility, sometimes pick wrong word (based on skill)
        if (this.possibleWords.length === 1) {
            if (randomFactor < mistakeChance * 0.3) {
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
        
        // If very few possibilities (2-3), sometimes pick wrong one (based on skill)
        if (this.possibleWords.length <= 3 && randomFactor < mistakeChance * 0.4) {
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
        
        // Skill-based candidate pool: higher skill = smaller pool (more optimal)
        // Toned down: Low skill (0.0): 40% of words, High skill (1.0): 15% of words (less optimal)
        const poolPercentage = 0.40 - (this.skillLevel * 0.25);
        const candidatePoolSize = Math.max(
            1, 
            Math.min(
                Math.ceil(this.possibleWords.length * poolPercentage),
                Math.max(5, Math.ceil(this.possibleWords.length * 0.20)) // Increased min pool size
            )
        );
        const candidates = this.possibleWords
            .slice(0, candidatePoolSize)
            .sort(() => Math.random() - 0.5); // Shuffle a bit
        
        return candidates[Math.floor(Math.random() * candidates.length)];
    }
}

// Bot card selection logic - ALWAYS returns a card (unless card locked)
function botSelectCard(game, botId, botHand, botSkillLevel = 0.5) {
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
    
    // If bot has negative effects, prioritize effectClear if available (skill-based chance)
    if (hasNegativeEffects) {
        const effectClearCard = availableCards.find(card => card.id === 'effectClear');
        if (effectClearCard) {
            // Lower skill = less likely to use effectClear (more mistakes)
            const useChance = 0.5 + (botSkillLevel * 0.3); // 50% at skill 0, 80% at skill 1
            if (Math.random() < useChance) {
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
    
    // Skill-based card selection: lower skill = more random, higher skill = more strategic
    const useStrategy = Math.random() < (0.3 + botSkillLevel * 0.4); // 30% at skill 0, 70% at skill 1
    
    if (useStrategy) {
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
                ['falseFeedback', 'cardLock', 'blindGuess', 'timeRush', 'wordScramble', 'amnesia'].includes(c.id)
            );
            if (offensiveCards.length > 0) {
                return offensiveCards[Math.floor(Math.random() * offensiveCards.length)];
            }
        }
    }
    
    // Default: always return a random card from available (more common for lower skill bots)
    return availableCards[Math.floor(Math.random() * availableCards.length)];
}

// Create a bot game
function createBotGame(humanSocket, humanName, firebaseUid = null, isTutorial = false, isRanked = false, humanChipPoints = null) {
    const botId = 'BOT_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const botName = isTutorial ? 'Bot' : getRandomBotName();
    const gameId = generateGameId();
    // Use a simple word for tutorial (common, easy words)
    const tutorialWords = ['APPLE', 'HEART', 'MUSIC', 'WATER', 'LIGHT', 'DREAM', 'HAPPY', 'SMILE'];
    const word = isTutorial ? tutorialWords[Math.floor(Math.random() * tutorialWords.length)] : getRandomWord();
    
    // Determine bot skill level - fluctuate around player's level to simulate real players
    let botSkillLevel = 0.3; // Default skill for new players
    if (!isTutorial && humanChipPoints !== null && humanChipPoints !== undefined) {
        // Calculate player's base skill level from chips
        // Scale: 0 chips = 0.15 skill, 1000 chips = 0.5 skill, 2000+ chips = 0.7 skill
        const normalizedChips = Math.min(humanChipPoints, 2000);
        const playerBaseSkill = 0.15 + (normalizedChips / 2000) * 0.55;
        
        // Fluctuate around player's level (±25%) to simulate real players
        // This means bots can be slightly better or worse, but not extremely so
        const variationRange = playerBaseSkill * 0.25; // 25% variation
        botSkillLevel = playerBaseSkill + (Math.random() - 0.5) * (variationRange * 2);
        
        // Ensure bot skill stays within reasonable bounds (not extremely better or worse)
        // Min: 70% of player skill, Max: 130% of player skill, but capped at 0.75 absolute max
        const minSkill = Math.max(0.1, playerBaseSkill * 0.7);
        const maxSkill = Math.min(0.75, playerBaseSkill * 1.3);
        botSkillLevel = Math.max(minSkill, Math.min(maxSkill, botSkillLevel));
    } else if (!isTutorial) {
        // Fallback for casual games without chip data: moderate random skill
        botSkillLevel = 0.25 + Math.random() * 0.35; // 0.25 to 0.6
    }
    
    // Create game state
    const game = {
        gameId: gameId,
        word: word,
        players: [
            {
                id: humanSocket.id,
                name: humanName,
                firebaseUid: firebaseUid || null,
                photoURL: null, // Bot games don't have photoURL initially
                guesses: [],
                row: 0
            },
            {
                id: botId,
                name: botName,
                photoURL: null,
                guesses: [],
                row: 0,
                isBot: true
            }
        ],
        currentTurn: isTutorial ? humanSocket.id : (Math.random() > 0.5 ? humanSocket.id : botId), // Tutorial always starts with human, otherwise random
        activeEffects: [],
        status: 'waiting',
        totalGuesses: 0,
        lastPlayedCards: new Map(),
        mirroredCards: new Map(),
        isBotGame: true,
        isTutorial: isTutorial,
        isRanked: isRanked
    };
    
    games.set(gameId, game);
    players.set(humanSocket.id, { gameId: gameId, playerId: humanSocket.id });
    players.set(botId, { gameId: gameId, playerId: botId, isBot: true });
    
    // Initialize bot solver with skill level
    const botSolver = new BotWordleSolver(WORDS, botSkillLevel);
    
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
    
    // Store bot game info (including initialized hand and skill level)
    botGames.set(gameId, {
        botId: botId,
        botSolver: botSolver,
        botHand: botHand,
        botSkillLevel: botSkillLevel // Store skill level for card selection
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
            totalGuesses: game.totalGuesses,
            isRanked: game.isRanked || false
        };
        
        console.log('Bot game starting. Players with firebaseUid:', gameStateForClients.players.map(p => ({ name: p.name, firebaseUid: p.firebaseUid })));
        
        // Send game started to human
        console.log(`Sending gameStarted (bot) to ${humanSocket.id} with players:`, gameStateForClients.players.map(p => ({ name: p.name, firebaseUid: p.firebaseUid })));
        const gameStartedData = {
            ...gameStateForClients,
            yourPlayerId: humanSocket.id,
            isTutorial: isTutorial
        };
        
        // For tutorial games, include the word so we can give hints
        if (isTutorial) {
            gameStartedData.tutorialWord = word;
        }
        
        humanSocket.emit('gameStarted', gameStartedData);
        
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
            selectedCard = botSelectCard(currentGame, botId, botData.botHand, botData.botSkillLevel || 0.5);
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
                        }
                    }
                }
            }
            
            // Check if this is a timeRush card - apply effect immediately when card is selected
            if (selectedCard.id === 'timeRush' && opponent) {
                // CRITICAL: Remove any existing timeRush effect for this target first (prevent duplicates)
                const existingTimeRush = currentGame.activeEffects.find(e => 
                    e.type === 'timeRush' && e.target === opponent.id && !e.used
                );
                if (existingTimeRush) {
                    console.log(`Time Rush (Bot): Removing existing timeRush effect for ${opponent.id} before adding new one`);
                    currentGame.activeEffects = currentGame.activeEffects.filter(e => e !== existingTimeRush);
                }
                
                // Add timeRush effect targeting the opponent
                currentGame.activeEffects.push({
                    type: 'timeRush',
                    target: opponent.id,
                    description: 'Your next turn will only have 20 seconds',
                    used: false
                });
                console.log(`Time Rush (Bot): Added timeRush effect targeting opponent ${opponent.id}`);
                
                // Notify human opponent with updated active effects
                if (opponent && !opponent.isBot) {
                    const humanSocket = io.sockets.sockets.get(opponent.id);
                    if (humanSocket) {
                        humanSocket.emit('activeEffectsUpdated', {
                            activeEffects: currentGame.activeEffects,
                            gameId: gameId
                        });
                    }
                }
            }
            
            // Emit card played event for human to see
            const botPlayerForCard = currentGame.players.find(p => p.id === botId);
            if (botPlayerForCard) {
                const humanPlayer = currentGame.players.find(p => p.id !== botId);
                if (!humanPlayer) {
                    console.error(`Bot card selection: Could not find human player in game ${gameId}`);
                    return;
                }
                const humanSocket = io.sockets.sockets.get(humanPlayer.id);
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
                            playerId: botId,
                            camoId: 'None' // Bots don't have camo preferences, default to None
                        });
                        
                        // Send system notification to chat with card data
                        const cardName = getCardDisplayName(cardToShow);
                        sendSystemChatMessage(currentGame.gameId, `${botPlayerForCard.name} played ${cardName}`, cardToShow);
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
                // First guess: use a variety of common starter words
                const starterWords = [
                    'APPLE', 'ARISE', 'AUDIO', 'EARTH', 'STARE', 'CRANE', 'SLATE', 'TRACE',
                    'ADIEU', 'OUIJA', 'RAISE', 'ROATE', 'SOARE', 'STALE', 'TEARS', 'LATER',
                    'ALERT', 'ALTER', 'IRATE', 'ORATE', 'STORE', 'STONE', 'ATONE', 'ALONE',
                    'ALOFT', 'ABOUT', 'ADULT', 'AGENT', 'AGREE', 'AHEAD', 'ALIEN', 'ALIGN',
                    'ALIKE', 'ALIVE', 'ALLOW', 'ALLOY', 'ALONE', 'ALONG', 'ALOUD', 'ALPHA'
                ];
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
    
    // Find opponent (human) - needed for card effects and notifications
    const opponent = game.players.find(p => p.id !== botId);
    if (!opponent) return;
    
    // Apply card effects using actual card (not fake one)
    if (actualCard && CARD_CONFIG[actualCard.id]) {
        const config = CARD_CONFIG[actualCard.id];
        if (!isModifierCard(actualCard.id) && config.effects?.onGuess) {
            const effectsBefore = game.activeEffects.length;
            config.effects.onGuess(game, botId);
            // If blackHand or amnesia effect was added, notify human player immediately
            if ((actualCard.id === 'blackHand' || actualCard.id === 'amnesia') && game.activeEffects.length > effectsBefore) {
                console.log(`${actualCard.id} (Bot): Notifying human player of updated effects`);
                const humanSocket = io.sockets.sockets.get(opponent.id);
                if (humanSocket) {
                    humanSocket.emit('activeEffectsUpdated', {
                        activeEffects: game.activeEffects,
                        gameId: gameId
                    });
                }
                // Also notify the bot (though bot doesn't need it, for consistency)
                const botSocket = io.sockets.sockets.get(botId);
                if (botSocket) {
                    botSocket.emit('activeEffectsUpdated', {
                        activeEffects: game.activeEffects,
                        gameId: gameId
                    });
                }
            }
        }
    }
    
    // Check for Rem-Job instant win (1% chance)
    if (game.remJobInstantWin === botId) {
        // Rem-Job triggered instant win - treat this guess as the winning word
        game.word = guess;
        game.remJobInstantWin = null; // Clear flag
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
        
        // Opponent already found earlier in function
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
            const shouldHideFromSelfRemJob = game.activeEffects.some(e => 
                e.type === 'remJobHide' && e.target === botId && !e.used
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
            
            // Calculate chip changes for ranked games (SECURITY: server-side calculation)
            const botGuesses = botPlayer.guesses ? botPlayer.guesses.length : 0;
            const humanGuesses = opponent.guesses ? opponent.guesses.length : 0;
            
            // Prepare gameOver data with chip calculations
            const gameOverData = {
                winner: botId,
                word: game.word,
                gameId: gameId,
                isRanked: game.isRanked || false,
                isPrivateGame: game.isPrivateGame || false
            };
            
            // Calculate chip changes if ranked game (bot wins, human loses)
            if (game.isRanked) {
                // Bot wins: calculate chip gain
                let botChipGain = 20;
                if (botGuesses > 0 && botGuesses <= 6) {
                    botChipGain += (7 - botGuesses) * 5;
                }
                
                // Human loses: -15 chips
                const humanChipLoss = -15;
                
                gameOverData.winnerChipChange = botChipGain;
                gameOverData.loserChipChange = humanChipLoss;
                gameOverData.winnerGuesses = botGuesses;
                gameOverData.loserGuesses = humanGuesses;
            }
            
            // Clean up user-to-game tracking
            game.players.forEach(player => {
                if (player.firebaseUid) {
                    userToGame.delete(player.firebaseUid);
                }
                // Remove players from players Map so they can matchmake again
                players.delete(player.id);
            });
            
            io.to(gameId).emit('gameOver', gameOverData);
            }, 2000);
        return;
    }
    
    // Opponent already found earlier in function (before card effects)
    
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
    
    // Remove used effects (but not timeRush - that's handled in turn switch section)
    game.activeEffects = game.activeEffects.filter(e => {
        if (e.target === botId && (
            e.type === 'hiddenGuess' || 
            e.type === 'hiddenFeedback' || 
            e.type === 'falseFeedback' ||
            e.type === 'extraGuess' ||
            e.type === 'cardLock' ||
            e.type === 'gamblerHide' ||
            e.type === 'gamblerReveal' ||
            e.type === 'blindGuess' ||
            e.type === 'remJobHide' ||
            e.type === 'greenToGrey' ||
            e.type === 'wordScramble' ||
            e.type === 'hiddenKeyboard' ||
            e.type === 'blackHand'
        )) {
            return false;
        }
        return true;
    });
    
    // Switch turns
    if (!isExtraGuess) {
        game.currentTurn = opponent.id;
        
        // Clear timeRush effect when the affected bot's turn ends
        // (when turn switches away from them)
        const hadTimeRushBot = game.activeEffects.some(e => 
            e.type === 'timeRush' && e.target === botId && !e.used
        );
        game.activeEffects = game.activeEffects.filter(e => {
            if (e.type === 'timeRush' && e.target === botId) {
                console.log('Removing timeRush effect after turn ended for bot:', botId);
                return false;
            }
            return true;
        });
        
        // CRITICAL: Notify human player when bot's timeRush is cleared
        if (hadTimeRushBot && opponent && !opponent.isBot) {
            console.log('Bot timeRush was cleared - notifying human player');
            const opponentSocket = io.sockets.sockets.get(opponent.id);
            if (opponentSocket) {
                opponentSocket.emit('activeEffectsUpdated', {
                    activeEffects: game.activeEffects,
                    gameId: gameId
                });
            }
        }
        
        // Clear moonshine effect when the affected bot's turn ends
        // (when turn switches away from them)
        game.activeEffects = game.activeEffects.filter(e => {
            if (e.type === 'moonshine' && e.target === botId) {
                console.log('Removing moonshine effect after turn ended for bot:', botId);
                return false;
            }
            return true;
        });
        
        // Clear blocked card when the bot's turn ends
        // (when turn switches away from them)
        if (game.blockedCards && game.blockedCards.has(botId)) {
            game.blockedCards.delete(botId);
            console.log(`Cleared blocked card for bot ${botId} after their turn`);
            // Notify human player that bot's card is unblocked (for bot games)
            if (opponent && !opponent.isBot) {
                const opponentSocket = io.sockets.sockets.get(opponent.id);
                if (opponentSocket) {
                    // Bot's card is unblocked, but this doesn't affect the human player's UI
                    // Only needed if we want to track it, but for now we'll just log
                }
            }
        }
    } else {
        game.activeEffects = game.activeEffects.filter(e => 
            !(e.type === 'extraGuess' && e.target === botId)
        );
            // Clear timeRush effect even if bot has extra guess (timeRush only affects one turn)
            const hadTimeRushBotExtra = game.activeEffects.some(e => 
                e.type === 'timeRush' && e.target === botId && !e.used
            );
            game.activeEffects = game.activeEffects.filter(e => {
                if (e.type === 'timeRush' && e.target === botId) {
                    console.log('Removing timeRush effect after first guess (extra guess used) for bot:', botId);
                    return false;
                }
                return true;
            });
            
            // CRITICAL: Notify human player when bot's timeRush is cleared in extra guess case
            if (hadTimeRushBotExtra && opponent && !opponent.isBot) {
                console.log('Bot timeRush was cleared (extra guess) - notifying human player');
                const opponentSocket = io.sockets.sockets.get(opponent.id);
                if (opponentSocket) {
                    opponentSocket.emit('activeEffectsUpdated', {
                        activeEffects: game.activeEffects,
                        gameId: gameId
                    });
                }
            }
            
            // Clear moonshine effect even if bot has extra guess (moonshine only affects one turn)
            game.activeEffects = game.activeEffects.filter(e => {
                if (e.type === 'moonshine' && e.target === botId) {
                    console.log('Removing moonshine effect after first guess (extra guess used) for bot:', botId);
                    return false;
                }
                return true;
            });
            
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
    
    // Also send turnChanged to spectators
    const gameSpectators = spectators.get(gameId);
    if (gameSpectators && gameSpectators.size > 0) {
        const spectatorGameState = {
            gameId: game.gameId,
            currentTurn: game.currentTurn,
            players: game.players.map(p => ({
                id: p.id,
                name: p.name,
                guesses: p.guesses,
                row: p.row
            })),
            status: game.status,
            activeEffects: game.activeEffects,
            totalGuesses: game.totalGuesses
        };
        gameSpectators.forEach(spectatorSocketId => {
            const spectatorSocket = io.sockets.sockets.get(spectatorSocketId);
            if (spectatorSocket) {
                spectatorSocket.emit('turnChanged', spectatorGameState);
            }
        });
    }
    
    // If it's still bot's turn (extra guess), process again
    if (game.currentTurn === botId) {
        setTimeout(() => processBotTurn(gameId), 1000);
    }
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Register user as online when they connect (if they have firebaseUid)
    socket.on('registerOnline', (data) => {
        if (data && data.firebaseUid) {
            onlineUsers.set(socket.id, data.firebaseUid);
            firebaseUidToSocket.set(data.firebaseUid, socket.id);
            console.log('User', data.firebaseUid, 'registered as online (socket:', socket.id + ')');
            console.log('Total online users:', onlineUsers.size);
            
            // Check for pending game results (from disconnecting during a game)
            const pendingResult = pendingGameResults.get(data.firebaseUid);
            if (pendingResult) {
                // Check if result is still valid (within 5 minutes)
                const timeSinceDisconnect = Date.now() - pendingResult.timestamp;
                if (timeSinceDisconnect < 5 * 60 * 1000) { // 5 minutes
                    console.log(`[PENDING RESULT] Sending pending game result to reconnected player ${data.firebaseUid}`);
                    socket.emit('gameOver', pendingResult.gameOverData);
                    pendingGameResults.delete(data.firebaseUid);
                } else {
                    // Result too old, remove it
                    console.log(`[PENDING RESULT] Removing expired game result for ${data.firebaseUid}`);
                    pendingGameResults.delete(data.firebaseUid);
                }
            }
        }
    });
    
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
    
    // Tutorial handler
    socket.on('startTutorial', (data) => {
        const playerName = data.playerName || 'Player';
        const firebaseUid = data.firebaseUid || null;
        
        // Track user as online
        if (firebaseUid) {
            onlineUsers.set(socket.id, firebaseUid);
            firebaseUidToSocket.set(firebaseUid, socket.id);
            console.log('User', firebaseUid, 'connected (startTutorial) and added to onlineUsers');
        }
        
        // Create tutorial bot game (isTutorial=true, isRanked=false)
        createBotGame(socket, playerName, firebaseUid, true, false);
    });
    
    // Matchmaking handlers
    // Ranked matchmaking
    socket.on('findMatch', (data) => {
        // Track user as online
        if (data.firebaseUid) {
            onlineUsers.set(socket.id, data.firebaseUid);
            firebaseUidToSocket.set(data.firebaseUid, socket.id);
            console.log('User', data.firebaseUid, 'connected and added to onlineUsers');
        }
        
        // Check if player is already in queue
        const existingIndex = matchmakingQueue.findIndex(p => p.id === socket.id);
        if (existingIndex !== -1) {
            socket.emit('matchmakingStatus', { status: 'alreadyInQueue' });
            return;
        }
        
        // Check if player is already in an active game (not finished)
        const playerData = players.get(socket.id);
        if (playerData) {
            const game = games.get(playerData.gameId);
            if (game && game.status !== 'finished') {
                socket.emit('error', { message: 'You are already in a game' });
                return;
            }
            // If game is finished, remove player from players Map so they can matchmake again
            if (game && game.status === 'finished') {
                players.delete(socket.id);
            }
        }
        
        // Add player to queue
        const player = {
            id: socket.id,
            name: data.playerName,
            firebaseUid: data.firebaseUid || null,
            photoURL: data.photoURL || null
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
            const humanChipPoints = data.chipPoints !== undefined ? data.chipPoints : null;
            createBotGame(socket, data.playerName, queuedPlayer.firebaseUid || null, false, true, humanChipPoints); // isTutorial=false, isRanked=true
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
                        photoURL: player1.photoURL || null,
                        guesses: [],
                        row: 0
                    },
                    {
                        id: player2.id,
                        name: player2.name,
                        firebaseUid: player2.firebaseUid || null,
                        photoURL: player2.photoURL || null,
                        guesses: [],
                        row: 0
                    }
                ],
                currentTurn: player1.id, // Randomly choose first player (or could use Math.random())
                activeEffects: [],
                status: 'waiting',
                totalGuesses: 0,
                lastPlayedCards: new Map(),  // Track last card played by each player
                mirroredCards: new Map(),  // Track what card each Card Mirror actually mirrored (playerId -> card)
                isRanked: true  // Games created via findMatch are ranked
            };
            
            game.status = 'playing';
            
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
                        photoURL: p.photoURL || null,
                        guesses: p.guesses || [],
                        row: p.row || 0,
                        isBot: p.isBot || false
                    })),
                    status: game.status,
                    activeEffects: game.activeEffects,
                    totalGuesses: game.totalGuesses,
                    isRanked: game.isRanked || false
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
    
    // Casual matchmaking
    socket.on('findCasualMatch', (data) => {
        // Track user as online
        if (data.firebaseUid) {
            onlineUsers.set(socket.id, data.firebaseUid);
            firebaseUidToSocket.set(data.firebaseUid, socket.id);
            console.log('User', data.firebaseUid, 'connected and added to onlineUsers (casual)');
        }
        
        // Check if player is already in queue
        const existingIndex = casualMatchmakingQueue.findIndex(p => p.id === socket.id);
        if (existingIndex !== -1) {
            socket.emit('matchmakingStatus', { status: 'alreadyInQueue' });
            return;
        }
        
        // Check if player is already in an active game (not finished)
        const playerData = players.get(socket.id);
        if (playerData) {
            const game = games.get(playerData.gameId);
            if (game && game.status !== 'finished') {
                socket.emit('error', { message: 'You are already in a game' });
                return;
            }
            // If game is finished, remove player from players Map so they can matchmake again
            if (game && game.status === 'finished') {
                players.delete(socket.id);
            }
        }
        
        // Add player to casual queue
        const player = {
            id: socket.id,
            name: data.playerName,
            firebaseUid: data.firebaseUid || null,
            photoURL: data.photoURL || null
        };
        
        casualMatchmakingQueue.push(player);
        socket.emit('matchmakingStatus', { status: 'searching' });
        
        console.log(`Player ${data.playerName} (${socket.id}) joined casual matchmaking queue. Queue size: ${casualMatchmakingQueue.length}`);
        
        // Set timeout to match with bot if no player found (20 seconds)
        const botTimeout = setTimeout(() => {
            const queueIndex = casualMatchmakingQueue.findIndex(p => p.id === socket.id);
            if (queueIndex === -1) return; // Already matched
            
            const queuedPlayer = casualMatchmakingQueue[queueIndex];
            casualMatchmakingQueue.splice(queueIndex, 1);
            casualMatchmakingTimeouts.delete(socket.id);
            
            console.log(`No casual match found for ${data.playerName}, creating bot game...`);
            const humanChipPoints = data.chipPoints !== undefined ? data.chipPoints : null;
            createBotGame(socket, data.playerName, queuedPlayer.firebaseUid || null, false, false, humanChipPoints); // isTutorial=false, isRanked=false
        }, 20000); // 20 second timeout
        
        casualMatchmakingTimeouts.set(socket.id, botTimeout);
        
        // Check if we can match players
        if (casualMatchmakingQueue.length >= 2) {
            // Match the first two players
            const player1 = casualMatchmakingQueue.shift();
            const player2 = casualMatchmakingQueue.shift();
            
            // Clear bot timeouts for matched players
            const timeout1 = casualMatchmakingTimeouts.get(player1.id);
            const timeout2 = casualMatchmakingTimeouts.get(player2.id);
            if (timeout1) {
                clearTimeout(timeout1);
                casualMatchmakingTimeouts.delete(player1.id);
            }
            if (timeout2) {
                clearTimeout(timeout2);
                casualMatchmakingTimeouts.delete(player2.id);
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
                        photoURL: player1.photoURL || null,
                        guesses: [],
                        row: 0
                    },
                    {
                        id: player2.id,
                        name: player2.name,
                        firebaseUid: player2.firebaseUid || null,
                        photoURL: player2.photoURL || null,
                        guesses: [],
                        row: 0
                    }
                ],
                currentTurn: player1.id, // Randomly choose first player (or could use Math.random())
                activeEffects: [],
                status: 'waiting',
                totalGuesses: 0,
                lastPlayedCards: new Map(),  // Track last card played by each player
                mirroredCards: new Map(),  // Track what card each Card Mirror actually mirrored (playerId -> card)
                isRanked: false  // Games created via findCasualMatch are NOT ranked
            };
            
            games.set(gameId, game);
            players.set(player1.id, { gameId: gameId, playerId: player1.id });
            players.set(player2.id, { gameId: gameId, playerId: player2.id });
            
            // Track users' games for friend status (even when waiting)
            if (player1.firebaseUid) {
                userToGame.set(player1.firebaseUid, gameId);
                console.log('Casual matchmade game created: Tracked user', player1.firebaseUid, 'in game', gameId, '(waiting)');
            }
            if (player2.firebaseUid) {
                userToGame.set(player2.firebaseUid, gameId);
                console.log('Casual matchmade game created: Tracked user', player2.firebaseUid, 'in game', gameId, '(waiting)');
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
                game.status = 'playing';
                console.log('Casual matchmade game starting. Current turn:', game.currentTurn);
                console.log('Players with firebaseUid:', game.players.map(p => ({ id: p.id, name: p.name, firebaseUid: p.firebaseUid })));
                const gameStateForClients = {
                    gameId: game.gameId,
                    currentTurn: game.currentTurn,
                    players: game.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        firebaseUid: p.firebaseUid || null,
                        photoURL: p.photoURL || null,
                        guesses: p.guesses || [],
                        row: p.row || 0,
                        isBot: p.isBot || false
                    })),
                    status: game.status,
                    activeEffects: game.activeEffects,
                    totalGuesses: game.totalGuesses,
                    isRanked: game.isRanked || false
                };
                
                game.players.forEach(player => {
                    const playerSocket = io.sockets.sockets.get(player.id);
                    if (playerSocket) {
                        console.log(`Sending gameStarted (casual) to ${player.id} (${player.name}) with players:`, gameStateForClients.players.map(p => ({ name: p.name, firebaseUid: p.firebaseUid })));
                        playerSocket.emit('gameStarted', {
                            ...gameStateForClients,
                            yourPlayerId: player.id
                        });
                        // Track user's game for friend status
                        if (player.firebaseUid) {
                            userToGame.set(player.firebaseUid, game.gameId);
                            console.log('Casual matchmade game started: Tracked user', player.firebaseUid, 'in game', game.gameId);
                        }
                    }
                });
            }, 1000);
        }
    });
    
    socket.on('cancelMatchmaking', () => {
        // Check ranked queue
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
            console.log(`Player ${socket.id} left ranked matchmaking queue. Queue size: ${matchmakingQueue.length}`);
        }
        
        // Check casual queue
        const casualIndex = casualMatchmakingQueue.findIndex(p => p.id === socket.id);
        if (casualIndex !== -1) {
            casualMatchmakingQueue.splice(casualIndex, 1);
            
            // Clear bot timeout
            const casualTimeout = casualMatchmakingTimeouts.get(socket.id);
            if (casualTimeout) {
                clearTimeout(casualTimeout);
                casualMatchmakingTimeouts.delete(socket.id);
            }
            
            socket.emit('matchmakingStatus', { status: 'cancelled' });
            console.log(`Player ${socket.id} left casual matchmaking queue. Queue size: ${casualMatchmakingQueue.length}`);
        }
    });
    
    socket.on('createGame', (data) => {
        // Track user as online
        if (data.firebaseUid) {
            onlineUsers.set(socket.id, data.firebaseUid);
            firebaseUidToSocket.set(data.firebaseUid, socket.id);
            console.log('User', data.firebaseUid, 'connected (createGame) and added to onlineUsers');
        }
        
        // Check if player is already in an active game (not finished)
        const playerData = players.get(socket.id);
        if (playerData) {
            const game = games.get(playerData.gameId);
            if (game && game.status !== 'finished') {
                socket.emit('error', { message: 'You are already in a game' });
                return;
            }
            // If game is finished, remove player from players Map so they can create a new game
            if (game && game.status === 'finished') {
                players.delete(socket.id);
            }
        }
        
        // Get game settings from data (defaults if not provided)
        const settings = data.settings || {};
        const turnTimeLimit = settings.turnTimeLimit || 60; // Default 60 seconds
        const gameMode = settings.gameMode || 'classic';
        const startingPlayer = settings.startingPlayer || 'random';
        
        console.log('createGame - Received settings:', settings);
        console.log('createGame - gameMode:', gameMode);
        
        const gameId = generateGameId();
        const word = getRandomWord();
        
        const game = {
            gameId: gameId,
            word: word, // For classic mode, this is the shared word. For duelDeck mode, this is unused.
            players: [{
                id: socket.id,
                name: data.playerName,
                firebaseUid: data.firebaseUid || null,
                photoURL: data.photoURL || null,
                guesses: [],
                row: 0
            }],
            currentTurn: socket.id, // Will be set properly when second player joins based on startingPlayer setting
            activeEffects: [],
            status: 'waiting',
            totalGuesses: 0,  // Shared counter for board rows
            lastPlayedCards: new Map(),  // Track last card played by each player
            mirroredCards: new Map(),  // Track what card each Card Mirror actually mirrored (playerId -> card)
            settings: {
                turnTimeLimit: turnTimeLimit,
                gameMode: gameMode,
                startingPlayer: startingPlayer
            },
            playerWords: new Map(), // For duelDeck mode: playerId -> word
            isPrivateGame: true // Mark as private game (created via createGame, not matchmaking)
        };
        
        games.set(gameId, game);
        players.set(socket.id, { gameId: gameId, playerId: socket.id });
        
        // Track user's game for friend status (even when waiting)
        if (data.firebaseUid) {
            userToGame.set(data.firebaseUid, gameId);
            console.log('Game created: Tracked user', data.firebaseUid, 'in game', gameId, '(waiting)');
        }
        
        socket.join(gameId);
        socket.emit('gameCreated', { gameId: gameId, playerId: socket.id, gameMode: gameMode || 'classic' });
        socket.emit('playerJoined', { players: game.players });
    });
    
    socket.on('submitCustomWord', (data) => {
        const game = games.get(data.gameId);
        if (!game) {
            socket.emit('error', { message: 'Game not found' });
            return;
        }
        
        const player = game.players.find(p => p.id === socket.id);
        if (!player) {
            socket.emit('error', { message: 'Player not found in game' });
            return;
        }
        
        // Only allow in duelDeck mode
        console.log('submitCustomWord check - game.settings:', game.settings);
        console.log('submitCustomWord check - gameMode:', game.settings?.gameMode);
        if (!game.settings || game.settings.gameMode !== 'duelDeck') {
            console.error('Duel deck mode check failed. Settings:', game.settings, 'GameMode:', game.settings?.gameMode);
            socket.emit('error', { message: 'Duel deck mode not enabled. Please make sure you selected Duel Deck mode when creating the game.' });
            return;
        }
        
        const word = data.word.toUpperCase();
        
        // Validate word format (any 5 letters, no dictionary check)
        if (word.length !== 5 || !/^[A-Z]+$/.test(word)) {
            socket.emit('error', { message: 'Invalid word. Must be 5 letters.' });
            return;
        }
        
        // No dictionary validation - allow any 5-letter word
        
        // Initialize playerWords map if it doesn't exist
        if (!game.playerWords) {
            game.playerWords = new Map();
        }
        
        // Store player's word
        game.playerWords.set(socket.id, word);
        console.log(`Player ${socket.id} (${player.name}) submitted custom word: ${word}`);
        
        // Check if both players have submitted their words
        if (game.players.length === 2 && game.playerWords.size === 2) {
            // Both players have submitted words, start the game
            // Set starting player based on settings
            if (game.settings && game.settings.startingPlayer) {
                if (game.settings.startingPlayer === 'creator') {
                    game.currentTurn = game.players[0].id;
                } else if (game.settings.startingPlayer === 'joiner') {
                    game.currentTurn = game.players[1].id;
                } else {
                    game.currentTurn = game.players[Math.random() > 0.5 ? 0 : 1].id;
                }
            } else {
                game.currentTurn = game.players[Math.random() > 0.5 ? 0 : 1].id;
            }
            
            setTimeout(() => {
                game.status = 'playing';
                const gameStateForClients = {
                    gameId: game.gameId,
                    currentTurn: game.currentTurn,
                    players: game.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        firebaseUid: p.firebaseUid || null,
                        photoURL: p.photoURL || null,
                        guesses: p.guesses || [],
                        row: p.row || 0,
                        isBot: p.isBot || false
                    })),
                    status: game.status,
                    activeEffects: game.activeEffects,
                    totalGuesses: game.totalGuesses,
                    isRanked: game.isRanked || false,
                    settings: game.settings || null
                };
                
                game.players.forEach(player => {
                    if (player.isBot) return;
                    const playerSocket = io.sockets.sockets.get(player.id);
                    if (playerSocket) {
                        playerSocket.emit('gameStarted', {
                            ...gameStateForClients,
                            yourPlayerId: player.id
                        });
                    }
                });
            }, 1000);
        } else {
            // Notify player that their word was accepted and they're waiting for opponent
            socket.emit('customWordAccepted', { gameId: data.gameId });
        }
    });
    
    socket.on('joinGame', (data) => {
        // Track user as online
        if (data.firebaseUid) {
            onlineUsers.set(socket.id, data.firebaseUid);
            firebaseUidToSocket.set(data.firebaseUid, socket.id);
            console.log('User', data.firebaseUid, 'connected (joinGame) and added to onlineUsers');
        }
        
        // Check if player is already in an active game (not finished)
        const playerData = players.get(socket.id);
        if (playerData) {
            const existingGame = games.get(playerData.gameId);
            if (existingGame && existingGame.status !== 'finished') {
                socket.emit('error', { message: 'You are already in a game' });
                return;
            }
            // If game is finished, remove player from players Map so they can join a new game
            if (existingGame && existingGame.status === 'finished') {
                players.delete(socket.id);
            }
        }
        
        const game = games.get(data.gameId);
        
        if (!game) {
            socket.emit('error', { message: 'Game not found' });
            return;
        }
        
        if (game.status === 'finished') {
            socket.emit('error', { message: 'Game has already ended' });
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
            photoURL: data.photoURL || null,
            guesses: [],
            row: 0
        });
        
        players.set(socket.id, { gameId: data.gameId, playerId: socket.id });
        socket.join(data.gameId);
        
        // Send the player their ID when they join
        socket.emit('playerJoinedGame', { playerId: socket.id, gameId: data.gameId, gameMode: game.settings?.gameMode || 'classic' });
        
        // If duel deck mode, wait for both players to submit words before starting
        if (game.settings && game.settings.gameMode === 'duelDeck') {
            // Don't start game automatically - wait for words
            return;
        }
        
        io.to(data.gameId).emit('playerJoined', { players: game.players });
        
        // If duel deck mode, wait for both players to submit words before starting
        if (game.settings && game.settings.gameMode === 'duelDeck') {
            // Don't start game automatically - wait for words
            return;
        }
        
        if (game.players.length === 2) {
            // Set starting player based on settings
            if (game.settings && game.settings.startingPlayer) {
                if (game.settings.startingPlayer === 'creator') {
                    game.currentTurn = game.players[0].id; // First player (creator)
                } else if (game.settings.startingPlayer === 'joiner') {
                    game.currentTurn = game.players[1].id; // Second player (joiner)
                } else {
                    // Random (default)
                    game.currentTurn = game.players[Math.random() > 0.5 ? 0 : 1].id;
                }
            } else {
                // Default to random if no settings
                game.currentTurn = game.players[Math.random() > 0.5 ? 0 : 1].id;
            }
            
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
                        photoURL: p.photoURL || null,
                        guesses: p.guesses || [],
                        row: p.row || 0,
                        isBot: p.isBot || false
                    })),
                    status: game.status,
                    activeEffects: game.activeEffects,
                    totalGuesses: game.totalGuesses,
                    isRanked: game.isRanked || false,  // Private games are not ranked
                    settings: game.settings || null  // Include game settings
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
        // Check which friends (by firebaseUid) are currently online and in games
        console.log('checkFriendsInGames: Received request for', data.friendIds?.length || 0, 'friends');
        console.log('checkFriendsInGames: userToGame map has', userToGame.size, 'entries');
        console.log('checkFriendsInGames: onlineUsers map has', onlineUsers.size, 'entries');
        console.log('checkFriendsInGames: Current games:', Array.from(games.keys()));
        
        if (!data.friendIds || !Array.isArray(data.friendIds)) {
            socket.emit('friendsInGames', { friendsInGames: {}, friendsOnline: {} });
            return;
        }
        
        const friendsInGames = {};
        const friendsOnline = {};
        
        // Check each friend's online status and game status
        data.friendIds.forEach(friendFirebaseUid => {
            // Check if friend is online (has an active socket connection)
            const onlineUserValues = Array.from(onlineUsers.values());
            const isOnline = onlineUserValues.includes(friendFirebaseUid);
            friendsOnline[friendFirebaseUid] = isOnline;
            
            const gameId = userToGame.get(friendFirebaseUid);
            console.log('checkFriendsInGames: Friend', friendFirebaseUid, 'is online:', isOnline, 'is in game:', gameId);
            console.log('checkFriendsInGames: Online users list:', onlineUserValues);
            
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
        
        console.log('checkFriendsInGames: Returning', Object.keys(friendsInGames).length, 'friends in games,', Object.values(friendsOnline).filter(Boolean).length, 'friends online');
        socket.emit('friendsInGames', { friendsInGames: friendsInGames, friendsOnline: friendsOnline });
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
            isSpectator: true,
            spectatedPlayerId: game.players[0]?.id || null  // Default to first player
        };
        
        socket.emit('gameStateForSpectator', spectatorGameState);
        
        // Request hand from spectated player to send to spectator
        const spectatedPlayerId = game.players[0]?.id;
        if (spectatedPlayerId) {
            const spectatedPlayerSocket = io.sockets.sockets.get(spectatedPlayerId);
            if (spectatedPlayerSocket) {
                // Request the spectated player's hand
                spectatedPlayerSocket.emit('requestHandForSpectator', {
                    gameId: data.gameId,
                    spectatorId: socket.id
                });
            }
        }
        
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
                spectators: [],
                isRanked: game.isRanked || false  // Preserve ranked status from original game
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
                        photoURL: p.photoURL || null,
                        guesses: p.guesses || [],
                        row: p.row || 0,
                        isBot: p.isBot || false
                    })),
                    status: newGame.status,
                    activeEffects: newGame.activeEffects,
                    totalGuesses: newGame.totalGuesses,
                    isRanked: newGame.isRanked || false
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
        if (!game) {
            socket.emit('error', { message: 'Game not found. Please try refreshing.' });
            console.error(`selectCard: Game ${data.gameId} not found for player ${socket.id}`);
            return;
        }
        if (game.currentTurn !== socket.id) {
            socket.emit('error', { message: 'It is not your turn to select a card.' });
            console.warn(`selectCard: Player ${socket.id} tried to select card but it's not their turn. Current turn: ${game.currentTurn}`);
            return;
        }
        
        // Check if player is card locked
        const isCardLocked = game.activeEffects.some(e => 
            e.type === 'cardLock' && e.target === socket.id && !e.used
        );
        if (isCardLocked) {
            socket.emit('error', { message: 'You cannot use a card this turn - Forced Miss is active!' });
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
        if (!player) {
            socket.emit('error', { message: 'Player not found in game.' });
            console.error(`selectCard: Player ${socket.id} not found in game ${data.gameId}`);
            return;
        }
        
        if (!data.card || !data.card.id) {
            socket.emit('error', { message: 'Invalid card data. Please try selecting the card again.' });
            console.error(`selectCard: Invalid card data from player ${socket.id}`, data.card);
            return;
        }
        
        // Initialize card chain tracking if needed
        if (!game.cardChains) {
            game.cardChains = new Map();
        }
        
        // Get or initialize the card chain for this player
        let cardChain = game.cardChains.get(socket.id) || [];
        
        // Check if player is in snack time mode - if so, this is the card they selected from all deck cards
        if (game.snackTimeMode && game.snackTimeMode.get(socket.id)) {
            // Clear snack time mode - process this card normally
            game.snackTimeMode.delete(socket.id);
            // Continue with normal processing below
        }
        
        // Check if this is a snack time card - trigger it immediately
        if (data.card.id === 'snackTime') {
            // Initialize snack time mode tracking if needed
            if (!game.snackTimeMode) {
                game.snackTimeMode = new Map();
            }
            game.snackTimeMode.set(socket.id, true);
            
            // Emit event to client to trigger snack time selection mode
            socket.emit('snackTimeTriggered', {
                gameId: data.gameId
            });
            
            // Show splash for snack time card
            const splashBehavior = getSplashBehavior(data.card.id);
            if (splashBehavior === 'show') {
                io.to(data.gameId).emit('cardPlayed', {
                    card: data.card,
                    playerName: player ? player.name : 'Player',
                    playerId: socket.id,
                    camoId: data.camoId || 'None' // Include camo from player's selection
                });
                
                // Send system notification to chat with card data
                const cardName = getCardDisplayName(data.card);
                sendSystemChatMessage(data.gameId, `${player ? player.name : 'Player'} played ${cardName}`, data.card);
            }
            
            // Notify the player they can select another card from all available cards
            socket.emit('cardSelected', {
                playerId: socket.id,
                card: data.card,
                allowSecondCard: true,
                snackTimeMode: true
            });
            return;
        }
        
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
                    playerId: socket.id,
                    camoId: data.camoId || 'None' // Include camo from player's selection
                });
                
                // Send system notification to chat with card data
                const cardName = getCardDisplayName(data.card);
                sendSystemChatMessage(data.gameId, `${player ? player.name : 'Player'} played ${cardName}`, data.card);
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
                playerId: socket.id,
                camoId: data.camoId || 'None' // Include camo from player's selection
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
        
        // Check if this is a timeRush card - apply effect immediately when card is selected
        if (realCard.id === 'timeRush' && opponent) {
            // CRITICAL: Remove any existing timeRush effect for this target first (prevent duplicates)
            const existingTimeRush = game.activeEffects.find(e => 
                e.type === 'timeRush' && e.target === opponent.id && !e.used
            );
            if (existingTimeRush) {
                console.log(`Time Rush: Removing existing timeRush effect for ${opponent.id} before adding new one`);
                game.activeEffects = game.activeEffects.filter(e => e !== existingTimeRush);
            }
            
            // Add timeRush effect targeting the opponent
            game.activeEffects.push({
                type: 'timeRush',
                target: opponent.id,
                description: 'Your next turn will only have 20 seconds',
                used: false
            });
            console.log(`Time Rush: Added timeRush effect targeting opponent ${opponent.id}`);
            
            // Notify both players about updated effects
            socket.emit('activeEffectsUpdated', {
                activeEffects: game.activeEffects,
                gameId: data.gameId
            });
            
            const opponentSocket = io.sockets.sockets.get(opponent.id);
            if (opponentSocket) {
                opponentSocket.emit('activeEffectsUpdated', {
                    activeEffects: game.activeEffects,
                    gameId: data.gameId
                });
            }
        }
        
        // Check if this is a slowMotion card - notify both players to add 30 seconds to timer
        if (realCard.id === 'slowMotion') {
            console.log(`Slow Motion: Player ${socket.id} played Slow Motion - notifying both players to add 30 seconds`);
            // Notify the player who played it
            socket.emit('slowMotionPlayed', {
                gameId: data.gameId,
                playerId: socket.id,
                addSeconds: 30
            });
            // Also notify opponent so their timer updates too
            if (opponent) {
                const opponentSocket = io.sockets.sockets.get(opponent.id);
                if (opponentSocket) {
                    opponentSocket.emit('slowMotionPlayed', {
                        gameId: data.gameId,
                        playerId: socket.id,
                        addSeconds: 30
                    });
                }
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
                    playerId: socket.id,
                    camoId: data.camoId || 'None' // Include camo from player's selection
                });
            }
        }
        
        // Send system notification to chat (only once, for visible cards) with card data
        if (!shouldHideFromOpponent && splashBehavior === 'show') {
            const cardName = getCardDisplayName(cardToShowOpponentForSplash);
            sendSystemChatMessage(data.gameId, `${player ? player.name : 'Player'} played ${cardName}`, cardToShowOpponentForSplash);
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
    
    socket.on('sendHandForSpectator', (data) => {
        // Player is sending their hand to a spectator
        const game = games.get(data.gameId);
        if (!game) return;
        
        const spectatorSocket = io.sockets.sockets.get(data.spectatorId);
        if (spectatorSocket) {
            spectatorSocket.emit('spectatedPlayerHand', {
                gameId: data.gameId,
                cards: data.cards,
                playerId: socket.id
            });
        }
    });
    
    socket.on('requestHandForSpectatorUpdate', (data) => {
        // Spectator is requesting an updated hand from the spectated player
        const game = games.get(data.gameId);
        if (!game) return;
        
        const spectatedPlayerSocket = io.sockets.sockets.get(data.spectatedPlayerId);
        if (spectatedPlayerSocket) {
            // Request the spectated player's hand
            spectatedPlayerSocket.emit('requestHandForSpectator', {
                gameId: data.gameId,
                spectatorId: socket.id
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
            socket.emit('error', { message: 'You cannot use a card this turn - Forced Miss is active!' });
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
        
        // Check if this is a snack time card - trigger it immediately (same as normal selectCard)
        if (stolenCard.id === 'snackTime') {
            // Initialize snack time mode tracking if needed
            if (!game.snackTimeMode) {
                game.snackTimeMode = new Map();
            }
            game.snackTimeMode.set(socket.id, true);
            
            // Emit event to client to trigger snack time selection mode
            socket.emit('snackTimeTriggered', {
                gameId: data.gameId
            });
            
            // Show splash for snack time card
            const splashBehavior = getSplashBehavior(stolenCard.id);
            if (splashBehavior === 'show') {
                io.to(data.gameId).emit('cardPlayed', {
                    card: stolenCard,
                    playerName: player ? player.name : 'Player',
                    playerId: socket.id,
                    camoId: data.camoId || 'None' // Include camo from player's selection
                });
                
                // Send system notification to chat with card data
                const cardName = getCardDisplayName(stolenCard);
                sendSystemChatMessage(data.gameId, `${player ? player.name : 'Player'} played ${cardName}`, stolenCard);
            }
            
            // Notify the player they can select another card from all available cards
            socket.emit('cardSelected', {
                playerId: socket.id,
                card: stolenCard,
                allowSecondCard: true,
                snackTimeMode: true
            });
            return;
        }
        
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
        
        // Check if this is a timeRush card - apply effect immediately when card is selected
        if (realCard.id === 'timeRush' && opponent) {
            // CRITICAL: Remove any existing timeRush effect for this target first (prevent duplicates)
            const existingTimeRush = game.activeEffects.find(e => 
                e.type === 'timeRush' && e.target === opponent.id && !e.used
            );
            if (existingTimeRush) {
                console.log(`Time Rush: Removing existing timeRush effect for ${opponent.id} before adding new one`);
                game.activeEffects = game.activeEffects.filter(e => e !== existingTimeRush);
            }
            
            // Add timeRush effect targeting the opponent
            game.activeEffects.push({
                type: 'timeRush',
                target: opponent.id,
                description: 'Your next turn will only have 20 seconds',
                used: false
            });
            console.log(`Time Rush: Added timeRush effect targeting opponent ${opponent.id}`);
            
            // Notify both players about updated effects
            socket.emit('activeEffectsUpdated', {
                activeEffects: game.activeEffects,
                gameId: data.gameId
            });
            
            const opponentSocket = io.sockets.sockets.get(opponent.id);
            if (opponentSocket) {
                opponentSocket.emit('activeEffectsUpdated', {
                    activeEffects: game.activeEffects,
                    gameId: data.gameId
                });
            }
        }
        
        // Check if this is a slowMotion card - notify both players to add 30 seconds to timer
        if (realCard.id === 'slowMotion') {
            console.log(`Slow Motion: Player ${socket.id} played Slow Motion - notifying both players to add 30 seconds`);
            // Notify the player who played it
            socket.emit('slowMotionPlayed', {
                gameId: data.gameId,
                playerId: socket.id,
                addSeconds: 30
            });
            // Also notify opponent so their timer updates too
            if (opponent) {
                const opponentSocket = io.sockets.sockets.get(opponent.id);
                if (opponentSocket) {
                    opponentSocket.emit('slowMotionPlayed', {
                        gameId: data.gameId,
                        playerId: socket.id,
                        addSeconds: 30
                    });
                }
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
                    playerId: socket.id,
                    camoId: data.camoId || 'None' // Include camo from player's selection
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
                            playerId: socket.id,
                            camoId: data.camoId || 'None' // Include camo from player's selection
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
        
        // Validate word format
        if (guess.length !== 5 || !/^[A-Z]+$/.test(guess)) {
            socket.emit('error', { message: 'Invalid word' });
            return;
        }
        
        // Find opponent
        const opponent = game.players.find(p => p.id !== socket.id);
        if (!opponent) return;
        
        // Determine target word based on game mode
        let targetWord;
        if (game.settings && game.settings.gameMode === 'duelDeck') {
            // In duel deck mode, player guesses opponent's word
            targetWord = game.playerWords?.get(opponent.id);
            if (!targetWord) {
                socket.emit('error', { message: 'Opponent has not submitted their word yet' });
                return;
            }
        } else {
            // Classic mode: both players guess the same word
            targetWord = game.word;
        }
        
        // Calculate feedback (always store real feedback)
        const realFeedback = calculateFeedback(guess, targetWord);
        
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
                const effectsBefore = game.activeEffects.length;
                config.effects.onGuess(game, socket.id);
                // If blackHand, amnesia, or moonshine effect was added, notify both players immediately
                if ((actualCard.id === 'blackHand' || actualCard.id === 'amnesia' || actualCard.id === 'moonshine') && game.activeEffects.length > effectsBefore) {
                    console.log(`${actualCard.id}: Notifying players of updated effects`);
                    socket.emit('activeEffectsUpdated', {
                        activeEffects: game.activeEffects,
                        gameId: data.gameId
                    });
                    const opponentSocket = io.sockets.sockets.get(opponent.id);
                    if (opponentSocket) {
                        opponentSocket.emit('activeEffectsUpdated', {
                            activeEffects: game.activeEffects,
                            gameId: data.gameId
                        });
                    }
                }
            } else if (isModifierCard(actualCard.id)) {
                console.log('Skipping modifier card effect:', actualCard.id, '(modifiers handled in selectCard)');
            } else {
                console.log('No onGuess effect for card:', actualCard.id);
            }
        } else if (actualCard) {
            console.log('Warning: Card not found in CARD_CONFIG:', actualCard.id);
        }
        
        // Check for Rem-Job instant win (1% chance) - only in classic mode
        if (game.remJobInstantWin === socket.id && (!game.settings || game.settings.gameMode !== 'duelDeck')) {
            // Rem-Job triggered instant win - treat this guess as the winning word
            game.word = guess;
            game.remJobInstantWin = null; // Clear flag
        }
        
        // Check for win
        const isWin = guess === targetWord;
        if (isWin) {
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
            const shouldHideFromSelfRemJob = game.activeEffects.some(e => 
                e.type === 'remJobHide' && e.target === socket.id && !e.used
            );
            const greenToGreyActive = game.activeEffects.some(e => 
                e.type === 'greenToGrey' && e.target === socket.id && !e.used
            );
            const wordScrambleActive = game.activeEffects.some(e => 
                e.type === 'wordScramble' && e.target === socket.id && !e.used
            );
            
            // Send winning guess to player
            if (!shouldHideFromSelf && !shouldHideFromSelfBlind && !shouldHideFromSelfRemJob) {
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
                
                // In duel deck mode, opponent should see feedback comparing the guess to THEIR target word (the guesser's word)
                const isDuelDeckMode = game.settings && game.settings.gameMode === 'duelDeck';
                let opponentFeedback;
                
                if (isDuelDeckMode) {
                    // In duel deck mode, opponent's target word is the guesser's word (what opponent is trying to guess)
                    const opponentTargetWord = game.playerWords?.get(socket.id);
                    if (opponentTargetWord) {
                        // Calculate feedback comparing the winning guess to opponent's target word (the guesser's word)
                        const opponentTargetFeedback = calculateFeedback(guess, opponentTargetWord);
                        console.log(`Duel deck mode (win): Opponent (${opponent.id}) sees feedback for guesser's (${socket.id}) guess "${guess}" vs opponent's target "${opponentTargetWord}":`, opponentTargetFeedback);
                        
                        if (shouldHideFeedback) {
                            opponentFeedback = ['absent', 'absent', 'absent', 'absent', 'absent'];
                        } else if (falseFeedbackActive) {
                            opponentFeedback = applyCardEffect(opponentTargetFeedback, { id: 'falseFeedback' }, true);
                        } else {
                            opponentFeedback = opponentTargetFeedback;
                        }
                    } else {
                        opponentFeedback = ['absent', 'absent', 'absent', 'absent', 'absent'];
                    }
                } else {
                    // Classic mode: both players guess the same word
                    if (shouldHideFeedback) {
                        opponentFeedback = ['absent', 'absent', 'absent', 'absent', 'absent'];
                    } else if (falseFeedbackActive) {
                        opponentFeedback = applyCardEffect(realFeedback, { id: 'falseFeedback' }, true);
                    } else {
                        opponentFeedback = realFeedback;
                    }
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
            
            // Calculate chip changes for ranked games (SECURITY: server-side calculation)
            const winnerGuesses = player.guesses ? player.guesses.length : 0;
            const loserGuesses = opponent.guesses ? opponent.guesses.length : 0;
            
            // Prepare gameOver data with chip calculations
            // In duel deck mode, send each player their opponent's word (the word they were trying to guess)
            let wordData = { word: game.word };
            if (game.settings && game.settings.gameMode === 'duelDeck') {
                const winnerWord = game.playerWords?.get(socket.id);
                const loserWord = game.playerWords?.get(opponent.id);
                // For winner: show opponent's word (what they were trying to guess)
                // For loser: show opponent's word (what they were trying to guess)
                wordData = {
                    opponentWord: loserWord // The word the winner was trying to guess (loser's word)
                };
            }
            
            const gameOverData = {
                winner: socket.id,
                ...wordData,
                gameId: data.gameId,
                isRanked: game.isRanked || false,
                gameMode: game.settings?.gameMode || 'classic',
                isPrivateGame: game.isPrivateGame || false
            };
            
            // Send separate gameOver data to each player in duel deck mode
            if (game.settings && game.settings.gameMode === 'duelDeck') {
                const winnerWord = game.playerWords?.get(socket.id);
                const loserWord = game.playerWords?.get(opponent.id);
                
                // Winner sees loser's word (what they were trying to guess)
                const winnerGameOverData = {
                    ...gameOverData,
                    opponentWord: loserWord
                };
                
                // Loser sees winner's word (what they were trying to guess)
                const loserGameOverData = {
                    winner: socket.id,
                    opponentWord: winnerWord,
                    gameId: data.gameId,
                    isRanked: game.isRanked || false,
                    gameMode: 'duelDeck',
                    isPrivateGame: game.isPrivateGame || false
                };
                
                // Calculate chip changes for ranked games
                if (game.isRanked) {
                    const winnerGuesses = player.guesses ? player.guesses.length : 0;
                    const loserGuesses = opponent.guesses ? opponent.guesses.length : 0;
                    
                    let winnerChipGain = 20;
                    if (winnerGuesses > 0 && winnerGuesses <= 6) {
                        winnerChipGain += (7 - winnerGuesses) * 5;
                    }
                    const loserChipLoss = -15;
                    
                    winnerGameOverData.winnerChipChange = winnerChipGain;
                    winnerGameOverData.loserChipChange = loserChipLoss;
                    winnerGameOverData.winnerGuesses = winnerGuesses;
                    winnerGameOverData.loserGuesses = loserGuesses;
                    
                    loserGameOverData.winnerChipChange = winnerChipGain;
                    loserGameOverData.loserChipChange = loserChipLoss;
                    loserGameOverData.winnerGuesses = winnerGuesses;
                    loserGameOverData.loserGuesses = loserGuesses;
                }
                
                // Send to each player separately
                socket.emit('gameOver', winnerGameOverData);
                if (opponentSocket) {
                    opponentSocket.emit('gameOver', loserGameOverData);
                }
                
                // Clean up user-to-game tracking
                game.players.forEach(player => {
                    if (player.firebaseUid) {
                        userToGame.delete(player.firebaseUid);
                    }
                    players.delete(player.id);
                });
                
                return; // Exit early, don't send to all players
            }
            
            // Calculate chip changes if ranked game
            if (game.isRanked) {
                // For winner: calculate chip gain (will need current chips from client, but we calculate the change)
                // Base: 20 + efficiency bonus (max 30 for 1 guess)
                let winnerChipGain = 20;
                if (winnerGuesses > 0 && winnerGuesses <= 6) {
                    winnerChipGain += (7 - winnerGuesses) * 5;
                }
                
                // For loser: -15 chips (minimum 0)
                const loserChipLoss = -15;
                
                gameOverData.winnerChipChange = winnerChipGain;
                gameOverData.loserChipChange = loserChipLoss;
                gameOverData.winnerGuesses = winnerGuesses;
                gameOverData.loserGuesses = loserGuesses;
            }
            
            // Clean up user-to-game tracking
            game.players.forEach(player => {
                if (player.firebaseUid) {
                    userToGame.delete(player.firebaseUid);
                }
                // Remove players from players Map so they can matchmake again
                players.delete(player.id);
            });
            
            io.to(data.gameId).emit('gameOver', gameOverData);
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
        
        // Check if remJobHide is active (hides guess from player themselves - Rem-Job 99% effect)
        const shouldHideFromSelfRemJob = game.activeEffects.some(e => 
            e.type === 'remJobHide' && e.target === socket.id && !e.used
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
        
        // Send to guesser (hide if gamblerHide, blindGuess, or remJobHide is active, otherwise show normally)
        if (shouldHideFromSelf || shouldHideFromSelfBlind || shouldHideFromSelfRemJob) {
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
            
            // In duel deck mode, opponent should see feedback comparing the guess to THEIR target word (the guesser's word)
            const isCustomWordMode = game.settings && game.settings.gameMode === 'duelDeck';
            let opponentTargetWord = null;
            
            if (isCustomWordMode) {
                // In duel deck mode, opponent's target word is the guesser's word (what opponent is trying to guess)
                // The opponent is trying to guess the guesser's word, so we compare the guess to the opponent's target word (which is the guesser's word)
                opponentTargetWord = game.playerWords?.get(socket.id); // Guesser's word is what opponent is trying to guess
                if (opponentTargetWord) {
                    // Calculate feedback comparing the guess to opponent's target word (the guesser's word)
                    const opponentTargetFeedback = calculateFeedback(guess, opponentTargetWord);
                    console.log(`Duel deck mode: Opponent (${opponent.id}) sees feedback for guesser's (${socket.id}) guess "${guess}" vs opponent's target "${opponentTargetWord}":`, opponentTargetFeedback);
                    
                    if (shouldHideFeedback) {
                        opponentFeedback = ['absent', 'absent', 'absent', 'absent', 'absent'];
                    } else if (falseFeedbackActive && falseFeedback) {
                        // Apply false feedback to the opponent's target feedback
                        opponentFeedback = applyCardEffect(opponentTargetFeedback, { id: 'falseFeedback' }, true);
                    } else {
                        opponentFeedback = opponentTargetFeedback;
                    }
                } else {
                    // Fallback if word not found
                    opponentFeedback = ['absent', 'absent', 'absent', 'absent', 'absent'];
                }
            } else {
                // Classic mode: both players guess the same word, so feedback is the same
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
            
            // Clear timeRush effect when the affected player's turn ends
            // (when turn switches away from them)
            const hadTimeRush = game.activeEffects.some(e => 
                e.type === 'timeRush' && e.target === socket.id && !e.used
            );
            game.activeEffects = game.activeEffects.filter(e => {
                if (e.type === 'timeRush' && e.target === socket.id) {
                    console.log('Removing timeRush effect after turn ended for player:', socket.id);
                    return false;
                }
                return true;
            });
            
            // CRITICAL: Explicitly notify clients when timeRush is cleared (don't rely only on turnChanged)
            if (hadTimeRush) {
                console.log('TimeRush was cleared - notifying both players');
                socket.emit('activeEffectsUpdated', {
                    activeEffects: game.activeEffects,
                    gameId: data.gameId
                });
                const opponentSocket = io.sockets.sockets.get(opponent.id);
                if (opponentSocket) {
                    opponentSocket.emit('activeEffectsUpdated', {
                        activeEffects: game.activeEffects,
                        gameId: data.gameId
                    });
                }
            }
            
            // Clear blocked card when the blocked player's turn ends
            // (when turn switches away from them)
            if (game.blockedCards && game.blockedCards.has(socket.id)) {
                game.blockedCards.delete(socket.id);
                console.log(`Cleared blocked card for player ${socket.id} after their turn`);
                // Notify client that the card is unblocked
                socket.emit('cardUnblocked', {});
            }
            
            // Clear amnesia effect after the opponent's turn ends
            const amnesiaEffect = game.activeEffects.find(e => 
                e.type === 'amnesia' && e.target === socket.id && !e.used
            );
            if (amnesiaEffect) {
                game.activeEffects = game.activeEffects.filter(e => e !== amnesiaEffect);
                console.log(`Cleared amnesia effect for player ${socket.id} after their turn`);
                // Notify both players that amnesia was cleared
                socket.emit('activeEffectsUpdated', {
                    activeEffects: game.activeEffects,
                    gameId: data.gameId
                });
                const opponentSocket = io.sockets.sockets.get(opponent.id);
                if (opponentSocket) {
                    opponentSocket.emit('activeEffectsUpdated', {
                        activeEffects: game.activeEffects,
                        gameId: data.gameId
                    });
                }
            }
            
            // Clear moonshine effect after the affected player's turn ends
            const moonshineEffect = game.activeEffects.find(e => 
                e.type === 'moonshine' && e.target === socket.id && !e.used
            );
            if (moonshineEffect) {
                game.activeEffects = game.activeEffects.filter(e => e !== moonshineEffect);
                console.log(`Cleared moonshine effect for player ${socket.id} after their turn`);
                // Notify both players that moonshine was cleared
                socket.emit('activeEffectsUpdated', {
                    activeEffects: game.activeEffects,
                    gameId: data.gameId
                });
                const opponentSocket = io.sockets.sockets.get(opponent.id);
                if (opponentSocket) {
                    opponentSocket.emit('activeEffectsUpdated', {
                        activeEffects: game.activeEffects,
                        gameId: data.gameId
                    });
                }
            }
        } else {
            // Extra guess: don't count toward limit, don't switch turns
            // Player gets another turn immediately
            // Mark extra guess as used
            game.activeEffects = game.activeEffects.filter(e => 
                !(e.type === 'extraGuess' && e.target === socket.id && !e.used)
            );
            // Clear timeRush effect even if player has extra guess (timeRush only affects one turn)
            const hadTimeRushExtra = game.activeEffects.some(e => 
                e.type === 'timeRush' && e.target === socket.id && !e.used
            );
            game.activeEffects = game.activeEffects.filter(e => {
                if (e.type === 'timeRush' && e.target === socket.id) {
                    console.log('Removing timeRush effect after first guess (extra guess used):', socket.id);
                    return false;
                }
                return true;
            });
            
            // CRITICAL: Explicitly notify clients when timeRush is cleared in extra guess case
            if (hadTimeRushExtra) {
                console.log('TimeRush was cleared (extra guess) - notifying both players');
                socket.emit('activeEffectsUpdated', {
                    activeEffects: game.activeEffects,
                    gameId: data.gameId
                });
                const opponentSocket = io.sockets.sockets.get(opponent.id);
                if (opponentSocket) {
                    opponentSocket.emit('activeEffectsUpdated', {
                        activeEffects: game.activeEffects,
                        gameId: data.gameId
                    });
                }
            }
            
            // Clear moonshine effect even if player has extra guess (moonshine only affects one turn)
            game.activeEffects = game.activeEffects.filter(e => {
                if (e.type === 'moonshine' && e.target === socket.id) {
                    console.log('Removing moonshine effect after first guess (extra guess used):', socket.id);
                    return false;
                }
                return true;
            });
            // Keep the turn with the same player
            game.currentTurn = socket.id;
            console.log(`Extra guess used - ${socket.id} gets another turn. Turn stays with: ${game.currentTurn}`);
        }
        
        // Remove used effects (mark as used and remove)
        game.activeEffects = game.activeEffects.filter(e => {
            // Remove hiddenGuess, hiddenFeedback, falseFeedback, gamblerHide, gamblerReveal, blindGuess, remJobHide, greenToGrey, wordScramble, hiddenKeyboard, blackHand, and amnesia after they've been used on this guess
            // Note: timeRush is removed in the turn switch section above, not here
            // Note: amnesia is removed after the opponent's turn ends (in the turn switch section)
            if (e.target === socket.id && (
                e.type === 'hiddenGuess' ||
                e.type === 'hiddenFeedback' ||
                e.type === 'falseFeedback' ||
                e.type === 'gamblerHide' ||
                e.type === 'gamblerReveal' ||
                e.type === 'blindGuess' ||
                e.type === 'remJobHide' ||
                e.type === 'greenToGrey' ||
                e.type === 'wordScramble' ||
                e.type === 'hiddenKeyboard' ||
                e.type === 'blackHand'
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
        
        // Also send turnChanged to spectators
        const gameSpectators = spectators.get(data.gameId);
        if (gameSpectators && gameSpectators.size > 0) {
            const spectatorGameState = {
                gameId: game.gameId,
                currentTurn: game.currentTurn,
                players: game.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    guesses: p.guesses,
                    row: p.row
                })),
                status: game.status,
                activeEffects: game.activeEffects,
                totalGuesses: game.totalGuesses
            };
            gameSpectators.forEach(spectatorSocketId => {
                const spectatorSocket = io.sockets.sockets.get(spectatorSocketId);
                if (spectatorSocket) {
                    spectatorSocket.emit('turnChanged', spectatorGameState);
                }
            });
        }
        
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
        
        // Remove from online users tracking
        const firebaseUid = onlineUsers.get(socket.id);
        if (firebaseUid) {
            onlineUsers.delete(socket.id);
            firebaseUidToSocket.delete(firebaseUid);
            console.log('User', firebaseUid, 'disconnected and removed from onlineUsers');
        }
        
        // Clean up pending challenges for this user
        pendingChallenges.forEach((challenge, challengeId) => {
            if (challenge.challengerSocketId === socket.id || 
                (challenge.targetFirebaseUid === firebaseUid && firebaseUidToSocket.get(challenge.targetFirebaseUid) === socket.id)) {
                pendingChallenges.delete(challengeId);
            }
        });
        
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
                const disconnectedPlayer = game.players.find(p => p.id === socket.id);
                const remainingPlayer = game.players.find(p => p.id !== socket.id);
                
                console.log(`Disconnect handler: Game ${playerData.gameId}, status: ${game.status}, disconnected player: ${socket.id}, remaining player: ${remainingPlayer ? remainingPlayer.id : 'none'}`);
                
                // If game is active (playing or waiting) and there's a remaining player, award win to remaining player
                if ((game.status === 'playing' || game.status === 'waiting') && remainingPlayer && !remainingPlayer.isBot) {
                    console.log(`Player ${socket.id} disconnected during active game. Awarding win to ${remainingPlayer.id}`);
                    
                    // Mark game as finished
                    game.status = 'finished';
                    
                    // Clean up user-to-game tracking
                    if (disconnectedPlayer && disconnectedPlayer.firebaseUid) {
                        userToGame.delete(disconnectedPlayer.firebaseUid);
                    }
                    if (remainingPlayer && remainingPlayer.firebaseUid) {
                        userToGame.delete(remainingPlayer.firebaseUid);
                    }
                    
                    // Clean up bot games
                    if (game.isBotGame) {
                        botGames.delete(game.gameId);
                    }
                    
                    // Calculate chip changes for ranked games
                    let chipChangeWinner = 0;
                    let chipChangeLoser = 0;
                    
                    if (game.isRanked) {
                        // Winner gets 10 chips for disconnect wins (fixed amount)
                        chipChangeWinner = 10;
                        
                        // Loser loses 50 chips
                        chipChangeLoser = -50;
                    } else {
                        // Non-ranked games: no chip changes
                        chipChangeWinner = 0;
                        chipChangeLoser = 0;
                    }
                    
                    console.log(`Disconnect handler: game.isRanked=${game.isRanked}, winner chipChange=${chipChangeWinner}, loser chipChange=${chipChangeLoser}`);
                    
                    // Handle duel deck mode for disconnect
                    let disconnectWordData = { word: game.word };
                    if (game.settings && game.settings.gameMode === 'duelDeck') {
                        const disconnectedWord = game.playerWords?.get(socket.id);
                        disconnectWordData = {
                            opponentWord: disconnectedWord // The word the remaining player was trying to guess
                        };
                    }
                    
                    // Send gameOver to remaining player (winner)
                    const remainingSocket = io.sockets.sockets.get(remainingPlayer.id);
                    if (remainingSocket) {
                        const remainingPlayerGuesses = remainingPlayer.guesses ? remainingPlayer.guesses.length : 0;
                        
                        remainingSocket.emit('gameOver', {
                            winner: remainingPlayer.id,
                            ...disconnectWordData,
                            gameId: game.gameId,
                            disconnected: true,
                            chipChange: chipChangeWinner,
                            isRanked: game.isRanked || false,
                            isPrivateGame: game.isPrivateGame || false,
                            guesses: remainingPlayerGuesses,
                            gameMode: game.settings?.gameMode || 'classic'
                        });
                        console.log(`[DISCONNECT] Sent gameOver to winner ${remainingPlayer.id} (${remainingPlayer.name || 'Unknown'})`);
                    } else {
                        console.error(`[DISCONNECT] Could not find socket for remaining player ${remainingPlayer.id}`);
                    }
                    
                    // CRITICAL: Send gameOver to disconnected player if they reconnect
                    // Try to find their socket by Firebase UID (they might have reconnected with new socket)
                    if (disconnectedPlayer && disconnectedPlayer.firebaseUid) {
                        const disconnectedPlayerGuesses = disconnectedPlayer.guesses ? disconnectedPlayer.guesses.length : 0;
                        
                        const gameOverDataForLoser = {
                            winner: remainingPlayer.id,
                            ...disconnectWordData,
                            gameId: game.gameId,
                            disconnected: true,
                            chipChange: chipChangeLoser, // Negative value for loss
                            loserChipChange: chipChangeLoser, // Explicit loser change (for client processing)
                            isRanked: game.isRanked || false,
                            isPrivateGame: game.isPrivateGame || false,
                            guesses: disconnectedPlayerGuesses,
                            gameMode: game.settings?.gameMode || 'classic'
                        };
                        
                        const disconnectedSocket = findSocketByFirebaseUid(disconnectedPlayer.firebaseUid);
                        if (disconnectedSocket) {
                            // Player is online, send immediately
                            disconnectedSocket.emit('gameOver', gameOverDataForLoser);
                            console.log(`[DISCONNECT] Sent gameOver (LOSS) to disconnected player ${disconnectedPlayer.firebaseUid} (socket: ${disconnectedSocket.id}), chipChange: ${chipChangeLoser}`);
                        } else {
                            // Player not online, store for when they reconnect
                            pendingGameResults.set(disconnectedPlayer.firebaseUid, {
                                gameOverData: gameOverDataForLoser,
                                timestamp: Date.now()
                            });
                            console.log(`[DISCONNECT] Disconnected player ${disconnectedPlayer.firebaseUid} not found online - stored pending game result (will be sent on reconnect)`);
                        }
                    }
                    
                    // Remove players from tracking
                    players.delete(socket.id);
                    if (remainingPlayer.id) {
                        players.delete(remainingPlayer.id);
                    }
                    
                    // Delete game
                    games.delete(playerData.gameId);
                } else {
                    // Game not active or no remaining player - normal cleanup
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
                    players.delete(socket.id);
            }
            } else {
            players.delete(socket.id);
            }
        }
    });
    
    // Helper function to reliably find a socket by firebaseUid
    function findSocketByFirebaseUid(firebaseUid) {
        // First try the map
        const socketId = firebaseUidToSocket.get(firebaseUid);
        if (socketId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket && socket.connected) {
                return socket;
            }
        }
        
        // If map lookup failed or socket is disconnected, search all sockets
        // This handles cases where the map is out of sync
        for (const [id, sock] of io.sockets.sockets) {
            const uid = onlineUsers.get(id);
            if (uid === firebaseUid && sock.connected) {
                // Update the map to keep it in sync
                firebaseUidToSocket.set(firebaseUid, id);
                return sock;
            }
        }
        
        return null;
    }
    
    // Challenge system - SIMPLIFIED: Only check if target is online, send challenge immediately
    socket.on('challengeFriend', (data) => {
        const { challengerFirebaseUid, challengerName, targetFirebaseUid, targetName } = data;
        
        console.log(`[CHALLENGE] ===== NEW CHALLENGE REQUEST =====`);
        console.log(`[CHALLENGE] From: ${challengerName} (${challengerFirebaseUid})`);
        console.log(`[CHALLENGE] To: ${targetName} (${targetFirebaseUid})`);
        console.log(`[CHALLENGE] Socket ID: ${socket.id}`);
        
        // Basic validation
        if (!challengerFirebaseUid || !targetFirebaseUid) {
            console.log('[CHALLENGE] ❌ REJECTED: Invalid challenge data - missing UIDs');
            socket.emit('error', { message: 'Invalid challenge data' });
            return;
        }
        
        // Find target socket using reliable method - THIS IS THE ONLY BLOCKING CHECK
        const targetSocket = findSocketByFirebaseUid(targetFirebaseUid);
        if (!targetSocket) {
            console.log(`[CHALLENGE] ❌ REJECTED: Target ${targetName} (${targetFirebaseUid}) is not online`);
            socket.emit('error', { message: 'Friend is not online' });
            return;
        }
        
        if (!targetSocket.connected) {
            console.log(`[CHALLENGE] ❌ REJECTED: Target socket ${targetSocket.id} is not connected`);
            socket.emit('error', { message: 'Friend disconnected. Please try again.' });
            return;
        }
        
        console.log(`[CHALLENGE] ✅ Target ${targetName} found online (socket: ${targetSocket.id}, connected: ${targetSocket.connected})`);
        
        // Clean up ANY existing pending challenges between these two users
        // This is critical - old challenges must be removed before sending new ones
        let cleanedCount = 0;
        const challengesToDelete = [];
        pendingChallenges.forEach((challenge, challengeId) => {
            const involvesChallenger = challenge.challengerFirebaseUid === challengerFirebaseUid || 
                                      challenge.targetFirebaseUid === challengerFirebaseUid;
            const involvesTarget = challenge.challengerFirebaseUid === targetFirebaseUid || 
                                  challenge.targetFirebaseUid === targetFirebaseUid;
            
            if (involvesChallenger && involvesTarget) {
                challengesToDelete.push(challengeId);
            }
        });
        
        if (challengesToDelete.length > 0) {
            console.log(`[CHALLENGE] 🧹 Cleaning up ${challengesToDelete.length} old pending challenge(s)`);
            challengesToDelete.forEach(challengeId => {
                pendingChallenges.delete(challengeId);
                cleanedCount++;
                console.log(`[CHALLENGE]   - Deleted: ${challengeId}`);
            });
        } else {
            console.log(`[CHALLENGE] ℹ️ No old challenges to clean up`);
        }
        
        // Generate unique challenge ID
        const challengeId = `challenge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`[CHALLENGE] 📝 Generated challenge ID: ${challengeId}`);
        
        // Store challenge
        pendingChallenges.set(challengeId, {
            challengerSocketId: socket.id,
            challengerFirebaseUid: challengerFirebaseUid,
            challengerName: challengerName,
            challengerPhotoURL: data.challengerPhotoURL || null,
            targetFirebaseUid: targetFirebaseUid,
            targetName: targetName,
            targetPhotoURL: data.targetPhotoURL || null
        });
        console.log(`[CHALLENGE] 💾 Stored challenge in pendingChallenges (total pending: ${pendingChallenges.size})`);
        
        // ALWAYS send the challenge - no other checks, no other conditions
        const challengeData = {
            challengeId: challengeId,
            challengerFirebaseUid: challengerFirebaseUid,
            challengerName: challengerName,
            challengerPhotoURL: data.challengerPhotoURL || null
        };
        
        try {
            // Send to target
            targetSocket.emit('challengeRequest', challengeData);
            console.log(`[CHALLENGE] ✅✅✅ SUCCESS: Challenge sent to ${targetName} (socket: ${targetSocket.id})`);
            console.log(`[CHALLENGE] 📤 Challenge data:`, JSON.stringify(challengeData));
            
            // Confirm to challenger
            socket.emit('challengeSent', { 
                success: true, 
                targetName: targetName,
                challengeId: challengeId 
            });
            console.log(`[CHALLENGE] ✅ Confirmation sent to challenger ${challengerName}`);
            console.log(`[CHALLENGE] ===== CHALLENGE COMPLETE =====\n`);
        } catch (error) {
            console.error('[CHALLENGE] ❌❌❌ ERROR sending challenge:', error);
            console.error('[CHALLENGE] Error stack:', error.stack);
            // Clean up on error
            pendingChallenges.delete(challengeId);
            socket.emit('error', { message: 'Failed to send challenge. Please try again.' });
        }
    });
    
    socket.on('acceptChallenge', (data) => {
        const { challengeId } = data;
        const challenge = pendingChallenges.get(challengeId);
        
        if (!challenge) {
            socket.emit('error', { message: 'Challenge not found or expired' });
            return;
        }
        
        // Verify this socket is the target
        const targetFirebaseUid = onlineUsers.get(socket.id);
        if (targetFirebaseUid !== challenge.targetFirebaseUid) {
            socket.emit('error', { message: 'Unauthorized' });
            return;
        }
        
        // Get challenger socket using reliable method (in case socket ID changed)
        let challengerSocket = io.sockets.sockets.get(challenge.challengerSocketId);
        if (!challengerSocket || !challengerSocket.connected) {
            // Try to find challenger socket by firebaseUid as fallback
            challengerSocket = findSocketByFirebaseUid(challenge.challengerFirebaseUid);
            if (!challengerSocket) {
                socket.emit('error', { message: 'Challenger is no longer online' });
                pendingChallenges.delete(challengeId);
                return;
            }
        }
        
        // Remove challenge
        pendingChallenges.delete(challengeId);
        
        // Create game between challenger and target
        const gameId = generateGameId();
        const word = getRandomWord();
        
        const game = {
            gameId: gameId,
            word: word,
            players: [
                {
                    id: challenge.challengerSocketId,
                    name: challenge.challengerName,
                    firebaseUid: challenge.challengerFirebaseUid,
                    photoURL: challenge.challengerPhotoURL || null,
                    guesses: [],
                    row: 0
                },
                {
                    id: socket.id,
                    name: challenge.targetName,
                    firebaseUid: challenge.targetFirebaseUid,
                    photoURL: challenge.targetPhotoURL || null,
                    guesses: [],
                    row: 0
                }
            ],
            currentTurn: challenge.challengerSocketId, // Challenger goes first
            activeEffects: [],
            status: 'waiting',
            totalGuesses: 0,
            lastPlayedCards: new Map(),
            mirroredCards: new Map(),
            isRanked: false  // Challenge games are not ranked
        };
        
        games.set(gameId, game);
        players.set(challenge.challengerSocketId, { gameId: gameId, playerId: challenge.challengerSocketId });
        players.set(socket.id, { gameId: gameId, playerId: socket.id });
        
        // Track users' games
        if (challenge.challengerFirebaseUid) {
            userToGame.set(challenge.challengerFirebaseUid, gameId);
        }
        if (challenge.targetFirebaseUid) {
            userToGame.set(challenge.targetFirebaseUid, gameId);
        }
        
        challengerSocket.join(gameId);
        socket.join(gameId);
        
        // Notify both players
        challengerSocket.emit('challengeAccepted', { gameId: gameId });
        socket.emit('challengeAccepted', { gameId: gameId });
        
        // Start the game
        setTimeout(() => {
            const gameStateForClients = {
                gameId: game.gameId,
                currentTurn: game.currentTurn,
                players: game.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    firebaseUid: p.firebaseUid || null,
                        photoURL: p.photoURL || null,
                    guesses: p.guesses || [],
                    row: p.row || 0,
                    isBot: false
                })),
                status: 'playing',
                activeEffects: game.activeEffects,
                    totalGuesses: game.totalGuesses,
                    isRanked: game.isRanked || false
            };
            
            game.status = 'playing';
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
        
        console.log('Challenge accepted, game created:', gameId);
    });
    
    socket.on('denyChallenge', (data) => {
        const { challengeId } = data;
        const challenge = pendingChallenges.get(challengeId);
        
        if (!challenge) {
            return;
        }
        
        // Verify this socket is the target
        const targetFirebaseUid = onlineUsers.get(socket.id);
        if (targetFirebaseUid !== challenge.targetFirebaseUid) {
            return;
        }
        
        // Get challenger socket using reliable method (in case socket ID changed)
        let challengerSocket = io.sockets.sockets.get(challenge.challengerSocketId);
        if (!challengerSocket || !challengerSocket.connected) {
            // Try to find challenger socket by firebaseUid as fallback
            challengerSocket = findSocketByFirebaseUid(challenge.challengerFirebaseUid);
        }
        if (challengerSocket) {
            challengerSocket.emit('challengeDenied', {
                targetName: challenge.targetName
            });
        }
        
        // Remove challenge
        pendingChallenges.delete(challengeId);
        console.log('Challenge denied:', challengeId, 'cleaned up from pendingChallenges');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});


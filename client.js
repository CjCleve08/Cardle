const socket = io();

// Initialize sound manager on user interaction (required for autoplay policy)
function initSoundOnInteraction() {
    if (typeof soundManager !== 'undefined') {
        soundManager.ensureAudioContext();
        // Try to resume background music if it exists but was paused
        if (soundManager.backgroundMusic && soundManager.backgroundMusic.paused) {
            soundManager.backgroundMusic.play().then(() => {
                // Trigger fade in if music was paused
                if (soundManager.backgroundMusic && soundManager.backgroundMusic.volume === 0) {
                    soundManager.backgroundMusic.dispatchEvent(new Event('play'));
                }
            }).catch(error => {
                console.log('Could not resume background music:', error);
            });
        }
    }
}

// Load saved volume settings on startup
function loadVolumeSettings() {
    if (typeof soundManager !== 'undefined') {
        const savedSoundEffectsVolume = localStorage.getItem('soundEffectsVolume');
        const savedMusicVolume = localStorage.getItem('musicVolume');
        
        if (savedSoundEffectsVolume !== null) {
            soundManager.setVolume(parseInt(savedSoundEffectsVolume) / 100);
        }
        
        if (savedMusicVolume !== null) {
            soundManager.setMusicVolume(parseInt(savedMusicVolume) / 100);
        }
    }
}

// Add sound initialization on first user interaction
document.addEventListener('click', initSoundOnInteraction, { once: true });
document.addEventListener('keydown', initSoundOnInteraction, { once: true });

// Load volume settings when sound manager is available
if (typeof soundManager !== 'undefined') {
    loadVolumeSettings();
}

// Firebase Authentication State
let currentUser = null;
let isGuestMode = false;
let guestName = null;

// Turn Timer
let turnTimer = null;
let turnTimeRemaining = 60; // 60 seconds per turn
const TURN_TIME_LIMIT = 60;

// Initialize Firebase Auth State Listener
function initializeAuth() {
    // Ensure screens are initialized first
    if (!ScreenManager.exists('login')) {
        console.warn('Screens not initialized yet, retrying...');
        setTimeout(initializeAuth, 100);
        return;
    }
    
    // Initially hide all screens (remove any active classes from HTML)
    Object.values(ScreenManager.screens).forEach(screen => {
        if (screen) screen.classList.remove('active');
    });
    
    // Check if user was in guest mode (stored in sessionStorage)
    const savedGuestName = sessionStorage.getItem('guestName');
    if (savedGuestName) {
        isGuestMode = true;
        guestName = savedGuestName;
        // Clear stats cache for guest mode
        clearStatsCache();
        if (ScreenManager.show('lobby')) {
            updateLobbyUserInfo();
            // Load and display guest stats
            updateStatsDisplay().catch(error => {
                console.error('Error loading guest stats:', error);
            });
        }
        return;
    }
    
    if (window.firebaseAuth) {
        window.firebaseAuth.onAuthStateChanged((user) => {
            if (user) {
                currentUser = user;
                isGuestMode = false;
                guestName = null;
                console.log('User signed in:', user.email);
                // Clear stats cache when user changes
                clearStatsCache();
                // User is signed in - show lobby
                if (ScreenManager.show('lobby')) {
                    updateLobbyUserInfo();
                    // Load and display stats
                    updateStatsDisplay().catch(error => {
                        console.error('Error loading stats:', error);
                    });
                }
            } else {
                currentUser = null;
                isGuestMode = false;
                guestName = null;
                console.log('User signed out');
                // Clear stats cache on logout
                clearStatsCache();
                // User is signed out - show login
                ScreenManager.show('login');
            }
        });
    } else {
        console.warn('Firebase Auth not initialized. Make sure firebase-config.js is loaded and configured.');
        // If Firebase is not configured, show login
        ScreenManager.show('login');
    }
}

// Initialize auth when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Wait a bit for screens to initialize
        setTimeout(initializeAuth, 50);
    });
} else {
    // DOM is already ready, but screens might not be initialized yet
    setTimeout(initializeAuth, 50);
}

// Authentication Functions
async function handleLogin() {
    if (!window.firebaseAuth) {
        showAuthError('loginError', 'Firebase is not configured. Please set up Firebase first.');
        return;
    }
    
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    
    if (!email || !password) {
        showAuthError('loginError', 'Please enter both email and password');
        return;
    }
    
    try {
        const userCredential = await window.firebaseAuth.signInWithEmailAndPassword(email, password);
        console.log('Login successful:', userCredential.user.email);
        // Auth state change will automatically show lobby
    } catch (error) {
        console.error('Login error:', error);
        let errorMessage = 'Failed to sign in. Please try again.';
        if (error.code === 'auth/user-not-found') {
            errorMessage = 'No account found with this email.';
        } else if (error.code === 'auth/wrong-password') {
            errorMessage = 'Incorrect password.';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = 'Invalid email address.';
        }
        showAuthError('loginError', errorMessage);
    }
}

async function handleGoogleSignIn() {
    if (!window.firebaseAuth) {
        showAuthError('loginError', 'Firebase is not configured. Please set up Firebase first.');
        return;
    }
    
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const userCredential = await window.firebaseAuth.signInWithPopup(provider);
        console.log('Google sign-in successful:', userCredential.user.email);
        
        // Save user data to Firestore if it's a new user
        if (window.firebaseDb && userCredential.additionalUserInfo?.isNewUser) {
            const user = userCredential.user;
            await window.firebaseDb.collection('users').doc(user.uid).set({
                displayName: user.displayName,
                email: user.email,
                photoURL: user.photoURL,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                provider: 'google'
            }, { merge: true });
        }
        
        // Auth state change will automatically show lobby
    } catch (error) {
        console.error('Google sign-in error:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        let errorMessage = 'Failed to sign in with Google. Please try again.';
        if (error.code === 'auth/popup-closed-by-user') {
            errorMessage = 'Sign-in popup was closed. Please try again.';
        } else if (error.code === 'auth/popup-blocked') {
            errorMessage = 'Sign-in popup was blocked. Please allow popups for this site.';
        } else if (error.code === 'auth/cancelled-popup-request') {
            errorMessage = 'Only one popup request is allowed at a time.';
        } else if (error.code === 'auth/operation-not-allowed') {
            errorMessage = 'Google sign-in is not enabled. Please enable it in Firebase Console.';
        } else if (error.code === 'auth/unauthorized-domain') {
            errorMessage = 'This domain is not authorized for Google sign-in. Please add it in Firebase Console.';
        } else if (error.code === 'auth/network-request-failed') {
            errorMessage = 'Network error. Please check your connection and try again.';
        } else {
            // Show the actual error message for debugging
            errorMessage = `Google sign-in failed: ${error.message || error.code || 'Unknown error'}`;
        }
        showAuthError('loginError', errorMessage);
    }
}

async function handleSignup() {
    if (!window.firebaseAuth) {
        showAuthError('signupError', 'Firebase is not configured. Please set up Firebase first.');
        return;
    }
    
    const name = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const passwordConfirm = document.getElementById('signupPasswordConfirm').value;
    const errorDiv = document.getElementById('signupError');
    
    if (!name || !email || !password || !passwordConfirm) {
        showAuthError('signupError', 'Please fill in all fields');
        return;
    }
    
    if (password.length < 6) {
        showAuthError('signupError', 'Password must be at least 6 characters');
        return;
    }
    
    if (password !== passwordConfirm) {
        showAuthError('signupError', 'Passwords do not match');
        return;
    }
    
    try {
        const userCredential = await window.firebaseAuth.createUserWithEmailAndPassword(email, password);
        // Update user profile with display name
        await userCredential.user.updateProfile({
            displayName: name
        });
        
        // Save user data to Firestore
        if (window.firebaseDb) {
            await window.firebaseDb.collection('users').doc(userCredential.user.uid).set({
                displayName: name,
                email: email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
        
        console.log('Signup successful:', userCredential.user.email);
        // Auth state change will automatically show lobby
    } catch (error) {
        console.error('Signup error:', error);
        let errorMessage = 'Failed to create account. Please try again.';
        if (error.code === 'auth/email-already-in-use') {
            errorMessage = 'An account with this email already exists.';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = 'Invalid email address.';
        } else if (error.code === 'auth/weak-password') {
            errorMessage = 'Password is too weak.';
        }
        showAuthError('signupError', errorMessage);
    }
}

function handlePlayAsGuest() {
    // Show guest name input screen
    if (ScreenManager.show('guestName')) {
        hideAuthErrors();
    }
}

function handleContinueAsGuest() {
    const name = document.getElementById('guestNameInput').value.trim();
    
    if (!name) {
        showAuthError('guestNameError', 'Please enter your name');
        return;
    }
    
    if (name.length < 2) {
        showAuthError('guestNameError', 'Name must be at least 2 characters');
        return;
    }
    
    // Set guest mode
    isGuestMode = true;
    guestName = name;
    sessionStorage.setItem('guestName', name);
    // Clear stats cache for guest mode
    clearStatsCache();
    
    // Show lobby
    if (ScreenManager.show('lobby')) {
        updateLobbyUserInfo();
        // Load and display guest stats
        updateStatsDisplay().catch(error => {
            console.error('Error loading guest stats:', error);
        });
    }
}

async function handleLogout() {
    // Clear guest mode if active
    if (isGuestMode) {
        isGuestMode = false;
        guestName = null;
        sessionStorage.removeItem('guestName');
        clearStatsCache();
        ScreenManager.show('login');
        return;
    }
    
    if (!window.firebaseAuth) {
        console.warn('Firebase Auth not available for logout');
        return;
    }
    
    try {
        await window.firebaseAuth.signOut();
        // Auth state change will automatically show login
    } catch (error) {
        console.error('Logout error:', error);
    }
}

function showAuthError(elementId, message) {
    const errorDiv = document.getElementById(elementId);
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
}

function hideAuthErrors() {
    const loginError = document.getElementById('loginError');
    const signupError = document.getElementById('signupError');
    const guestNameError = document.getElementById('guestNameError');
    if (loginError) loginError.style.display = 'none';
    if (signupError) signupError.style.display = 'none';
    if (guestNameError) guestNameError.style.display = 'none';
}

function updateLobbyUserInfo() {
    const userInfoHeader = document.getElementById('userInfoHeader');
    const userDisplayNameHeader = document.getElementById('userDisplayNameHeader');
    const logoutBtn = document.getElementById('logoutBtn');
    const profileName = document.getElementById('profileName');
    const profileEmail = document.getElementById('profileEmail');
    const profileAccountType = document.getElementById('profileAccountType');
    const profileAvatar = document.getElementById('profileAvatar');
    
    if (isGuestMode && guestName) {
        // Guest mode
        if (userDisplayNameHeader) {
            userDisplayNameHeader.textContent = `Playing as ${guestName}`;
        }
        if (userInfoHeader) {
            userInfoHeader.style.display = 'block';
        }
        if (logoutBtn) {
            logoutBtn.style.display = 'block';
        }
        // Update profile tab
        if (profileName) profileName.textContent = guestName;
        if (profileEmail) profileEmail.textContent = 'Guest Account';
        if (profileAccountType) profileAccountType.textContent = 'Guest';
        if (profileAvatar) profileAvatar.textContent = '👤';
    } else if (currentUser) {
        // Authenticated user
        const displayName = currentUser.displayName || currentUser.email?.split('@')[0] || 'Player';
        if (userDisplayNameHeader) {
            userDisplayNameHeader.textContent = displayName;
        }
        if (userInfoHeader) {
            userInfoHeader.style.display = 'block';
        }
        if (logoutBtn) {
            logoutBtn.style.display = 'block';
        }
        // Update profile tab
        if (profileName) profileName.textContent = displayName;
        if (profileEmail) profileEmail.textContent = currentUser.email || '-';
        if (profileAccountType) {
            const provider = currentUser.providerData?.[0]?.providerId || 'email';
            profileAccountType.textContent = provider === 'google.com' ? 'Google Account' : 'Email Account';
        }
        if (profileAvatar) {
            if (currentUser.photoURL) {
                profileAvatar.style.backgroundImage = `url(${currentUser.photoURL})`;
                profileAvatar.style.backgroundSize = 'cover';
                profileAvatar.style.backgroundPosition = 'center';
                profileAvatar.textContent = '';
            } else {
                profileAvatar.textContent = displayName.charAt(0).toUpperCase();
            }
        }
    } else {
        // Not signed in
        if (userInfoHeader) {
            userInfoHeader.style.display = 'none';
        }
        if (logoutBtn) {
            logoutBtn.style.display = 'none';
        }
    }
}

function getPlayerName() {
    if (isGuestMode && guestName) {
        return guestName;
    }
    if (currentUser) {
        return currentUser.displayName || currentUser.email?.split('@')[0] || 'Player';
    }
    return 'Player';
}

// Debug helper: expose function to get word
window.getWord = function() {
    socket.emit('getWord');
    return new Promise((resolve) => {
        socket.once('wordResponse', (data) => {
            console.log('Word:', data.word);
            resolve(data.word);
        });
    });
};

let currentPlayer = null;
let gameState = null;
let selectedCard = null;
let cardChainActive = false; // Track if we're in a card chain (any modifier card active)
let currentRow = 0;
let currentGuess = '';

// Card Configuration Helper Functions
// These use window.CARD_CONFIG which is injected by the server
function getCardConfig() {
    if (!window.CARD_CONFIG) {
        console.error('CARD_CONFIG not loaded! Make sure server is running.');
        return {};
    }
    return window.CARD_CONFIG;
}

function isModifierCard(cardId) {
    const config = getCardConfig();
    return config[cardId]?.modifier?.isModifier === true;
}

function getSplashBehavior(cardId) {
    const config = getCardConfig();
    return config[cardId]?.modifier?.splashBehavior || 'show';
}

function getModifierCards() {
    const config = getCardConfig();
    return Object.keys(config).filter(id => isModifierCard(id));
}

// All available cards in the deck - derived from card config
function getAllCards() {
    const config = getCardConfig();
    if (!config || Object.keys(config).length === 0) {
        // Fallback if config not loaded yet
        return [
            { id: 'falseFeedback', title: 'False Feedback', description: 'Next word your opponent guesses will show incorrect feedback', type: 'hurt' },
            { id: 'hiddenFeedback', title: 'Hidden Feedback', description: 'Next word you guess will only show feedback to you', type: 'help' },
            { id: 'hiddenGuess', title: 'Hidden Guess', description: 'Your next guess will be hidden from your opponent', type: 'help' },
            { id: 'extraGuess', title: 'Extra Turn', description: 'Get an additional turn immediately after this one', type: 'help' },
            { id: 'hideCard', title: 'Hide Card', description: 'Play another card secretly - your opponent won\'t know which one', type: 'help' },
            { id: 'phonyCard', title: 'Phony Card', description: 'Play a card that shows a fake card to your opponent', type: 'hurt' }
        ];
    }
    return Object.values(config).map(c => c.metadata);
}

const ALL_CARDS = getAllCards();

// Deck Management
const DECK_STORAGE_KEY = 'cardle_player_deck';
const DECK_SIZE = 6;

// Statistics Management
// Cache for current stats to avoid repeated Firestore reads
let cachedStats = null;

function getDefaultStats() {
    return {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        totalGuesses: 0,
        gamesWithGuesses: 0
    };
}

async function getPlayerStats() {
    // For guests, use localStorage as fallback
    if (isGuestMode || !currentUser) {
        const stored = localStorage.getItem('cardle_guest_stats');
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error('Error loading guest stats:', e);
            }
        }
        return getDefaultStats();
    }
    
    // For authenticated users, use Firestore
    if (!window.firebaseDb || !currentUser || !currentUser.uid) {
        console.warn('Firebase not available or user not authenticated');
        return getDefaultStats();
    }
    
    // Return cached stats if available
    if (cachedStats !== null) {
        return cachedStats;
    }
    
    try {
        const statsDoc = await window.firebaseDb.collection('stats').doc(currentUser.uid).get();
        if (statsDoc.exists) {
            cachedStats = statsDoc.data();
            return cachedStats;
        } else {
            // No stats yet, return defaults
            cachedStats = getDefaultStats();
            return cachedStats;
        }
    } catch (error) {
        console.error('Error loading stats from Firestore:', error);
        return getDefaultStats();
    }
}

async function savePlayerStats(stats) {
    // For guests, use localStorage
    if (isGuestMode || !currentUser) {
        localStorage.setItem('cardle_guest_stats', JSON.stringify(stats));
        cachedStats = stats;
        return;
    }
    
    // For authenticated users, save to Firestore
    if (!window.firebaseDb || !currentUser || !currentUser.uid) {
        console.warn('Firebase not available or user not authenticated');
        return;
    }
    
    try {
        await window.firebaseDb.collection('stats').doc(currentUser.uid).set(stats, { merge: true });
        cachedStats = stats;
    } catch (error) {
        console.error('Error saving stats to Firestore:', error);
    }
}

async function updateStats(gameResult) {
    const stats = await getPlayerStats();
    
    stats.gamesPlayed++;
    
    if (gameResult.won) {
        stats.wins++;
    } else {
        stats.losses++;
    }
    
    if (gameResult.guesses > 0) {
        stats.totalGuesses += gameResult.guesses;
        stats.gamesWithGuesses++;
    }
    
    await savePlayerStats(stats);
    await updateStatsDisplay();
}

async function updateStatsDisplay() {
    const stats = await getPlayerStats();
    
    const gamesPlayedEl = document.getElementById('statGamesPlayed');
    const winsEl = document.getElementById('statWins');
    const winRateEl = document.getElementById('statWinRate');
    const avgGuessesEl = document.getElementById('statAvgGuesses');
    
    if (gamesPlayedEl) {
        gamesPlayedEl.textContent = stats.gamesPlayed;
    }
    
    if (winsEl) {
        winsEl.textContent = stats.wins;
    }
    
    if (winRateEl) {
        if (stats.gamesPlayed > 0) {
            const winRate = Math.round((stats.wins / stats.gamesPlayed) * 100);
            winRateEl.textContent = winRate + '%';
        } else {
            winRateEl.textContent = '0%';
        }
    }
    
    if (avgGuessesEl) {
        if (stats.gamesWithGuesses > 0) {
            const avgGuesses = (stats.totalGuesses / stats.gamesWithGuesses).toFixed(1);
            avgGuessesEl.textContent = avgGuesses;
        } else {
            avgGuessesEl.textContent = '-';
        }
    }
}

// Clear cached stats when user changes (login/logout)
function clearStatsCache() {
    cachedStats = null;
}

function getPlayerDeck() {
    const stored = localStorage.getItem(DECK_STORAGE_KEY);
    if (stored) {
        try {
            const deck = JSON.parse(stored);
            // Validate deck - ensure all cards still exist
            const allCardIds = getAllCards().map(c => c.id);
            return deck.filter(cardId => allCardIds.includes(cardId));
        } catch (e) {
            console.error('Error loading deck:', e);
        }
    }
    // Default deck: first 6 cards (or all if less than 6)
    const defaultDeck = getAllCards().slice(0, Math.min(DECK_SIZE, getAllCards().length));
    return defaultDeck.map(c => c.id);
}

function savePlayerDeck(deck) {
    localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(deck));
}

function getDeckCards() {
    const deckIds = getPlayerDeck();
    const allCards = getAllCards();
    return deckIds.map(id => allCards.find(c => c.id === id)).filter(Boolean);
}

// Screen Management System
// Lobby Background Animation
let lobbyAnimationInterval = null;
let lobbyAnimationElements = [];

function startLobbyBackgroundAnimation() {
    const container = document.getElementById('lobbyBackgroundAnimation');
    if (!container) return;
    
    // Clear any existing animation
    stopLobbyBackgroundAnimation();
    
    // Create initial elements immediately (no delay)
    for (let i = 0; i < 15; i++) {
        createFallingElement(container);
    }
    
    // Create falling elements periodically
    lobbyAnimationInterval = setInterval(() => {
        createFallingElement(container);
    }, 600); // Create a new element every 0.6 seconds
}

function stopLobbyBackgroundAnimation() {
    if (lobbyAnimationInterval) {
        clearInterval(lobbyAnimationInterval);
        lobbyAnimationInterval = null;
    }
    
    // Remove all falling elements
    lobbyAnimationElements.forEach(el => {
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    });
    lobbyAnimationElements = [];
}

function createFallingElement(container) {
    if (!container) return;
    
    const isCard = Math.random() > 0.5; // 50% chance of card vs letter
    const element = document.createElement('div');
    element.className = `falling-element ${isCard ? 'falling-card' : 'falling-letter'}`;
    
    if (isCard) {
        element.textContent = '🃏';
    } else {
        // Random letter from A-Z
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        element.textContent = letters[Math.floor(Math.random() * letters.length)];
    }
    
    // Random horizontal position
    const leftPosition = Math.random() * 100;
    element.style.left = `${leftPosition}%`;
    
    // Random animation duration (10-20 seconds)
    const duration = 10 + Math.random() * 10;
    element.style.animationDuration = `${duration}s`;
    
    // Very small or no delay to start immediately
    const delay = Math.random() * 0.2; // 0 to 0.2 seconds
    element.style.animationDelay = `${delay}s`;
    
    // Random rotation amount (some elements rotate more than others)
    const rotationAmount = (Math.random() * 2 - 1) * 720; // -720 to 720 degrees
    element.style.setProperty('--rotation', `${rotationAmount}deg`);
    
    container.appendChild(element);
    lobbyAnimationElements.push(element);
    
    // Remove element after animation completes
    setTimeout(() => {
        if (element && element.parentNode) {
            element.parentNode.removeChild(element);
            const index = lobbyAnimationElements.indexOf(element);
            if (index > -1) {
                lobbyAnimationElements.splice(index, 1);
            }
        }
    }, (duration + delay) * 1000);
}

const ScreenManager = {
    screens: {},
    currentScreen: null,
    
    // Initialize all screens
    init() {
        const screenIds = ['login', 'signup', 'guestName', 'lobby', 'waiting', 'game', 'gameOver'];
        screenIds.forEach(id => {
            const element = document.getElementById(id);
            if (!element) {
                console.error(`Screen element with id "${id}" not found in HTML!`);
            } else {
                this.screens[id] = element;
                // Remove any existing active class during initialization
                element.classList.remove('active');
            }
        });
        
        // Verify all screens were found
        const missingScreens = screenIds.filter(id => !this.screens[id]);
        if (missingScreens.length > 0) {
            console.error('Missing screen elements:', missingScreens);
        }
        
        console.log('ScreenManager initialized. Available screens:', Object.keys(this.screens));
    },
    
    // Show a specific screen
    show(screenName) {
        if (!screenName) {
            console.error('showScreen called without screen name');
            return false;
        }
        
        const screen = this.screens[screenName];
        if (!screen) {
            console.error(`Screen "${screenName}" not found! Available screens:`, Object.keys(this.screens));
            return false;
        }
        
        // Clean up background animation if leaving lobby
        if (this.currentScreen === 'lobby' && screenName !== 'lobby') {
            stopLobbyBackgroundAnimation();
        }
        
        // Stop background music if leaving game (but not if going to lobby, lobby has its own music)
        if (this.currentScreen === 'game' && screenName !== 'game' && screenName !== 'lobby') {
            if (typeof soundManager !== 'undefined') {
                soundManager.stopBackgroundMusic();
            }
        }
        
        // Stop lobby music if leaving lobby (but not if going to game, game has its own music)
        if (this.currentScreen === 'lobby' && screenName !== 'lobby' && screenName !== 'game') {
            if (typeof soundManager !== 'undefined') {
                soundManager.stopBackgroundMusic();
            }
        }
        
        // Hide all screens first
        Object.values(this.screens).forEach(s => {
            if (s) {
                s.classList.remove('active');
            }
        });
        
        // Show the requested screen
        screen.classList.add('active');
        this.currentScreen = screenName;
        
        // Initialize background animation if showing lobby
        if (screenName === 'lobby') {
            startLobbyBackgroundAnimation();
            // Start lobby music
            if (typeof soundManager !== 'undefined') {
                soundManager.playLobbyMusic('LobbySoundTrack.mp4');
            }
        }
        
        console.log(`Screen changed to: ${screenName}`);
        return true;
    },
    
    // Get current screen name
    getCurrent() {
        return this.currentScreen;
    },
    
    // Check if a screen exists
    exists(screenName) {
        return !!this.screens[screenName];
    }
};

// Initialize screens when DOM is ready
function initScreens() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ScreenManager.init());
    } else {
        ScreenManager.init();
    }
}

// Initialize immediately
initScreens();

// Convenience function for backward compatibility
function showScreen(screenName) {
    return ScreenManager.show(screenName);
}

// Socket Events
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('gameCreated', (data) => {
    currentPlayer = data.playerId;
    // Show game ID in both lobby and waiting screens
    const gameIdEl = document.getElementById('gameId');
    const gameIdDisplay = document.getElementById('gameIdDisplay');
    const gameIdWaiting = document.getElementById('gameIdWaiting');
    const gameIdDisplayWaiting = document.getElementById('gameIdDisplayWaiting');
    
    if (gameIdEl) gameIdEl.textContent = data.gameId;
    if (gameIdDisplay) gameIdDisplay.style.display = 'block';
    if (gameIdWaiting) gameIdWaiting.textContent = data.gameId;
    if (gameIdDisplayWaiting) gameIdDisplayWaiting.style.display = 'block';
    
    ScreenManager.show('waiting');
});

socket.on('playerJoinedGame', (data) => {
    // Set currentPlayer when joining a game (for player 2)
    if (!currentPlayer) {
        currentPlayer = data.playerId;
        console.log('Set currentPlayer from joinGame:', currentPlayer);
    }
});

socket.on('playerJoined', (data) => {
    updatePlayersList(data.players);
    if (data.players.length === 2) {
        document.getElementById('waitingMessage').textContent = 'Starting game...';
    }
});

socket.on('privateGameCancelled', (data) => {
    if (data.success) {
        // Hide game ID displays
        const gameIdDisplay = document.getElementById('gameIdDisplay');
        const gameIdDisplayWaiting = document.getElementById('gameIdDisplayWaiting');
        if (gameIdDisplay) gameIdDisplay.style.display = 'none';
        if (gameIdDisplayWaiting) gameIdDisplayWaiting.style.display = 'none';
        
        // Reset waiting message
        const waitingMessage = document.getElementById('waitingMessage');
        if (waitingMessage) waitingMessage.textContent = 'Waiting for another player to join...';
        
        // Clear players list
        const p1Name = document.getElementById('p1Name');
        const p2Name = document.getElementById('p2Name');
        if (p1Name) p1Name.textContent = '-';
        if (p2Name) p2Name.textContent = '-';
        
        // Return to lobby
        ScreenManager.show('lobby');
        
        // Play cancel sound
        if (typeof soundManager !== 'undefined') {
            soundManager.playClickSound();
        }
    } else {
        console.error('Failed to cancel private game:', data.message);
        alert('Failed to cancel game: ' + data.message);
    }
});

socket.on('playerLeftPrivateGame', (data) => {
    // Other player left, return to lobby
    const gameIdDisplay = document.getElementById('gameIdDisplay');
    const gameIdDisplayWaiting = document.getElementById('gameIdDisplayWaiting');
    if (gameIdDisplay) gameIdDisplay.style.display = 'none';
    if (gameIdDisplayWaiting) gameIdDisplayWaiting.style.display = 'none';
    
    // Reset waiting message
    const waitingMessage = document.getElementById('waitingMessage');
    if (waitingMessage) waitingMessage.textContent = 'Waiting for another player to join...';
    
    // Clear players list
    const p1Name = document.getElementById('p1Name');
    const p2Name = document.getElementById('p2Name');
    if (p1Name) p1Name.textContent = '-';
    if (p2Name) p2Name.textContent = '-';
    
    // Return to lobby
    ScreenManager.show('lobby');
});

socket.on('gameStarted', (data) => {
    console.log('Game started event received:', data);
    
    // Play game start sound
    if (typeof soundManager !== 'undefined') {
        soundManager.playGameStart();
    }
    
    // Hide matchmaking status if visible
    const matchmakingStatus = document.getElementById('matchmakingStatus');
    const findMatchBtn = document.getElementById('findMatchBtn');
    if (matchmakingStatus) {
        matchmakingStatus.style.display = 'none';
    }
    if (findMatchBtn) {
        findMatchBtn.disabled = false;
    }
    
    // Set currentPlayer from the event if not already set
    if (data.yourPlayerId) {
        currentPlayer = data.yourPlayerId;
        console.log('Set currentPlayer from gameStarted:', currentPlayer);
    }
    
    console.log('My player ID:', currentPlayer);
    
    // Remove yourPlayerId from data before storing in gameState
    const { yourPlayerId, ...gameStateData } = data;
    gameState = gameStateData;
    
    // Ensure gameId is set in gameState (it might be in the data)
    if (data.gameId && !gameState.gameId) {
        gameState.gameId = data.gameId;
    }
    
    if (ScreenManager.show('game')) {
        // Start background music when game starts
        if (typeof soundManager !== 'undefined') {
            soundManager.playBackgroundMusic('GameSoundTrack.mp4');
        }
    initializeGame(gameState);
    } else {
        console.error('Failed to show game screen!');
    }
});

socket.on('cardSelected', (data) => {
    if (data.playerId === currentPlayer) {
        selectedCard = data.card;
        
        // If a modifier card was used, allow another card selection
        if (data.allowSecondCard) {
            cardChainActive = true; // We're in a card chain
            // Don't hide card selection - show it again for next card
            setTimeout(() => {
                showCardSelection();
            }, 100);
        } else {
            // Final card in chain - hide selection and show board
            cardChainActive = false; // Clear flag
        hideCardSelection();
        showGameBoard();
        }
    }
});

socket.on('turnChanged', (data) => {
    console.log('Turn changed event received:', data);
    console.log('Current player ID:', currentPlayer);
    console.log('Current turn ID:', data.currentTurn);
    console.log('Your player ID from event:', data.yourPlayerId);
    
    // Update currentPlayer if provided in the event (shouldn't be necessary but good fallback)
    if (data.yourPlayerId) {
        if (!currentPlayer) {
            currentPlayer = data.yourPlayerId;
            console.log('Set currentPlayer from turnChanged event:', currentPlayer);
        } else if (currentPlayer !== data.yourPlayerId) {
            console.warn('currentPlayer mismatch! Had:', currentPlayer, 'Got:', data.yourPlayerId);
            currentPlayer = data.yourPlayerId; // Update it
        }
    }
    
    console.log('Is it my turn?', data.currentTurn === currentPlayer);
    console.log('Type check - currentPlayer type:', typeof currentPlayer, 'currentTurn type:', typeof data.currentTurn);
    
    // Update gameState with the new turn info (remove yourPlayerId before storing)
    const { yourPlayerId, ...gameStateData } = data;
    if (gameState) {
        gameState.currentTurn = gameStateData.currentTurn;
        gameState.players = gameStateData.players;
        gameState.status = gameStateData.status;
        gameState.activeEffects = gameStateData.activeEffects;
        if (gameStateData.totalGuesses !== undefined) {
            gameState.totalGuesses = gameStateData.totalGuesses;
        }
    } else {
        gameState = gameStateData;
    }
    
    stopTurnTimer(); // Stop timer when turn changes
    
    // Both players should track the timer, but only the player whose turn it is can trigger timeout
    const currentTurnStr = String(data.currentTurn).trim();
    const currentPlayerStr = String(currentPlayer).trim();
    
    // Also check against yourPlayerId if available (more reliable)
    let myTurn = false;
    if (data.yourPlayerId) {
        const yourPlayerIdStr = String(data.yourPlayerId).trim();
        myTurn = (currentTurnStr === yourPlayerIdStr) || (currentTurnStr === currentPlayerStr);
        console.log('Using yourPlayerId for comparison:', yourPlayerIdStr);
    } else {
        myTurn = currentTurnStr === currentPlayerStr;
    }
    
    console.log('After string conversion - Is it my turn?', myTurn);
    console.log('String comparison:', `"${currentTurnStr}" === "${currentPlayerStr}"`);
    console.log('Current turn length:', currentTurnStr.length, 'Current player length:', currentPlayerStr.length);
    
    // Update turn indicator and start timer (both players track the timer)
    updateTurnIndicator();
    updatePlayerStatus();
    
    // Always show game board so players can see previous guesses
    showGameBoard();
    
    // Play turn change sound
    if (typeof soundManager !== 'undefined') {
        soundManager.playTurnChange();
    }
    
    if (myTurn) {
        // It's my turn - show card selection and enable input
        console.log('✓ Showing card selection for my turn');
        
        // Helper function to show card selection
        const showCardSelectionNow = () => {
            showCardSelection();
            document.getElementById('wordInput').disabled = false;
            document.getElementById('wordInput').value = '';
            selectedCard = null; // Reset selected card for new turn
            cardChainActive = false; // Reset card chain flag
            // Focus input after a short delay to ensure card selection is visible
            setTimeout(() => {
                document.getElementById('wordInput').focus();
            }, 100);
        };
        
        // Check if it's the first turn (no guesses made yet)
        const isFirstTurn = !gameState || !gameState.totalGuesses || gameState.totalGuesses === 0;
        
        if (isFirstTurn) {
            // First turn - show immediately
            showCardSelectionNow();
        } else {
            // Not first turn - wait 3 seconds before showing card selection
            setTimeout(showCardSelectionNow, 3000);
        }
    } else {
        // It's opponent's turn - hide card selection, disable input
        console.log('✗ Hiding card selection - opponent\'s turn');
        hideCardSelection();
        document.getElementById('wordInput').disabled = true;
        document.getElementById('wordInput').value = '';
    }
});

socket.on('guessSubmitted', (data) => {
    if (data.playerId === currentPlayer) {
        // This is my guess
        if (data.hidden || !data.guess || !data.feedback) {
            // Guess is hidden from player (Gambler's Card bad luck)
            displayOpponentGuessHidden(data.row);
            console.log('Your guess was hidden by Gambler\'s Card!');
        } else {
            // Normal display
        displayGuess(data.guess, data.feedback, data.row);
        updateKeyboard({ guess: data.guess, feedback: data.feedback });
        }
    } else {
        // This is opponent's guess
        if (data.hidden || !data.guess) {
            // Guess is completely hidden (hiddenGuess card)
            displayOpponentGuessHidden(data.row);
        } else if (data.feedback && data.feedback.every(f => f === 'absent') && data.guess) {
            // Hidden feedback - guess is visible but all letters are grey (absent)
            // This happens when opponent used hiddenFeedback card
            displayOpponentGuess(data.guess, data.feedback, data.row);
            // Don't update keyboard since feedback is false
        } else if (!data.feedback) {
            // Fallback: no feedback available
            displayOpponentGuess(data.guess, ['absent', 'absent', 'absent', 'absent', 'absent'], data.row);
        } else {
            // Both guess and feedback are visible (normal or false feedback)
            displayOpponentGuess(data.guess, data.feedback, data.row);
            // Only update keyboard if it's not all absent (hidden feedback)
            if (!data.feedback.every(f => f === 'absent')) {
            updateKeyboard({ guess: data.guess, feedback: data.feedback });
        }
    }
    }
    // Don't increment currentRow here - it's managed by the server via data.row
});

socket.on('letterRevealed', (data) => {
    // Show revealed letter information (Gambler's Card lucky outcome)
    showGameMessage(
        '🎰',
        'Gambler\'s Card',
        `Letter <span class="highlight">${data.letter}</span> is at position <span class="highlight">${data.position + 1}</span>!`
    );
    console.log('Letter revealed:', data.letter, 'at position', data.position + 1);
});

socket.on('requestHand', (data) => {
    // Opponent is requesting to see our hand (Hand Reveal card)
    // Ensure we have cards in hand - generate them if needed
    if (!window.playerCardHand || window.playerCardHand.length < 3) {
        // Initialize deck pool if needed
        if (!window.deckPool || window.deckPool.length === 0) {
            initializeDeckPool();
        }
        
        // Draw cards to fill hand
        if (!window.playerCardHand) {
            window.playerCardHand = [];
        }
        while (window.playerCardHand.length < 3) {
            const newCard = drawCardFromDeck();
            window.playerCardHand.push(newCard);
        }
    }
    
    // Send current hand to server (up to 3 cards)
    const handToSend = window.playerCardHand.slice(0, 3).map(card => ({
        id: card.id,
        title: card.title,
        description: card.description
    }));
    
    socket.emit('sendHand', {
        gameId: data.gameId,
        requesterId: data.requesterId,
        cards: handToSend
    });
});

socket.on('requestHandForSteal', (data) => {
    // Opponent is requesting to see our hand for card stealing
    // Ensure we have cards in hand - generate them if needed
    if (!window.playerCardHand || window.playerCardHand.length < 3) {
        // Initialize deck pool if needed
        if (!window.deckPool || window.deckPool.length === 0) {
            initializeDeckPool();
        }
        
        // Draw cards to fill hand
        if (!window.playerCardHand) {
            window.playerCardHand = [];
        }
        while (window.playerCardHand.length < 3) {
            const newCard = drawCardFromDeck();
            window.playerCardHand.push(newCard);
        }
    }
    
    // Send current hand to server (up to 3 cards)
    const handToSend = window.playerCardHand.slice(0, 3).map(card => ({
        id: card.id,
        title: card.title,
        description: card.description
    }));
    
    socket.emit('sendHandForSteal', {
        gameId: data.gameId,
        requesterId: data.requesterId,
        cards: handToSend
    });
});

socket.on('requestHandForBlock', (data) => {
    // Opponent is requesting to see our hand for card blocking
    // Ensure we have cards in hand - generate them if needed
    if (!window.playerCardHand || window.playerCardHand.length < 3) {
        // Initialize deck pool if needed
        if (!window.deckPool || window.deckPool.length === 0) {
            initializeDeckPool();
        }
        
        // Draw cards to fill hand
        if (!window.playerCardHand) {
            window.playerCardHand = [];
        }
        while (window.playerCardHand.length < 3) {
            const newCard = drawCardFromDeck();
            window.playerCardHand.push(newCard);
        }
    }
    
    // Send current hand to server (up to 3 cards)
    const handToSend = window.playerCardHand.slice(0, 3).map(card => ({
        id: card.id,
        title: card.title,
        description: card.description
    }));
    
    socket.emit('sendHandForBlock', {
        gameId: data.gameId,
        requesterId: data.requesterId,
        cards: handToSend
    });
});

socket.on('cardBlocked', (data) => {
    // A card in our hand has been blocked
    window.blockedCardId = data.blockedCardId;
    // Update hand panel to show blocked card (no message shown to keep it secret)
    updateHandPanel();
});

socket.on('opponentHandRevealed', (data) => {
    // Display opponent's hand that was revealed
    displayOpponentHand(data.cards, data.opponentName);
});

socket.on('opponentHandForSteal', (data) => {
    // Display opponent's hand for card stealing - make cards selectable
    displayOpponentHandForSteal(data.cards, data.opponentName, data.gameId);
});

function displayOpponentHand(cards, opponentName) {
    const overlay = document.getElementById('handRevealOverlay');
    const cardsContainer = document.getElementById('handRevealCards');
    const button = document.getElementById('handRevealButton');
    const title = document.querySelector('.hand-reveal-title');
    
    if (!overlay || !cardsContainer || !button) {
        console.error('Hand reveal elements not found');
        return;
    }
    
    // Reset title to default
    if (title) {
        title.textContent = 'Opponent\'s Hand Revealed';
    }
    button.textContent = 'Got it!';
    
    // Clear previous cards
    cardsContainer.innerHTML = '';
    
    // Display each card
    if (cards && cards.length > 0) {
        cards.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = 'hand-reveal-card';
            cardElement.style.animationDelay = `${index * 0.1}s`;
            cardElement.innerHTML = `
                <div class="hand-reveal-card-title">${card.title}</div>
                <div class="hand-reveal-card-description">${card.description}</div>
            `;
            cardsContainer.appendChild(cardElement);
        });
    } else {
        // No cards in hand
        const noCardsMsg = document.createElement('div');
        noCardsMsg.style.cssText = 'color: #d7dadc; font-size: 1.1rem; padding: 20px;';
        noCardsMsg.textContent = 'Opponent has no cards in hand';
        cardsContainer.appendChild(noCardsMsg);
    }
    
    // Show overlay
    overlay.classList.remove('show', 'hiding');
    void overlay.offsetWidth; // Force reflow
    overlay.classList.add('show');
    
    // Close handler
    const closeHandReveal = () => {
        overlay.classList.add('hiding');
        setTimeout(() => {
            overlay.classList.remove('show', 'hiding');
        }, 300);
        button.removeEventListener('click', closeHandReveal);
    };
    
    button.addEventListener('click', closeHandReveal);
}

function displayOpponentHandForSteal(cards, opponentName, gameId) {
    const overlay = document.getElementById('handRevealOverlay');
    const cardsContainer = document.getElementById('handRevealCards');
    const button = document.getElementById('handRevealButton');
    const title = document.querySelector('.hand-reveal-title');
    
    if (!overlay || !cardsContainer || !button || !title) {
        console.error('Hand reveal elements not found');
        return;
    }
    
    // Update title to indicate selection mode
    title.textContent = 'Select a Card to Steal';
    
    // Clear previous cards
    cardsContainer.innerHTML = '';
    
    // Display each card as clickable
    if (cards && cards.length > 0) {
        cards.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = 'hand-reveal-card';
            cardElement.style.animationDelay = `${index * 0.1}s`;
            cardElement.style.cursor = 'pointer';
            cardElement.innerHTML = `
                <div class="hand-reveal-card-title">${card.title}</div>
                <div class="hand-reveal-card-description">${card.description}</div>
            `;
            
            // Add hover effect
            cardElement.addEventListener('mouseenter', () => {
                cardElement.style.transform = 'translateY(-5px) scale(1.05)';
                cardElement.style.borderColor = '#6aaa64';
                cardElement.style.boxShadow = '0 12px 24px rgba(106, 170, 100, 0.4)';
            });
            
            cardElement.addEventListener('mouseleave', () => {
                cardElement.style.transform = '';
                cardElement.style.borderColor = '';
                cardElement.style.boxShadow = '';
            });
            
            // Add click handler to select and steal the card
            cardElement.addEventListener('click', () => {
                // Hide overlay immediately
                overlay.classList.add('hiding');
                setTimeout(() => {
                    overlay.classList.remove('show', 'hiding');
                    // Reset title and button
                    title.textContent = 'Opponent\'s Hand Revealed';
                    button.textContent = 'Got it!';
                }, 300);
                
                // Show splash immediately for better feedback
                const config = getCardConfig();
                if (config && config[card.id]) {
                    const splashBehavior = config[card.id].modifier?.splashBehavior || 'show';
                    if (splashBehavior === 'show') {
                        showCardSplash(card, 'You');
                    }
                }
                
                // Send the selected card to server
                socket.emit('selectOpponentCard', {
                    gameId: gameId,
                    card: card
                });
            });
            
            cardsContainer.appendChild(cardElement);
        });
    } else {
        // No cards in hand
        const noCardsMsg = document.createElement('div');
        noCardsMsg.style.cssText = 'color: #d7dadc; font-size: 1.1rem; padding: 20px;';
        noCardsMsg.textContent = 'Opponent has no cards in hand';
        cardsContainer.appendChild(noCardsMsg);
    }
    
    // Show overlay
    overlay.classList.remove('show', 'hiding');
    void overlay.offsetWidth; // Force reflow
    overlay.classList.add('show');
    
    // Update button text
    button.textContent = 'Cancel';
    
    // Close handler (cancel)
    const closeHandReveal = () => {
        overlay.classList.add('hiding');
        setTimeout(() => {
            overlay.classList.remove('show', 'hiding');
            // Reset title
            title.textContent = 'Opponent\'s Hand Revealed';
            button.textContent = 'Got it!';
        }, 300);
        button.removeEventListener('click', closeHandReveal);
    };
    
    button.addEventListener('click', closeHandReveal);
}

socket.on('gameOver', (data) => {
    if (!ScreenManager.show('gameOver')) {
        console.error('Failed to show gameOver screen!');
        return;
    }
    
    const titleEl = document.getElementById('gameOverTitle');
    const messageEl = document.getElementById('gameOverMessage');
    const iconEl = document.getElementById('gameOverIcon');
    const wordEl = document.getElementById('gameOverWord');
    
    const won = data.winner === currentPlayer;
    // Get guess count - use player's row (individual guess count) if available
    let guesses = 0;
    if (gameState && gameState.players) {
        const player = gameState.players.find(p => p.id === currentPlayer);
        if (player) {
            // Use player.row which tracks individual player's guesses
            guesses = player.row || 0;
            // If row is 0 but they won, they must have guessed at least once
            if (guesses === 0 && won) {
                guesses = 1;
            }
        }
    }
    
    if (won) {
        titleEl.textContent = 'You Win!';
        titleEl.classList.add('win');
        titleEl.classList.remove('lose');
        messageEl.textContent = 'Congratulations! You guessed the word!';
        iconEl.textContent = '🎉';
        wordEl.textContent = data.word;
        
        // Play win sound
        if (typeof soundManager !== 'undefined') {
            soundManager.playGameWin();
        }
    } else {
        titleEl.textContent = 'You Lost!';
        titleEl.classList.add('lose');
        titleEl.classList.remove('win');
        messageEl.textContent = 'Better luck next time! The word was:';
        iconEl.textContent = '😔';
        wordEl.textContent = data.word;
        
        // Play lose sound
        if (typeof soundManager !== 'undefined') {
            soundManager.playGameLose();
        }
    }
    
    // Update statistics (async, but don't wait for it)
    updateStats({
        won: won,
        guesses: guesses
    }).catch(error => {
        console.error('Error updating stats:', error);
    });
});

socket.on('error', (data) => {
    alert(data.message);
});

socket.on('matchmakingStatus', (data) => {
    const matchmakingStatus = document.getElementById('matchmakingStatus');
    const matchmakingText = document.getElementById('matchmakingText');
    const findMatchBtn = document.getElementById('findMatchBtn');
    
    if (data.status === 'searching') {
        // Show matchmaking status
        matchmakingStatus.style.display = 'flex';
        matchmakingText.textContent = 'Searching for opponent...';
        findMatchBtn.disabled = true;
    } else if (data.status === 'matched') {
        // Play match found sound
        if (typeof soundManager !== 'undefined') {
            soundManager.playMatchFound();
        }
        // Hide matchmaking status (game will start)
        matchmakingStatus.style.display = 'none';
        findMatchBtn.disabled = false;
    } else if (data.status === 'cancelled') {
        // Hide matchmaking status
        matchmakingStatus.style.display = 'none';
        findMatchBtn.disabled = false;
    }
});

socket.on('cardPlayed', (data) => {
    // Show splash for both players when a card is played
    console.log('Card played event received:', data);
    if (data && data.card) {
        showCardSplash(data.card, data.playerName);
    }
});

socket.on('chatMessage', (data) => {
    // Receive and display chat message
    displayChatMessage(data.playerName, data.message, data.timestamp, data.playerId === currentPlayer);
    
    // Play chat message sound (only for messages from others)
    if (typeof soundManager !== 'undefined' && data.playerId !== currentPlayer) {
        soundManager.playChatMessage();
    }
    
    // Flash the show chat button if chat is hidden and it's not your own message
    const chatContainer = document.getElementById('chatContainer');
    const chatShowBtn = document.getElementById('chatShowBtn');
    
    if (chatContainer && chatShowBtn && chatContainer.classList.contains('hidden') && data.playerId !== currentPlayer) {
        // Remove any existing flash class
        chatShowBtn.classList.remove('flash');
        
        // Force reflow to restart animation
        void chatShowBtn.offsetWidth;
        
        // Add flash class
        chatShowBtn.classList.add('flash');
        
        // Remove flash class after animation completes (3 flashes * 0.6s = 1.8s)
        setTimeout(() => {
            chatShowBtn.classList.remove('flash');
        }, 1800);
    }
});

// UI Functions
// showScreen is now provided by ScreenManager (defined earlier)

function updatePlayersList(players) {
    if (players[0]) {
        document.getElementById('p1Name').textContent = players[0].name;
    }
    if (players[1]) {
        document.getElementById('p2Name').textContent = players[1].name;
    }
}

function initializeGame(data) {
    currentRow = 0;
    // Reset card hand and initialize deck pool for new game
    window.playerCardHand = [];
    window.blockedCardId = null; // Clear blocked card for new game
    initializeDeckPool();
    createBoard();
    createKeyboard();
    stopTurnTimer(); // Reset timer for new game
    updateTurnIndicator();
    updatePlayerStatus();
    
    // Clear chat messages for new game
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        chatMessages.innerHTML = '';
    }
    
    // Update hand panel when game initializes
    updateHandPanel();
    
    if (data.currentTurn === currentPlayer) {
        // It's my turn - show card selection and enable input
        showGameBoard();
        // First turn - show immediately (no guesses made yet)
        showCardSelection();
        document.getElementById('wordInput').disabled = false;
        selectedCard = null;
    } else {
        // It's opponent's turn - hide card selection, disable input
        hideCardSelection();
        showGameBoard();
        document.getElementById('wordInput').disabled = true;
    }
}

function createBoard() {
    const container = document.getElementById('boardContainer');
    container.innerHTML = '';
    
    // Start with 6 rows, but we'll add more dynamically as needed
    for (let i = 0; i < 6; i++) {
        createBoardRow(i);
    }
    
    // Initialize scroll behavior
    setupScrollBehavior();
}

function createBoardRow(rowIndex) {
    const container = document.getElementById('boardContainer');
        const row = document.createElement('div');
        row.className = 'board-row';
    row.id = `row-${rowIndex}`;
    row.style.scrollSnapAlign = 'start';
        
        for (let j = 0; j < 5; j++) {
            const cell = document.createElement('div');
            cell.className = 'board-cell';
        cell.id = `cell-${rowIndex}-${j}`;
            row.appendChild(cell);
        }
        
        container.appendChild(row);
    return row;
}

function ensureBoardRowExists(rowIndex) {
    const row = document.getElementById(`row-${rowIndex}`);
    if (!row) {
        createBoardRow(rowIndex);
        // Scroll to show the new row after a brief delay
        setTimeout(() => {
            const container = document.getElementById('boardContainer');
            const newRow = document.getElementById(`row-${rowIndex}`);
            if (container && newRow) {
                container.scrollTop = newRow.offsetTop;
                updateScrollButtons();
            }
        }, 100);
    }
}

function setupScrollBehavior() {
    const container = document.getElementById('boardContainer');
    const scrollUpBtn = document.getElementById('scrollUpBtn');
    const scrollDownBtn = document.getElementById('scrollDownBtn');
    
    if (!container || !scrollUpBtn || !scrollDownBtn) return;
    
    // Snapping scroll function
    function scrollToRow(direction) {
        const rows = container.querySelectorAll('.board-row');
        if (rows.length === 0) return;
        
        const containerTop = container.scrollTop;
        const rowHeight = rows[0].offsetHeight + 5; // row height + gap
        const visibleRows = Math.floor(container.clientHeight / rowHeight);
        
        let targetScroll = 0;
        
        if (direction === 'up') {
            // Calculate which row is currently at the top
            const currentRowIndex = Math.round(containerTop / rowHeight);
            const newRowIndex = Math.max(0, currentRowIndex - 1);
            targetScroll = newRowIndex * rowHeight;
        } else {
            // Scroll down
            const currentRowIndex = Math.round(containerTop / rowHeight);
            const maxScroll = container.scrollHeight - container.clientHeight;
            const newRowIndex = Math.min(
                Math.floor(maxScroll / rowHeight),
                currentRowIndex + 1
            );
            targetScroll = Math.min(newRowIndex * rowHeight, maxScroll);
        }
        
        // Snap scroll instantly
        container.scrollTop = targetScroll;
        
        // Update buttons after a brief delay
        setTimeout(updateScrollButtons, 50);
    }
    
    scrollUpBtn.addEventListener('click', () => scrollToRow('up'));
    scrollDownBtn.addEventListener('click', () => scrollToRow('down'));
    
    // Update button visibility on scroll
    container.addEventListener('scroll', updateScrollButtons);
    
    // Initial button state
    updateScrollButtons();
}

function updateScrollButtons() {
    const container = document.getElementById('boardContainer');
    const scrollUpBtn = document.getElementById('scrollUpBtn');
    const scrollDownBtn = document.getElementById('scrollDownBtn');
    
    if (!container || !scrollUpBtn || !scrollDownBtn) return;
    
    const isAtTop = container.scrollTop <= 5;
    const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 5;
    
    scrollUpBtn.classList.toggle('hidden', isAtTop);
    scrollDownBtn.classList.toggle('hidden', isAtBottom);
}

function createKeyboard() {
    const keyboard = document.getElementById('keyboard');
    keyboard.innerHTML = '';
    
    const rows = [
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
    ];
    
    rows.forEach(rowKeys => {
        const row = document.createElement('div');
        row.className = 'keyboard-row';
        
        rowKeys.forEach(key => {
            const keyBtn = document.createElement('button');
            keyBtn.className = 'key';
            keyBtn.textContent = key;
            keyBtn.onclick = () => handleKeyPress(key);
            row.appendChild(keyBtn);
        });
        
        keyboard.appendChild(row);
    });
}

function showCardSelection() {
    const cardSelection = document.getElementById('cardSelection');
    if (cardSelection) {
        cardSelection.style.display = 'flex';
        console.log('Card selection shown');
        
        // Check if player is card locked
        if (isCardLocked()) {
            // Show a message that cards are locked
            const cardsContainer = document.getElementById('cardsContainer');
            if (cardsContainer) {
                const lockMessage = document.createElement('div');
                lockMessage.id = 'cardLockMessage';
                lockMessage.style.cssText = 'text-align: center; padding: 20px; color: #ff6b6b; font-weight: bold; font-size: 18px;';
                lockMessage.textContent = '🔒 Card Locked - You cannot use a card this turn!';
                cardsContainer.innerHTML = '';
                cardsContainer.appendChild(lockMessage);
            }
            
            // Automatically hide card selection after 2.5 seconds so player can make a guess
            setTimeout(() => {
                hideCardSelection();
                // Ensure game board and input are visible and enabled
                showGameBoard();
                const wordInput = document.getElementById('wordInput');
                if (wordInput) {
                    wordInput.disabled = false;
                }
            }, 2500);
        } else {
    generateCards();
        }
    } else {
        console.error('cardSelection element not found!');
    }
}

function hideCardSelection() {
    const cardSelection = document.getElementById('cardSelection');
    if (cardSelection) {
        cardSelection.style.display = 'none';
        console.log('Card selection hidden');
    }
}

function showGameBoard() {
    document.getElementById('gameBoard').style.display = 'block';
}

// Deck cycling system (like Clash Royale)
function initializeDeckPool() {
    const deckCards = getDeckCards();
    // Create a shuffled pool of deck cards
    window.deckPool = [...deckCards].sort(() => Math.random() - 0.5);
    window.playerCardHand = [];
}

// Update the hand panel display
function updateHandPanel() {
    const handCardsContainer = document.getElementById('handCards');
    const nextCardContainer = document.getElementById('nextCardContainer');
    
    if (!handCardsContainer || !nextCardContainer) {
        return;
    }
    
    // Ensure deck pool is initialized
    if (!window.deckPool || window.deckPool.length === 0) {
        initializeDeckPool();
    }
    
    // Ensure hand has cards (draw if needed)
    if (!window.playerCardHand) {
        window.playerCardHand = [];
    }
    while (window.playerCardHand.length < 3 && window.deckPool && window.deckPool.length > 0) {
        const newCard = drawCardFromDeck();
        window.playerCardHand.push(newCard);
    }
    
    // Clear existing content
    handCardsContainer.innerHTML = '';
    
    // Display current hand (up to 3 cards)
    if (window.playerCardHand && window.playerCardHand.length > 0) {
        window.playerCardHand.slice(0, 3).forEach((card) => {
            const cardElement = document.createElement('div');
            const isBlocked = window.blockedCardId === card.id;
            cardElement.className = 'hand-card-item';
            
            if (isBlocked) {
                cardElement.style.opacity = '0.4';
                cardElement.style.filter = 'grayscale(100%)';
            }
            
            const title = document.createElement('div');
            title.className = 'hand-card-title';
            title.textContent = card.title || 'Unknown Card';
            if (isBlocked) {
                title.textContent += ' (Blocked)';
            }
            
            const description = document.createElement('div');
            description.className = 'hand-card-description';
            description.textContent = card.description || '';
            
            cardElement.appendChild(title);
            cardElement.appendChild(description);
            handCardsContainer.appendChild(cardElement);
        });
    } else {
        // Show empty state
        const emptyState = document.createElement('div');
        emptyState.className = 'hand-card-item';
        emptyState.style.opacity = '0.5';
        emptyState.innerHTML = '<div class="hand-card-description">No cards in hand</div>';
        handCardsContainer.appendChild(emptyState);
    }
    
    // Display next card in rotation
    nextCardContainer.innerHTML = '';
    if (window.deckPool && window.deckPool.length > 0) {
        const nextCard = window.deckPool[0];
        const nextCardElement = document.createElement('div');
        
        const title = document.createElement('div');
        title.className = 'next-card-title';
        title.textContent = nextCard.title || 'Unknown Card';
        
        const description = document.createElement('div');
        description.className = 'next-card-description';
        description.textContent = nextCard.description || '';
        
        nextCardElement.appendChild(title);
        nextCardElement.appendChild(description);
        nextCardContainer.appendChild(nextCardElement);
    } else {
        // Deck is empty or will be reshuffled
        const emptyState = document.createElement('div');
        emptyState.className = 'next-card-description';
        emptyState.textContent = 'Deck will be reshuffled';
        nextCardContainer.appendChild(emptyState);
    }
}

function drawCardFromDeck() {
    // If deck pool is empty, reshuffle
    if (!window.deckPool || window.deckPool.length === 0) {
        const deckCards = getDeckCards();
        window.deckPool = [...deckCards].sort(() => Math.random() - 0.5);
    }
    
    // Draw a card from the pool
    if (window.deckPool.length > 0) {
        return window.deckPool.shift();
    }
    
    // Fallback (shouldn't happen)
    const deckCards = getDeckCards();
    return deckCards[0];
}

function generateCards() {
    const container = document.getElementById('cardsContainer');
    container.innerHTML = '';
    
    // Initialize deck pool if not exists
    if (!window.deckPool || window.deckPool.length === 0) {
        initializeDeckPool();
    }
    
    // Get or initialize player's card hand
    if (!window.playerCardHand) {
        window.playerCardHand = [];
    }
    
    // If hand is empty or has less than 3 cards, draw from deck
    while (window.playerCardHand.length < 3) {
        const newCard = drawCardFromDeck();
        window.playerCardHand.push(newCard);
    }
    
    // Check if blocked card is still in hand - clear it if not
    if (window.blockedCardId) {
        const blockedCardStillInHand = window.playerCardHand.slice(0, 3).some(c => c.id === window.blockedCardId);
        if (!blockedCardStillInHand) {
            window.blockedCardId = null;
        }
    }
    
    // If we're in a card chain, filter out modifier cards that are already in the chain
    let availableCards = window.playerCardHand.slice(0, 3);
    if (cardChainActive) {
        const modifierCards = getModifierCards();
        // Get cards already in the chain from selectedCard
        const cardsInChain = [];
        if (selectedCard && isModifierCard(selectedCard.id)) {
            cardsInChain.push(selectedCard.id);
        }
        
        // Filter out modifier cards that are already in the chain
        availableCards = availableCards.filter(c => 
            !isModifierCard(c.id) || !cardsInChain.includes(c.id)
        );
    
        // If we filtered out cards and have less than 3, add replacements from deck
        while (availableCards.length < 3) {
            const replacementCard = drawCardFromDeck();
            // Make sure it's not already in hand and not in chain
            if (!window.playerCardHand.some(handCard => handCard.id === replacementCard.id) &&
                (!isModifierCard(replacementCard.id) || !cardsInChain.includes(replacementCard.id))) {
                availableCards.push(replacementCard);
            }
        }
    }
    
    // Show available cards (up to 3, including blocked card but greyed out)
    const selectedCards = availableCards.slice(0, 3);
    
    selectedCards.forEach((card, index) => {
        const cardElement = document.createElement('div');
        const isBlocked = window.blockedCardId === card.id;
        cardElement.className = 'card';
        if (isBlocked) {
            cardElement.classList.add('blocked');
            cardElement.style.opacity = '0.4';
            cardElement.style.filter = 'grayscale(100%)';
            cardElement.style.cursor = 'not-allowed';
            cardElement.style.pointerEvents = 'none';
        }
        cardElement.innerHTML = `
            <div class="card-title">${card.title}</div>
            <div class="card-description">${card.description}</div>
        `;
        if (!isBlocked) {
        cardElement.onclick = () => selectCard(card, cardElement);
        }
        
        // Add hover sound to card
        cardElement.addEventListener('mouseenter', () => {
            if (typeof soundManager !== 'undefined' && !isBlocked) {
                soundManager.playCardHover();
            }
        });
        
        container.appendChild(cardElement);
    });
    
    // Update hand panel after cards are generated
    updateHandPanel();
}

function selectCard(card, cardElement) {
    // Check if player is card locked
    if (isCardLocked()) {
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        showGameMessage('Card Locked', 'You cannot use a card this turn!', '🔒');
        return;
    }
    
    // Check if card is blocked
    if (window.blockedCardId === card.id) {
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        showGameMessage('🚫', 'Card Blocked', 'This card has been blocked and cannot be used!');
        return;
    }
    
    // Play card select sound
    if (typeof soundManager !== 'undefined') {
        soundManager.playCardSelect();
    }
    
    selectedCard = card;
    document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
    cardElement.classList.add('selected');
    
    console.log('Selecting card:', card);
    
    // Check if we're in a card chain (modifier cards active) using config
    const cardIsModifier = isModifierCard(card.id);
    
    // If we're in a chain or this is another modifier, mark as part of chain
    const isInChain = cardChainActive || cardIsModifier;
    
    socket.emit('selectCard', {
        gameId: gameState.gameId,
        playerId: currentPlayer,
        card: card,
        hidden: isInChain // Mark as hidden if we're in a chain
    });
    
    // Remove the selected card from hand and cycle it to the back of deck pool
    // Then draw the next card from the front of the deck pool
    if (window.playerCardHand) {
        const cardIndex = window.playerCardHand.findIndex(c => c.id === card.id);
        if (cardIndex !== -1) {
            const selectedCardObj = window.playerCardHand[cardIndex];
            window.playerCardHand.splice(cardIndex, 1);
            
            // Ensure deck pool is initialized
            if (!window.deckPool || window.deckPool.length === 0) {
                initializeDeckPool();
            }
            
            // Put the selected card at the BACK of the deck pool (end of cycle)
            window.deckPool.push(selectedCardObj);
            
            // Draw the next card from the FRONT of the deck pool
            let newCard = null;
            let attempts = 0;
            const maxAttempts = 50; // Prevent infinite loop
            
            // Draw cards until we get one that's not already in hand
            while (!newCard && attempts < maxAttempts && window.deckPool.length > 0) {
                const drawnCard = window.deckPool.shift();
                
                // Check if card is already in hand - if so, put it back at the end and try next
                if (window.playerCardHand.some(handCard => handCard.id === drawnCard.id)) {
                    window.deckPool.push(drawnCard);
                    attempts++;
                    continue;
                }
                
                newCard = drawnCard;
            }
            
            // If deck pool is empty or we couldn't find a suitable card, reshuffle
            if (!newCard) {
                initializeDeckPool();
                // Remove cards currently in hand from the new pool to avoid duplicates
                const handCardIds = new Set(window.playerCardHand.map(c => c.id));
                window.deckPool = window.deckPool.filter(c => !handCardIds.has(c.id));
                // Draw from the filtered pool
                if (window.deckPool.length > 0) {
                    newCard = window.deckPool.shift();
                } else {
                    // If pool is still empty after filtering, just use any card from deck
                    const deckCards = getDeckCards();
                    const availableCard = deckCards.find(c => !handCardIds.has(c.id)) || deckCards[0];
                    if (availableCard) {
                        newCard = availableCard;
                    }
                }
            }
            
            if (newCard) {
                window.playerCardHand.push(newCard);
            }
            
            // Clear blocked card if the blocked card was removed from hand
            if (window.blockedCardId === card.id) {
                window.blockedCardId = null;
            }
            
            // Update hand panel after card is selected and replaced
            updateHandPanel();
        }
    }
    
    // Show splash based on config (show if not silent and not in chain, or if hideCard)
    const splashBehavior = getSplashBehavior(card.id);
    if ((splashBehavior === 'show' && !isInChain) || (card.id === 'hideCard' && !isInChain)) {
    showCardSplash(card, 'You');
    }
    
    // If a modifier card was selected, wait for server to allow another card selection
    // Otherwise, hide card selection and show game board
    if (cardIsModifier) {
        // cardChainActive will be set by the cardSelected event handler
        // Don't hide selection yet - wait for next card
    } else {
        // Final card in chain - clear flag and proceed
        cardChainActive = false;
    setTimeout(() => {
            hideCardSelection();
            showGameBoard();
            document.getElementById('wordInput').disabled = false;
        document.getElementById('wordInput').focus();
    }, 100);
    }
}

function isCardLocked() {
    if (!gameState || !gameState.activeEffects || !currentPlayer) return false;
    return gameState.activeEffects.some(e => 
        e.type === 'cardLock' && e.target === currentPlayer && !e.used
    );
}

function updateTurnIndicator() {
    const indicator = document.getElementById('turnIndicator');
    if (!indicator) return;
    
    if (gameState && gameState.currentTurn === currentPlayer) {
        if (isCardLocked()) {
            indicator.textContent = 'Your Turn - Card Locked!';
            indicator.classList.add('active-turn');
        } else {
            indicator.textContent = 'Your Turn';
        indicator.classList.add('active-turn');
        }
        startTurnTimer();
    } else {
        indicator.textContent = "Opponent's Turn";
        indicator.classList.remove('active-turn');
        // Start timer for opponent's turn too (both players track it)
        startTurnTimer();
    }
}

function startTurnTimer() {
    // Both players should track the timer
    if (!gameState || !gameState.currentTurn) {
        console.log('Not starting timer - no game state or current turn');
        return;
    }
    
    stopTurnTimer(); // Clear any existing timer
    
    // Check if there's a timeRush effect active for the current player
    const currentTurnPlayerId = gameState.currentTurn;
    const hasTimeRush = gameState.activeEffects && gameState.activeEffects.some(e => 
        e.type === 'timeRush' && e.target === currentTurnPlayerId && !e.used
    );
    
    // Set timer limit based on whether timeRush is active
    const timeLimit = hasTimeRush ? 20 : TURN_TIME_LIMIT;
    turnTimeRemaining = timeLimit;
    
    const isMyTurn = gameState.currentTurn === currentPlayer;
    if (hasTimeRush && isMyTurn) {
        console.log('Time Rush effect active - timer set to 20 seconds');
    }
    console.log(`Starting turn timer - is my turn: ${isMyTurn}`);
    
    updateTimerDisplay();
    
    turnTimer = setInterval(() => {
        // Check if turn has changed
        if (!gameState || !gameState.currentTurn) {
            console.log('Timer: Game state invalid, stopping timer');
            stopTurnTimer();
            return;
        }
        
        const stillMyTurn = gameState.currentTurn === currentPlayer;
        
        // If turn changed, stop timer
        if (isMyTurn && !stillMyTurn) {
            console.log('Timer: Turn changed, stopping timer');
            stopTurnTimer();
            return;
        }
        
        turnTimeRemaining--;
        updateTimerDisplay();
        
        // Only the player whose turn it is can trigger timeout
        if (turnTimeRemaining <= 0) {
            stopTurnTimer();
            if (stillMyTurn && gameState.gameId) {
                console.log('Turn timer expired - switching turn, gameId:', gameState.gameId);
                socket.emit('turnTimeout', { gameId: gameState.gameId });
            }
        }
    }, 1000);
}

function stopTurnTimer() {
    if (turnTimer) {
        clearInterval(turnTimer);
        turnTimer = null;
    }
    turnTimeRemaining = TURN_TIME_LIMIT;
    updateTimerDisplay();
}

function updateTimerDisplay() {
    const timerText = document.getElementById('timerText');
    const timerCircle = document.getElementById('timerCircle');
    
    if (!gameState || !gameState.currentTurn) {
        // No game state, reset timer
        if (timerText) timerText.textContent = '60';
        if (timerCircle) {
            timerCircle.style.strokeDashoffset = 100;
            timerCircle.classList.remove('warning', 'danger');
        }
        const timerContainer = document.querySelector('.turn-timer');
        if (timerContainer) timerContainer.style.opacity = '0.3';
        return;
    }
    
    const isMyTurn = gameState.currentTurn === currentPlayer;
    
    // Check if timeRush is active for the current turn
    const currentTurnPlayerId = gameState.currentTurn;
    const hasTimeRush = gameState.activeEffects && gameState.activeEffects.some(e => 
        e.type === 'timeRush' && e.target === currentTurnPlayerId && !e.used
    );
    const timeLimit = hasTimeRush ? 20 : TURN_TIME_LIMIT;
    
    // Both players see the same countdown
    if (timerText) {
        timerText.textContent = Math.max(0, turnTimeRemaining);
    }
    
    if (timerCircle) {
        const progress = (turnTimeRemaining / timeLimit) * 100;
        const circumference = 2 * Math.PI * 15.9155; // radius of the circle
        const offset = circumference - (progress / 100) * circumference;
        
        timerCircle.style.strokeDashoffset = offset;
        
        // Update color based on time remaining (both players see the same)
        // For timeRush (20 seconds), show warning earlier
        timerCircle.classList.remove('warning', 'danger');
        if (hasTimeRush) {
            // For 20 second timer, show danger at 5 seconds, warning at 10
            if (turnTimeRemaining <= 5) {
                timerCircle.classList.add('danger');
            } else if (turnTimeRemaining <= 10) {
                timerCircle.classList.add('warning');
            }
        } else {
            // Normal 60 second timer
            if (turnTimeRemaining <= 10) {
                timerCircle.classList.add('danger');
            } else if (turnTimeRemaining <= 30) {
                timerCircle.classList.add('warning');
            }
        }
        
        // Slightly dimmed when it's not your turn, but still visible
        const timerContainer = document.querySelector('.turn-timer');
        if (timerContainer) {
            timerContainer.style.opacity = isMyTurn ? '1' : '0.7';
        }
    }
}

function updatePlayerStatus() {
    // Player status bar removed - function kept for compatibility
}

function handleKeyPress(key) {
    const input = document.getElementById('wordInput');
    if (key === 'BACKSPACE') {
        input.value = input.value.slice(0, -1);
        currentGuess = input.value.toUpperCase();
        if (typeof soundManager !== 'undefined') {
            soundManager.playLetterDelete();
        }
    } else if (key.length === 1 && /[A-Z]/.test(key)) {
        if (input.value.length < 5) {
            input.value += key;
            currentGuess = input.value.toUpperCase();
            if (typeof soundManager !== 'undefined') {
                soundManager.playLetterType();
            }
        }
    }
}

function displayGuess(guess, feedback, row) {
    // Ensure the row exists (for unlimited guesses)
    ensureBoardRowExists(row);
    
    // First, fill in the letters
    for (let i = 0; i < 5; i++) {
        const cell = document.getElementById(`cell-${row}-${i}`);
        if (cell) {
        cell.textContent = guess[i];
        cell.classList.add('filled');
        }
    }
    
    // Check if all letters are correct for win sound
    const allCorrect = feedback && feedback.every(f => f === 'correct');
    
    // Then animate the feedback with a delay (like Wordle)
    setTimeout(() => {
        for (let i = 0; i < 5; i++) {
            const cell = document.getElementById(`cell-${row}-${i}`);
            if (cell) {
            setTimeout(() => {
                if (typeof soundManager !== 'undefined') {
                if (feedback[i] === 'correct') {
                    cell.classList.add('correct');
                        if (!allCorrect) { // Only play individual sound if not all correct
                            soundManager.playCorrectLetter();
                        }
                } else if (feedback[i] === 'present') {
                    cell.classList.add('present');
                        soundManager.playPresentLetter();
                } else {
                    cell.classList.add('absent');
                        soundManager.playWrongLetter();
                    }
                } else {
                    // No sound manager, just add classes
                    if (feedback[i] === 'correct') {
                        cell.classList.add('correct');
                    } else if (feedback[i] === 'present') {
                        cell.classList.add('present');
                    } else {
                        cell.classList.add('absent');
                    }
                }
            }, i * 150); // Stagger the animations
        }
        }
        
        // Play win sound if all correct (after last letter animation)
        if (allCorrect && typeof soundManager !== 'undefined') {
            setTimeout(() => {
                soundManager.playCorrectWord();
            }, 5 * 150 + 200);
        }
        
        // Update scroll buttons after animation
        setTimeout(updateScrollButtons, 1000);
    }, 200);
}

function displayOpponentGuess(guess, feedback, row) {
    if (!guess) {
        displayOpponentGuessHidden(row);
        return;
    }
    
    // Ensure the row exists (for unlimited guesses)
    ensureBoardRowExists(row);
    
    // First, fill in the letters
    for (let i = 0; i < 5; i++) {
        const cell = document.getElementById(`cell-${row}-${i}`);
        if (cell) {
        cell.textContent = guess[i];
        cell.classList.add('filled');
        }
    }
    
    // Then animate the feedback with a delay
    setTimeout(() => {
        for (let i = 0; i < 5; i++) {
            const cell = document.getElementById(`cell-${row}-${i}`);
            if (cell) {
            setTimeout(() => {
                if (feedback && feedback[i]) {
                    if (feedback[i] === 'correct') {
                        cell.classList.add('correct');
                    } else if (feedback[i] === 'present') {
                        cell.classList.add('present');
                    } else {
                        cell.classList.add('absent');
                    }
                } else {
                    // No feedback available
                    cell.classList.add('absent');
                }
            }, i * 150); // Stagger the animations
        }
        }
        // Update scroll buttons after animation
        setTimeout(updateScrollButtons, 1000);
    }, 200);
}

function displayOpponentGuessHidden(row) {
    // Ensure the row exists (for unlimited guesses)
    ensureBoardRowExists(row);
    
    for (let i = 0; i < 5; i++) {
        const cell = document.getElementById(`cell-${row}-${i}`);
        if (cell) {
        cell.textContent = '?';
        cell.classList.add('filled', 'absent');
        }
    }
}

// This function is no longer needed as server handles it

function updateKeyboard(feedbackData) {
    // feedbackData contains { guess, feedback } from server
    if (!feedbackData || !feedbackData.guess || !feedbackData.feedback) return;
    
    const guess = feedbackData.guess;
    const feedback = feedbackData.feedback;
    
    // Update keyboard keys based on feedback
    for (let i = 0; i < guess.length; i++) {
        const letter = guess[i];
        const state = feedback[i];
        
        // Find all keys with this letter
        const keys = document.querySelectorAll('.key');
        keys.forEach(key => {
            if (key.textContent === letter) {
                // Only update if we're setting a better state (correct > present > absent)
                if (state === 'correct') {
                    key.classList.remove('present', 'absent');
                    key.classList.add('correct');
                } else if (state === 'present' && !key.classList.contains('correct')) {
                    key.classList.remove('absent');
                    key.classList.add('present');
                } else if (state === 'absent' && !key.classList.contains('correct') && !key.classList.contains('present')) {
                    key.classList.add('absent');
                }
            }
        });
    }
}

/**
 * Show a game message overlay (reusable for any card or game event)
 * @param {string} icon - Emoji or icon to display
 * @param {string} title - Title of the message
 * @param {string} text - Message text (can include HTML)
 * @param {number} autoClose - Auto-close after milliseconds (0 = manual close only)
 */
function showGameMessage(icon, title, text, autoClose = 0) {
    const overlay = document.getElementById('gameMessage');
    const iconEl = document.getElementById('gameMessageIcon');
    const titleEl = document.getElementById('gameMessageTitle');
    const textEl = document.getElementById('gameMessageText');
    const buttonEl = document.getElementById('gameMessageButton');
    
    if (!overlay || !iconEl || !titleEl || !textEl || !buttonEl) {
        console.error('Game message elements not found');
        return;
    }
    
    // Set content
    iconEl.textContent = icon || '🎮';
    titleEl.textContent = title || 'Game Message';
    textEl.innerHTML = text || '';
    
    // Reset classes
    overlay.classList.remove('show', 'hiding');
    
    // Force reflow
    void overlay.offsetWidth;
    
    // Show overlay
    overlay.classList.add('show');
    
    // Close handler
    const closeMessage = () => {
        overlay.classList.add('hiding');
        setTimeout(() => {
            overlay.classList.remove('show', 'hiding');
        }, 300);
    };
    
    // Button click
    buttonEl.onclick = closeMessage;
    
    // Auto-close if specified
    if (autoClose > 0) {
        setTimeout(closeMessage, autoClose);
    }
    
    // Close on overlay click (outside content)
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            closeMessage();
        }
    };
}

function showCardSplash(card, playerName) {
    const splash = document.getElementById('cardSplash');
    const splashTitle = document.getElementById('splashCardTitle');
    const splashDescription = document.getElementById('splashCardDescription');
    const splashPlayer = document.getElementById('splashPlayer');
    
    if (!splash || !splashTitle || !splashDescription || !splashPlayer) {
        console.error('Splash elements not found');
        return;
    }
    
    if (!card) {
        console.error('Card data is missing');
        return;
    }
    
    // Remove any existing classes
    splash.classList.remove('show', 'hiding');
    
    // Set content
    splashTitle.textContent = card.title || 'Card';
    splashDescription.textContent = card.description || '';
    splashPlayer.textContent = `${playerName || 'Player'} played:`;
    
    // Reset animation by forcing reflow
    void splash.offsetWidth;
    
    // Show with fly-in animation
    splash.classList.add('show');
    
    // After 2.5 seconds, start fly-out animation
    setTimeout(() => {
        splash.classList.add('hiding');
        // Remove from DOM after animation completes
        setTimeout(() => {
            splash.classList.remove('show', 'hiding');
        }, 500);
    }, 2500);
}

// Event Listeners
// Deck Builder Functions with Drag and Drop
let currentDeckSelection = []; // Array of card IDs in deck slots (index = slot number)
let draggedCard = null;
let draggedSlotIndex = null;

// Helper function to create a custom drag image that doesn't get cut off
function createDragImage(element) {
    // Get the computed styles and dimensions
    const rect = element.getBoundingClientRect();
    const computedStyle = getComputedStyle(element);
    
    // Create a clone of the element
    const dragImage = element.cloneNode(true);
    
    // Remove any classes that might apply transforms (like 'dragging') BEFORE setting styles
    dragImage.classList.remove('dragging');
    
    // Position it off-screen but visible for rendering
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-9999px';
    dragImage.style.left = '0px';
    dragImage.style.margin = '0';
    dragImage.style.opacity = '0.9';
    
    // Ensure all styles are explicitly set to prevent clipping
    dragImage.style.width = `${rect.width}px`;
    dragImage.style.height = `${rect.height}px`;
    dragImage.style.boxSizing = 'border-box';
    dragImage.style.overflow = 'visible';
    
    // Copy important computed styles
    dragImage.style.backgroundColor = computedStyle.backgroundColor;
    dragImage.style.backgroundImage = computedStyle.backgroundImage;
    dragImage.style.backgroundSize = computedStyle.backgroundSize;
    dragImage.style.border = computedStyle.border;
    dragImage.style.borderRadius = computedStyle.borderRadius;
    dragImage.style.boxShadow = computedStyle.boxShadow;
    dragImage.style.padding = computedStyle.padding;
    dragImage.style.display = computedStyle.display;
    dragImage.style.flexDirection = computedStyle.flexDirection;
    dragImage.style.justifyContent = computedStyle.justifyContent;
    dragImage.style.alignItems = computedStyle.alignItems;
    
    // CRITICAL: Reset any transforms/rotations to ensure the drag image is straight
    // This must be set AFTER all other styles to override any CSS transforms
    // Inline styles will override CSS classes, so setting to 'none' should work
    dragImage.style.setProperty('transform', 'none', 'important');
    dragImage.style.transition = 'none';
    
    // Append to body so it can be measured and rendered
    document.body.appendChild(dragImage);
    
    return dragImage;
}

function createDeckSlots() {
    const deckSlots = document.getElementById('deckSlots');
    deckSlots.innerHTML = '';
    
    for (let i = 0; i < DECK_SIZE; i++) {
        const slot = document.createElement('div');
        slot.className = 'deck-slot';
        slot.dataset.slotIndex = i;
        
        const slotNumber = document.createElement('div');
        slotNumber.className = 'deck-slot-number';
        slotNumber.textContent = i + 1;
        slot.appendChild(slotNumber);
        
        // Add drag and drop event listeners
        slot.addEventListener('dragover', (e) => {
            e.preventDefault();
            slot.classList.add('drag-over');
        });
        
        slot.addEventListener('dragleave', () => {
            slot.classList.remove('drag-over');
        });
        
        slot.addEventListener('drop', (e) => {
            e.preventDefault();
            slot.classList.remove('drag-over');
            handleDropOnSlot(i);
        });
        
        deckSlots.appendChild(slot);
    }
    
    updateDeckSlots();
}

function updateDeckSlots() {
    updateDeckCount();
    updateSaveButton();
    const slots = document.querySelectorAll('.deck-slot');
    slots.forEach((slot, index) => {
        const cardId = currentDeckSelection[index];
        
        // Clear existing card
        const existingCard = slot.querySelector('.deck-slot-card');
        if (existingCard) {
            existingCard.remove();
        }
        
        slot.classList.remove('filled');
        
        if (cardId) {
            const allCards = getAllCards();
            const card = allCards.find(c => c.id === cardId);
            if (card) {
                slot.classList.add('filled');
                const cardElement = createDeckSlotCard(card, index);
                slot.appendChild(cardElement);
            }
        }
    });
    
    updateAvailableCards();
    updateSaveButton();
}

function createDeckSlotCard(card, slotIndex) {
    const cardElement = document.createElement('div');
    cardElement.className = 'deck-slot-card';
    cardElement.draggable = true;
    cardElement.dataset.cardId = card.id;
    cardElement.dataset.slotIndex = slotIndex;
    
    cardElement.innerHTML = `
        <div class="deck-slot-card-title">${card.title}</div>
    `;
    
    cardElement.addEventListener('dragstart', (e) => {
        draggedCard = card.id;
        draggedSlotIndex = slotIndex;
        cardElement.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        
        // Create custom drag image to prevent edge clipping
        const dragImage = createDragImage(cardElement);
        e.dataTransfer.setDragImage(dragImage, 0, 0);
        
        // Clean up drag image after a short delay
        setTimeout(() => {
            if (dragImage.parentNode) {
                document.body.removeChild(dragImage);
            }
        }, 0);
    });
    
    cardElement.addEventListener('dragend', () => {
        cardElement.classList.remove('dragging');
        draggedCard = null;
        draggedSlotIndex = null;
    });
    
    cardElement.addEventListener('click', () => {
        // Remove card from slot on click
        removeCardFromSlot(slotIndex);
    });
    
    return cardElement;
}

function renderDeckBuilder() {
    const deckCardsGrid = document.getElementById('deckCardsGrid');
    const deckSlots = document.getElementById('deckSlots');
    
    if (!deckCardsGrid || !deckSlots) {
        console.error('Deck builder elements not found');
        return;
    }
    
    const allCards = getAllCards();
    const currentDeck = getPlayerDeck();
    
    // Initialize deck selection (pad with nulls if needed)
    currentDeckSelection = [...currentDeck];
    while (currentDeckSelection.length < DECK_SIZE) {
        currentDeckSelection.push(null);
    }
    
    createDeckSlots();
    updateDeckSlots();
    renderAvailableCards();
    
    // Set up drop handling on the grid (only once)
    if (!deckCardsGrid.dataset.dropHandlersAdded) {
        deckCardsGrid.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (draggedSlotIndex !== null) {
                // Card is being dragged from a deck slot
                deckCardsGrid.style.borderColor = '#6aaa64';
                deckCardsGrid.style.backgroundColor = '#1a2a1b';
            }
        });
        
        deckCardsGrid.addEventListener('dragleave', (e) => {
            if (!deckCardsGrid.contains(e.relatedTarget)) {
                deckCardsGrid.style.borderColor = '#3a3a3c';
                deckCardsGrid.style.backgroundColor = '#121213';
            }
        });
        
        deckCardsGrid.addEventListener('drop', (e) => {
            e.preventDefault();
            deckCardsGrid.style.borderColor = '#3a3a3c';
            deckCardsGrid.style.backgroundColor = '#121213';
            
            // If card was dragged from a deck slot, remove it from deck
            if (draggedSlotIndex !== null && draggedCard) {
                removeCardFromSlot(draggedSlotIndex);
            }
        });
        
        deckCardsGrid.dataset.dropHandlersAdded = 'true';
    }
}

function renderAvailableCards() {
    const deckCardsGrid = document.getElementById('deckCardsGrid');
    const allCards = getAllCards();
    
    // Filter out cards that are in the deck
    const availableCards = allCards.filter(card => !currentDeckSelection.includes(card.id));
    
    deckCardsGrid.innerHTML = '';
    
    availableCards.forEach(card => {
        const cardElement = document.createElement('div');
        cardElement.className = 'deck-card-item';
        cardElement.dataset.cardId = card.id;
        
        cardElement.innerHTML = `
            <div class="deck-card-title">${card.title}</div>
            <div class="deck-card-description">${card.description}</div>
        `;
        
        // Set draggable after innerHTML to ensure it sticks
        cardElement.setAttribute('draggable', 'true');
        
        // Set up drag events
        cardElement.addEventListener('dragstart', (e) => {
            draggedCard = card.id;
            draggedSlotIndex = null;
            cardElement.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', card.id);
            
            // Create custom drag image to prevent edge clipping
            const dragImage = createDragImage(cardElement);
            e.dataTransfer.setDragImage(dragImage, 0, 0);
            
            // Clean up drag image after a short delay
            setTimeout(() => {
                if (dragImage.parentNode) {
                    document.body.removeChild(dragImage);
                }
            }, 0);
        });
        
        cardElement.addEventListener('dragend', (e) => {
            cardElement.classList.remove('dragging');
            draggedCard = null;
            draggedSlotIndex = null;
        });
        
        deckCardsGrid.appendChild(cardElement);
    });
}

function updateAvailableCards() {
    // Re-render available cards to reflect current deck state
    renderAvailableCards();
}

function handleDropOnSlot(slotIndex) {
    if (!draggedCard) return;
    
    const allCards = getAllCards();
    const card = allCards.find(c => c.id === draggedCard);
    if (!card) return;
    
    // If dragging from another slot, remove it from that slot first
    if (draggedSlotIndex !== null && draggedSlotIndex !== slotIndex) {
        const oldCardId = currentDeckSelection[slotIndex];
        currentDeckSelection[draggedSlotIndex] = oldCardId;
    } else if (draggedSlotIndex === null) {
        // Dragging from available cards - check if card is already in deck
        const existingSlotIndex = currentDeckSelection.indexOf(draggedCard);
        if (existingSlotIndex !== -1) {
            // Card already in deck, swap positions
            const oldCardId = currentDeckSelection[slotIndex];
            currentDeckSelection[existingSlotIndex] = oldCardId;
        }
    }
    
    // Place card in new slot
    currentDeckSelection[slotIndex] = draggedCard;
    
    updateDeckSlots();
}

function removeCardFromSlot(slotIndex) {
    currentDeckSelection[slotIndex] = null;
    updateDeckSlots();
}

function updateSaveButton() {
    const saveBtn = document.getElementById('saveDeckBtn');
    if (saveBtn) {
        const filledSlots = currentDeckSelection.filter(id => id !== null).length;
        saveBtn.disabled = filledSlots !== DECK_SIZE;
    }
}

function saveDeck() {
    const filledSlots = currentDeckSelection.filter(id => id !== null);
    if (filledSlots.length === DECK_SIZE) {
        savePlayerDeck(filledSlots);
        showGameMessage('Deck Saved', 'Your deck has been saved successfully!', '💾');
        // Update slots to reflect saved deck
        renderDeckBuilder();
    } else {
        alert(`Please fill all ${DECK_SIZE} deck slots.`);
    }
}

function clearDeck() {
    if (confirm('Are you sure you want to clear your deck?')) {
        currentDeckSelection = new Array(DECK_SIZE).fill(null);
        updateDeckSlots();
    }
}

// Deck builder is now in a tab, so these functions are simplified
function openDeckBuilder() {
    // Switch to deck tab
    switchTab('deck');
}

function closeDeckBuilder() {
    // Reset to saved deck when leaving
    const savedDeck = getPlayerDeck();
    currentDeckSelection = [...savedDeck];
    while (currentDeckSelection.length < DECK_SIZE) {
        currentDeckSelection.push(null);
    }
}

// Initialize deck builder on page load
document.addEventListener('DOMContentLoaded', () => {
    // Wait a bit for CARD_CONFIG to be injected by server
    setTimeout(() => {
        // Ensure a valid deck exists
        const allCards = getAllCards();
        if (allCards.length === 0) {
            console.warn('No cards available yet, deck will be initialized when cards load');
            return;
        }
        
        const deck = getPlayerDeck();
        // Validate deck - remove any cards that no longer exist
        const validDeck = deck.filter(cardId => allCards.some(c => c.id === cardId));
        
        if (validDeck.length === 0 || validDeck.length > DECK_SIZE) {
            // Create default deck
            const defaultDeck = allCards.slice(0, Math.min(DECK_SIZE, allCards.length));
            savePlayerDeck(defaultDeck.map(c => c.id));
        } else if (validDeck.length !== deck.length) {
            // Some cards were removed, save the valid deck
            savePlayerDeck(validDeck);
        }
    }, 100);
    
    // Initialize stats display
    updateStatsDisplay().catch(error => {
        console.error('Error initializing stats display:', error);
    });
});

// Authentication Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Login form
    const loginBtn = document.getElementById('loginBtn');
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    const showSignupBtn = document.getElementById('showSignupBtn');
    const signupBtn = document.getElementById('signupBtn');
    const showLoginBtn = document.getElementById('showLoginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const playAsGuestBtn = document.getElementById('playAsGuestBtn');
    const continueAsGuestBtn = document.getElementById('continueAsGuestBtn');
    const backToLoginFromGuestBtn = document.getElementById('backToLoginFromGuestBtn');
    
    if (loginBtn) {
        loginBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleLogin();
        });
    }
    
    if (googleSignInBtn) {
        googleSignInBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleGoogleSignIn();
        });
    }
    
    // Enter key on login form
    const loginPassword = document.getElementById('loginPassword');
    if (loginPassword) {
        loginPassword.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleLogin();
            }
        });
    }
    
    if (showSignupBtn) {
        showSignupBtn.addEventListener('click', () => {
            hideAuthErrors();
            ScreenManager.show('signup');
        });
    }
    
    if (signupBtn) {
        signupBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleSignup();
        });
    }
    
    // Enter key on signup form
    const signupPasswordConfirm = document.getElementById('signupPasswordConfirm');
    if (signupPasswordConfirm) {
        signupPasswordConfirm.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSignup();
            }
        });
    }
    
    if (showLoginBtn) {
        showLoginBtn.addEventListener('click', () => {
            hideAuthErrors();
            ScreenManager.show('login');
        });
    }
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            handleLogout();
        });
    }
    
    if (playAsGuestBtn) {
        playAsGuestBtn.addEventListener('click', () => {
            handlePlayAsGuest();
        });
    }
    
    if (continueAsGuestBtn) {
        continueAsGuestBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleContinueAsGuest();
        });
    }
    
    // Enter key on guest name input
    const guestNameInput = document.getElementById('guestNameInput');
    if (guestNameInput) {
        guestNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleContinueAsGuest();
            }
        });
    }
    
    if (backToLoginFromGuestBtn) {
        backToLoginFromGuestBtn.addEventListener('click', () => {
            hideAuthErrors();
            ScreenManager.show('login');
        });
    }
});

document.getElementById('findMatchBtn').addEventListener('click', () => {
    const name = getPlayerName();
    if (name) {
        socket.emit('findMatch', { playerName: name });
    } else {
        alert('Please enter your name');
    }
});

document.getElementById('cancelMatchmakingBtn').addEventListener('click', () => {
    socket.emit('cancelMatchmaking');
});

document.getElementById('createGameBtn').addEventListener('click', () => {
    const name = getPlayerName();
    if (name) {
        // Cancel matchmaking if active
        socket.emit('cancelMatchmaking');
        socket.emit('createGame', { playerName: name });
    } else {
        alert('Please sign in to create a game');
    }
});

document.getElementById('joinGameBtn').addEventListener('click', () => {
    // Cancel matchmaking if active
    socket.emit('cancelMatchmaking');
    document.getElementById('joinGroup').style.display = 'block';
});

// Tab switching functionality
function switchTab(tabName) {
    // Remove active class from all tabs and panels
    document.querySelectorAll('.lobby-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    
    // Add active class to selected tab and panel
    const selectedTab = document.querySelector(`[data-tab="${tabName}"]`);
    const selectedPanel = document.getElementById(`${tabName}Tab`);
    
    if (selectedTab) selectedTab.classList.add('active');
    if (selectedPanel) selectedPanel.classList.add('active');
    
    // If switching to deck tab, initialize deck builder
    if (tabName === 'deck') {
        renderDeckBuilder();
        updateDeckCount();
    }
    
    // If switching to profile tab, update stats display
    if (tabName === 'profile') {
        updateStatsDisplay().catch(error => {
            console.error('Error loading stats:', error);
        });
    }
    
    // If switching to settings tab, initialize settings
    if (tabName === 'settings') {
        initializeSettings();
    }
}

// Update deck count display
function updateDeckCount() {
    const deckCountEl = document.getElementById('deckCount');
    if (deckCountEl) {
        const filledSlots = currentDeckSelection.filter(id => id !== null).length;
        deckCountEl.textContent = filledSlots;
    }
}

// Tab switching event listeners
document.querySelectorAll('.lobby-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        switchTab(tabName);
    });
});

// Help modal functions
function openHelp() {
    const helpOverlay = document.getElementById('helpOverlay');
    if (helpOverlay) {
        helpOverlay.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }
}

function closeHelp() {
    const helpOverlay = document.getElementById('helpOverlay');
    if (helpOverlay) {
        helpOverlay.style.display = 'none';
        document.body.style.overflow = ''; // Restore scrolling
    }
}

// Help button event listeners
document.getElementById('helpBtn').addEventListener('click', openHelp);
document.getElementById('closeHelpBtn').addEventListener('click', closeHelp);
document.getElementById('closeHelpBtnBottom').addEventListener('click', closeHelp);

// Close help when clicking outside the modal
document.getElementById('helpOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'helpOverlay') {
        closeHelp();
    }
});

document.getElementById('saveDeckBtn').addEventListener('click', () => {
    saveDeck();
});

document.getElementById('clearDeckBtn').addEventListener('click', () => {
    clearDeck();
});

// Settings Functions
function initializeSettings() {
    // Load saved volume settings from localStorage
    const savedSoundEffectsVolume = localStorage.getItem('soundEffectsVolume');
    const savedMusicVolume = localStorage.getItem('musicVolume');
    
    const soundEffectsSlider = document.getElementById('soundEffectsVolume');
    const musicSlider = document.getElementById('musicVolume');
    const soundEffectsValue = document.getElementById('soundEffectsValue');
    const musicValue = document.getElementById('musicVolumeValue');
    
    if (soundEffectsSlider && soundEffectsValue) {
        const volume = savedSoundEffectsVolume !== null ? parseInt(savedSoundEffectsVolume) : 30;
        soundEffectsSlider.value = volume;
        soundEffectsValue.textContent = `${volume}%`;
        
        // Update sound manager
        if (typeof soundManager !== 'undefined') {
            soundManager.setVolume(volume / 100);
        }
    }
    
    if (musicSlider && musicValue) {
        const volume = savedMusicVolume !== null ? parseInt(savedMusicVolume) : 40;
        musicSlider.value = volume;
        musicValue.textContent = `${volume}%`;
        
        // Update sound manager
        if (typeof soundManager !== 'undefined') {
            soundManager.setMusicVolume(volume / 100);
        }
    }
}

// Settings event listeners
document.addEventListener('DOMContentLoaded', () => {
    const soundEffectsSlider = document.getElementById('soundEffectsVolume');
    const musicSlider = document.getElementById('musicVolume');
    const soundEffectsValue = document.getElementById('soundEffectsValue');
    const musicValue = document.getElementById('musicVolumeValue');
    
    if (soundEffectsSlider && soundEffectsValue) {
        soundEffectsSlider.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value);
            soundEffectsValue.textContent = `${volume}%`;
            
            // Update sound manager
            if (typeof soundManager !== 'undefined') {
                soundManager.setVolume(volume / 100);
            }
            
            // Save to localStorage
            localStorage.setItem('soundEffectsVolume', volume);
        });
    }
    
    if (musicSlider && musicValue) {
        musicSlider.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value);
            musicValue.textContent = `${volume}%`;
            
            // Update sound manager
            if (typeof soundManager !== 'undefined') {
                soundManager.setMusicVolume(volume / 100);
            }
            
            // Save to localStorage
            localStorage.setItem('musicVolume', volume);
        });
    }
});

document.getElementById('joinWithIdBtn').addEventListener('click', () => {
    const name = getPlayerName();
    const gameId = document.getElementById('gameIdInput').value.trim();
    if (name && gameId) {
        // Cancel matchmaking if active
        socket.emit('cancelMatchmaking');
        socket.emit('joinGame', { playerName: name, gameId: gameId });
    } else {
        alert('Please sign in and enter a game ID');
    }
});

// Cancel private game button
document.getElementById('cancelPrivateGameBtn').addEventListener('click', () => {
    if (typeof soundManager !== 'undefined') {
        soundManager.playButtonClick();
    }
    socket.emit('cancelPrivateGame');
});

document.getElementById('submitBtn').addEventListener('click', submitGuess);

document.getElementById('wordInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        submitGuess();
    }
});

document.getElementById('wordInput').addEventListener('input', (e) => {
    const oldValue = currentGuess || '';
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
    currentGuess = e.target.value;
    
    // Play sound for typing (only when adding, not deleting)
    if (typeof soundManager !== 'undefined' && currentGuess.length > oldValue.length) {
        soundManager.playLetterType();
    } else if (typeof soundManager !== 'undefined' && currentGuess.length < oldValue.length) {
        soundManager.playLetterDelete();
    }
});

document.getElementById('playAgainBtn').addEventListener('click', () => {
    // Stop background music before reloading
    if (typeof soundManager !== 'undefined') {
        soundManager.stopBackgroundMusic();
    }
    location.reload();
});

// Chat Functions
function displayChatMessage(playerName, message, timestamp, isOwnMessage) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message' + (isOwnMessage ? ' own-message' : '');
    
    const time = new Date(timestamp);
    const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageDiv.innerHTML = `
        <div class="chat-message-header">
            <span class="chat-message-name">${escapeHtml(playerName)}</span>
            <span class="chat-message-time">${timeStr}</span>
        </div>
        <div class="chat-message-text">${escapeHtml(message)}</div>
    `;
    
    chatMessages.appendChild(messageDiv);
    
    // Auto-scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function sendChatMessage() {
    if (!gameState || !gameState.gameId) return;
    
    const chatInput = document.getElementById('chatInput');
    const message = chatInput.value.trim();
    
    if (!message) return;
    
    // Play chat send sound
    if (typeof soundManager !== 'undefined') {
        soundManager.playChatSend();
    }
    
    socket.emit('chatMessage', {
        gameId: gameState.gameId,
        playerId: currentPlayer,
        message: message
    });
    
    chatInput.value = '';
}

// Chat toggle functionality
function toggleChat() {
    const chatContainer = document.getElementById('chatContainer');
    const chatShowBtn = document.getElementById('chatShowBtn');
    const chatToggleBtn = document.getElementById('chatToggleBtn');
    
    if (chatContainer && chatShowBtn) {
        const isHidden = chatContainer.classList.contains('hidden');
        
        if (isHidden) {
            // Show chat
            chatContainer.classList.remove('hidden');
            chatShowBtn.style.display = 'none';
            // Remove flash animation when opening chat
            chatShowBtn.classList.remove('flash');
        } else {
            // Hide chat
            chatContainer.classList.add('hidden');
            chatShowBtn.style.display = 'flex';
        }
    }
}

// Chat event listeners
document.getElementById('chatSendBtn').addEventListener('click', sendChatMessage);

document.getElementById('chatInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendChatMessage();
    }
});

// Chat toggle buttons
document.getElementById('chatToggleBtn').addEventListener('click', toggleChat);
document.getElementById('chatShowBtn').addEventListener('click', toggleChat);

// Keyboard input handling
document.addEventListener('keydown', (e) => {
    if (screens.game.classList.contains('active')) {
        const input = document.getElementById('wordInput');
        const chatInput = document.getElementById('chatInput');
        
        // If chat input is focused, don't handle game keyboard input at all
        if (document.activeElement === chatInput) {
            return; // Let browser handle chat input naturally
        }
        
        // Handle Enter key to submit (works whether input is focused or not)
        if (e.key === 'Enter') {
            e.preventDefault();
            submitGuess();
            return;
        }
        
        // Only handle if input is focused (to avoid double letters)
        // When input is focused, browser handles it naturally and input event normalizes it
        if (document.activeElement === input) {
            return; // Let browser handle it naturally
        }
        // If input is not focused, handle it manually
        if (e.key === 'Backspace') {
            e.preventDefault();
            handleKeyPress('BACKSPACE');
        } else if (e.key.length === 1 && /[A-Za-z]/.test(e.key)) {
            e.preventDefault();
            handleKeyPress(e.key.toUpperCase());
        }
    }
});

function submitGuess() {
    if (gameState.currentTurn !== currentPlayer) {
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        alert("It's not your turn!");
        return;
    }
    
    // Allow submitting without a card if player is card locked
    const locked = isCardLocked();
    if (!selectedCard && !locked) {
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        alert('Please select a card first!');
        return;
    }
    
    // Can't submit if we're in a card chain (modifier card selected but no final card)
    if (cardChainActive && selectedCard && isModifierCard(selectedCard.id)) {
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        alert('Please select a final card to complete the chain!');
        return;
    }
    
    const guess = document.getElementById('wordInput').value.toUpperCase();
    
    if (guess.length !== 5) {
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        alert('Please enter a 5-letter word');
        return;
    }
    
    // Play submit sound
    if (typeof soundManager !== 'undefined') {
        soundManager.playWordSubmit();
    }
    
    socket.emit('submitGuess', {
        gameId: gameState.gameId,
        playerId: currentPlayer,
        guess: guess,
        card: selectedCard
    });
    
    document.getElementById('wordInput').value = '';
    currentGuess = '';
    selectedCard = null;
    cardChainActive = false; // Reset card chain flag after submitting
}


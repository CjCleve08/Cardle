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
        clearDecksCache();
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
        clearDecksCache();
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
        clearDecksCache();
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
        clearDecksCache();
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
        
        // Show edit button for authenticated users
        const editUsernameBtn = document.getElementById('editUsernameBtn');
        if (editUsernameBtn) {
            editUsernameBtn.style.display = 'inline-flex';
        }
    } else {
        // Not signed in
        if (userInfoHeader) {
            userInfoHeader.style.display = 'none';
        }
        if (logoutBtn) {
            logoutBtn.style.display = 'none';
        }
        
        // Hide username change section for non-authenticated users
        const usernameSection = document.getElementById('profileUsernameSection');
        if (usernameSection) {
            usernameSection.style.display = 'none';
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

// Map card IDs to image filenames
function getCardImagePath(cardId) {
    const cardImageMap = {
        'falseFeedback': 'Bluff.png',
        'hiddenFeedback': 'PokerFace.png',
        'hiddenGuess': 'Blank.png',
        'extraGuess': 'HitMe.png',
        'hideCard': 'SneakySet.png',
        'phonyCard': 'DummyHand.png',
        'gamblersCard': 'BustSpecial.png',
        'cardLock': 'ForcedMiss.png',
        'handReveal': 'DeadHand.png',
        'blindGuess': 'Null.png',
        'cardSteal': 'Finesse.png',
        'greenToGrey': 'FalseShuffle.png',
        'cardBlock': 'OppressiveFold.png',
        'effectClear': 'Counter.png',
        'timeRush': 'QuickDeal.png',
        'wordScramble': 'Undertrick.png',
        'cardMirror': 'FollowSuit.png',
        'snackTime': 'SnackTime.png',
        'remJob': 'RemJob.png',
        'hiddenKeyboard': 'CardeBlanche.png'
    };
    
    const imageName = cardImageMap[cardId] || 'Blank.png';
    return `images/Card Images/${imageName}`;
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
const DECK_STORAGE_KEY = 'cardle_player_decks';
const DECK_SLOT_KEY = 'cardle_current_deck_slot';
const DECK_SIZE = 7;
const NUMBER_OF_DECK_SLOTS = 3;
const SPECIAL_CARD_SLOTS = 2; // First 2 slots are special card slots
const SPECIAL_CARD_SLOT_START = 0;
const REGULAR_SLOT_START = 2; // Regular cards start at index 2
let currentDeckSlot = 1; // Current deck slot (1, 2, or 3)

// Check if a card is special (chainable cards)
// Special cards are: modifier cards and cards that allow additional selections/turns
// Modifier cards can be chained with another card (like phonyCard, hideCard)
// Other chainable cards allow selecting additional cards or turns (like snackTime, extraGuess, cardSteal, handReveal)
function isSpecialCard(cardId) {
    // Check if it's a modifier card (can be chained with another card)
    if (isModifierCard(cardId)) {
        return true;
    }
    
    // Check if it allows additional card selections or turns
    // These cards enable chaining behavior:
    // - snackTime: allows selecting from all deck cards
    // - extraGuess (Hit Me): gives extra turn (allows chaining across turns)
    // - cardSteal (Finesse): allows selecting opponent's card
    const chainableCards = ['snackTime', 'extraGuess', 'cardSteal'];
    if (chainableCards.includes(cardId)) {
        return true;
    }
    
    return false;
}

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

// Clear cached decks when user changes (login/logout)
function clearDecksCache() {
    cachedDecks = null;
}

// Cache for current decks to avoid repeated Firestore reads
let cachedDecks = null;

// Get all decks (returns object with slot numbers as keys)
async function getAllDecks() {
    // For guests, use localStorage as fallback
    if (isGuestMode || !currentUser) {
    const stored = localStorage.getItem(DECK_STORAGE_KEY);
    if (stored) {
        try {
                const decks = JSON.parse(stored);
                // Validate all decks - ensure all cards still exist
            const allCardIds = getAllCards().map(c => c.id);
                const validatedDecks = {};
                for (let slot = 1; slot <= NUMBER_OF_DECK_SLOTS; slot++) {
                    if (decks[slot]) {
                        validatedDecks[slot] = decks[slot].filter(cardId => allCardIds.includes(cardId));
                    }
                }
                return validatedDecks;
        } catch (e) {
                console.error('Error loading decks from localStorage:', e);
            }
        }
        return {};
    }
    
    // For authenticated users, use Firestore
    if (!window.firebaseDb || !currentUser || !currentUser.uid) {
        console.warn('Firebase not available or user not authenticated, using localStorage');
        const stored = localStorage.getItem(DECK_STORAGE_KEY);
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error('Error loading decks from localStorage:', e);
            }
        }
        return {};
    }
    
    // Return cached decks if available
    if (cachedDecks !== null) {
        return cachedDecks;
    }
    
    try {
        const decksDoc = await window.firebaseDb.collection('decks').doc(currentUser.uid).get();
        if (decksDoc.exists) {
            cachedDecks = decksDoc.data();
            return cachedDecks;
        } else {
            // No decks yet, return empty
            cachedDecks = {};
            return cachedDecks;
        }
    } catch (error) {
        console.error('Error loading decks from Firestore:', error);
        // Fallback to localStorage
        const stored = localStorage.getItem(DECK_STORAGE_KEY);
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error('Error loading decks from localStorage fallback:', e);
            }
        }
        return {};
    }
}

// Synchronous version for backwards compatibility (returns cached or localStorage)
function getAllDecksSync() {
    if (cachedDecks !== null) {
        return cachedDecks;
    }
    
    // For guests or when not authenticated, use localStorage
    if (isGuestMode || !currentUser) {
        const stored = localStorage.getItem(DECK_STORAGE_KEY);
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error('Error loading decks from localStorage:', e);
            }
        }
    }
    
    return {};
}

// Get current deck slot
function getCurrentDeckSlot() {
    const stored = localStorage.getItem(DECK_SLOT_KEY);
    if (stored) {
        const slot = parseInt(stored);
        if (slot >= 1 && slot <= NUMBER_OF_DECK_SLOTS) {
            return slot;
        }
    }
    return 1; // Default to slot 1
}

// Set current deck slot
function setCurrentDeckSlot(slot) {
    if (slot >= 1 && slot <= NUMBER_OF_DECK_SLOTS) {
        currentDeckSlot = slot;
        localStorage.setItem(DECK_SLOT_KEY, slot.toString());
        return true;
    }
    return false;
}

// Get player deck from current slot
async function getPlayerDeck() {
    const decks = await getAllDecks();
    const slot = getCurrentDeckSlot();
    
    if (decks[slot] && Array.isArray(decks[slot]) && decks[slot].length > 0) {
        return decks[slot];
    }
    
    // Default to premade deck for slot 1, empty for others
    if (slot === 1) {
        const premadeDeck = createPremadeDeck().filter(id => id !== null);
        if (premadeDeck.length > 0) {
            return premadeDeck;
        }
    }
    
    // Fallback: empty deck
    return [];
}

// Synchronous version for backwards compatibility
function getPlayerDeckSync() {
    const decks = getAllDecksSync();
    const slot = getCurrentDeckSlot();
    
    if (decks[slot] && Array.isArray(decks[slot]) && decks[slot].length > 0) {
        return decks[slot];
    }
    
    // Default to premade deck for slot 1, empty for others
    if (slot === 1) {
        const premadeDeck = createPremadeDeck().filter(id => id !== null);
        if (premadeDeck.length > 0) {
            return premadeDeck;
        }
    }
    
    // Fallback: empty deck
    return [];
}

// Create a premade deck following special card rules
function createPremadeDeck() {
    const allCards = getAllCards();
    if (allCards.length === 0) {
        return [];
    }
    
    // Separate cards into special and regular
    const specialCards = allCards.filter(card => isSpecialCard(card.id));
    const regularCards = allCards.filter(card => !isSpecialCard(card.id));
    
    // Create deck: 2 special cards + 4 regular cards
    const deck = [];
    
    // Add 2 special cards (or as many as available, max 2)
    const specialsToAdd = Math.min(SPECIAL_CARD_SLOTS, specialCards.length);
    for (let i = 0; i < specialsToAdd; i++) {
        deck.push(specialCards[i].id);
    }
    
    // Fill remaining slots with regular cards (up to 4, or fill remaining slots)
    const regularsToAdd = Math.min(DECK_SIZE - deck.length, regularCards.length);
    for (let i = 0; i < regularsToAdd; i++) {
        deck.push(regularCards[i].id);
    }
    
    // Pad with nulls if needed to reach DECK_SIZE
    while (deck.length < DECK_SIZE) {
        deck.push(null);
    }
    
    return deck;
}

// Save player deck to current slot (auto-save)
async function savePlayerDeck(deck) {
    const decks = await getAllDecks();
    const slot = getCurrentDeckSlot();
    decks[slot] = deck.filter(id => id !== null); // Remove nulls before saving
    
    // For guests, use localStorage
    if (isGuestMode || !currentUser) {
        localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(decks));
        return;
    }
    
    // For authenticated users, save to Firestore
    if (!window.firebaseDb || !currentUser || !currentUser.uid) {
        console.warn('Firebase not available or user not authenticated, using localStorage');
        localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(decks));
        return;
    }
    
    try {
        await window.firebaseDb.collection('decks').doc(currentUser.uid).set(decks, { merge: true });
        cachedDecks = decks; // Update cache
        // Also save to localStorage as backup
        localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(decks));
    } catch (error) {
        console.error('Error saving decks to Firestore:', error);
        // Fallback to localStorage
        localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(decks));
    }
}

// Auto-save deck when it changes
async function autoSaveDeck() {
    const filledSlots = currentDeckSelection.filter(id => id !== null);
    
    // Validate: Check that special cards are only in special slots
    for (let i = 0; i < DECK_SIZE; i++) {
        const cardId = currentDeckSelection[i];
        if (cardId && isSpecialCard(cardId) && i >= SPECIAL_CARD_SLOTS) {
            // Invalid placement, but don't block auto-save - just log
            console.warn('Invalid deck: special card in regular slot');
        }
    }
    
    // Only save if deck is complete or being edited
    if (filledSlots.length === DECK_SIZE || filledSlots.length > 0) {
        await savePlayerDeck(currentDeckSelection.filter(id => id !== null));
    }
}

// Get deck for a specific slot
function getDeckForSlot(slot) {
    const decks = getAllDecksSync();
    if (decks[slot] && Array.isArray(decks[slot])) {
        return decks[slot];
    }
    return null;
}

// Save deck for a specific slot
async function saveDeckForSlot(slot, deck) {
    if (slot >= 1 && slot <= NUMBER_OF_DECK_SLOTS) {
        const decks = await getAllDecks();
        decks[slot] = deck;
        
        // For guests, use localStorage
        if (isGuestMode || !currentUser) {
            localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(decks));
            return;
        }
        
        // For authenticated users, save to Firestore
        if (!window.firebaseDb || !currentUser || !currentUser.uid) {
            console.warn('Firebase not available or user not authenticated, using localStorage');
            localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(decks));
            return;
        }
        
        try {
            await window.firebaseDb.collection('decks').doc(currentUser.uid).set(decks, { merge: true });
            cachedDecks = decks; // Update cache
            // Also save to localStorage as backup
            localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(decks));
        } catch (error) {
            console.error('Error saving decks to Firestore:', error);
            // Fallback to localStorage
            localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(decks));
        }
    }
}

function getDeckCards() {
    const deckIds = getPlayerDeckSync();
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
        const screenIds = ['login', 'signup', 'guestName', 'lobby', 'waiting', 'vs', 'game', 'gameOver'];
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
        
        // Stop lobby music if leaving lobby (but not if going to game or vs, game/vs will handle their own music)
        if (this.currentScreen === 'lobby' && screenName !== 'lobby' && screenName !== 'game' && screenName !== 'vs') {
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
        
        // Reset VS screen animations when showing
        if (screenName === 'vs') {
            // Reset any animation styles that might be present
            const vsPlayer1 = document.querySelector('.vs-player-left');
            const vsPlayer2 = document.querySelector('.vs-player-right');
            const vsText = document.querySelector('.vs-vs-text');
            const vsAvatars = document.querySelectorAll('.vs-player-avatar');
            const vsStats = document.querySelectorAll('.vs-player-stat');
            
            // Force reflow to reset animations
            if (vsPlayer1) {
                vsPlayer1.style.animation = 'none';
                vsPlayer1.style.opacity = '0';
                void vsPlayer1.offsetWidth; // Force reflow
                vsPlayer1.style.animation = '';
            }
            if (vsPlayer2) {
                vsPlayer2.style.animation = 'none';
                vsPlayer2.style.opacity = '0';
                void vsPlayer2.offsetWidth; // Force reflow
                vsPlayer2.style.animation = '';
            }
            if (vsText) {
                vsText.style.animation = 'none';
                vsText.style.opacity = '0';
                vsText.style.transform = 'scale(0)';
                void vsText.offsetWidth; // Force reflow
                vsText.style.animation = '';
            }
            vsAvatars.forEach(avatar => {
                avatar.style.animation = 'none';
                avatar.style.opacity = '0';
                void avatar.offsetWidth;
                avatar.style.animation = '';
            });
            vsStats.forEach(stat => {
                stat.style.animation = 'none';
                stat.style.opacity = '0';
                void stat.offsetWidth;
                stat.style.animation = '';
            });
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
    console.log('Players array:', data.players);
    
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
    
    // Find player names and data for VS screen
    let player1Name = 'You';
    let player2Name = 'Opponent';
    let myPlayerData = null;
    let opponentData = null;
    
    if (data.players && Array.isArray(data.players)) {
        console.log('Looking for my player data (id:', currentPlayer, ') in players:', data.players.map(p => ({ id: p.id, name: p.name, firebaseUid: p.firebaseUid })));
        myPlayerData = data.players.find(p => p.id === currentPlayer);
        opponentData = data.players.find(p => p.id !== currentPlayer);
        
        console.log('My player data:', myPlayerData);
        console.log('Opponent data:', opponentData);
        
        if (myPlayerData) {
            player1Name = myPlayerData.name || 'You';
        }
        if (opponentData) {
            player2Name = opponentData.name || 'Opponent';
        }
    }
    
    // Show VS screen first
    if (ScreenManager.show('vs')) {
        // Update VS screen with player names
        const vsPlayer1Name = document.getElementById('vsPlayer1Name');
        const vsPlayer2Name = document.getElementById('vsPlayer2Name');
        const vsPlayer1Avatar = document.getElementById('vsPlayer1Avatar');
        const vsPlayer2Avatar = document.getElementById('vsPlayer2Avatar');
        const vsPlayer1Stat = document.getElementById('vsPlayer1Stat');
        const vsPlayer1StatWins = document.getElementById('vsPlayer1StatWins');
        const vsPlayer2Stat = document.getElementById('vsPlayer2Stat');
        const vsPlayer2StatWins = document.getElementById('vsPlayer2StatWins');
        
        console.log('Setting VS screen names:', player1Name, 'vs', player2Name);
        console.log('Opponent data:', opponentData);
        
        // Update player 1 (me) name
        if (vsPlayer1Name) {
            vsPlayer1Name.textContent = player1Name;
        }
        
        // Update player 1 avatar
        if (vsPlayer1Avatar) {
            if (currentUser && currentUser.photoURL) {
                vsPlayer1Avatar.style.backgroundImage = `url(${currentUser.photoURL})`;
                vsPlayer1Avatar.style.backgroundSize = 'cover';
                vsPlayer1Avatar.style.backgroundPosition = 'center';
                vsPlayer1Avatar.textContent = '';
            } else {
                vsPlayer1Avatar.style.backgroundImage = '';
                vsPlayer1Avatar.style.backgroundSize = '';
                vsPlayer1Avatar.style.backgroundPosition = '';
                const initial = player1Name.charAt(0).toUpperCase();
                vsPlayer1Avatar.textContent = initial || '👤';
            }
        }
        
        // Update player 1 stats (my stats)
        if (vsPlayer1Stat) {
            getPlayerStats().then(stats => {
                vsPlayer1Stat.textContent = `Games Played: ${stats.gamesPlayed || 0}`;
                if (vsPlayer1StatWins) {
                    vsPlayer1StatWins.textContent = `Games Won: ${stats.wins || 0}`;
                }
            }).catch(() => {
                vsPlayer1Stat.textContent = 'Games Played: -';
                if (vsPlayer1StatWins) {
                    vsPlayer1StatWins.textContent = 'Games Won: -';
                }
            });
        }
        
        // Update player 2 (opponent) name
        if (vsPlayer2Name) {
            vsPlayer2Name.textContent = player2Name;
        }
        
        // Update player 2 avatar
        if (vsPlayer2Avatar) {
            // For opponent, we might not have photoURL in the data
            // If opponent has a user ID and we can fetch their profile, we could do that
            // For now, just use first letter or emoji
            vsPlayer2Avatar.style.backgroundImage = '';
            vsPlayer2Avatar.style.backgroundSize = '';
            vsPlayer2Avatar.style.backgroundPosition = '';
            const initial = player2Name.charAt(0).toUpperCase();
            vsPlayer2Avatar.textContent = initial || '👤';
        }
        
        // Update player 2 stats (opponent stats)
        if (vsPlayer2Stat) {
            // Try to fetch opponent stats if they have a Firebase UID
            console.log('Opponent data for stats:', opponentData);
            if (opponentData && opponentData.firebaseUid && window.firebaseDb) {
                console.log('Fetching opponent stats for firebaseUid:', opponentData.firebaseUid);
                console.log('Current user authenticated?', !!window.firebaseAuth?.currentUser);
                console.log('Current user UID:', window.firebaseAuth?.currentUser?.uid);
                
                // Check if user is authenticated before trying to fetch
                if (!window.firebaseAuth || !window.firebaseAuth.currentUser) {
                    console.warn('User not authenticated, cannot fetch opponent stats');
                    vsPlayer2Stat.textContent = 'Games Played: -';
                    if (vsPlayer2StatWins) {
                        vsPlayer2StatWins.textContent = 'Games Won: -';
                    }
                    return;
                }
                
                // Fetch opponent stats from Firestore
                window.firebaseDb.collection('stats').doc(opponentData.firebaseUid).get()
                    .then(statsDoc => {
                        console.log('Opponent stats doc exists:', statsDoc.exists);
                        if (statsDoc.exists) {
                            const opponentStats = statsDoc.data();
                            console.log('Opponent stats data:', opponentStats);
                            console.log('Opponent gamesPlayed:', opponentStats.gamesPlayed);
                            console.log('Opponent wins:', opponentStats.wins);
                            
                            const gamesPlayed = opponentStats.gamesPlayed || opponentStats.gamesPlayed === 0 ? opponentStats.gamesPlayed : 0;
                            const wins = opponentStats.wins || opponentStats.wins === 0 ? opponentStats.wins : 0;
                            
                            vsPlayer2Stat.textContent = `Games Played: ${gamesPlayed}`;
                            if (vsPlayer2StatWins) {
                                vsPlayer2StatWins.textContent = `Games Won: ${wins}`;
                            }
                        } else {
                            console.log('Opponent stats doc does not exist for firebaseUid:', opponentData.firebaseUid);
                            vsPlayer2Stat.textContent = 'Games Played: 0';
                            if (vsPlayer2StatWins) {
                                vsPlayer2StatWins.textContent = 'Games Won: 0';
                            }
                        }
                    })
                    .catch(error => {
                        console.error('Error fetching opponent stats:', error);
                        console.error('Error details:', error.message, error.code);
                        console.error('Full error:', error);
                        
                        // Check if it's a permission error
                        if (error.code === 'permission-denied') {
                            console.error('Permission denied - check Firestore security rules');
                        }
                        
                        vsPlayer2Stat.textContent = 'Games Played: -';
                        if (vsPlayer2StatWins) {
                            vsPlayer2StatWins.textContent = 'Games Won: -';
                        }
                    });
            } else if (opponentData && opponentData.isBot) {
                // Bot - show "-" or "Bot"
                console.log('Opponent is a bot');
                vsPlayer2Stat.textContent = 'Games Played: -';
                if (vsPlayer2StatWins) {
                    vsPlayer2StatWins.textContent = 'Games Won: -';
                }
            } else {
                // No Firebase UID available (guest player)
                console.log('No firebaseUid for opponent. OpponentData:', opponentData);
                console.log('Has firebaseDb?', !!window.firebaseDb);
                vsPlayer2Stat.textContent = 'Games Played: -';
                if (vsPlayer2StatWins) {
                    vsPlayer2StatWins.textContent = 'Games Won: -';
                }
            }
        }
        
        // After 5 seconds, transition to game screen
        setTimeout(() => {
            // Play game start sound when transitioning to game
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
    
    if (ScreenManager.show('game')) {
                // Start background music when game starts
                if (typeof soundManager !== 'undefined') {
                    soundManager.playBackgroundMusic('GameSoundTrack.mp4');
                }
    initializeGame(gameState);
    } else {
        console.error('Failed to show game screen!');
            }
        }, 3000);
    } else {
        // Fallback: if VS screen fails, go directly to game
        console.error('Failed to show vs screen, going directly to game');
        if (ScreenManager.show('game')) {
            if (typeof soundManager !== 'undefined') {
                soundManager.playGameStart();
                soundManager.playBackgroundMusic('GameSoundTrack.mp4');
            }
            initializeGame(gameState);
        }
    }
});

socket.on('snackTimeTriggered', (data) => {
    // Skip if spectator
    if (window.isSpectator) return;
    
    if (data.gameId === gameState?.gameId) {
        // Save the original hand before replacing it
        window.snackTimeOriginalHand = [...window.playerCardHand];
        
        // Put all deck cards into hand (excluding snackTime)
        const deckCards = getDeckCards();
        const allCards = deckCards.filter(card => card.id !== 'snackTime');
        
        // Set snack time mode flag
        window.snackTimeMode = true;
        
        // Put all cards into hand
        window.playerCardHand = [...allCards];
        
        // Show card selection from all available cards
        setTimeout(() => {
            showCardSelection();
        }, 100);
    }
});

socket.on('cardSelected', (data) => {
    // Skip if spectator
    if (window.isSpectator) return;
    
    if (data.playerId === currentPlayer) {
        selectedCard = data.card;
        
        // If Counter card was played, effects will be cleared server-side
        // We'll receive activeEffectsUpdated event to update our gameState
        
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
            window.snackTimeMode = false; // Clear snack time mode
        hideCardSelection();
        showGameBoard();
        }
    }
});

socket.on('activeEffectsUpdated', (data) => {
    // Update gameState with new active effects
    if (gameState && gameState.gameId === data.gameId) {
        // Check if timeRush was active before (to detect if it was cleared)
        const currentTurnPlayerId = gameState.currentTurn;
        const hadTimeRushBefore = gameState.activeEffects && gameState.activeEffects.some(e => 
            e.type === 'timeRush' && e.target === currentTurnPlayerId && !e.used
        );
        const oldTimeLimit = hadTimeRushBefore ? 20 : TURN_TIME_LIMIT;
        
        // Update with new active effects
        gameState.activeEffects = data.activeEffects;
        console.log('Active effects updated:', data.activeEffects);
        
        // Update keyboard visibility if hiddenKeyboard effect changed
        updateKeyboardVisibility();
        
        // Check if timeRush is active now
        const hasTimeRushAfter = gameState.activeEffects && gameState.activeEffects.some(e => 
            e.type === 'timeRush' && e.target === currentTurnPlayerId && !e.used
        );
        const newTimeLimit = hasTimeRushAfter ? 20 : TURN_TIME_LIMIT;
        
        // If timer is running (for either player's turn), restart it to recalculate time limit
        if (turnTimer) {
            const timeRemainingBefore = turnTimeRemaining;
            const isMyTurn = gameState.currentTurn === currentPlayer;
            
            stopTurnTimer();
            
            // If time limit changed (timeRush was cleared), adjust the remaining time
            if (oldTimeLimit !== newTimeLimit) {
                if (newTimeLimit > oldTimeLimit) {
                    // Time limit increased (timeRush cleared) - reset to full time
                    turnTimeRemaining = newTimeLimit;
                    console.log(`Time limit increased from ${oldTimeLimit} to ${newTimeLimit} - resetting to full time (${isMyTurn ? 'my turn' : 'opponent turn'})`);
                } else {
                    // Time limit decreased - keep proportional time
                    const percentageRemaining = timeRemainingBefore / oldTimeLimit;
                    turnTimeRemaining = Math.max(1, Math.floor(newTimeLimit * percentageRemaining));
                    console.log(`Time limit decreased from ${oldTimeLimit} to ${newTimeLimit} - adjusted time: ${turnTimeRemaining} (${isMyTurn ? 'my turn' : 'opponent turn'})`);
                }
            } else {
                // Time limit didn't change, keep the same remaining time
                turnTimeRemaining = timeRemainingBefore;
            }
            
            // Restart timer with updated effects, preserving the adjusted time
            startTurnTimer(true); // Pass true to preserve timeRemaining
        } else {
            // Timer not running yet, but will be started correctly when needed
            // Just update the display
            updateTimerDisplay();
        }
    }
});

socket.on('turnChanged', (data) => {
    // Skip if spectator (spectators are handled by a separate handler below)
    if (window.isSpectator) {
        return;
    }
    
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
    updateKeyboardVisibility(); // Update keyboard visibility when turn changes
    
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
    // Check if we're spectating
    if (window.isSpectator && window.spectatedPlayerId) {
        // For spectators, show spectated player's guesses with displayGuess
        if (data.playerId === window.spectatedPlayerId) {
            // This is the spectated player's guess
            if (data.hidden || !data.guess || !data.feedback) {
                displayOpponentGuessHidden(data.row);
            } else {
                displayGuess(data.guess, data.feedback, data.row);
                updateKeyboard({ guess: data.guess, feedback: data.feedback });
            }
        } else {
            // This is the opponent's guess (show on opponent board)
            if (data.hidden || !data.guess) {
                displayOpponentGuessHidden(data.row);
            } else if (data.feedback && data.feedback.every(f => f === 'absent') && data.guess) {
                displayOpponentGuess(data.guess, data.feedback, data.row);
            } else if (!data.feedback) {
                displayOpponentGuess(data.guess, ['absent', 'absent', 'absent', 'absent', 'absent'], data.row);
            } else {
                displayOpponentGuess(data.guess, data.feedback, data.row);
                if (!data.feedback.every(f => f === 'absent')) {
                    updateKeyboard({ guess: data.guess, feedback: data.feedback });
                }
            }
        }
    } else if (data.playerId === currentPlayer) {
        // This is my guess
        if (data.hidden || !data.guess || !data.feedback) {
            // Guess is hidden from player (Gambler's Card, Rem-Job, or Blind Guess effect)
            displayOpponentGuessHidden(data.row);
            console.log('Your guess was hidden!');
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
            initializeDeckPoolSync();
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
            initializeDeckPoolSync();
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
            initializeDeckPoolSync();
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

socket.on('cardUnblocked', (data) => {
    // The blocked card is now unblocked (after our turn)
    window.blockedCardId = null;
    // Update hand panel to show cards are no longer blocked
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
                
                // Don't show splash here - server will emit 'cardPlayed' event which will queue the splash
                // This prevents double splashes (client-side + server-side)
                
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
    console.log('gameOver event received:', data);
    // Prepare UI elements first
    const titleEl = document.getElementById('gameOverTitle');
    const messageEl = document.getElementById('gameOverMessage');
    const iconEl = document.getElementById('gameOverIcon');
    const wordEl = document.getElementById('gameOverWord');
    
    // Store gameId for rematch functionality
    if (data.gameId) {
        if (gameState) {
            gameState.gameId = data.gameId;
        }
        // Also store globally as backup
        window.lastGameId = data.gameId;
        console.log('Stored gameId for rematch:', data.gameId);
    }
    
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
    
    // Transition to game over screen immediately (server already delayed by 2 seconds)
    if (!ScreenManager.show('gameOver')) {
        console.error('Failed to show gameOver screen!');
        return;
    }
    
    // Reset rematch button state
    const rematchBtn = document.getElementById('rematchBtn');
    if (rematchBtn) {
        rematchBtn.disabled = false;
        rematchBtn.textContent = 'Rematch';
        rematchBtn.classList.remove('waiting', 'opponent-ready');
    }
});

// Rematch functionality
socket.on('rematchRequested', (data) => {
    const rematchBtn = document.getElementById('rematchBtn');
    if (rematchBtn) {
        if (data.playerId === currentPlayer) {
            // You requested rematch - show waiting state
            rematchBtn.textContent = 'Waiting for opponent...';
            rematchBtn.disabled = true;
            rematchBtn.classList.add('waiting');
        } else {
            // Opponent requested rematch - show that they're ready
            rematchBtn.textContent = 'Opponent wants rematch!';
            rematchBtn.classList.add('opponent-ready');
        }
    }
});

socket.on('rematchAccepted', (data) => {
    // Both players accepted rematch - new game is starting
    const rematchBtn = document.getElementById('rematchBtn');
    if (rematchBtn) {
        rematchBtn.textContent = 'Starting rematch...';
        rematchBtn.disabled = true;
    }
});

socket.on('rematchCancelled', () => {
    // Reset rematch button if opponent cancelled
    const rematchBtn = document.getElementById('rematchBtn');
    if (rematchBtn) {
        rematchBtn.disabled = false;
        rematchBtn.textContent = 'Rematch';
        rematchBtn.classList.remove('waiting', 'opponent-ready');
    }
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
        queueCardSplash(data.card, data.playerName);
    }
});


socket.on('chatMessage', (data) => {
    // Receive and display chat message
    const isSystemMessage = data.isSystem || data.playerId === 'system';
    displayChatMessage(data.playerName, data.message, data.timestamp, data.playerId === currentPlayer, isSystemMessage);
    
    // Play chat message sound (only for messages from others, not system messages)
    if (typeof soundManager !== 'undefined' && data.playerId !== currentPlayer && !isSystemMessage) {
        soundManager.playChatMessage();
    }
    
    // Flash the show chat button if chat is hidden and it's not your own message or a system message
    const chatContainer = document.getElementById('chatContainer');
    const chatShowBtn = document.getElementById('chatShowBtn');
    
    if (chatContainer && chatShowBtn && chatContainer.classList.contains('hidden') && data.playerId !== currentPlayer && !isSystemMessage) {
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

async function initializeGame(data) {
    // Skip normal initialization if spectator
    if (window.isSpectator) {
        console.log('Spectator mode: Skipping normal game initialization');
        return;
    }
    
    currentRow = 0;
    // Reset card hand and initialize deck pool for new game
    window.playerCardHand = [];
    window.blockedCardId = null; // Clear blocked card for new game
    await initializeDeckPool();
    createBoard();
    createKeyboard();
    updateKeyboardVisibility(); // Update keyboard visibility based on active effects
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
    
    // Scale game board to fit available space (with a small delay to ensure layout is complete)
    setTimeout(() => {
        scaleGameBoard();
    }, 50);
    
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

function scaleGameBoard() {
    const gameBoard = document.getElementById('gameBoard');
    const scalingContainer = document.getElementById('gameBoardScalingContainer');
    
    if (!gameBoard || !scalingContainer) return;
    
    // Temporarily set transform to just centering (no scale) to measure natural size accurately
    scalingContainer.style.transform = 'translate(-50%, -50%) scale(1)';
    scalingContainer.style.webkitTransform = 'translate(-50%, -50%) scale(1)';
    scalingContainer.style.msTransform = 'translate(-50%, -50%) scale(1)';
    scalingContainer.style.width = 'auto';
    scalingContainer.style.height = 'auto';
    scalingContainer.style.minWidth = '0';
    scalingContainer.style.minHeight = '0';
    
    // Force browser to recalculate layout
    void scalingContainer.offsetWidth;
    void scalingContainer.offsetHeight;
    
    // Get the natural (unscaled) dimensions of the content
    const contentWidth = scalingContainer.scrollWidth;
    const contentHeight = scalingContainer.scrollHeight;
    
    // Get available space from the parent container
    // Use the actual client dimensions, accounting for any padding
    const padding = 20; // Safety padding on all sides
    const availableWidth = gameBoard.clientWidth - (padding * 2);
    const availableHeight = gameBoard.clientHeight - (padding * 2);
    
    // Only proceed if we have valid dimensions
    if (availableWidth <= 0 || availableHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) {
        return;
    }
    
    // Calculate scale factors for both dimensions
    const scaleX = availableWidth / contentWidth;
    const scaleY = availableHeight / contentHeight;
    
    // Use the smaller scale to ensure everything fits in both dimensions
    let scale = Math.min(scaleX, scaleY);
    
    // Apply a small safety margin (0.98) to prevent edge touching
    scale = scale * 0.98;
    
    // Ensure minimum and maximum scale limits for usability
    scale = Math.max(0.3, Math.min(scale, 2.0));
    
    // Calculate the scaled dimensions
    const scaledWidth = contentWidth * scale;
    const scaledHeight = contentHeight * scale;
    
    // Apply the transform with centering and scaling
    // Use translate(-50%, -50%) for centering, then scale from center
    scalingContainer.style.transform = `translate(-50%, -50%) scale(${scale})`;
    scalingContainer.style.webkitTransform = `translate(-50%, -50%) scale(${scale})`;
    scalingContainer.style.msTransform = `translate(-50%, -50%) scale(${scale})`;
    scalingContainer.style.transformOrigin = 'center center';
    
    console.log(`Game board scaled: ${(scale * 100).toFixed(1)}% (content: ${contentWidth}x${contentHeight}, available: ${availableWidth}x${availableHeight}, scaled: ${scaledWidth.toFixed(0)}x${scaledHeight.toFixed(0)})`);
}

// Scale game board on window resize (with debounce for performance)
let resizeTimeout;
window.addEventListener('resize', () => {
    const gameScreen = document.getElementById('game');
    if (gameScreen && gameScreen.classList.contains('active')) {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            scaleGameBoard();
        }, 100);
    }
});

function createBoard() {
    const container = document.getElementById('boardContainer');
    container.innerHTML = '';
    
    // Start with 6 rows, but we'll add more dynamically as needed
    for (let i = 0; i < 6; i++) {
        createBoardRow(i);
    }
    
    // Initialize scroll behavior
    setupScrollBehavior();
    
    // Rescale after board is created (if on game screen)
    const gameScreen = document.getElementById('game');
    if (gameScreen && gameScreen.classList.contains('active')) {
        setTimeout(() => {
            scaleGameBoard();
        }, 10);
    }
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
    
    // Check if keyboard should be hidden and apply styling
    updateKeyboardVisibility();
    
    // Rescale after keyboard is created (if on game screen)
    const gameScreen = document.getElementById('game');
    if (gameScreen && gameScreen.classList.contains('active')) {
        setTimeout(() => {
            scaleGameBoard();
        }, 10);
    }
}

function updateKeyboardVisibility() {
    // Check if hiddenKeyboard effect is active for the current player
    if (!gameState || !currentPlayer) {
        // Game not initialized yet, don't hide keyboard
        return;
    }
    
    const isKeyboardHidden = gameState.activeEffects && gameState.activeEffects.some(e => 
        e.type === 'hiddenKeyboard' && e.target === currentPlayer && !e.used
    );
    
    const keys = document.querySelectorAll('.key');
    keys.forEach(key => {
        if (isKeyboardHidden) {
            key.classList.add('keyboard-hidden');
            // Also hide feedback colors (correct/present/absent)
            key.classList.remove('correct', 'present', 'absent');
        } else {
            key.classList.remove('keyboard-hidden');
        }
    });
}

function showCardSelection() {
    // Don't show card selection for spectators
    if (window.isSpectator) {
        console.log('Spectator mode: Skipping card selection');
        return;
    }
    
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
async function initializeDeckPool() {
    // Ensure decks are loaded from Firebase before getting the deck
    if (!isGuestMode && currentUser && cachedDecks === null) {
        await getAllDecks();
    }
    
    const deckIds = await getPlayerDeck();
    const allCards = getAllCards();
    const deckCards = deckIds.map(id => allCards.find(c => c.id === id)).filter(Boolean);
    
    // Create a shuffled pool of deck cards
    window.deckPool = [...deckCards].sort(() => Math.random() - 0.5);
    window.playerCardHand = [];
}

// Synchronous version that uses cached decks (for backwards compatibility)
function initializeDeckPoolSync() {
    const deckIds = getPlayerDeckSync();
    const allCards = getAllCards();
    const deckCards = deckIds.map(id => allCards.find(c => c.id === id)).filter(Boolean);
    
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
        initializeDeckPoolSync();
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
            
            // Create image element for the card
            const cardImage = document.createElement('img');
            cardImage.src = getCardImagePath(card.id);
            cardImage.alt = card.title || 'Unknown Card';
            cardImage.className = 'hand-card-image';
            cardElement.appendChild(cardImage);
            
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
        nextCardElement.className = 'next-card-item';
        
        // Create image element for the card
        const cardImage = document.createElement('img');
        cardImage.src = getCardImagePath(nextCard.id);
        cardImage.alt = nextCard.title || 'Unknown Card';
        cardImage.className = 'next-card-image';
        nextCardElement.appendChild(cardImage);
        
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
        const deckIds = getPlayerDeckSync();
        const allCards = getAllCards();
        const deckCards = deckIds.map(id => allCards.find(c => c.id === id)).filter(Boolean);
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
        initializeDeckPoolSync();
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
    
    // Check if we're in snack time mode - show all deck cards (excluding snackTime)
    if (window.snackTimeMode) {
        // Add class to container to indicate snack time mode
        container.classList.add('snack-time-mode');
        
        // In snack time mode, show all cards from hand except snackTime
        let availableCards = window.playerCardHand.filter(c => c.id !== 'snackTime');
        
        // Show all available cards (excluding blocked card)
        const selectedCards = availableCards.filter(c => c.id !== window.blockedCardId);
        
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
            
            // Create image element for the card
            const cardImage = document.createElement('img');
            cardImage.src = getCardImagePath(card.id);
            cardImage.alt = card.title;
            cardImage.className = 'card-image';
            cardElement.appendChild(cardImage);
            
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
        return;
    } else {
        // Remove snack time mode class if not in snack time mode
        container.classList.remove('snack-time-mode');
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
        
        // Create image element for the card
        const cardImage = document.createElement('img');
        cardImage.src = getCardImagePath(card.id);
        cardImage.alt = card.title;
        cardImage.className = 'card-image';
        cardElement.appendChild(cardImage);
        
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
    
    // Handle snack time mode differently
    if (window.snackTimeMode) {
        // Remove the selected card from hand
        if (window.playerCardHand) {
            const cardIndex = window.playerCardHand.findIndex(c => c.id === card.id);
            if (cardIndex !== -1) {
                const selectedCardObj = window.playerCardHand[cardIndex];
                window.playerCardHand.splice(cardIndex, 1);
                
                // Ensure deck pool is initialized
                if (!window.deckPool || window.deckPool.length === 0) {
                    initializeDeckPool();
                }
                
                // Put the selected card at the BACK of the deck pool
                window.deckPool.push(selectedCardObj);
                
                // Put all remaining cards from hand back into deck pool
                window.playerCardHand.forEach(remainingCard => {
                    if (remainingCard.id !== 'snackTime') {
                        window.deckPool.push(remainingCard);
                    }
                });
                
                // Restore the original hand (excluding Snack Time since it was used)
                if (window.snackTimeOriginalHand && window.snackTimeOriginalHand.length > 0) {
                    window.playerCardHand = window.snackTimeOriginalHand.filter(c => c.id !== 'snackTime');
                    // Clean up the saved hand
                    window.snackTimeOriginalHand = null;
                } else {
                    // Fallback: draw 3 cards if original hand wasn't saved
                    window.playerCardHand = [];
                    while (window.playerCardHand.length < 3 && window.deckPool.length > 0) {
                        const newCard = drawCardFromDeck();
                        window.playerCardHand.push(newCard);
                    }
                }
                
                // Clear snack time mode
                window.snackTimeMode = false;
                
                // Update hand panel
                updateHandPanel();
            }
        }
    } else {
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
                initializeDeckPoolSync();
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
    }
    
    // Don't show splash here - server will emit 'cardPlayed' event which will queue the splash
    // This prevents double splashes (client-side + server-side)
    
    // If a modifier card was selected, wait for server to allow another card selection
    // If in snack time mode, wait for server confirmation
    // Otherwise, hide card selection and show game board
    if (cardIsModifier) {
        // cardChainActive will be set by the cardSelected event handler
        // Don't hide selection yet - wait for next card
    } else if (window.snackTimeMode) {
        // In snack time mode, wait for server to confirm before hiding
        // The server will emit cardSelected with allowSecondCard: false
        cardChainActive = false;
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
    
    // Handle spectators
    if (window.isSpectator && gameState && gameState.currentTurn) {
        const spectatedPlayerId = window.spectatedPlayerId;
        if (gameState.currentTurn === spectatedPlayerId) {
            // It's the spectated player's turn
            indicator.textContent = `${gameState.players?.find(p => p.id === spectatedPlayerId)?.name || 'Player'}'s Turn`;
            indicator.classList.add('active-turn');
        } else {
            // It's the opponent's turn
            const currentTurnPlayer = gameState.players?.find(p => p.id === gameState.currentTurn);
            indicator.textContent = `${currentTurnPlayer?.name || 'Opponent'}'s Turn`;
            indicator.classList.remove('active-turn');
        }
        // Start timer for spectators (they see the timer for whoever's turn it is)
        startTurnTimer();
        return;
    }
    
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

function startTurnTimer(preserveTimeRemaining = false) {
    // Both players and spectators should track the timer
    if (!gameState || !gameState.currentTurn) {
        console.log('Not starting timer - no game state or current turn');
        return;
    }
    
    // Check if there's a timeRush effect active for the current player
    const currentTurnPlayerId = gameState.currentTurn;
    const hasTimeRush = gameState.activeEffects && gameState.activeEffects.some(e => 
        e.type === 'timeRush' && e.target === currentTurnPlayerId && !e.used
    );
    
    // Set timer limit based on whether timeRush is active
    const timeLimit = hasTimeRush ? 20 : TURN_TIME_LIMIT;
    
    // Only reset time remaining if we're not preserving it (e.g., when Counter clears timeRush)
    if (!preserveTimeRemaining) {
    turnTimeRemaining = timeLimit;
    } else {
        // If preserving, make sure it doesn't exceed the new limit
        if (turnTimeRemaining > timeLimit) {
            turnTimeRemaining = timeLimit;
        }
    }
    
    // Store the current turn for spectators to detect turn changes
    if (window.isSpectator) {
        window.spectatorTimerCurrentTurn = gameState.currentTurn;
    }
    
    const isMyTurn = !window.isSpectator && gameState.currentTurn === currentPlayer;
    const isSpectatedPlayerTurn = window.isSpectator && gameState.currentTurn === window.spectatedPlayerId;
    
    if (hasTimeRush && (isMyTurn || isSpectatedPlayerTurn)) {
        console.log('Time Rush effect active - timer set to 20 seconds');
    } else if (!hasTimeRush && (isMyTurn || isSpectatedPlayerTurn) && preserveTimeRemaining) {
        console.log(`Time Rush cleared - timer reset to ${turnTimeRemaining} seconds (limit: ${timeLimit})`);
    }
    console.log(`Starting turn timer - is my turn: ${isMyTurn}, is spectator: ${window.isSpectator}, time remaining: ${turnTimeRemaining}, limit: ${timeLimit}, preserve: ${preserveTimeRemaining}`);
    
    // Clear any existing timer before starting new one
    if (turnTimer) {
        clearInterval(turnTimer);
        turnTimer = null;
    }
    
    updateTimerDisplay();
    
    turnTimer = setInterval(() => {
        // Check if turn has changed
        if (!gameState || !gameState.currentTurn) {
            console.log('Timer: Game state invalid, stopping timer');
            stopTurnTimer();
            return;
        }
        
        // For spectators, check if the current turn changed (compare with stored turn)
        if (window.isSpectator) {
            const currentTurnWhenStarted = window.spectatorTimerCurrentTurn;
            if (currentTurnWhenStarted !== undefined && currentTurnWhenStarted !== gameState.currentTurn) {
                // Turn changed, restart timer with new turn
                console.log('Timer: Turn changed for spectator, restarting timer');
                stopTurnTimer();
                startTurnTimer();
                return;
            }
        }
        
        const stillMyTurn = !window.isSpectator && gameState.currentTurn === currentPlayer;
        
        // If turn changed, stop timer (for players only)
        if (!window.isSpectator && isMyTurn && !stillMyTurn) {
            console.log('Timer: Turn changed, stopping timer');
            stopTurnTimer();
            return;
        }
        
        turnTimeRemaining--;
        updateTimerDisplay();
        
        // Only the player whose turn it is can trigger timeout (not spectators)
        if (turnTimeRemaining <= 0) {
            stopTurnTimer();
            if (stillMyTurn && gameState.gameId && !window.isSpectator) {
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
    // Don't reset turnTimeRemaining here - let startTurnTimer() handle it
    // This allows the timer to properly reset to the correct limit (which may be 20 for timeRush)
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
    
    // For spectators, always show the timer (for whoever's turn it is)
    const isMyTurn = !window.isSpectator && gameState.currentTurn === currentPlayer;
    
    // Check if timeRush is active for the current turn
    const currentTurnPlayerId = gameState.currentTurn;
    const hasTimeRush = gameState.activeEffects && gameState.activeEffects.some(e => 
        e.type === 'timeRush' && e.target === currentTurnPlayerId && !e.used
    );
    const timeLimit = hasTimeRush ? 20 : TURN_TIME_LIMIT;
    
    // Ensure timeRemaining doesn't exceed the current limit (in case timeRush was just cleared)
    if (turnTimeRemaining > timeLimit) {
        turnTimeRemaining = timeLimit;
    }
    
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
                // Add the class to start the flip animation
                if (feedback[i] === 'correct') {
                    cell.classList.add('correct');
                } else if (feedback[i] === 'present') {
                    cell.classList.add('present');
                } else {
                    cell.classList.add('absent');
                }
                
                // Play sound at midpoint of flip when color becomes visible (300ms = 50% of 600ms animation)
                if (typeof soundManager !== 'undefined') {
                    setTimeout(() => {
                        if (feedback[i] === 'correct') {
                            if (!allCorrect) { // Only play individual sound if not all correct
                                soundManager.playCorrectLetter();
                            }
                        } else if (feedback[i] === 'present') {
                            soundManager.playPresentLetter();
                        } else {
                            soundManager.playWrongLetter();
                        }
                    }, 300); // Play when flip reveals color (midpoint of 600ms animation)
                }
            }, i * 150); // Stagger the animations
        }
        }
        
        // Play win sound if all correct (after last letter sound)
        if (allCorrect && typeof soundManager !== 'undefined') {
            setTimeout(() => {
                soundManager.playCorrectWord();
            }, 4 * 150 + 300 + 200); // After last letter sound (900ms) + 200ms delay
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
    
    // Don't update keyboard colors if hiddenKeyboard effect is active
    const isKeyboardHidden = gameState && gameState.activeEffects && gameState.activeEffects.some(e => 
        e.type === 'hiddenKeyboard' && e.target === currentPlayer && !e.used
    );
    if (isKeyboardHidden) {
        return; // Skip updating keyboard colors when hidden
    }
    
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

// Splash queue system to handle multiple card splashes sequentially
let splashQueue = [];
let isShowingSplash = false;
let splashTimeouts = { hideTimeout: null, removeTimeout: null };
let currentSplashComplete = null;

function queueCardSplash(card, playerName) {
    splashQueue.push({ card, playerName });
    processSplashQueue();
}

function processSplashQueue() {
    // If already showing a splash or queue is empty, do nothing
    if (isShowingSplash || splashQueue.length === 0) {
        return;
    }
    
    // Mark as showing and get the next splash
    isShowingSplash = true;
    const { card, playerName } = splashQueue.shift();
    
    // Show the splash
    showCardSplash(card, playerName, () => {
        // Callback when splash completes
        isShowingSplash = false;
        // Process next splash in queue after a short delay
        setTimeout(() => {
            processSplashQueue();
        }, 100);
    });
}

function showCardSplash(card, playerName, onComplete) {
    const splash = document.getElementById('cardSplash');
    const splashImage = document.getElementById('splashCardImage');
    const splashPlayer = document.getElementById('splashPlayer');
    
    if (!splash || !splashImage || !splashPlayer) {
        console.error('Splash elements not found');
        if (onComplete) onComplete();
        return;
    }
    
    if (!card) {
        console.error('Card data is missing');
        if (onComplete) onComplete();
        return;
    }
    
    // Clear any existing timeouts
    if (splashTimeouts.hideTimeout) {
        clearTimeout(splashTimeouts.hideTimeout);
        splashTimeouts.hideTimeout = null;
    }
    if (splashTimeouts.removeTimeout) {
        clearTimeout(splashTimeouts.removeTimeout);
        splashTimeouts.removeTimeout = null;
    }
    
    // Store the complete callback
    currentSplashComplete = onComplete;
    
    // Remove any existing classes and click handlers
    splash.classList.remove('show', 'hiding');
    splash.onclick = null;
    
    // Set content
    splashImage.src = getCardImagePath(card.id);
    splashImage.alt = card.title || 'Card';
    splashPlayer.textContent = `${playerName || 'Player'} played:`;
    
    // Reset animation by forcing reflow
    void splash.offsetWidth;
    
    // Show with fly-in animation
    splash.classList.add('show');
    
    // Add click handler to skip animation
    splash.onclick = () => {
        // Clear timeouts
        if (splashTimeouts.hideTimeout) {
            clearTimeout(splashTimeouts.hideTimeout);
            splashTimeouts.hideTimeout = null;
        }
        if (splashTimeouts.removeTimeout) {
            clearTimeout(splashTimeouts.removeTimeout);
            splashTimeouts.removeTimeout = null;
        }
        
        // Immediately hide and remove
        splash.classList.remove('show', 'hiding');
        splash.onclick = null;
        
        // Call completion callback immediately
        if (currentSplashComplete) {
            const callback = currentSplashComplete;
            currentSplashComplete = null;
            callback();
        }
    };
    
    // After 2.5 seconds, start fly-out animation
    splashTimeouts.hideTimeout = setTimeout(() => {
        splash.classList.add('hiding');
        // Remove from DOM after animation completes
        splashTimeouts.removeTimeout = setTimeout(() => {
            splash.classList.remove('show', 'hiding');
            splash.onclick = null;
            if (currentSplashComplete) {
                const callback = currentSplashComplete;
                currentSplashComplete = null;
                callback();
            }
        }, 500);
    }, 2500);
}

// Event Listeners
// Deck Builder Functions with Drag and Drop
let currentDeckSelection = []; // Array of card IDs in deck slots (index = slot number)
let draggedCard = null;
let draggedSlotIndex = null;
let autoScrollInterval = null;
let mouseTracker = null; // Mouse position tracker function

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
        if (i < SPECIAL_CARD_SLOTS) {
            slot.classList.add('special-card-slot');
        }
        slot.dataset.slotIndex = i;
        
        // Removed slot numbers and stars as per user request
        
        // Add drag and drop event listeners
        slot.addEventListener('dragover', (e) => {
            e.preventDefault();
            slot.classList.add('drag-over');
        });
        
        slot.addEventListener('dragleave', () => {
            slot.classList.remove('drag-over');
        });
        
        slot.addEventListener('drop', async (e) => {
            e.preventDefault();
            slot.classList.remove('drag-over');
            await handleDropOnSlot(i);
        });
        
        deckSlots.appendChild(slot);
    }
    
    updateDeckSlots();
}

function updateDeckSlots() {
    updateDeckCount();
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
}

function createDeckSlotCard(card, slotIndex) {
    const cardElement = document.createElement('div');
    cardElement.className = 'deck-slot-card';
    if (isSpecialCard(card.id)) {
        cardElement.classList.add('special-card');
    }
    cardElement.draggable = true;
    cardElement.dataset.cardId = card.id;
    cardElement.dataset.slotIndex = slotIndex;
    
    // Create image element for the card
    const cardImage = document.createElement('img');
    cardImage.src = getCardImagePath(card.id);
    cardImage.alt = card.title;
    cardImage.className = 'deck-slot-card-image';
    cardElement.appendChild(cardImage);
    
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
    
    cardElement.addEventListener('click', (e) => {
        // Don't trigger click if it was part of a drag
        if (cardElement.classList.contains('dragging')) {
            return;
        }
        
        e.stopPropagation();
        const isInDeck = true; // Cards in slots are always in deck
        showCardDropdown(card, cardElement, isInDeck, slotIndex);
    });
    
    return cardElement;
}

async function renderDeckBuilder() {
    const deckCardsGrid = document.getElementById('deckCardsGrid');
    const deckSlots = document.getElementById('deckSlots');
    
    if (!deckCardsGrid || !deckSlots) {
        console.error('Deck builder elements not found');
        return;
    }
    
    const allCards = getAllCards();
    const currentDeck = await getPlayerDeck();
    
    // Initialize deck selection (pad with nulls if needed)
    currentDeckSelection = [...currentDeck];
    while (currentDeckSelection.length < DECK_SIZE) {
        currentDeckSelection.push(null);
    }
    
    // Validate and fix: Move special cards to special slots if they're in wrong slots
    const specialCardsInDeck = [];
    const regularCardsInDeck = [];
    
    for (let i = 0; i < currentDeckSelection.length; i++) {
        const cardId = currentDeckSelection[i];
        if (cardId) {
            if (isSpecialCard(cardId)) {
                specialCardsInDeck.push({ cardId, index: i });
            } else {
                regularCardsInDeck.push({ cardId, index: i });
            }
        }
    }
    
    // Fix special cards in wrong slots
    let specialSlotIndex = 0;
    for (const { cardId, index } of specialCardsInDeck) {
        if (index >= SPECIAL_CARD_SLOTS) {
            // Special card is in wrong slot, move to first available special slot
            if (specialSlotIndex < SPECIAL_CARD_SLOTS) {
                // Check if target slot is empty or has a regular card
                if (!currentDeckSelection[specialSlotIndex] || !isSpecialCard(currentDeckSelection[specialSlotIndex])) {
                    // Swap: move regular card (if any) to the old slot, move special card to special slot
                    const oldCardInSpecialSlot = currentDeckSelection[specialSlotIndex];
                    currentDeckSelection[specialSlotIndex] = cardId;
                    currentDeckSelection[index] = oldCardInSpecialSlot;
                }
                specialSlotIndex++;
            }
        } else {
            specialSlotIndex++;
        }
    }
    
    // Update deck slot selector UI
    updateDeckSlotSelector();
    
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
        
        deckCardsGrid.addEventListener('drop', async (e) => {
            e.preventDefault();
            deckCardsGrid.style.borderColor = '#3a3a3c';
            deckCardsGrid.style.backgroundColor = '#121213';
            
            // If card was dragged from a deck slot, remove it from deck
            // Capture slot index before dragend clears it
            const slotIndexToRemove = draggedSlotIndex;
            if (slotIndexToRemove !== null && draggedCard) {
                await removeCardFromSlot(slotIndexToRemove);
            }
        });
        
        deckCardsGrid.dataset.dropHandlersAdded = 'true';
    }
}

function renderAvailableCards() {
    const deckCardsGrid = document.getElementById('deckCardsGrid');
    const allCards = getAllCards();
    
    // Filter out cards that are in the deck
    let availableCards = allCards.filter(card => !currentDeckSelection.includes(card.id));
    
    // Sort cards: special cards at the end
    availableCards.sort((a, b) => {
        const aIsSpecial = isSpecialCard(a.id);
        const bIsSpecial = isSpecialCard(b.id);
        
        // If one is special and the other isn't, special comes last
        if (aIsSpecial && !bIsSpecial) return 1;
        if (!aIsSpecial && bIsSpecial) return -1;
        
        // If both are special or both are normal, maintain original order (or sort alphabetically)
        return a.title.localeCompare(b.title);
    });
    
    deckCardsGrid.innerHTML = '';
    
    availableCards.forEach(card => {
        const cardElement = document.createElement('div');
        cardElement.className = 'deck-card-item';
        if (isSpecialCard(card.id)) {
            cardElement.classList.add('special-card');
        }
        cardElement.dataset.cardId = card.id;
        
        // Create image element for the card
        const cardImage = document.createElement('img');
        cardImage.src = getCardImagePath(card.id);
        cardImage.alt = card.title;
        cardImage.className = 'deck-card-image';
        cardElement.appendChild(cardImage);
        
        // Set draggable
        cardElement.setAttribute('draggable', 'true');
        
        // Set up drag events
        cardElement.addEventListener('dragstart', (e) => {
            draggedCard = card.id;
            draggedSlotIndex = null;
            cardElement.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', card.id);
            
            // Store initial mouse position
            window.mouseY = e.clientY || 0;
            
            // Create custom drag image to prevent edge clipping
            const dragImage = createDragImage(cardElement);
            e.dataTransfer.setDragImage(dragImage, 0, 0);
            
            // Clean up drag image after a short delay
            setTimeout(() => {
                if (dragImage.parentNode) {
                    document.body.removeChild(dragImage);
                }
            }, 0);
            
            // Start auto-scroll when dragging (with a small delay to ensure mouse tracking is set up)
            setTimeout(() => {
                startAutoScroll();
            }, 50);
        });
        
        cardElement.addEventListener('dragend', (e) => {
            cardElement.classList.remove('dragging');
            draggedCard = null;
            draggedSlotIndex = null;
            // Stop auto-scroll
            stopAutoScroll();
        });
        
        // Add click handler to show dropdown menu
        cardElement.addEventListener('click', (e) => {
            // Don't trigger click if it was part of a drag
            if (cardElement.classList.contains('dragging')) {
                return;
            }
            
            e.stopPropagation();
            const isInDeck = currentDeckSelection.includes(card.id);
            showCardDropdown(card, cardElement, isInDeck, null);
        });
        
        deckCardsGrid.appendChild(cardElement);
    });
    
    // Add informational text at the bottom explaining yellow cards
    const infoText = document.createElement('div');
    infoText.className = 'deck-cards-info-text';
    infoText.textContent = 'Yellow cards are special cards and can only be placed in special slots';
    deckCardsGrid.appendChild(infoText);
}

function updateAvailableCards() {
    // Re-render available cards to reflect current deck state
    renderAvailableCards();
}

// Auto-scroll functionality for dragging cards
function startAutoScroll() {
    // Clear any existing interval
    stopAutoScroll();
    
    const deckSlotsContainer = document.querySelector('.deck-slots-container');
    const deckCardsGrid = document.getElementById('deckCardsGrid');
    
    if (!deckSlotsContainer || !deckCardsGrid) return;
    
    // Find the scrollable container - check multiple possible containers
    let scrollContainer = null;
    
    // Try to find .lobby-tab-content first (the main scrollable area)
    const lobbyTabContent = document.querySelector('.lobby-tab-content');
    if (lobbyTabContent && lobbyTabContent.scrollHeight > lobbyTabContent.clientHeight) {
        scrollContainer = lobbyTabContent;
    } else {
        // Fall back to finding the scrollable parent
        let element = deckSlotsContainer.parentElement;
        while (element && element !== document.body) {
            const style = getComputedStyle(element);
            const hasScroll = element.scrollHeight > element.clientHeight;
            if ((style.overflowY === 'auto' || style.overflowY === 'scroll' || hasScroll) && hasScroll) {
                scrollContainer = element;
                break;
            }
            element = element.parentElement;
        }
    }
    
    // If no scrollable container found, use window
    if (!scrollContainer) {
        scrollContainer = window;
    }
    
    // Track mouse position globally immediately
    mouseTracker = (e) => {
        window.mouseY = e.clientY || 0;
    };
    document.addEventListener('dragover', mouseTracker, { passive: true });
    document.addEventListener('drag', mouseTracker, { passive: true });
    
    autoScrollInterval = setInterval(() => {
        if (!draggedCard || draggedSlotIndex !== null) {
            // Only auto-scroll when dragging from available cards (not from deck slots)
            stopAutoScroll();
            return;
        }
        
        // Get mouse position (default to viewport center if not set)
        const mouseY = window.mouseY !== undefined ? window.mouseY : window.innerHeight / 2;
        const viewportHeight = window.innerHeight;
        const deckSlotsRect = deckSlotsContainer.getBoundingClientRect();
        
        // Calculate scroll direction and speed
        let scrollAmount = 0;
        const scrollSpeed = 25; // pixels per interval
        const scrollZone = 120; // pixels from top/bottom to trigger scroll
        
        // Get current scroll position
        const currentScrollTop = scrollContainer === window ? 
            window.pageYOffset || document.documentElement.scrollTop : 
            scrollContainer.scrollTop;
        
        // Calculate if we should scroll up (toward deck slots)
        // Scroll up if:
        // 1. Mouse is in upper portion of viewport AND deck slots are above current view
        // 2. Mouse is above deck slots (even if they're visible)
        const mouseAboveDeckSlots = mouseY < deckSlotsRect.bottom;
        const deckSlotsAboveViewport = deckSlotsRect.top < -50;
        const mouseInUpperZone = mouseY < scrollZone;
        
        if ((mouseAboveDeckSlots || mouseInUpperZone) && (deckSlotsRect.top > -200 || currentScrollTop > 0)) {
            scrollAmount = -scrollSpeed;
        }
        // Scroll down if mouse is in lower portion of viewport
        else if (mouseY > viewportHeight - scrollZone) {
            scrollAmount = scrollSpeed;
        }
        
        if (scrollAmount !== 0) {
            try {
                if (scrollContainer === window) {
                    window.scrollBy(0, scrollAmount);
                } else {
                    scrollContainer.scrollTop += scrollAmount;
                }
            } catch (e) {
                console.error('Scroll error:', e);
            }
        }
    }, 16); // ~60fps
}

function stopAutoScroll() {
    if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
    }
    // Remove all mouse tracking listeners
    if (mouseTracker) {
        document.removeEventListener('dragover', mouseTracker);
        document.removeEventListener('drag', mouseTracker);
        mouseTracker = null;
    }
}

async function handleDropOnSlot(slotIndex) {
    if (!draggedCard) return;
    
    // Stop auto-scroll
    stopAutoScroll();
    
    const allCards = getAllCards();
    const card = allCards.find(c => c.id === draggedCard);
    if (!card) return;
    
    // Validate: Special cards can only go in special slots (0-1)
    const isSpecial = isSpecialCard(draggedCard);
    const isSpecialSlot = slotIndex < SPECIAL_CARD_SLOTS;
    
    if (isSpecial && !isSpecialSlot) {
        showGameMessage('Invalid Slot', 'Special cards can only be placed in special card slots (★)!', '⚠️');
        return;
    }
    
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
    await autoSaveDeck(); // Auto-save when deck changes
}

async function removeCardFromSlot(slotIndex) {
    currentDeckSelection[slotIndex] = null;
    updateDeckSlots();
    await autoSaveDeck(); // Auto-save when deck changes
}

// Dropdown menu for deck builder cards
let currentDropdownCard = null;
let currentDropdownSlotIndex = null;
let currentDropdownCardElement = null;
let dropdownPositionUpdateInterval = null;

function updateDropdownPosition() {
    if (!currentDropdownCardElement) return;
    
    const dropdown = document.getElementById('cardDropdownMenu');
    if (!dropdown || dropdown.style.display === 'none') return;
    
    const rect = currentDropdownCardElement.getBoundingClientRect();
    
    // Center the dropdown below the card
    dropdown.style.left = `${rect.left + (rect.width / 2) - 80}px`;
    dropdown.style.top = `${rect.bottom + 8}px`;
    
    // Ensure dropdown is visible (adjust if it goes off screen)
    const dropdownRect = dropdown.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Adjust if dropdown goes off right edge
    if (dropdownRect.right > viewportWidth - 10) {
        dropdown.style.left = `${viewportWidth - dropdownRect.width - 10}px`;
    }
    // Adjust if dropdown goes off left edge
    if (dropdownRect.left < 10) {
        dropdown.style.left = '10px';
    }
    // Adjust if dropdown goes off bottom edge - show above card instead
    if (dropdownRect.bottom > viewportHeight - 10) {
        dropdown.style.top = `${rect.top - dropdownRect.height - 8}px`;
    }
}

function showCardDropdown(card, cardElement, isInDeck, slotIndex = null) {
    const dropdown = document.getElementById('cardDropdownMenu');
    const addRemoveBtn = document.getElementById('dropdownAddRemove');
    
    if (!dropdown || !addRemoveBtn) {
        console.error('Dropdown elements not found', { dropdown: !!dropdown, addRemoveBtn: !!addRemoveBtn });
        return;
    }
    
    const addRemoveText = addRemoveBtn.querySelector('.dropdown-item-text');
    const addRemoveIcon = addRemoveBtn.querySelector('.dropdown-item-icon');
    
    if (!addRemoveText || !addRemoveIcon) {
        console.error('Dropdown button elements not found');
        return;
    }
    
    // Clean up any existing dropdown event listeners first
    if (dropdown._scrollHandler) {
        window.removeEventListener('scroll', dropdown._scrollHandler, true);
        delete dropdown._scrollHandler;
    }
    if (dropdown._resizeHandler) {
        window.removeEventListener('resize', dropdown._resizeHandler);
        delete dropdown._resizeHandler;
    }
    if (dropdownPositionUpdateInterval) {
        clearInterval(dropdownPositionUpdateInterval);
        dropdownPositionUpdateInterval = null;
    }
    
    // Store current card info
    currentDropdownCard = card;
    currentDropdownSlotIndex = slotIndex;
    currentDropdownCardElement = cardElement;
    
    // Update button text and icon based on whether card is in deck
    if (isInDeck) {
        addRemoveText.textContent = 'Remove from Deck';
        addRemoveIcon.textContent = '➖';
    } else {
        addRemoveText.textContent = 'Add to Deck';
        addRemoveIcon.textContent = '➕';
    }
    
    // Position dropdown directly below the clicked card while hidden (visibility: hidden keeps layout)
    dropdown.style.display = 'block';
    dropdown.style.visibility = 'hidden';
    updateDropdownPosition();
    
    // Show it after position is set (using double RAF to ensure browser has applied the position)
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            dropdown.style.visibility = 'visible';
        });
    });
    
    // Update position on scroll and resize to keep it under the card
    const updateHandler = () => updateDropdownPosition();
    window.addEventListener('scroll', updateHandler, true);
    window.addEventListener('resize', updateHandler);
    
    // Store handlers for cleanup
    dropdown._scrollHandler = updateHandler;
    dropdown._resizeHandler = updateHandler;
    
    // Also update position periodically in case of layout shifts
    dropdownPositionUpdateInterval = setInterval(updateDropdownPosition, 100);
    
    // Add click handler for add/remove button
    addRemoveBtn.onclick = (e) => {
        e.stopPropagation();
        if (isInDeck) {
            removeCardFromSlot(slotIndex);
        } else {
            addCardToDeck(card);
        }
        hideCardDropdown();
    };
    
    // Add click handler for info button
    const infoBtn = document.getElementById('dropdownInfo');
    if (infoBtn) {
        infoBtn.onclick = (e) => {
            e.stopPropagation();
            showCardInfo(card);
            hideCardDropdown();
        };
    }
    
    // Close dropdown when clicking outside
    setTimeout(() => {
        const clickHandler = (e) => {
            if (!dropdown.contains(e.target)) {
                hideCardDropdown();
                document.removeEventListener('click', clickHandler);
            }
        };
        document.addEventListener('click', clickHandler);
    }, 0);
}

function hideCardDropdown() {
    const dropdown = document.getElementById('cardDropdownMenu');
    if (dropdown) {
        // Clean up event listeners
        if (dropdown._scrollHandler) {
            window.removeEventListener('scroll', dropdown._scrollHandler, true);
            delete dropdown._scrollHandler;
        }
        if (dropdown._resizeHandler) {
            window.removeEventListener('resize', dropdown._resizeHandler);
            delete dropdown._resizeHandler;
        }
        
        // Hide the dropdown
        dropdown.style.display = 'none';
        dropdown.style.visibility = 'hidden';
    }
    
    // Clear interval
    if (dropdownPositionUpdateInterval) {
        clearInterval(dropdownPositionUpdateInterval);
        dropdownPositionUpdateInterval = null;
    }
    
    currentDropdownCard = null;
    currentDropdownSlotIndex = null;
    currentDropdownCardElement = null;
}

function addCardToDeck(card) {
    const isSpecial = isSpecialCard(card.id);
    
    // Find appropriate open slot
    let targetSlot = -1;
    if (isSpecial) {
        // Special cards must go in special slots (0-1)
        targetSlot = currentDeckSelection.findIndex((slot, index) => 
            slot === null && index < SPECIAL_CARD_SLOTS
        );
    } else {
        // Normal cards can go in any slot
        targetSlot = currentDeckSelection.findIndex(slot => slot === null);
    }
    
    if (targetSlot !== -1) {
        currentDeckSelection[targetSlot] = card.id;
        updateDeckSlots();
        autoSaveDeck(); // Auto-save when deck changes
    } else if (isSpecial) {
        showGameMessage('No Special Slot Available', 'Special card slots are full! Remove a card from a special slot first.', '⚠️');
    } else {
        showGameMessage('Deck Full', 'Your deck is full! Remove a card first.', '⚠️');
    }
}

// Card info overlay
function showCardInfo(card) {
    const overlay = document.getElementById('cardInfoOverlay');
    const cardImage = document.getElementById('cardInfoImage');
    
    if (!overlay || !cardImage) {
        console.error('Card info overlay elements not found');
        return;
    }
    
    cardImage.src = getCardImagePath(card.id);
    cardImage.alt = card.title || 'Card';
    overlay.style.display = 'flex';
    
    // Close on click
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            hideCardInfo();
        }
    };
}

function hideCardInfo() {
    const overlay = document.getElementById('cardInfoOverlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.onclick = null;
    }
}

// Initialize card info overlay close button (called after DOM is loaded)
function initializeCardInfoOverlay() {
    const cardInfoCloseBtn = document.getElementById('cardInfoClose');
    if (cardInfoCloseBtn) {
        cardInfoCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideCardInfo();
        });
    }
}

// Save button removed - no longer needed

async function saveDeck() {
    const filledSlots = currentDeckSelection.filter(id => id !== null);
    if (filledSlots.length !== DECK_SIZE) {
        alert(`Please fill all ${DECK_SIZE} deck slots.`);
        return;
    }
    
    // Validate: Check that special cards are only in special slots
    for (let i = 0; i < DECK_SIZE; i++) {
        const cardId = currentDeckSelection[i];
        if (cardId && isSpecialCard(cardId) && i >= SPECIAL_CARD_SLOTS) {
            alert('Special cards can only be placed in special card slots (★)!');
            return;
        }
    }
    
    // Validate: Count special cards (should be max 2, but that's enforced by slots)
    const specialCardCount = currentDeckSelection.filter(id => id && isSpecialCard(id)).length;
    if (specialCardCount > SPECIAL_CARD_SLOTS) {
        alert(`You can only have ${SPECIAL_CARD_SLOTS} special cards in your deck!`);
        return;
    }
    
    await savePlayerDeck(filledSlots);
        showGameMessage('Deck Saved', 'Your deck has been saved successfully!', '💾');
        // Update slots to reflect saved deck
    await renderDeckBuilder();
}

async function clearDeck() {
        currentDeckSelection = new Array(DECK_SIZE).fill(null);
        updateDeckSlots();
    // Save empty deck directly
    await savePlayerDeck([]);
}

// Deck builder is now in a tab, so these functions are simplified
function openDeckBuilder() {
    // Switch to deck tab
    switchTab('deck');
}

async function closeDeckBuilder() {
    // Reset to saved deck when leaving
    const savedDeck = await getPlayerDeck();
    currentDeckSelection = [...savedDeck];
    while (currentDeckSelection.length < DECK_SIZE) {
        currentDeckSelection.push(null);
    }
}

// Initialize deck slot selector
function initializeDeckSlotSelector() {
    const slotButtons = document.querySelectorAll('.deck-slot-btn');
    slotButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            const slot = parseInt(btn.dataset.slot);
            await switchDeckSlot(slot);
        });
    });
    updateDeckSlotSelector();
}

// Update deck slot selector UI
function updateDeckSlotSelector() {
    const slotButtons = document.querySelectorAll('.deck-slot-btn');
    slotButtons.forEach(btn => {
        const slot = parseInt(btn.dataset.slot);
        if (slot === currentDeckSlot) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Switch to a different deck slot
async function switchDeckSlot(slot) {
    if (slot === currentDeckSlot) return;
    
    // Save current deck selection if it was modified
    // (optional: could add a check for unsaved changes)
    
    // Switch to new slot
    if (setCurrentDeckSlot(slot)) {
        // Reload deck builder with new slot's deck
        await renderDeckBuilder();
    }
}

// Initialize deck builder on page load
document.addEventListener('DOMContentLoaded', () => {
    // Initialize current deck slot
    currentDeckSlot = getCurrentDeckSlot();
    
    // Initialize card info overlay
    initializeCardInfoOverlay();
    
    // Wait a bit for CARD_CONFIG to be injected by server
    setTimeout(async () => {
        // Ensure valid decks exist for all slots
        const allCards = getAllCards();
        if (allCards.length === 0) {
            console.warn('No cards available yet, decks will be initialized when cards load');
            return;
        }
        
        const decks = await getAllDecks();
        const premadeDeck = createPremadeDeck().filter(id => id !== null);
        
        // Migration: Reset all accounts to have premade deck in slot 1, empty slots 2-3
        const MIGRATION_KEY = 'cardle_deck_migration_v1';
        const hasMigrated = localStorage.getItem(MIGRATION_KEY);
        
        if (!hasMigrated) {
            // Reset all decks: slot 1 gets premade deck, slots 2-3 are empty
            await saveDeckForSlot(1, premadeDeck);
            await saveDeckForSlot(2, []);
            await saveDeckForSlot(3, []);
            
            // Mark migration as complete
            localStorage.setItem(MIGRATION_KEY, 'true');
            console.log('Deck migration completed: All decks reset to premade deck in slot 1');
            // Reload decks after migration
            cachedDecks = null;
            const updatedDecks = await getAllDecks();
            Object.assign(decks, updatedDecks);
        }
        
        // Initialize all slots if needed
        for (let slot = 1; slot <= NUMBER_OF_DECK_SLOTS; slot++) {
            let deck = decks[slot];
            
            if (!deck || !Array.isArray(deck)) {
                // No deck for this slot
                if (slot === 1) {
                    // Slot 1 gets premade deck
                    await saveDeckForSlot(slot, premadeDeck);
                } else {
                    // Slots 2-3 are empty
                    await saveDeckForSlot(slot, []);
                }
            } else {
        // Validate deck - remove any cards that no longer exist
        const validDeck = deck.filter(cardId => allCards.some(c => c.id === cardId));
        
                if (validDeck.length > DECK_SIZE) {
                    // Invalid deck (too many cards), reset based on slot
                    if (slot === 1) {
                        await saveDeckForSlot(slot, premadeDeck);
                    } else {
                        await saveDeckForSlot(slot, []);
                    }
        } else if (validDeck.length !== deck.length) {
            // Some cards were removed, save the valid deck
                    await saveDeckForSlot(slot, validDeck);
                }
            }
        }
        
        // Initialize deck slot selector UI
        setTimeout(() => {
            initializeDeckSlotSelector();
        }, 150);
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

// Validate deck before starting a game
function validateDeckForGame() {
    const deck = getPlayerDeckSync();
    
    // Check if deck is complete (has exactly DECK_SIZE cards)
    if (!deck || deck.length !== DECK_SIZE) {
        return { valid: false, message: `Your deck must have exactly ${DECK_SIZE} cards to play!` };
    }
    
    // Check if deck has any null values
    if (deck.some(id => id === null || id === undefined)) {
        return { valid: false, message: `Your deck must have exactly ${DECK_SIZE} cards to play!` };
    }
    
    // Validate: Check that special cards are only in special slots
    for (let i = 0; i < DECK_SIZE; i++) {
        const cardId = deck[i];
        if (cardId && isSpecialCard(cardId) && i >= SPECIAL_CARD_SLOTS) {
            return { valid: false, message: 'Invalid deck: Special cards can only be in special card slots!' };
        }
    }
    
    return { valid: true };
}

document.getElementById('findMatchBtn').addEventListener('click', () => {
    const name = getPlayerName();
    if (!name) {
        alert('Please enter your name');
        return;
    }
    
    // Validate deck before starting matchmaking
    const validation = validateDeckForGame();
    if (!validation.valid) {
        alert(validation.message);
        // Switch to deck tab so user can fix their deck
        switchTab('deck');
        return;
    }
    
    const firebaseUid = currentUser ? currentUser.uid : null;
    socket.emit('findMatch', { playerName: name, firebaseUid: firebaseUid });
});

document.getElementById('cancelMatchmakingBtn').addEventListener('click', () => {
    socket.emit('cancelMatchmaking');
});

document.getElementById('createGameBtn').addEventListener('click', () => {
    const name = getPlayerName();
    if (name) {
        // Cancel matchmaking if active
        socket.emit('cancelMatchmaking');
        const firebaseUid = currentUser ? currentUser.uid : null;
        socket.emit('createGame', { playerName: name, firebaseUid: firebaseUid });
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
        renderDeckBuilder().then(() => {
        updateDeckCount();
        });
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
    
    // If switching to friends tab, load friends and check game status
    if (tabName === 'friends') {
        loadFriends();
        // Also periodically check for friends in games while on this tab
        if (window.friendStatusInterval) {
            clearInterval(window.friendStatusInterval);
        }
        window.friendStatusInterval = setInterval(() => {
            const friendsList = document.getElementById('friendsList');
            if (friendsList && friendsList.querySelectorAll('.friend-item').length > 0) {
                const friendIds = Array.from(friendsList.querySelectorAll('.friend-item'))
                    .map(item => item.dataset.friendId)
                    .filter(id => id);
                if (friendIds.length > 0 && socket) {
                    socket.emit('checkFriendsInGames', { friendIds: friendIds });
                }
            }
        }, 5000); // Check every 5 seconds
    } else {
        // Clear interval when leaving friends tab
        if (window.friendStatusInterval) {
            clearInterval(window.friendStatusInterval);
            window.friendStatusInterval = null;
        }
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

// Friends functionality
async function loadFriends() {
    if (!currentUser || !window.firebaseDb) {
        console.log('User not authenticated or Firebase not available');
        renderFriendsList([]);
        renderFriendRequests([]);
        return;
    }
    
    try {
        const userId = currentUser.uid;
        const friendsRef = window.firebaseDb.collection('friends');
        
        // Get friends list (where status is 'accepted')
        const friendsQuery = friendsRef.where('status', '==', 'accepted')
            .where('users', 'array-contains', userId);
        const friendsSnapshot = await friendsQuery.get();
        
        const friends = [];
        friendsSnapshot.forEach(doc => {
            const data = doc.data();
            const friendId = data.users.find(id => id !== userId);
            friends.push({
                id: friendId,
                friendDocId: doc.id,
                ...data
            });
        });
        
        // Get friend requests (pending requests where current user is the recipient)
        const requestsQuery = friendsRef.where('status', '==', 'pending')
            .where('recipientId', '==', userId);
        const requestsSnapshot = await requestsQuery.get();
        
        const requests = [];
        requestsSnapshot.forEach(doc => {
            const data = doc.data();
            requests.push({
                id: doc.id,
                senderId: data.senderId,
                ...data
            });
        });
        
        // Fetch user details for friends
        const friendsWithDetails = await Promise.all(friends.map(async (friend) => {
            try {
                const userDoc = await window.firebaseDb.collection('users').doc(friend.id).get();
                if (userDoc.exists) {
                    return {
                        ...friend,
                        name: userDoc.data().displayName || 'Unknown',
                        email: userDoc.data().email || ''
                    };
                }
                return friend;
            } catch (error) {
                console.error('Error fetching friend details:', error);
                return friend;
            }
        }));
        
        // Fetch user details for requests
        const requestsWithDetails = await Promise.all(requests.map(async (request) => {
            try {
                const userDoc = await window.firebaseDb.collection('users').doc(request.senderId).get();
                if (userDoc.exists) {
                    return {
                        ...request,
                        senderName: userDoc.data().displayName || 'Unknown',
                        senderEmail: userDoc.data().email || ''
                    };
                }
                return request;
            } catch (error) {
                console.error('Error fetching request details:', error);
                return request;
            }
        }));
        
        renderFriendsList(friendsWithDetails);
        renderFriendRequests(requestsWithDetails);
        
        // Check which friends are in games
        checkFriendsInGames(friendsWithDetails);
    } catch (error) {
        console.error('Error loading friends:', error);
        renderFriendsList([]);
        renderFriendRequests([]);
    }
}

async function checkFriendsInGames(friends) {
    if (!currentUser || !socket || friends.length === 0) return;
    
    // Get Firebase UIDs of friends
    const friendFirebaseUids = friends
        .filter(friend => friend.id && friend.id !== currentUser.uid)
        .map(friend => friend.id);
    
    if (friendFirebaseUids.length === 0) return;
    
    // Request server to check which friends are in games
    socket.emit('checkFriendsInGames', { friendIds: friendFirebaseUids });
}

socket.on('friendsInGames', (data) => {
    // Update friends list to show eye icons for friends in games
    console.log('friendsInGames received:', data);
    const friendsList = document.getElementById('friendsList');
    if (!friendsList) {
        console.log('friendsInGames: friendsList not found');
        return;
    }
    if (!data.friendsInGames) {
        console.log('friendsInGames: No friendsInGames data');
        return;
    }
    
    console.log('friendsInGames: Updating UI with', Object.keys(data.friendsInGames).length, 'friends in games');
    
    // Re-render friends list with game status
    const friendItems = friendsList.querySelectorAll('.friend-item');
    console.log('friendsInGames: Found', friendItems.length, 'friend items in DOM');
    
    friendItems.forEach(item => {
        const friendId = item.dataset.friendId;
        if (!friendId) {
            console.log('friendsInGames: Friend item missing friendId');
            return;
        }
        
        // Check if this friend is in a game
        const gameInfo = data.friendsInGames[friendId];
        console.log('friendsInGames: Friend', friendId, 'gameInfo:', gameInfo);
        
        let spectateBtn = item.querySelector('.spectate-btn');
        
        if (gameInfo && (gameInfo.status === 'playing' || gameInfo.status === 'waiting')) {
            // Add or update eye icon
            if (!spectateBtn) {
                spectateBtn = document.createElement('button');
                spectateBtn.className = 'spectate-btn';
                spectateBtn.innerHTML = '<span class="btn-icon">👁️</span>';
                spectateBtn.title = 'Spectate Game';
                item.appendChild(spectateBtn);
                console.log('friendsInGames: Created spectate button for', friendId);
            }
            spectateBtn.dataset.gameId = gameInfo.gameId;
            spectateBtn.onclick = () => spectateFriendGame(friendId, gameInfo.gameId);
            spectateBtn.style.display = 'block';
            console.log('friendsInGames: Showing spectate button for', friendId, 'game:', gameInfo.gameId);
        } else {
            // Hide eye icon if friend is not in a game
            if (spectateBtn) {
                spectateBtn.style.display = 'none';
                delete spectateBtn.dataset.gameId;
            }
        }
    });
});

function renderFriendsList(friends) {
    const friendsList = document.getElementById('friendsList');
    if (!friendsList) return;
    
    if (friends.length === 0) {
        friendsList.innerHTML = '<p class="friends-empty">No friends yet</p>';
        return;
    }
    
    friendsList.innerHTML = friends.map(friend => `
        <div class="friend-item" data-friend-id="${friend.id || ''}">
            <div class="friend-avatar">${friend.name ? friend.name.charAt(0).toUpperCase() : '👤'}</div>
            <div class="friend-info">
                <div class="friend-name">${friend.name || 'Unknown'}</div>
                <div class="friend-status">${friend.email || ''}</div>
            </div>
            <button class="spectate-btn" style="display: none;" onclick="spectateFriendGame('${friend.id || ''}', '')" title="Spectate Game">
                <span class="btn-icon">👁️</span>
            </button>
        </div>
    `).join('');
}

function renderFriendRequests(requests) {
    const requestsList = document.getElementById('friendRequestsList');
    if (!requestsList) return;
    
    if (requests.length === 0) {
        requestsList.innerHTML = '<p class="friends-empty">No pending requests</p>';
        return;
    }
    
    requestsList.innerHTML = requests.map(request => `
        <div class="friend-item">
            <div class="friend-avatar">${request.senderName ? request.senderName.charAt(0).toUpperCase() : '👤'}</div>
            <div class="friend-info">
                <div class="friend-name">${request.senderName || 'Unknown'}</div>
                <div class="friend-status">${request.senderEmail || ''}</div>
            </div>
            <div class="friend-actions">
                <button class="btn btn-primary btn-small friend-action-btn" onclick="acceptFriendRequest('${request.id}')">
                    <span class="btn-icon">✓</span>
                    <span>Accept</span>
                </button>
                <button class="btn btn-secondary btn-small friend-action-btn" onclick="rejectFriendRequest('${request.id}')">
                    <span class="btn-icon">✗</span>
                    <span>Decline</span>
                </button>
            </div>
        </div>
    `).join('');
}

async function searchFriend() {
    const searchInput = document.getElementById('friendSearchInput');
    if (!searchInput || !searchInput.value.trim()) {
        alert('Please enter a username or email to search');
        return;
    }
    
    const searchTerm = searchInput.value.trim().toLowerCase();
    
    if (!currentUser || !window.firebaseDb) {
        alert('You must be logged in to search for friends');
        return;
    }
    
    try {
        const currentUserId = currentUser.uid;
        
        if (!window.firebaseDb) {
            throw new Error('Firebase database is not initialized');
        }
        
        const usersRef = window.firebaseDb.collection('users');
        
        // Get all users (Firestore doesn't support case-insensitive or partial search natively)
        // We'll filter client-side for similar matches
        console.log('Fetching all users for search...');
        console.log('Firebase DB available:', !!window.firebaseDb);
        console.log('Current user:', currentUserId);
        
        let allUsersSnapshot;
        try {
            allUsersSnapshot = await usersRef.get();
        } catch (fetchError) {
            console.error('Error fetching users from Firestore:', fetchError);
            console.error('Error code:', fetchError.code);
            console.error('Error message:', fetchError.message);
            
            // Check if it's a permissions error
            if (fetchError.code === 'permission-denied') {
                throw new Error('Permission denied: Firestore security rules need to allow reading user documents for friend search. Please update your Firestore rules to allow: `allow read: if request.auth != null;` for the users collection.');
            }
            
            throw new Error(`Failed to fetch users: ${fetchError.message} (Code: ${fetchError.code})`);
        }
        
        console.log('Found', allUsersSnapshot.size, 'total users');
        
        // Filter users client-side based on similar name/email
        const matchingUsers = [];
        allUsersSnapshot.forEach(doc => {
            const userData = doc.data();
            const userId = doc.id;
            
            // Skip current user
            if (userId === currentUserId) {
                return;
            }
            
            const displayName = (userData.displayName || '').toLowerCase();
            const email = (userData.email || '').toLowerCase();
            
            // Check if search term matches (contains or starts with)
            const nameMatches = displayName.includes(searchTerm) || displayName.startsWith(searchTerm);
            const emailMatches = email.includes(searchTerm) || email.startsWith(searchTerm);
            
            if (nameMatches || emailMatches) {
                matchingUsers.push({
                    id: userId,
                    displayName: userData.displayName || 'Unknown',
                    email: userData.email || '',
                    photoURL: userData.photoURL || null
                });
            }
        });
        
        console.log('Found', matchingUsers.length, 'matching users');
        
        // Display search results in the UI
        showSearchResults(matchingUsers);
    } catch (error) {
        console.error('Error searching for friend:', error);
        console.error('Error details:', {
            code: error.code,
            message: error.message,
            stack: error.stack
        });
        alert(`Error searching for friend: ${error.message || 'Unknown error'}. Please check the console for details.`);
    }
}

async function sendFriendRequest(foundUserId, foundUserName) {
    if (!currentUser || !window.firebaseDb) {
        alert('You must be logged in to send friend requests');
        return;
    }
    
    try {
        const currentUserId = currentUser.uid;
        
        // Check if already friends or request exists
        const friendsRef = window.firebaseDb.collection('friends');
        const existingQuery = friendsRef.where('users', 'array-contains', currentUserId);
        const existingSnapshot = await existingQuery.get();
        
        let alreadyFriend = false;
        let pendingRequest = false;
        
        existingSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.users && data.users.includes(foundUserId)) {
                if (data.status === 'accepted') {
                    alreadyFriend = true;
                } else if (data.status === 'pending') {
                    // Check if request is from current user to found user
                    if (data.senderId === currentUserId && data.recipientId === foundUserId) {
                        pendingRequest = true;
                    }
                    // Check if request is from found user to current user (opposite direction)
                    else if (data.senderId === foundUserId && data.recipientId === currentUserId) {
                        // There's a pending request from them to us - we could auto-accept or show message
                        pendingRequest = true;
                    }
                }
            }
        });
        
        if (alreadyFriend) {
            alert('You are already friends with this user');
            return;
        }
        
        if (pendingRequest) {
            alert('A friend request already exists between you and this user');
            return;
        }
        
        // Send friend request
        await friendsRef.add({
            users: [currentUserId, foundUserId],
            senderId: currentUserId,
            recipientId: foundUserId,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        alert(`Friend request sent to ${foundUserName}`);
        
        // Reload friends list to show the new request
        loadFriends();
        
        return Promise.resolve();
    } catch (error) {
        console.error('Error sending friend request:', error);
        alert('Error sending friend request. Please try again.');
        return Promise.reject(error);
    }
}

async function acceptFriendRequest(requestId) {
    if (!currentUser || !window.firebaseDb) return;
    
    try {
        const friendsRef = window.firebaseDb.collection('friends').doc(requestId);
        await friendsRef.update({
            status: 'accepted',
            acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        loadFriends(); // Reload friends list
    } catch (error) {
        console.error('Error accepting friend request:', error);
        alert('Error accepting friend request. Please try again.');
    }
}

async function rejectFriendRequest(requestId) {
    if (!currentUser || !window.firebaseDb) return;
    
    try {
        const friendsRef = window.firebaseDb.collection('friends').doc(requestId);
        await friendsRef.delete();
        
        loadFriends(); // Reload friends list
    } catch (error) {
        console.error('Error rejecting friend request:', error);
        alert('Error rejecting friend request. Please try again.');
    }
}

function showSearchResults(users) {
    const searchResultsContainer = document.getElementById('friendSearchResults');
    const searchResultsList = document.getElementById('friendSearchResultsList');
    
    if (!searchResultsContainer || !searchResultsList) return;
    
    if (users.length === 0) {
        searchResultsList.innerHTML = '<p class="friends-empty">No users found</p>';
        searchResultsContainer.style.display = 'block';
        return;
    }
    
    // Check existing friend relationships for each user
    const currentUserId = currentUser ? currentUser.uid : null;
    const friendsRef = window.firebaseDb ? window.firebaseDb.collection('friends') : null;
    
    // Build the results list
    Promise.all(users.map(async (user) => {
        let relationshipStatus = 'none'; // none, pending, friends
        
        if (currentUserId && friendsRef) {
            try {
                const existingQuery = friendsRef.where('users', 'array-contains', currentUserId);
                const existingSnapshot = await existingQuery.get();
                
                existingSnapshot.forEach(doc => {
                    const data = doc.data();
                    if (data.users && data.users.includes(user.id)) {
                        if (data.status === 'accepted') {
                            relationshipStatus = 'friends';
                        } else if (data.status === 'pending') {
                            relationshipStatus = 'pending';
                        }
                    }
                });
            } catch (error) {
                console.error('Error checking friend status:', error);
            }
        }
        
        return {
            ...user,
            relationshipStatus
        };
    })).then(usersWithStatus => {
        searchResultsList.innerHTML = usersWithStatus.map(user => {
            const avatarText = user.displayName ? user.displayName.charAt(0).toUpperCase() : '👤';
            let actionButton = '';
            
            if (user.relationshipStatus === 'friends') {
                actionButton = '<span class="friend-status-badge">Friends</span>';
            } else if (user.relationshipStatus === 'pending') {
                actionButton = '<span class="friend-status-badge pending">Request Sent</span>';
            } else {
                actionButton = `<button class="btn btn-primary btn-small friend-action-btn" onclick="sendFriendRequestFromSearch('${user.id}', '${(user.displayName || user.email).replace(/'/g, "\\'")}')">
                    <span class="btn-icon">➕</span>
                    <span>Add Friend</span>
                </button>`;
            }
            
            return `
                <div class="friend-search-result-item">
                    <div class="friend-avatar">${avatarText}</div>
                    <div class="friend-info">
                        <div class="friend-name">${user.displayName || 'Unknown'}</div>
                        <div class="friend-status">${user.email || ''}</div>
                    </div>
                    ${actionButton}
                </div>
            `;
        }).join('');
        
        searchResultsContainer.style.display = 'block';
    });
}

function sendFriendRequestFromSearch(userId, userName) {
    sendFriendRequest(userId, userName).then(() => {
        // Reload search results to update status
        const searchInput = document.getElementById('friendSearchInput');
        if (searchInput && searchInput.value.trim()) {
            searchFriend();
        }
    });
}

function hideSearchResults() {
    const searchResultsContainer = document.getElementById('friendSearchResults');
    if (searchResultsContainer) {
        searchResultsContainer.style.display = 'none';
    }
}

function spectateFriendGame(friendFirebaseUid, gameId) {
    if (!socket) {
        alert('Not connected to server');
        return;
    }
    
    // If gameId not provided, get it from the button's data attribute
    if (!gameId) {
        const friendItem = document.querySelector(`[data-friend-id="${friendFirebaseUid}"]`);
        if (friendItem) {
            const spectateBtn = friendItem.querySelector('.spectate-btn');
            gameId = spectateBtn?.dataset.gameId;
        }
    }
    
    if (!gameId) {
        alert('Game information not available. Friend may have left the game.');
        // Refresh friend status
        loadFriends();
        return;
    }
    
    // Get spectator name (current user's display name if available)
    let spectatorName = 'Someone';
    if (currentUser && currentUser.displayName) {
        spectatorName = currentUser.displayName;
    } else if (currentUser && currentUser.email) {
        spectatorName = currentUser.email.split('@')[0];
    }
    
    // Request to spectate the game
    socket.emit('spectateGame', { 
        gameId: gameId,
        spectatorName: spectatorName
    });
}

socket.on('gameStateForSpectator', (data) => {
    // Show spectator view
    console.log('Received game state for spectator:', data);
    
    // Switch to game screen in spectator mode
    if (ScreenManager.show('game')) {
        // Set spectator mode flag
        window.isSpectator = true;
        window.spectatorGameId = data.gameId;
        window.spectatorGameWord = data.word;
        
        // Initialize spectator view
        initializeSpectatorView(data);
    }
});

function initializeSpectatorView(data) {
    console.log('Initializing spectator view with game state:', data);
    
    // Set the player being spectated (first player, index 0)
    if (data.players && data.players.length > 0) {
        window.spectatedPlayerId = data.players[0].id;
    }
    
    // Store gameState for spectator (use global gameState variable)
    gameState = data;
    
    // Hide card selection immediately
    const cardSelection = document.getElementById('cardSelection');
    if (cardSelection) {
        cardSelection.style.display = 'none';
    }
    
    // Show game board
    showGameBoard();
    
    // Clear game boards
    const player1Board = document.getElementById('player1Board');
    const player2Board = document.getElementById('player2Board');
    if (player1Board) player1Board.innerHTML = '';
    if (player2Board) player2Board.innerHTML = '';
    
    // Set player names
    if (gameState.players && gameState.players.length >= 2) {
        const player1NameEl = document.getElementById('player1Name');
        const player2NameEl = document.getElementById('player2Name');
        if (player1NameEl) player1NameEl.textContent = gameState.players[0].name || 'Player 1';
        if (player2NameEl) player2NameEl.textContent = gameState.players[1].name || 'Player 2';
    }
    
    // Initialize board and keyboard for spectator
    createBoard();
    createKeyboard();
    
    // Scale game board to fit available space (with a small delay to ensure layout is complete)
    setTimeout(() => {
        scaleGameBoard();
    }, 50);
    
    // Display existing guesses for both players
    if (gameState.players) {
        gameState.players.forEach((player, index) => {
            if (player.guesses && player.guesses.length > 0) {
                player.guesses.forEach(guessData => {
                    if (guessData.guess && guessData.feedback) {
                        // For spectators, show spectated player's guesses with displayGuess (main view)
                        // and opponent's guesses with displayOpponentGuess
                        if (player.id === window.spectatedPlayerId) {
                            displayGuess(guessData.guess, guessData.feedback, guessData.row);
                        } else {
                            displayOpponentGuess(guessData.guess, guessData.feedback, guessData.row);
                        }
                    }
                });
            }
        });
    }
    
    // Update turn indicator for spectator (this will also start the timer)
    if (gameState.currentTurn) {
        updateTurnIndicator();
    }
    
    // Show leave button (removed spectator indicator text)
    const gameHeaderLogo = document.querySelector('.game-header-logo');
    if (gameHeaderLogo) {
        // Hide spectator indicator if it exists (we're removing it)
        const spectatorIndicator = document.getElementById('spectatorIndicator');
        if (spectatorIndicator) {
            spectatorIndicator.style.display = 'none';
        }
        
        // Show leave button on the left side
        const leaveBtn = document.getElementById('leaveSpectateBtn');
        if (leaveBtn) {
            leaveBtn.style.display = 'flex';
        }
    }
    
    // Hide input controls for spectators
    const wordInput = document.getElementById('wordInput');
    const submitBtn = document.getElementById('submitBtn');
    const cardsContainer = document.getElementById('cardsContainer');
    const cardSelectionPanel = document.getElementById('cardSelection');
    
    if (wordInput) {
        wordInput.style.display = 'none';
        wordInput.disabled = true;
    }
    if (submitBtn) submitBtn.style.display = 'none';
    if (cardsContainer) cardsContainer.style.display = 'none';
    if (cardSelectionPanel) cardSelectionPanel.style.display = 'none';
    
    // Also hide hand panel for spectators
    const handPanel = document.querySelector('.hand-panel');
    if (handPanel) handPanel.style.display = 'none';
}

// Listen for turn changes while spectating (this runs after the main turnChanged handler)
// We need a separate handler because the main one has an early return for spectators
socket.on('turnChanged', (data) => {
    if (window.isSpectator && window.spectatorGameId && data.gameId === window.spectatorGameId) {
        // Update gameState for spectator
        if (gameState) {
            gameState.currentTurn = data.currentTurn;
            gameState.players = data.players;
            gameState.status = data.status;
            gameState.activeEffects = data.activeEffects;
            if (data.totalGuesses !== undefined) {
                gameState.totalGuesses = data.totalGuesses;
            }
        } else {
            gameState = data;
        }
        
        // Update turn indicator and start timer
        stopTurnTimer();
        updateTurnIndicator();
    }
});

// Listen for game updates while spectating
socket.on('guessSubmitted', (data) => {
    if (window.isSpectator && window.spectatorGameId) {
        // Update spectator view with new guess
        // This will be handled by existing displayGuess/displayOpponentGuess functions
    }
});

socket.on('cardPlayed', (data) => {
    if (window.isSpectator && window.spectatorGameId) {
        // Show card splash for spectators too
        queueCardSplash(data.card, data.playerName);
    }
});

socket.on('gameOver', (data) => {
    if (window.isSpectator && window.spectatorGameId) {
        // Exit spectator mode and show game over
        leaveSpectatorMode();
        
        // Show game over screen
        ScreenManager.show('gameOver');
    }
});

function leaveSpectatorMode() {
    if (!window.isSpectator) {
        console.log('leaveSpectatorMode called but not in spectator mode');
        return;
    }
    
    console.log('Leaving spectator mode, gameId:', window.spectatorGameId);
    
    // Leave the game room
    if (window.spectatorGameId && socket) {
        socket.emit('leaveSpectate', { gameId: window.spectatorGameId });
    }
    
    // Clear spectator state
    window.isSpectator = false;
    window.spectatorGameId = null;
    window.spectatorGameWord = null;
    
    // Hide spectator indicator and leave button
    const spectatorIndicator = document.getElementById('spectatorIndicator');
    if (spectatorIndicator) spectatorIndicator.style.display = 'none';
    
    const leaveBtn = document.getElementById('leaveSpectateBtn');
    if (leaveBtn) leaveBtn.style.display = 'none';
    
    // Return to lobby
    ScreenManager.show('lobby');
}

// Make leaveSpectatorMode available globally so the button can call it
window.leaveSpectatorMode = leaveSpectatorMode;

// Friends tab event listeners
document.addEventListener('DOMContentLoaded', () => {
    const searchFriendBtn = document.getElementById('searchFriendBtn');
    if (searchFriendBtn) {
        searchFriendBtn.addEventListener('click', searchFriend);
    }
    
    const friendSearchInput = document.getElementById('friendSearchInput');
    if (friendSearchInput) {
        friendSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchFriend();
            }
        });
    }
    
    // Username change functionality
    const editUsernameBtn = document.getElementById('editUsernameBtn');
    const saveUsernameBtn = document.getElementById('saveUsernameBtn');
    const cancelUsernameBtn = document.getElementById('cancelUsernameBtn');
    const usernameInput = document.getElementById('usernameInput');
    const usernameError = document.getElementById('usernameError');
    const usernameSuccess = document.getElementById('usernameSuccess');
    const usernameSection = document.getElementById('profileUsernameSection');
    
    if (editUsernameBtn) {
        editUsernameBtn.addEventListener('click', () => {
            if (usernameSection) {
                usernameSection.style.display = 'block';
                // Set current username as placeholder
                if (usernameInput && currentUser) {
                    const currentName = currentUser.displayName || currentUser.email?.split('@')[0] || '';
                    usernameInput.value = '';
                    usernameInput.placeholder = `Current: ${currentName}`;
                    setTimeout(() => usernameInput.focus(), 100);
                }
            }
        });
    }
    
    if (saveUsernameBtn) {
        saveUsernameBtn.addEventListener('click', handleChangeUsername);
    }
    
    if (cancelUsernameBtn) {
        cancelUsernameBtn.addEventListener('click', () => {
            if (usernameSection) {
                usernameSection.style.display = 'none';
            }
            if (usernameInput) {
                usernameInput.value = '';
            }
            if (usernameError) usernameError.style.display = 'none';
            if (usernameSuccess) usernameSuccess.style.display = 'none';
        });
    }
    
    if (usernameInput) {
        usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleChangeUsername();
            } else if (e.key === 'Escape') {
                if (cancelUsernameBtn) cancelUsernameBtn.click();
            }
        });
        
        usernameInput.addEventListener('input', () => {
            // Clear error/success messages when user types
            if (usernameError) usernameError.style.display = 'none';
            if (usernameSuccess) usernameSuccess.style.display = 'none';
        });
    }
});

// Save button removed - deck now auto-saves

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
        const firebaseUid = currentUser ? currentUser.uid : null;
        socket.emit('joinGame', { playerName: name, gameId: gameId, firebaseUid: firebaseUid });
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

// Back to lobby and rematch buttons initialization
function initializeGameOverButtons() {
    const backToLobbyBtn = document.getElementById('backToLobbyBtn');
    if (backToLobbyBtn) {
        // Remove any existing listeners by cloning
        const newBtn = backToLobbyBtn.cloneNode(true);
        backToLobbyBtn.parentNode.replaceChild(newBtn, backToLobbyBtn);
        
        newBtn.addEventListener('click', () => {
            // Cancel any pending rematch request
            if (gameState && gameState.gameId) {
                socket.emit('cancelRematch', { gameId: gameState.gameId });
            }
            ScreenManager.show('lobby');
        });
    }
    
    // Rematch button
    const rematchBtn = document.getElementById('rematchBtn');
    if (rematchBtn) {
        // Remove any existing listeners by cloning
        const newRematchBtn = rematchBtn.cloneNode(true);
        rematchBtn.parentNode.replaceChild(newRematchBtn, rematchBtn);
        
        newRematchBtn.addEventListener('click', () => {
            // Get gameId from gameState or from the gameOver event data
            const gameId = gameState?.gameId || window.lastGameId;
            if (!gameId) {
                console.error('No gameId available for rematch');
                alert('Unable to rematch: Game ID not found');
                return;
            }
            
            console.log('Requesting rematch for game:', gameId);
            // Request rematch
            socket.emit('requestRematch', { gameId: gameId });
        });
    }
}

// Initialize buttons when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeGameOverButtons);
} else {
    initializeGameOverButtons();
}

// Chat Functions
function displayChatMessage(playerName, message, timestamp, isOwnMessage, isSystemMessage = false) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    
    const messageDiv = document.createElement('div');
    let className = 'chat-message';
    if (isSystemMessage) {
        className += ' system-message';
    } else if (isOwnMessage) {
        className += ' own-message';
    }
    messageDiv.className = className;
    
    const time = new Date(timestamp);
    const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (isSystemMessage) {
        // System messages don't show player name or timestamp
        messageDiv.innerHTML = `
            <div class="chat-message-text">${escapeHtml(message)}</div>
        `;
    } else {
    messageDiv.innerHTML = `
        <div class="chat-message-header">
            <span class="chat-message-name">${escapeHtml(playerName)}</span>
            <span class="chat-message-time">${timeStr}</span>
        </div>
        <div class="chat-message-text">${escapeHtml(message)}</div>
    `;
    }
    
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
        
        // Rescale game board after chat toggle animation
        if (ScreenManager.currentScreen === 'game') {
            setTimeout(() => {
                scaleGameBoard();
            }, 350); // Wait for chat animation to complete
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

// Username change functionality
async function checkUsernameAvailable(username) {
    if (!window.firebaseDb || !currentUser) {
        return { available: false, message: 'Not authenticated' };
    }
    
    const trimmedUsername = username.trim().toLowerCase();
    
    // Validate username format
    const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
    if (!usernameRegex.test(trimmedUsername)) {
        return { 
            available: false, 
            message: 'Username must be 3-20 characters and contain only letters, numbers, underscores, or hyphens' 
        };
    }
    
    try {
        // Check if username is already taken by querying users collection
        const usersSnapshot = await window.firebaseDb.collection('users')
            .where('displayName', '==', trimmedUsername)
            .limit(1)
            .get();
        
        if (!usersSnapshot.empty) {
            // Check if it's the current user's username
            const existingUser = usersSnapshot.docs[0];
            if (existingUser.id !== currentUser.uid) {
                return { available: false, message: 'Username is already taken' };
            }
        }
        
        return { available: true, message: 'Username is available' };
    } catch (error) {
        console.error('Error checking username availability:', error);
        return { available: false, message: 'Error checking username availability' };
    }
}

async function handleChangeUsername() {
    const usernameInput = document.getElementById('usernameInput');
    const usernameError = document.getElementById('usernameError');
    const usernameSuccess = document.getElementById('usernameSuccess');
    const saveUsernameBtn = document.getElementById('saveUsernameBtn');
    const usernameSection = document.getElementById('profileUsernameSection');
    
    if (!usernameInput || !currentUser || !window.firebaseAuth || !window.firebaseDb) {
        if (usernameError) {
            usernameError.textContent = 'Please sign in to change your username';
            usernameError.style.display = 'block';
        }
        return;
    }
    
    const newUsername = usernameInput.value.trim();
    
    if (!newUsername) {
        if (usernameError) {
            usernameError.textContent = 'Please enter a username';
            usernameError.style.display = 'block';
        }
        return;
    }
    
    // Check if username is available
    const checkResult = await checkUsernameAvailable(newUsername);
    if (!checkResult.available) {
        if (usernameError) {
            usernameError.textContent = checkResult.message;
            usernameError.style.display = 'block';
        }
        if (usernameSuccess) usernameSuccess.style.display = 'none';
        return;
    }
    
    // Disable button during update
    if (saveUsernameBtn) {
        saveUsernameBtn.disabled = true;
        saveUsernameBtn.innerHTML = '<span>Saving...</span>';
    }
    
    try {
        // Update Firebase Auth displayName
        await window.firebaseAuth.currentUser.updateProfile({
            displayName: newUsername
        });
        
        // Update Firestore user document
        await window.firebaseDb.collection('users').doc(currentUser.uid).set({
            displayName: newUsername,
            usernameUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        // Reload user to get updated displayName
        await window.firebaseAuth.currentUser.reload();
        currentUser = window.firebaseAuth.currentUser;
        
        // Update UI
        updateLobbyUserInfo();
        
        // Show success message
        if (usernameSuccess) {
            usernameSuccess.textContent = 'Username updated successfully!';
            usernameSuccess.style.display = 'block';
        }
        if (usernameError) usernameError.style.display = 'none';
        
        // Clear input and hide form after a delay
        usernameInput.value = '';
        
        // Re-enable button
        if (saveUsernameBtn) {
            saveUsernameBtn.disabled = false;
            saveUsernameBtn.innerHTML = '<span class="btn-icon">✓</span><span>Save</span>';
        }
        
        // Hide form and success message after 2 seconds
        setTimeout(() => {
            if (usernameSection) {
                usernameSection.style.display = 'none';
            }
            if (usernameSuccess) usernameSuccess.style.display = 'none';
        }, 2000);
        
    } catch (error) {
        console.error('Error updating username:', error);
        if (usernameError) {
            usernameError.textContent = 'Failed to update username. Please try again.';
            usernameError.style.display = 'block';
        }
        if (usernameSuccess) usernameSuccess.style.display = 'none';
        
        // Re-enable button
        if (saveUsernameBtn) {
            saveUsernameBtn.disabled = false;
            saveUsernameBtn.innerHTML = '<span class="btn-icon">✓</span><span>Save</span>';
        }
    }
}

// Socket event handlers for username (if using server-side validation)
socket.on('usernameCheckResult', (data) => {
    const usernameError = document.getElementById('usernameError');
    const usernameSuccess = document.getElementById('usernameSuccess');
    
    if (data.available) {
        if (usernameSuccess) {
            usernameSuccess.textContent = data.message;
            usernameSuccess.style.display = 'block';
        }
        if (usernameError) usernameError.style.display = 'none';
    } else {
        if (usernameError) {
            usernameError.textContent = data.message;
            usernameError.style.display = 'block';
        }
        if (usernameSuccess) usernameSuccess.style.display = 'none';
    }
});

socket.on('usernameUpdateResult', (data) => {
    const usernameError = document.getElementById('usernameError');
    const usernameSuccess = document.getElementById('usernameSuccess');
    const saveUsernameBtn = document.getElementById('saveUsernameBtn');
    
    if (data.success) {
        if (usernameSuccess) {
            usernameSuccess.textContent = data.message;
            usernameSuccess.style.display = 'block';
        }
        if (usernameError) usernameError.style.display = 'none';
        
        // Update UI
        updateLobbyUserInfo();
        
        // Clear input
        const usernameInput = document.getElementById('usernameInput');
        if (usernameInput) usernameInput.value = '';
        
        // Hide success message after 3 seconds
        setTimeout(() => {
            if (usernameSuccess) usernameSuccess.style.display = 'none';
        }, 3000);
    } else {
        if (usernameError) {
            usernameError.textContent = data.message;
            usernameError.style.display = 'block';
        }
        if (usernameSuccess) usernameSuccess.style.display = 'none';
    }
    
    // Re-enable button
    if (saveUsernameBtn) {
        saveUsernameBtn.disabled = false;
        saveUsernameBtn.innerHTML = '<span class="btn-icon">✓</span><span>Save</span>';
    }
});


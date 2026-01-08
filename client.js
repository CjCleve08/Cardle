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

// Show splash and credits screens before lobby
function showSplashThenLobby() {
    // Show splash screen first
    ScreenManager.show('splash');
    
    // Play intro music (non-looping)
    if (typeof soundManager !== 'undefined') {
        soundManager.playIntroMusic('IntroSoundTrack.mp4');
    }
    
    // Auto-advance after 4.5 seconds, or allow click to skip
    let splashTimeout = setTimeout(() => {
        showCreditsThenLobby();
    }, 4500);
    
    // Click to skip splash
    const splashScreen = document.getElementById('splash');
    if (splashScreen) {
        const skipSplash = (e) => {
            clearTimeout(splashTimeout);
            splashScreen.removeEventListener('click', skipSplash);
            showCreditsThenLobby();
        };
        splashScreen.addEventListener('click', skipSplash);
    }
}

function showCreditsThenLobby() {
    ScreenManager.show('credits');
    
    // Auto-advance after 4.5 seconds, or allow click to skip
    let creditsTimeout = setTimeout(() => {
        showLobby();
    }, 4500);
    
    // Click to skip credits
    const creditsScreen = document.getElementById('credits');
    if (creditsScreen) {
        const skipCredits = (e) => {
            clearTimeout(creditsTimeout);
            creditsScreen.removeEventListener('click', skipCredits);
            showLobby();
        };
        creditsScreen.addEventListener('click', skipCredits);
    }
}

function showLobby() {
    // Stop intro music before showing lobby
    if (typeof soundManager !== 'undefined') {
        soundManager.stopBackgroundMusic();
    }
    
    // Register user as online when showing lobby
    registerUserAsOnline();
    
    if (ScreenManager.show('lobby')) {
        updateLobbyUserInfo();
        // Load and display stats
        updateStatsDisplay().catch(error => {
            console.error('Error loading stats:', error);
        });
        // Update rank display
        updateRankDisplay().catch(error => {
            console.error('Error loading rank:', error);
        });
        // Generate rank ladder
        generateRankLadder();
    }
}

function continueToAuth() {
    // Check if user was in guest mode (stored in sessionStorage)
    const savedGuestName = sessionStorage.getItem('guestName');
    if (savedGuestName) {
        isGuestMode = true;
        guestName = savedGuestName;
        // Clear stats cache for guest mode
        clearStatsCache();
        clearDecksCache();
        // Show splash/credits then lobby
        showSplashThenLobby();
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
                // Register user as online
                registerUserAsOnline();
                // User is signed in - show splash/credits then lobby
                showSplashThenLobby();
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

// Initialize Firebase Auth State Listener
function initializeAuth() {
    // Ensure screens are initialized first
    if (!ScreenManager.exists('splash')) {
        console.warn('Screens not initialized yet, retrying...');
        setTimeout(initializeAuth, 100);
        return;
    }
    
    // Initially hide all screens (remove any active classes from HTML)
    Object.values(ScreenManager.screens).forEach(screen => {
        if (screen) screen.classList.remove('active');
    });
    
    // Check auth state - splash/credits will show after sign-in
    continueToAuth();
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
    
    // Show splash/credits then lobby
    showSplashThenLobby();
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
            // Prefer Firestore photoURL if available
            const applyAvatar = (url) => {
                if (url) {
                    profileAvatar.style.backgroundImage = `url(${url})`;
                profileAvatar.style.backgroundSize = 'cover';
                profileAvatar.style.backgroundPosition = 'center';
                profileAvatar.textContent = '';
            } else {
                    profileAvatar.style.backgroundImage = '';
                    profileAvatar.style.backgroundSize = '';
                    profileAvatar.style.backgroundPosition = '';
                profileAvatar.textContent = displayName.charAt(0).toUpperCase();
            }
            };
            // Default to Auth photoURL while we fetch Firestore
            const initialPhoto = currentUser.photoURL || null;
            window.currentUserPhotoURL = initialPhoto;
            applyAvatar(initialPhoto);
            // Fetch Firestore user doc for photoURL override
            if (window.firebaseDb && currentUser.uid) {
                window.firebaseDb.collection('users').doc(currentUser.uid).get().then(doc => {
                    if (doc.exists) {
                        const docPhoto = doc.data().photoURL || null;
                        window.currentUserPhotoURL = docPhoto || initialPhoto || null;
                        applyAvatar(window.currentUserPhotoURL);
                    }
                }).catch(() => {
                    // Ignore Firestore errors here, keep initial photo
                });
            }
        }
        
        // Show edit buttons for authenticated users
        const editUsernameBtn = document.getElementById('editUsernameBtn');
        if (editUsernameBtn) {
            editUsernameBtn.style.display = 'inline-flex';
        }
        const editPictureBtn = document.getElementById('editPictureBtn');
        if (editPictureBtn) {
            editPictureBtn.style.display = 'inline-flex';
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
        gamesWithGuesses: 0,
        chipPoints: 0, // Starting chip points (rating system)
        winStreak: 0, // Current consecutive wins
        bestWinStreak: 0 // Best win streak achieved
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

// Calculate chip points based on game result
// SECURITY WARNING: This function is DEPRECATED for actual chip calculations.
// The server now calculates chip points and sends them in gameOver events.
// This function is kept only for display/UI purposes and should NOT be used for actual stat updates.
// Always use server-provided chip change values from gameOver events.
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

async function updateStats(gameResult) {
    const stats = await getPlayerStats();
    
    // Initialize new stats if they don't exist
    if (stats.chipPoints === undefined || stats.chipPoints === null) {
        stats.chipPoints = 0;
    }
    if (stats.winStreak === undefined || stats.winStreak === null) {
        stats.winStreak = 0;
    }
    if (stats.bestWinStreak === undefined || stats.bestWinStreak === null) {
        stats.bestWinStreak = 0;
    }
    
    stats.gamesPlayed++;
    
    if (gameResult.won) {
        stats.wins++;
        // Update win streak
        stats.winStreak++;
        // Update best win streak if current streak is better
        if (stats.winStreak > stats.bestWinStreak) {
            stats.bestWinStreak = stats.winStreak;
        }
    } else {
        stats.losses++;
        // Reset win streak on loss
        stats.winStreak = 0;
    }
    
    if (gameResult.guesses > 0) {
        stats.totalGuesses += gameResult.guesses;
        stats.gamesWithGuesses++;
    }
    
    // Only update chip points (rank) if this is a ranked game
    // SECURITY: Only use server-provided chipPoints values to prevent manipulation
    const isRanked = (gameResult.isRanked !== undefined ? gameResult.isRanked : (gameState && gameState.isRanked === true));
    if (isRanked) {
        // SECURITY: Only update chip points if server provided the value
        // This prevents clients from manipulating their rank by sending arbitrary chip values
        if (gameResult.chipPoints !== undefined) {
            stats.chipPoints = gameResult.chipPoints;
        } else {
            // If server didn't provide chipPoints, don't update (security measure)
            console.warn('Server did not provide chipPoints. Skipping chip update for security.');
        }
    }
    
    await savePlayerStats(stats);
    await updateStatsDisplay();
    await updateRankDisplay();
}

async function updateStatsDisplay() {
    const stats = await getPlayerStats();
    
    const gamesPlayedEl = document.getElementById('statGamesPlayed');
    const winsEl = document.getElementById('statWins');
    const winRateEl = document.getElementById('statWinRate');
    const avgGuessesEl = document.getElementById('statAvgGuesses');
    const chipPointsEl = document.getElementById('statChipPoints');
    const winStreakEl = document.getElementById('statWinStreak');
    
    if (gamesPlayedEl) {
        gamesPlayedEl.textContent = stats.gamesPlayed || 0;
    }
    
    if (winsEl) {
        winsEl.textContent = stats.wins || 0;
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
    
    if (chipPointsEl) {
        const chipPoints = stats.chipPoints !== undefined && stats.chipPoints !== null ? stats.chipPoints : 0;
        chipPointsEl.textContent = Math.round(chipPoints);
    }
    
    if (winStreakEl) {
        const winStreak = stats.winStreak !== undefined && stats.winStreak !== null ? stats.winStreak : 0;
        winStreakEl.textContent = winStreak;
    }
    
    // Also update rank display
    updateRankDisplay().catch(error => {
        console.error('Error updating rank display:', error);
    });
}

// Clear cached stats when user changes (login/logout)
function clearStatsCache() {
    cachedStats = null;
}

// Ranking System (Rainbow Six Siege style)
const RANK_TIERS = [
    { name: 'Copper', subRanks: ['V', 'IV', 'III', 'II', 'I'], minChips: 0, maxChips: 1199, color: '#8B4513' },
    { name: 'Bronze', subRanks: ['V', 'IV', 'III', 'II', 'I'], minChips: 1200, maxChips: 2399, color: '#CD7F32' },
    { name: 'Silver', subRanks: ['V', 'IV', 'III', 'II', 'I'], minChips: 2400, maxChips: 3599, color: '#C0C0C0' },
    { name: 'Gold', subRanks: ['V', 'IV', 'III', 'II', 'I'], minChips: 3600, maxChips: 4799, color: '#FFD700' },
    { name: 'Platinum', subRanks: ['V', 'IV', 'III', 'II', 'I'], minChips: 4800, maxChips: 5999, color: '#00CED1' },
    { name: 'Diamond', subRanks: ['V', 'IV', 'III', 'II', 'I'], minChips: 6000, maxChips: 7999, color: '#B9F2FF' },
    { name: 'Champion', subRanks: ['V', 'IV', 'III', 'II', 'I'], minChips: 8000, maxChips: 9999, color: '#FF1493' }
];

// Get rank image path based on tier and sub-rank
function getRankImagePath(tier, subRank) {
    // Map sub-rank Roman numerals to numbers (I = 1, II = 2, III = 3, IV = 4, V = 5)
    const subRankMap = {
        'I': '1',
        'II': '2',
        'III': '3',
        'IV': '4',
        'V': '5'
    };
    
    const subRankNumber = subRankMap[subRank] || '1';
    
    // Map tier names to image folder names
    const tierMap = {
        'Copper': 'Copper',
        'Bronze': 'Bronze',
        'Silver': 'Silver',
        'Gold': 'Gold',
        'Platinum': 'Plat',  // Platinum uses "Plat" in filename
        'Diamond': 'Diamond',
        'Champion': 'Champ'  // Champion uses "Champ" in filename
    };
    
    const tierName = tierMap[tier] || 'Copper';
    
    return `images/Rank Images/${tierName}${subRankNumber}.png`;
}

function getRankFromChips(chipPoints) {
    const chips = chipPoints || 0;
    
    for (const tier of RANK_TIERS) {
        if (chips >= tier.minChips && chips <= tier.maxChips) {
            // Calculate which sub-rank
            const tierRange = tier.maxChips - tier.minChips;
            const subRankRange = tierRange / tier.subRanks.length;
            const chipsInTier = chips - tier.minChips;
            const subRankIndex = Math.min(
                Math.floor(chipsInTier / subRankRange),
                tier.subRanks.length - 1
            );
            const subRank = tier.subRanks[subRankIndex];
            
            // Calculate progress to next sub-rank
            const currentSubRankStart = tier.minChips + (subRankIndex * subRankRange);
            const nextSubRankStart = tier.minChips + ((subRankIndex + 1) * subRankRange);
            const progress = ((chips - currentSubRankStart) / (nextSubRankStart - currentSubRankStart)) * 100;
            
            // Determine next rank
            let nextRank = null;
            if (subRankIndex < tier.subRanks.length - 1) {
                nextRank = {
                    tier: tier.name,
                    subRank: tier.subRanks[subRankIndex + 1],
                    fullRank: `${tier.name} ${tier.subRanks[subRankIndex + 1]}`,
                    chipsNeeded: Math.ceil(nextSubRankStart - chips)
                };
            } else if (tier !== RANK_TIERS[RANK_TIERS.length - 1]) {
                // Next tier
                const nextTier = RANK_TIERS[RANK_TIERS.findIndex(t => t.name === tier.name) + 1];
                nextRank = {
                    tier: nextTier.name,
                    subRank: nextTier.subRanks[0] || '',
                    fullRank: nextTier.name + (nextTier.subRanks[0] ? ` ${nextTier.subRanks[0]}` : ''),
                    chipsNeeded: Math.ceil(nextTier.minChips - chips)
                };
            }
            
            return {
                tier: tier.name,
                subRank: subRank,
                fullRank: `${tier.name} ${subRank}`,
                color: tier.color,
                chips: chips,
                progress: Math.min(100, Math.max(0, progress)),
                nextRank: nextRank
            };
        }
    }
    
    // Fallback (shouldn't happen)
    return {
        tier: 'Copper',
        subRank: 'V',
        fullRank: 'Copper V',
        color: '#8B4513',
        chips: chips,
        progress: 0,
        nextRank: null
    };
}

async function updateRankDisplay() {
    const stats = await getPlayerStats();
    const chipPoints = stats.chipPoints !== undefined && stats.chipPoints !== null ? stats.chipPoints : 0;
    const rank = getRankFromChips(chipPoints);
    
    // Update rank display in play tab
    const rankDisplayEl = document.getElementById('currentRankDisplay');
    const rankTierEl = document.getElementById('currentRankTier');
    const rankSubRankEl = document.getElementById('currentRankSubRank');
    const rankImageEl = document.getElementById('currentRankImage');
    const rankChipsEl = document.getElementById('currentRankChips');
    const rankProgressBar = document.getElementById('rankProgressBar');
    const rankProgressText = document.getElementById('rankProgressText');
    
    if (rankDisplayEl) {
        rankDisplayEl.textContent = rank.fullRank;
        rankDisplayEl.style.color = rank.color;
    }
    
    if (rankTierEl) {
        rankTierEl.textContent = rank.tier;
        rankTierEl.style.color = rank.color;
    }
    
    if (rankSubRankEl) {
        rankSubRankEl.textContent = rank.subRank || '';
        rankSubRankEl.style.color = rank.color;
    }
    
    // Update rank image
    if (rankImageEl) {
        rankImageEl.src = getRankImagePath(rank.tier, rank.subRank);
        rankImageEl.alt = rank.fullRank;
    }
    
    if (rankChipsEl) {
        rankChipsEl.textContent = Math.round(chipPoints);
    }
    
    if (rankProgressBar) {
        rankProgressBar.style.width = `${rank.progress}%`;
        rankProgressBar.style.backgroundColor = rank.color;
    }
    
    if (rankProgressText && rank.nextRank) {
        rankProgressText.textContent = `${Math.ceil(rank.nextRank.chipsNeeded)} chips to ${rank.nextRank.fullRank}`;
    } else if (rankProgressText) {
        rankProgressText.textContent = 'Max Rank Achieved!';
    }
    
    // Update rank ladder highlighting
    updateRankLadderHighlight(rank);
}

function updateRankLadderHighlight(currentRank) {
    // This function is no longer needed for the new design
    // The progress bar fill and indicator show the current rank
}

function generateGameOverRankProgress(beforeChips, afterChips) {
    const markersContainer = document.getElementById('gameOverRankMarkers');
    const progressBarFill = document.getElementById('gameOverRankProgressFill');
    const progressBarChange = document.getElementById('gameOverRankProgressChange');
    const currentRankBadge = document.getElementById('gameOverRankBadge');
    const currentRankIndicator = document.getElementById('gameOverRankIndicator');
    const progressBarTrack = document.getElementById('gameOverRankProgressTrack');
    
    if (!markersContainer || !progressBarFill || !progressBarChange || !currentRankBadge || !currentRankIndicator || !progressBarTrack) return;
    
    // Reset change overlay
    progressBarChange.style.width = '0%';
    progressBarChange.style.left = '0%';
    progressBarChange.classList.remove('show', 'gain', 'loss');
    
    markersContainer.innerHTML = '';
    
    // Get before and after ranks
    const beforeRank = getRankFromChips(beforeChips);
    const afterRank = getRankFromChips(afterChips);
    
    // Find the tier that contains the current rank (use after rank, or before if they're in different tiers)
    const currentTier = RANK_TIERS.find(tier => tier.name === afterRank.tier) || 
                        RANK_TIERS.find(tier => tier.name === beforeRank.tier);
    
    // Calculate tier range
    const tierRange = currentTier.maxChips - currentTier.minChips;
    const subRankRange = tierRange / currentTier.subRanks.length;
    const beforeChipsInTier = Math.max(0, beforeChips - currentTier.minChips);
    const afterChipsInTier = Math.max(0, afterChips - currentTier.minChips);
    
    // Calculate which sub-rank we're in
    const beforeSubRankIndex = Math.min(
        Math.floor(beforeChipsInTier / subRankRange),
        currentTier.subRanks.length - 1
    );
    const afterSubRankIndex = Math.min(
        Math.floor(afterChipsInTier / subRankRange),
        currentTier.subRanks.length - 1
    );
    
    // Calculate progress within current sub-rank range
    const beforeSubRankStart = currentTier.minChips + (beforeSubRankIndex * subRankRange);
    const afterSubRankStart = currentTier.minChips + (afterSubRankIndex * subRankRange);
    const beforeProgressInSubRank = ((beforeChips - beforeSubRankStart) / subRankRange) * 100;
    const afterProgressInSubRank = ((afterChips - afterSubRankStart) / subRankRange) * 100;
    
    // Calculate overall percentage within tier
    const beforeFillPercentage = ((beforeSubRankIndex + (beforeProgressInSubRank / 100)) / currentTier.subRanks.length) * 100;
    const afterFillPercentage = ((afterSubRankIndex + (afterProgressInSubRank / 100)) / currentTier.subRanks.length) * 100;
    
    // Set initial position (before)
    progressBarFill.style.width = `${beforeFillPercentage}%`;
    progressBarFill.style.background = `linear-gradient(90deg, ${beforeRank.color}, ${beforeRank.color})`;
    currentRankIndicator.style.left = `${beforeFillPercentage}%`;
    
    // Update rank badge with image
    const beforeRankImagePath = getRankImagePath(beforeRank.tier, beforeRank.subRank);
    currentRankBadge.innerHTML = `<img src="${beforeRankImagePath}" alt="${beforeRank.fullRank}" class="rank-badge-image">`;
    currentRankBadge.style.backgroundColor = beforeRank.color;
    currentRankBadge.style.borderColor = beforeRank.color;
    
    // Create markers for each sub-rank in this tier
    currentTier.subRanks.forEach((subRank, index) => {
        const marker = document.createElement('div');
        marker.className = 'rank-marker';
        const markerPosition = (index / currentTier.subRanks.length) * 100;
        marker.style.left = `${markerPosition}%`;
        marker.style.borderColor = currentTier.color;
        
        const markerLabel = document.createElement('div');
        markerLabel.className = 'rank-marker-label';
        markerLabel.textContent = `${currentTier.name} ${subRank}`;
        markerLabel.style.color = currentTier.color;
        marker.appendChild(markerLabel);
        
        markersContainer.appendChild(marker);
    });
    
    // Add end marker for next tier (only if there is a next tier)
    const currentTierIndex = RANK_TIERS.findIndex(t => t.name === currentTier.name);
    const nextTier = currentTierIndex < RANK_TIERS.length - 1 ? RANK_TIERS[currentTierIndex + 1] : null;
    
    // Only add end marker if there's a next tier (don't add one at Champion since Champion I is the highest)
    if (nextTier) {
    const endMarker = document.createElement('div');
    endMarker.className = 'rank-marker';
    endMarker.style.left = '100%';
    
    const endMarkerLabel = document.createElement('div');
    endMarkerLabel.className = 'rank-marker-label';
        endMarkerLabel.textContent = nextTier.name;
        endMarkerLabel.style.color = nextTier.color;
        endMarker.style.borderColor = nextTier.color;
    endMarker.appendChild(endMarkerLabel);
    markersContainer.appendChild(endMarker);
    }
    
    // Animate to new position
    setTimeout(() => {
        if (afterChips > beforeChips) {
            // Gain: Smoothly expand from before to after, green overlay on new portion
            const changeWidth = afterFillPercentage - beforeFillPercentage;
            
            if (changeWidth > 0) {
                // Reset and position green overlay at the before position with 0 width
                progressBarChange.style.transition = 'none';
                progressBarChange.style.left = `${beforeFillPercentage}%`;
                progressBarChange.style.width = '0%';
                progressBarChange.classList.add('show', 'gain');
                
                // Force reflow to apply initial state
                void progressBarChange.offsetWidth;
                
                // Re-enable transition and animate
                progressBarChange.style.transition = 'left 1.2s cubic-bezier(0.4, 0, 0.2, 1), width 1.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease';
                
                // Animate both fill expansion and green overlay expansion simultaneously
                progressBarFill.style.width = `${Math.min(100, afterFillPercentage)}%`;
                progressBarFill.style.background = afterRank.color;
                progressBarChange.style.width = `${changeWidth}%`;
            } else {
                progressBarFill.style.width = `${Math.min(100, afterFillPercentage)}%`;
                progressBarFill.style.background = afterRank.color;
            }
        } else if (afterChips < beforeChips) {
            // Loss: Smoothly shrink from before to after, gray overlay on lost portion
            const lossWidth = beforeFillPercentage - afterFillPercentage;
            
            if (lossWidth > 0) {
                // Reset and position gray overlay at the after position with 0 width
                progressBarChange.style.transition = 'none';
                progressBarChange.style.left = `${afterFillPercentage}%`;
                progressBarChange.style.width = '0%';
                progressBarChange.classList.add('show', 'loss');
                
                // Force reflow to apply initial state
                void progressBarChange.offsetWidth;
                
                // Re-enable transition and animate
                progressBarChange.style.transition = 'left 1.2s cubic-bezier(0.4, 0, 0.2, 1), width 1.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease';
                
                // Animate fill shrinking and gray overlay expanding to show lost portion
                progressBarFill.style.width = `${Math.min(100, afterFillPercentage)}%`;
                progressBarFill.style.background = afterRank.color;
                progressBarChange.style.width = `${lossWidth}%`;
            } else {
                progressBarFill.style.width = `${Math.min(100, afterFillPercentage)}%`;
                progressBarFill.style.background = afterRank.color;
            }
        } else {
            // No change
            progressBarFill.style.width = `${Math.min(100, afterFillPercentage)}%`;
            progressBarFill.style.background = afterRank.color;
        }
        
        // Position marker at exact fill position
        currentRankIndicator.style.left = `${Math.min(100, afterFillPercentage)}%`;
        
        // Update rank badge with image
        const afterRankImagePath = getRankImagePath(afterRank.tier, afterRank.subRank);
        currentRankBadge.innerHTML = `<img src="${afterRankImagePath}" alt="${afterRank.fullRank}" class="rank-badge-image">`;
        currentRankBadge.style.backgroundColor = afterRank.color;
        currentRankBadge.style.borderColor = afterRank.color;
    }, 500);
}

function generateRankLadder() {
    const markersContainer = document.getElementById('rankMarkers');
    const progressBarFill = document.getElementById('rankProgressBarFill');
    const currentRankBadge = document.getElementById('currentRankBadge');
    const currentRankIndicator = document.getElementById('currentRankIndicator');
    
    if (!markersContainer || !progressBarFill || !currentRankBadge || !currentRankIndicator) return;
    
    markersContainer.innerHTML = '';
    
    // Calculate total number of ranks
    let totalRanks = 0;
    RANK_TIERS.forEach(tier => {
            totalRanks += tier.subRanks.length;
    });
    
    // Get current rank
    getPlayerStats().then(stats => {
        const chipPoints = stats.chipPoints !== undefined && stats.chipPoints !== null ? stats.chipPoints : 0;
        const currentRank = getRankFromChips(chipPoints);
        
        // Calculate position based on actual rank structure (matching getRankFromChips logic)
        let rankPosition = 0; // 0 to 1 (0% to 100%)
        let rankCount = 0;
        
        for (const tier of RANK_TIERS) {
            if (chipPoints >= tier.minChips && chipPoints <= tier.maxChips) {
                // We're in this tier
                    const tierRange = tier.maxChips - tier.minChips;
                    const subRankRange = tierRange / tier.subRanks.length;
                    const chipsInTier = chipPoints - tier.minChips;
                    const subRankIndex = Math.min(
                        Math.floor(chipsInTier / subRankRange),
                        tier.subRanks.length - 1
                    );
                    
                    // Calculate progress within the current sub-rank
                    const currentSubRankStart = subRankIndex * subRankRange;
                    const nextSubRankStart = (subRankIndex + 1) * subRankRange;
                    const progressInSubRank = ((chipsInTier - currentSubRankStart) / (nextSubRankStart - currentSubRankStart));
                    
                    // Position = (ranks before this tier + current sub-rank index + progress in sub-rank) / total ranks
                    rankPosition = (rankCount + subRankIndex + progressInSubRank) / totalRanks;
                    break;
            } else if (chipPoints > tier.maxChips) {
                // We've passed this tier, add all its sub-ranks to the count
                    rankCount += tier.subRanks.length;
            }
        }
        
        const fillPercentage = rankPosition * 100;
        const indicatorPosition = fillPercentage;
        progressBarFill.style.width = `${fillPercentage}%`;
        progressBarFill.style.background = `linear-gradient(90deg, ${currentRank.color}, ${currentRank.color})`;
        
        // Position current rank indicator
        currentRankIndicator.style.left = `${indicatorPosition}%`;
        
        // Update rank badge with image
        const rankImagePath = getRankImagePath(currentRank.tier, currentRank.subRank);
        currentRankBadge.innerHTML = `<img src="${rankImagePath}" alt="${currentRank.fullRank}" class="rank-badge-image">`;
        currentRankBadge.style.backgroundColor = currentRank.color;
        currentRankBadge.style.borderColor = currentRank.color;
        
        // Create markers for each tier (not each sub-rank to avoid clutter)
        RANK_TIERS.forEach((tier, tierIndex) => {
            const marker = document.createElement('div');
            marker.className = 'rank-marker';
            
            // Calculate position for this tier
            let tierStartIndex = 0;
            for (let i = 0; i < tierIndex; i++) {
                    tierStartIndex += RANK_TIERS[i].subRanks.length;
            }
            
            // Position at the start of the tier
            const markerPosition = (tierStartIndex / (totalRanks - 1)) * 100;
            marker.style.left = `${markerPosition}%`;
            marker.style.borderColor = tier.color;
            
            const markerLabel = document.createElement('div');
            markerLabel.className = 'rank-marker-label';
            markerLabel.textContent = tier.name;
            markerLabel.style.color = tier.color;
            marker.appendChild(markerLabel);
            
            markersContainer.appendChild(marker);
        });
        
    }).catch(error => {
        console.error('Error generating rank ladder:', error);
    });
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
        // Get a random card from all available cards
        const allCards = getAllCards();
        if (allCards.length > 0) {
            const randomCard = allCards[Math.floor(Math.random() * allCards.length)];
            const cardImage = document.createElement('img');
            cardImage.src = getCardImagePath(randomCard.id);
            cardImage.alt = randomCard.title || 'Card';
            cardImage.className = 'falling-card-image';
            element.appendChild(cardImage);
        } else {
            // Fallback to emoji if cards aren't loaded yet
            element.textContent = '🃏';
        }
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
        const screenIds = ['splash', 'credits', 'login', 'signup', 'guestName', 'lobby', 'waiting', 'vs', 'game', 'gameOver'];
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
// Register user as online when authenticated
function registerUserAsOnline() {
    if (socket && socket.connected && currentUser && currentUser.uid) {
        socket.emit('registerOnline', { firebaseUid: currentUser.uid });
        console.log('Registered user as online:', currentUser.uid);
    }
}

socket.on('connect', () => {
    // Register user as online when socket connects (if authenticated)
    registerUserAsOnline();
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
        showGameMessage('⚠️', 'Failed to Cancel Game', data.message);
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
    console.log('Is tutorial?', data.isTutorial);
    
    // Set currentPlayer from the event if not already set
    if (data.yourPlayerId) {
        currentPlayer = data.yourPlayerId;
        console.log('Set currentPlayer from gameStarted:', currentPlayer);
    }
    
    console.log('My player ID:', currentPlayer);
    
    // Remove yourPlayerId from data before storing in gameState, but preserve isTutorial
    const { yourPlayerId, ...gameStateData } = data;
    gameState = gameStateData;
    
    // Ensure isTutorial is preserved in gameState
    if (data.isTutorial !== undefined) {
        gameState.isTutorial = data.isTutorial;
        console.log('Tutorial mode set in gameState:', gameState.isTutorial);
    }
    
    // Ensure isRanked is preserved in gameState
    if (data.isRanked !== undefined) {
        gameState.isRanked = data.isRanked;
        console.log('Ranked mode set in gameState:', gameState.isRanked);
    }
    
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
    
    // Show VS screen first (or skip for tutorial)
    const showVSScreen = !data.isTutorial; // Skip VS screen for tutorial
    if (showVSScreen && ScreenManager.show('vs')) {
        console.log('Showing VS screen');
        // Update VS screen with player names
        const vsPlayer1Name = document.getElementById('vsPlayer1Name');
        const vsPlayer2Name = document.getElementById('vsPlayer2Name');
        const vsPlayer1Avatar = document.getElementById('vsPlayer1Avatar');
        const vsPlayer2Avatar = document.getElementById('vsPlayer2Avatar');
        const vsPlayer1StatRank = document.getElementById('vsPlayer1StatRank');
        const vsPlayer1StatChipPoints = document.getElementById('vsPlayer1StatChipPoints');
        const vsPlayer1StatWins = document.getElementById('vsPlayer1StatWins');
        const vsPlayer2StatRank = document.getElementById('vsPlayer2StatRank');
        const vsPlayer2StatChipPoints = document.getElementById('vsPlayer2StatChipPoints');
        const vsPlayer2StatWins = document.getElementById('vsPlayer2StatWins');
        
        console.log('Setting VS screen names:', player1Name, 'vs', player2Name);
        console.log('Opponent data:', opponentData);
        
        // Update player 1 (me) name
        if (vsPlayer1Name) {
            vsPlayer1Name.textContent = player1Name;
        }
        
        // Update player 1 avatar
        if (vsPlayer1Avatar) {
            const myPhoto = window.currentUserPhotoURL || (currentUser ? currentUser.photoURL : null) || null;
            if (myPhoto) {
                vsPlayer1Avatar.style.backgroundImage = `url(${myPhoto})`;
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
        getPlayerStats().then(stats => {
            const chipPoints = stats.chipPoints !== undefined && stats.chipPoints !== null ? stats.chipPoints : 0;
            const rank = getRankFromChips(chipPoints);
            
            if (vsPlayer1StatRank) {
                const rankImagePath = getRankImagePath(rank.tier, rank.subRank);
                vsPlayer1StatRank.innerHTML = `<img src="${rankImagePath}" alt="${rank.fullRank}" class="vs-rank-image"> ${rank.fullRank}`;
                vsPlayer1StatRank.style.color = rank.color;
            }
            if (vsPlayer1StatChipPoints) {
                vsPlayer1StatChipPoints.textContent = `Chips: ${Math.round(chipPoints)}`;
            }
            if (vsPlayer1StatWins) {
                vsPlayer1StatWins.textContent = `Games Won: ${stats.wins || 0}`;
            }
        }).catch(() => {
            if (vsPlayer1StatRank) {
                vsPlayer1StatRank.textContent = '-';
                vsPlayer1StatRank.style.color = '';
            }
            if (vsPlayer1StatChipPoints) {
                vsPlayer1StatChipPoints.textContent = 'Chips: -';
            }
            if (vsPlayer1StatWins) {
                vsPlayer1StatWins.textContent = 'Games Won: -';
            }
        });
        
        // Update player 2 (opponent) name
        if (vsPlayer2Name) {
            vsPlayer2Name.textContent = player2Name;
        }
        
        // Update player 2 avatar
        if (vsPlayer2Avatar) {
            // Check if opponent has photoURL in the game data
            if (opponentData && opponentData.photoURL) {
                vsPlayer2Avatar.style.backgroundImage = `url(${opponentData.photoURL})`;
                vsPlayer2Avatar.style.backgroundSize = 'cover';
                vsPlayer2Avatar.style.backgroundPosition = 'center';
                vsPlayer2Avatar.textContent = '';
            } else if (opponentData && opponentData.firebaseUid && window.firebaseDb) {
                // Try to fetch from Firestore if we have firebaseUid
                window.firebaseDb.collection('users').doc(opponentData.firebaseUid).get()
                    .then(userDoc => {
                        if (userDoc.exists && userDoc.data().photoURL) {
                            vsPlayer2Avatar.style.backgroundImage = `url(${userDoc.data().photoURL})`;
                            vsPlayer2Avatar.style.backgroundSize = 'cover';
                            vsPlayer2Avatar.style.backgroundPosition = 'center';
                            vsPlayer2Avatar.textContent = '';
                        } else {
            vsPlayer2Avatar.style.backgroundImage = '';
            vsPlayer2Avatar.style.backgroundSize = '';
            vsPlayer2Avatar.style.backgroundPosition = '';
            const initial = player2Name.charAt(0).toUpperCase();
            vsPlayer2Avatar.textContent = initial || '👤';
                        }
                    })
                    .catch(() => {
                        vsPlayer2Avatar.style.backgroundImage = '';
                        vsPlayer2Avatar.style.backgroundSize = '';
                        vsPlayer2Avatar.style.backgroundPosition = '';
                        const initial = player2Name.charAt(0).toUpperCase();
                        vsPlayer2Avatar.textContent = initial || '👤';
                    });
            } else {
                vsPlayer2Avatar.style.backgroundImage = '';
                vsPlayer2Avatar.style.backgroundSize = '';
                vsPlayer2Avatar.style.backgroundPosition = '';
                const initial = player2Name.charAt(0).toUpperCase();
                vsPlayer2Avatar.textContent = initial || '👤';
            }
        }
        
        // Update player 2 stats (opponent stats)
        // Try to fetch opponent stats if they have a Firebase UID
        console.log('Opponent data for stats:', opponentData);
        if (opponentData && opponentData.firebaseUid && window.firebaseDb) {
            console.log('Fetching opponent stats for firebaseUid:', opponentData.firebaseUid);
            console.log('Current user authenticated?', !!window.firebaseAuth?.currentUser);
            console.log('Current user UID:', window.firebaseAuth?.currentUser?.uid);
            
            // Check if user is authenticated before trying to fetch
            if (!window.firebaseAuth || !window.firebaseAuth.currentUser) {
                console.warn('User not authenticated, cannot fetch opponent stats');
                if (vsPlayer2StatRank) {
                    vsPlayer2StatRank.textContent = '-';
                    vsPlayer2StatRank.style.color = '';
                }
                if (vsPlayer2StatChipPoints) {
                    vsPlayer2StatChipPoints.textContent = 'Chips: -';
                }
                if (vsPlayer2StatWins) {
                    vsPlayer2StatWins.textContent = 'Games Won: -';
                }
            } else {
                // Fetch opponent stats from Firestore
                window.firebaseDb.collection('stats').doc(opponentData.firebaseUid).get()
                    .then(statsDoc => {
                        console.log('Opponent stats doc exists:', statsDoc.exists);
                        if (statsDoc.exists) {
                            const opponentStats = statsDoc.data();
                            console.log('Opponent stats data:', opponentStats);
                            
                            const wins = opponentStats.wins || opponentStats.wins === 0 ? opponentStats.wins : 0;
                            const chipPoints = opponentStats.chipPoints !== undefined && opponentStats.chipPoints !== null ? opponentStats.chipPoints : 0;
                            const rank = getRankFromChips(chipPoints);
                            
                            if (vsPlayer2StatRank) {
                                const rankImagePath = getRankImagePath(rank.tier, rank.subRank);
                                vsPlayer2StatRank.innerHTML = `<img src="${rankImagePath}" alt="${rank.fullRank}" class="vs-rank-image"> ${rank.fullRank}`;
                                vsPlayer2StatRank.style.color = rank.color;
                            }
                            if (vsPlayer2StatChipPoints) {
                                vsPlayer2StatChipPoints.textContent = `Chips: ${Math.round(chipPoints)}`;
                            }
                            if (vsPlayer2StatWins) {
                                vsPlayer2StatWins.textContent = `Games Won: ${wins}`;
                            }
                        } else {
                            console.log('Opponent stats doc does not exist for firebaseUid:', opponentData.firebaseUid);
                            if (vsPlayer2StatRank) {
                                vsPlayer2StatRank.textContent = 'Copper V';
                                vsPlayer2StatRank.style.color = '#8B4513';
                            }
                            if (vsPlayer2StatChipPoints) {
                                vsPlayer2StatChipPoints.textContent = 'Chips: 0';
                            }
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
                        
                        if (vsPlayer2StatRank) {
                            vsPlayer2StatRank.textContent = '-';
                            vsPlayer2StatRank.style.color = '';
                        }
                        if (vsPlayer2StatChipPoints) {
                            vsPlayer2StatChipPoints.textContent = 'Chips: -';
                        }
                        if (vsPlayer2StatWins) {
                            vsPlayer2StatWins.textContent = 'Games Won: -';
                        }
                    });
            }
        } else if (opponentData && opponentData.isBot) {
            // Bot - generate random stats
            console.log('Opponent is a bot, generating random stats');
            
            // Generate random stats for bot
            // Games played: 10-500
            const gamesPlayed = Math.floor(Math.random() * 491) + 10;
            // Win rate: 30-70% (realistic range)
            const winRate = Math.random() * 0.4 + 0.3; // 0.3 to 0.7
            const wins = Math.floor(gamesPlayed * winRate);
            // Chip points: Based on performance, roughly 0-3000
            // Higher win rate and more games = more chip points
            const baseChipPoints = Math.floor((wins * 25) + (gamesPlayed * 2));
            const chipPointsVariation = Math.floor(Math.random() * 500) - 250; // ±250 variation
            const chipPoints = Math.max(0, baseChipPoints + chipPointsVariation);
            const rank = getRankFromChips(chipPoints);
            
            if (vsPlayer2StatRank) {
                const rankImagePath = getRankImagePath(rank.tier, rank.subRank);
                vsPlayer2StatRank.innerHTML = `<img src="${rankImagePath}" alt="${rank.fullRank}" class="vs-rank-image"> ${rank.fullRank}`;
                vsPlayer2StatRank.style.color = rank.color;
            }
            if (vsPlayer2StatChipPoints) {
                vsPlayer2StatChipPoints.textContent = `Chips: ${Math.round(chipPoints)}`;
            }
            if (vsPlayer2StatWins) {
                vsPlayer2StatWins.textContent = `Games Won: ${wins}`;
            }
        } else {
            // No Firebase UID available (guest player)
            console.log('No firebaseUid for opponent. OpponentData:', opponentData);
            console.log('Has firebaseDb?', !!window.firebaseDb);
            if (vsPlayer2StatRank) {
                vsPlayer2StatRank.textContent = 'Rank: -';
                vsPlayer2StatRank.style.color = '';
            }
            if (vsPlayer2StatChipPoints) {
                vsPlayer2StatChipPoints.textContent = 'Chips: -';
            }
            if (vsPlayer2StatWins) {
                vsPlayer2StatWins.textContent = 'Games Won: -';
            }
        }
        
        // After 3 seconds (or immediately for tutorial), transition to game screen
        const transitionDelay = data.isTutorial ? 500 : 3000; // Faster transition for tutorial
        setTimeout(() => {
            console.log('Transitioning to game screen, tutorial:', data.isTutorial);
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
                console.log('Game screen shown successfully');
                // Start background music when game starts
                if (typeof soundManager !== 'undefined') {
                    soundManager.playBackgroundMusic('GameSoundTrack.mp4');
                }
                // Check if this is a tutorial game (check both gameState and data)
                if (gameState.isTutorial || data.isTutorial) {
                    window.tutorialMode = true;
                    window.tutorialStep = 0;
                    window.tutorialMessagesShown = new Set(); // Track which messages have been shown
                    // Store tutorial word if provided
                    if (data.tutorialWord) {
                        tutorialWord = data.tutorialWord;
                        console.log('Tutorial word set in gameStarted:', tutorialWord);
                    }
                    console.log('Tutorial mode activated in gameStarted handler, step:', window.tutorialStep);
                }
                initializeGame(gameState);
            } else {
                console.error('Failed to show game screen!');
            }
        }, transitionDelay);
    } else {
        // For tutorial or if VS screen fails, go directly to game
        console.log('Skipping VS screen, going directly to game (tutorial:', data.isTutorial, ')');
        if (ScreenManager.show('game')) {
            if (typeof soundManager !== 'undefined') {
                soundManager.playGameStart();
                soundManager.playBackgroundMusic('GameSoundTrack.mp4');
            }
            // Check if this is a tutorial game
            if (gameState.isTutorial || data.isTutorial) {
                window.tutorialMode = true;
                window.tutorialStep = 0;
                window.tutorialMessagesShown = new Set(); // Track which messages have been shown
                // Store tutorial word if provided
                if (data.tutorialWord) {
                    tutorialWord = data.tutorialWord;
                    console.log('Tutorial word set in fallback:', tutorialWord);
                }
                console.log('Tutorial mode activated (direct to game), step:', window.tutorialStep);
            }
            initializeGame(gameState);
        } else {
            console.error('Failed to show game screen in fallback!');
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
        
        // If this is the Finesse card, don't hide selection yet - opponentHandForSteal is coming
        if (data.card && data.card.id === 'cardSteal') {
            // Don't hide card selection - opponentHandForSteal event will show opponent's cards
            return;
        }
        
        // If this is the Dead Hand card, don't hide selection yet - opponentHandRevealed is coming
        if (data.card && data.card.id === 'handReveal') {
            // Don't hide card selection - opponentHandRevealed event will show opponent's cards
            return;
        }
        
        // If we were in Finesse mode (just selected an opponent's card), clear it now
        // This ensures that if allowSecondCard is true, the next selection uses normal flow
        if (window.finesseMode) {
            window.finesseMode = false;
            window.opponentCardsForFinesse = null;
            window.finesseGameId = null;
            
            // Remove Finesse mode class from container
            const container = document.getElementById('cardsContainer');
            if (container) {
                container.classList.remove('finesse-mode');
            }
        }
        
        // If a modifier card was used, allow another card selection
        if (data.allowSecondCard) {
            cardChainActive = true; // We're in a card chain
            // Don't hide card selection - show it again for next card (player's own cards)
            // Finesse mode is already cleared above, so next selection will use normal selectCard flow
            setTimeout(() => {
                showCardSelection();
                generateCards(); // Regenerate with player's own cards (not opponent's)
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
        
        // Show tutorial message on opponent's turn (only once, when opponent's turn first starts)
        if (window.tutorialMode && !window.tutorialMessagesShown?.has('opponentTurn')) {
            setTimeout(() => {
                if (window.tutorialMode && !window.tutorialMessagesShown.has('opponentTurn')) {
                    queueTutorialMessage('opponentTurn');
                    window.tutorialStep = 4;
                    console.log('Tutorial step updated to:', window.tutorialStep);
                }
            }, 1000);
        }
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
        // This is my guess - clear input and card since it was successfully submitted
        document.getElementById('wordInput').value = '';
        currentGuess = '';
        selectedCard = null;
        cardChainActive = false;
        
        if (data.hidden || !data.guess || !data.feedback) {
            // Guess is hidden from player (Gambler's Card, Rem-Job, or Blind Guess effect)
            displayOpponentGuessHidden(data.row);
            console.log('Your guess was hidden!');
        } else {
            // Normal display
        displayGuess(data.guess, data.feedback, data.row);
        updateKeyboard({ guess: data.guess, feedback: data.feedback });
        
        // Show tutorial message after first guess feedback (only once, after first guess)
        if (window.tutorialMode && !window.tutorialMessagesShown?.has('feedback')) {
            console.log('Feedback received, queueing feedback tutorial');
            setTimeout(() => {
                if (window.tutorialMode && !window.tutorialMessagesShown.has('feedback')) {
                    queueTutorialMessage('feedback');
                    window.tutorialStep = 3;
                    console.log('Tutorial step updated to:', window.tutorialStep);
                }
            }, 2500);
        }
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
    // Show revealed letter information (Bust Special lucky outcome)
    showGameMessage(
        '🎰',
        'Bust Special',
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
            if (newCard) {
            window.playerCardHand.push(newCard);
            } else {
                break; // Prevent infinite loop if drawCardFromDeck returns null
            }
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
            if (newCard) {
            window.playerCardHand.push(newCard);
            } else {
                break; // Prevent infinite loop if drawCardFromDeck returns null
            }
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
            if (newCard) {
            window.playerCardHand.push(newCard);
            } else {
                break; // Prevent infinite loop if drawCardFromDeck returns null
            }
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

socket.on('requestHandForSpectator', (data) => {
    // Spectator is requesting to see our hand
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
            if (newCard) {
                window.playerCardHand.push(newCard);
            } else {
                break; // Prevent infinite loop if drawCardFromDeck returns null
            }
        }
    }
    
    // Send current hand to server (up to 3 cards)
    const handToSend = window.playerCardHand.slice(0, 3).map(card => ({
        id: card.id,
        title: card.title,
        description: card.description
    }));
    
    socket.emit('sendHandForSpectator', {
        gameId: data.gameId,
        spectatorId: data.spectatorId,
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
    // Store opponent's cards and enter hand reveal mode
    // Cards will be shown in the normal card selection area
    window.handRevealMode = true;
    window.opponentCardsForReveal = data.cards;
    
    // Hide game board and show card selection with opponent's cards
    const gameBoard = document.getElementById('gameBoard');
    if (gameBoard) {
        gameBoard.style.display = 'none';
    }
    showCardSelection();
    // Use a small delay to ensure card selection panel is visible before generating cards
    setTimeout(() => {
        generateCards();
    }, 50);
});

socket.on('opponentHandForSteal', (data) => {
    // Store opponent's cards and enter Finesse mode
    // Cards will be shown in the normal card selection area
    window.finesseMode = true;
    window.opponentCardsForFinesse = data.cards;
    window.finesseGameId = data.gameId;
    
    // Hide game board and show card selection with opponent's cards
    const gameBoard = document.getElementById('gameBoard');
    if (gameBoard) {
        gameBoard.style.display = 'none';
    }
    showCardSelection();
    // Use a small delay to ensure card selection panel is visible before generating cards
    setTimeout(() => {
        generateCards();
    }, 50);
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

// Fetch word definition from dictionary API
async function fetchWordDefinition(word) {
    const definitionEl = document.getElementById('gameOverDefinition');
    if (!definitionEl) return;
    
    // Clear previous definition
    definitionEl.textContent = '';
    definitionEl.classList.remove('error', 'loading');
    
    // Show loading state
    definitionEl.classList.add('loading');
    definitionEl.textContent = 'Loading definition...';
    
    try {
        // Use Dictionary API (free, no API key required)
        const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`);
        
        if (!response.ok) {
            throw new Error('Definition not found');
        }
        
        const data = await response.json();
        
        if (data && data.length > 0 && data[0].meanings && data[0].meanings.length > 0) {
            // Get the first meaning and first definition
            const firstMeaning = data[0].meanings[0];
            if (firstMeaning.definitions && firstMeaning.definitions.length > 0) {
                const definition = firstMeaning.definitions[0].definition;
                definitionEl.textContent = definition;
                definitionEl.classList.remove('loading');
                return;
            }
        }
        
        throw new Error('No definition available');
    } catch (error) {
        console.log('Could not fetch word definition:', error);
        definitionEl.textContent = 'Definition not available';
        definitionEl.classList.remove('loading');
        definitionEl.classList.add('error');
    }
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
    // Get guess count - use provided guesses or calculate from player data
    let guesses = data.guesses || 0;
    if (guesses === 0 && gameState && gameState.players) {
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
    
    // Handle disconnect scenario
    if (data.disconnected) {
        if (won) {
            titleEl.textContent = 'You Win!';
            titleEl.classList.add('win');
            titleEl.classList.remove('lose');
            messageEl.textContent = 'Your opponent disconnected. You win!';
            iconEl.textContent = '🏆';
            wordEl.textContent = data.word;
            
            // Play win sound
            if (typeof soundManager !== 'undefined') {
                soundManager.playGameWin();
            }
        } else {
            titleEl.textContent = 'You Lost!';
            titleEl.classList.add('lose');
            titleEl.classList.remove('win');
            messageEl.textContent = 'You disconnected. The word was:';
            iconEl.textContent = '😔';
            wordEl.textContent = data.word;
            
            // Play lose sound
            if (typeof soundManager !== 'undefined') {
                soundManager.playGameLose();
            }
        }
    } else {
        // Normal game end
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
    }
    
    // Fetch and display word definition
    fetchWordDefinition(data.word);
    
    // Show tutorial message if in tutorial mode (only once, when game ends)
    if (window.tutorialMode && !window.tutorialMessagesShown?.has('gameOver')) {
        setTimeout(() => {
            if (window.tutorialMode && !window.tutorialMessagesShown.has('gameOver')) {
                queueTutorialMessage('gameOver');
            }
        }, 2000);
    }
    
    // Transition to game over screen immediately (don't wait for stats calculations)
    if (!ScreenManager.show('gameOver')) {
        console.error('Failed to show gameOver screen!');
        return;
    }
    
    // Scale game over screen to fit
    setTimeout(() => {
        scaleGameOverScreen();
    }, 100);
    
    // Calculate chip points change before updating stats (only for ranked games)
    // SECURITY: Use server-provided chip values instead of client-side calculation
    const isRanked = (data.isRanked !== undefined ? data.isRanked : (gameState && gameState.isRanked === true));
    
    // Show/hide rank progress bar based on ranked status
    const rankProgressContainer = document.getElementById('gameOverRankProgressTrack');
    if (rankProgressContainer) {
        rankProgressContainer.style.display = isRanked ? 'block' : 'none';
    }
    
    if (isRanked) {
    getPlayerStats().then(stats => {
        const currentChipPoints = stats.chipPoints !== undefined && stats.chipPoints !== null ? stats.chipPoints : 0;
            
            // SECURITY: Use server-provided chip change values (prevents client-side manipulation)
            let chipPointsChange = 0;
            let newChipPoints = currentChipPoints;
            
            if (data.disconnected && data.chipChange !== undefined) {
                // Disconnect scenario: use server-provided chip change
                chipPointsChange = data.chipChange;
                newChipPoints = Math.max(0, currentChipPoints + chipPointsChange);
            } else if (won && data.winnerChipChange !== undefined) {
                // Winner: use server-provided chip gain
                chipPointsChange = data.winnerChipChange;
                newChipPoints = Math.max(0, currentChipPoints + chipPointsChange);
            } else if (!won && data.loserChipChange !== undefined) {
                // Loser: use server-provided chip loss
                chipPointsChange = data.loserChipChange;
                newChipPoints = Math.max(0, currentChipPoints + chipPointsChange);
            } else {
                // Fallback: if server didn't send chip change, don't update (security measure)
                console.warn('Server did not provide chip change values. Skipping chip update for security.');
                chipPointsChange = 0;
                newChipPoints = currentChipPoints;
            }
        
        // Display chip points change on game over screen
        const chipPointsChangeEl = document.getElementById('gameOverChipPoints');
        if (chipPointsChangeEl) {
            if (chipPointsChange > 0) {
                chipPointsChangeEl.textContent = `+${chipPointsChange} Chips`;
                chipPointsChangeEl.classList.add('chip-points-gain');
                chipPointsChangeEl.classList.remove('chip-points-loss');
            } else if (chipPointsChange < 0) {
                chipPointsChangeEl.textContent = `${chipPointsChange} Chips`;
                chipPointsChangeEl.classList.add('chip-points-loss');
                chipPointsChangeEl.classList.remove('chip-points-gain');
            } else {
                chipPointsChangeEl.textContent = '0 Chips';
                chipPointsChangeEl.classList.remove('chip-points-gain', 'chip-points-loss');
            }
        }
        
        // Generate and animate rank progress bar
        generateGameOverRankProgress(currentChipPoints, newChipPoints);
            
            // Update stats with the server-provided chip change (SECURITY: only update if server provided values)
            // Use server-provided guesses if available, otherwise fall back to client calculation
            const finalGuesses = (won && data.winnerGuesses !== undefined) ? data.winnerGuesses :
                                (!won && data.loserGuesses !== undefined) ? data.loserGuesses :
                                guesses;
            
            updateStats({
                won: won,
                guesses: finalGuesses,
                chipPoints: newChipPoints,  // Use server-calculated chip points (SECURITY: prevents manipulation)
                isRanked: true  // Explicitly mark as ranked
            }).catch(error => {
                console.error('Error updating stats:', error);
            });
    }).catch(error => {
        console.error('Error calculating chip points change:', error);
    });
    } else {
        // Hide chip points change for non-ranked games
        const chipPointsChangeEl = document.getElementById('gameOverChipPoints');
        if (chipPointsChangeEl) {
            chipPointsChangeEl.textContent = '';
            chipPointsChangeEl.classList.remove('chip-points-gain', 'chip-points-loss');
        }
    
        // Update statistics for non-ranked games
    updateStats({
        won: won,
            guesses: guesses,
            isRanked: false  // Explicitly mark as non-ranked
    }).catch(error => {
        console.error('Error updating stats:', error);
    });
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
    // Play error sound
    if (typeof soundManager !== 'undefined') {
        soundManager.playError();
    }
    showGameMessage('⚠️', 'Invalid Word', data.message);
    // Don't clear input/card on error - let player fix their guess
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
        
        // Show tutorial message if opponent played a card (only once, first time)
        if (window.tutorialMode && data.playerId !== currentPlayer && !window.tutorialMessagesShown?.has('opponentCard')) {
            // Wait for card splash to finish, then show tutorial message
            setTimeout(() => {
                queueTutorialMessage('opponentCard');
            }, 2000);
        }
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
    
    // Initialize tutorial mode if this is a tutorial game
    if (data.isTutorial) {
        console.log('Tutorial mode activated!');
        window.tutorialMode = true;
        window.tutorialStep = 0;
        window.tutorialMessagesShown = new Set(); // Track which messages have been shown
        // Store tutorial word if provided
        if (data.tutorialWord) {
            tutorialWord = data.tutorialWord;
            console.log('Tutorial word set:', tutorialWord);
        }
        // Show first tutorial message immediately to ensure it's first in queue
        // Use a short delay to ensure game UI is ready
        setTimeout(() => {
            if (window.tutorialMode) {
                queueTutorialMessage('welcome');
            }
        }, 500);
    } else {
        window.tutorialMode = false;
        tutorialWord = null;
        window.tutorialMessagesShown = null;
    }
    
    currentRow = 0;
    // Reset card hand and initialize deck pool for new game
    window.playerCardHand = [];
    window.blockedCardId = null; // Clear blocked card for new game
    window.finesseMode = false; // Clear Finesse mode
    window.opponentCardsForFinesse = null;
    window.finesseGameId = null;
    window.handRevealMode = false; // Clear hand reveal mode
    window.opponentCardsForReveal = null;
    await initializeDeckPool();
    
    // Validate that we have cards in hand after initialization
    if (!window.playerCardHand || window.playerCardHand.length === 0) {
        console.error('No cards in hand after deck initialization! Attempting to draw cards...');
        // Try to draw cards again
        if (window.deckPool && window.deckPool.length > 0) {
            while (window.playerCardHand.length < 3 && window.deckPool.length > 0) {
                const newCard = drawCardFromDeck();
                if (newCard) {
                    window.playerCardHand.push(newCard);
                } else {
                    break;
                }
            }
        }
        
        // If still no cards, this is a critical error
        if (!window.playerCardHand || window.playerCardHand.length === 0) {
            console.error('CRITICAL: Still no cards after retry! Deck pool length:', window.deckPool?.length);
            showGameMessage('⚠️', 'Deck Error', 'Your deck appears to be empty. Please check your deck in the lobby.');
        }
    }
    
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
    const gameOverScreen = document.getElementById('gameOver');
    if (gameScreen && gameScreen.classList.contains('active')) {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            scaleGameBoard();
        }, 100);
    }
    if (gameOverScreen && gameOverScreen.classList.contains('active')) {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            scaleGameOverScreen();
        }, 100);
    }
});

// Scale game over screen to fit viewport
function scaleGameOverScreen() {
    const gameOverScreen = document.getElementById('gameOver');
    const scalingContainer = document.getElementById('gameOverScalingContainer');
    
    if (!gameOverScreen || !scalingContainer) return;
    
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
    const padding = 20; // Safety padding on all sides
    const availableWidth = gameOverScreen.clientWidth - (padding * 2);
    const availableHeight = gameOverScreen.clientHeight - (padding * 2);
    
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
    
    // Apply the transform with centering and scaling
    scalingContainer.style.transform = `translate(-50%, -50%) scale(${scale})`;
    scalingContainer.style.webkitTransform = `translate(-50%, -50%) scale(${scale})`;
    scalingContainer.style.msTransform = `translate(-50%, -50%) scale(${scale})`;
    scalingContainer.style.transformOrigin = 'center center';
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

function rebuildKeyboardFromBoard() {
    // Rebuild keyboard feedback colors from the game board
    // This is used when restoring keyboard after hiddenKeyboard effect ends
    // Track the best state for each letter (correct > present > absent)
    const letterStates = {};
    
    // First, try to rebuild from gameState if available (more reliable)
    if (gameState && gameState.players && currentPlayer) {
        const player = gameState.players.find(p => p.id === currentPlayer);
        if (player && player.guesses && Array.isArray(player.guesses)) {
            player.guesses.forEach(guessData => {
                if (guessData.guess && guessData.feedback) {
                    const guess = guessData.guess;
                    const feedback = guessData.feedback;
                    
                    for (let i = 0; i < guess.length && i < feedback.length; i++) {
                        const letter = guess[i];
                        const state = feedback[i];
                        
                        if (letter && state) {
                            const currentState = letterStates[letter];
                            // Only update if we're setting a better state (correct > present > absent)
                            if (!currentState || 
                                (state === 'correct') ||
                                (state === 'present' && currentState !== 'correct') ||
                                (state === 'absent' && currentState !== 'correct' && currentState !== 'present')) {
                                letterStates[letter] = state;
                            }
                        }
                    }
                }
            });
        }
    }
    
    // Fallback: rebuild from board if gameState not available or incomplete
    if (Object.keys(letterStates).length === 0) {
        const boardContainer = document.getElementById('boardContainer');
        if (boardContainer) {
            const rows = boardContainer.querySelectorAll('.board-row');
            rows.forEach(row => {
                const cells = row.querySelectorAll('.board-cell');
                cells.forEach((cell, index) => {
                    // Only process filled cells
                    if (!cell.classList.contains('filled')) return;
                    
                    const letter = cell.textContent.trim();
                    if (!letter) return;
                    
                    // Determine the feedback state from the cell classes
                    let state = null;
                    if (cell.classList.contains('correct')) {
                        state = 'correct';
                    } else if (cell.classList.contains('present')) {
                        state = 'present';
                    } else if (cell.classList.contains('absent')) {
                        state = 'absent';
                    }
                    
                    // Only update if we have a state and it's better than the current one
                    if (state) {
                        const currentState = letterStates[letter];
                        if (!currentState || 
                            (state === 'correct') ||
                            (state === 'present' && currentState !== 'correct') ||
                            (state === 'absent' && currentState !== 'correct' && currentState !== 'present')) {
                            letterStates[letter] = state;
                        }
                    }
                });
            });
        }
    }
    
    // Apply the states to the keyboard
    const keys = document.querySelectorAll('.key');
    keys.forEach(key => {
        const letter = key.textContent.trim();
        if (letterStates.hasOwnProperty(letter)) {
            // Remove all feedback classes
            key.classList.remove('correct', 'present', 'absent');
            // Add the correct state
            key.classList.add(letterStates[letter]);
        }
    });
}

function updateKeyboardVisibility() {
    // Check if hiddenKeyboard effect is active for the current player
    if (!gameState || !currentPlayer) {
        // Game not initialized yet, don't hide keyboard
        return;
    }
    
    // Check if keyboard was previously hidden (before we update)
    const wasKeyboardHidden = Array.from(document.querySelectorAll('.key')).some(key => 
        key.classList.contains('keyboard-hidden')
    );
    
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
    
    // If keyboard was previously hidden and is now visible, restore feedback colors
    if (wasKeyboardHidden && !isKeyboardHidden) {
        // Rebuild keyboard state from the board
        rebuildKeyboardFromBoard();
    }
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
        
        // Show tutorial message if in tutorial mode (only once, when card selection first appears)
        // Wait for welcome message to be shown first
        if (window.tutorialMode && !window.tutorialMessagesShown?.has('cardSelection')) {
            console.log('Card selection shown, waiting for welcome message before queueing cardSelection');
            const checkWelcomeShown = () => {
                if (window.tutorialMessagesShown?.has('welcome')) {
                    // Welcome message has been shown, now queue cardSelection
                    if (window.tutorialMode && !window.tutorialMessagesShown.has('cardSelection')) {
                        queueTutorialMessage('cardSelection');
                        window.tutorialStep = 1;
                        console.log('Tutorial step updated to:', window.tutorialStep);
                    }
                } else {
                    // Welcome not shown yet, check again in 200ms
                    setTimeout(checkWelcomeShown, 200);
                }
            };
            // Start checking after a short delay
            setTimeout(checkWelcomeShown, 500);
        }
        
        // Check if player is card locked - if so, show cards but grayed out
        if (isCardLocked()) {
            // Update title to show Forced Miss
            const titleElement = cardSelection.querySelector('h3');
            if (titleElement) {
                titleElement.textContent = "Forced Miss";
            }
            
            // Show cards but grayed out - player can see them but can't select
            // Pass a flag to generateCards to apply grayed out styles from the start
            generateCards(true); // true = force gray out all cards
            
            // Automatically hide card selection after 2.5 seconds so player can make a guess
            setTimeout(() => {
                // Restore title
                if (titleElement) {
                    titleElement.textContent = "Choose a Card";
                }
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
    // For tutorial mode, always use premade deck
    if (window.tutorialMode) {
        const allCards = getAllCards();
        const premadeDeck = createPremadeDeck().filter(id => id !== null);
        const premadeCards = premadeDeck.map(id => allCards.find(c => c.id === id)).filter(Boolean);
        if (premadeCards.length > 0) {
            console.log('Tutorial mode: Using premade deck');
            window.deckPool = [...premadeCards].sort(() => Math.random() - 0.5);
        } else {
            console.error('Tutorial mode: Premade deck is empty!');
            window.deckPool = [];
        }
    } else {
        // Always ensure decks are loaded before getting the deck
        // Clear cache to ensure fresh data
        cachedDecks = null;
        await getAllDecks();
        
        const deckIds = await getPlayerDeck();
        const allCards = getAllCards();
        const deckCards = deckIds.map(id => allCards.find(c => c.id === id)).filter(Boolean);
        
        // Validate that we have cards
        if (deckCards.length === 0) {
            console.error('No cards found in deck! Deck IDs:', deckIds);
            // Fallback to premade deck if current deck is empty
            const premadeDeck = createPremadeDeck().filter(id => id !== null);
            const premadeCards = premadeDeck.map(id => allCards.find(c => c.id === id)).filter(Boolean);
            if (premadeCards.length > 0) {
                console.warn('Using premade deck as fallback');
                window.deckPool = [...premadeCards].sort(() => Math.random() - 0.5);
            } else {
                console.error('Premade deck is also empty! Cannot initialize deck pool.');
                window.deckPool = [];
            }
        } else {
        // Create a shuffled pool of deck cards
        window.deckPool = [...deckCards].sort(() => Math.random() - 0.5);
        }
    }
    
    window.playerCardHand = [];
    
    // Draw initial 3 cards into hand
    if (window.deckPool && window.deckPool.length > 0) {
        while (window.playerCardHand.length < 3 && window.deckPool.length > 0) {
            const newCard = drawCardFromDeck();
            if (newCard) {
                window.playerCardHand.push(newCard);
            } else {
                break; // Prevent infinite loop if drawCardFromDeck returns null
            }
        }
    }
}

// Synchronous version that uses cached decks (for backwards compatibility)
function initializeDeckPoolSync() {
    const deckIds = getPlayerDeckSync();
    const allCards = getAllCards();
    const deckCards = deckIds.map(id => allCards.find(c => c.id === id)).filter(Boolean);
    
    // Create a shuffled pool of deck cards
    window.deckPool = [...deckCards].sort(() => Math.random() - 0.5);
    
    // Initialize hand if not exists
    if (!window.playerCardHand) {
    window.playerCardHand = [];
    }
    
    // Draw initial 3 cards into hand if empty
    if (window.deckPool && window.deckPool.length > 0) {
        while (window.playerCardHand.length < 3 && window.deckPool.length > 0) {
            const newCard = window.deckPool.shift();
            if (newCard) {
                window.playerCardHand.push(newCard);
            } else {
                break; // Prevent infinite loop
            }
        }
    }
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
        if (newCard) {
        window.playerCardHand.push(newCard);
        } else {
            break; // Prevent infinite loop if drawCardFromDeck returns null/undefined
        }
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
                cardElement.classList.add('blocked');
                // CSS class .card.blocked will handle opacity and filter with !important
                // Animation will still run, but opacity stays at 0.4 via CSS
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
    // If deck pool is empty, try to reshuffle
    if (!window.deckPool || window.deckPool.length === 0) {
        const deckIds = getPlayerDeckSync();
        const allCards = getAllCards();
        const deckCards = deckIds.map(id => allCards.find(c => c.id === id)).filter(Boolean);
        if (deckCards.length > 0) {
        window.deckPool = [...deckCards].sort(() => Math.random() - 0.5);
        } else {
            // If still empty, try fallback
            const fallbackCards = getDeckCards();
            if (fallbackCards && fallbackCards.length > 0) {
                window.deckPool = [...fallbackCards].sort(() => Math.random() - 0.5);
            } else {
                console.error('drawCardFromDeck: No cards available in deck!');
                return null; // Return null instead of undefined
            }
        }
    }
    
    // Draw a card from the pool
    if (window.deckPool && window.deckPool.length > 0) {
        return window.deckPool.shift();
    }
    
    // Final fallback
    const deckCards = getDeckCards();
    if (deckCards && deckCards.length > 0) {
    return deckCards[0];
    }
    
    console.error('drawCardFromDeck: All fallbacks failed, returning null');
    return null;
}

function generateCards(forceGrayOut = false) {
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
        if (newCard) {
        window.playerCardHand.push(newCard);
        } else {
            // If we can't draw a card, break to prevent infinite loop
            console.error('Cannot draw card from deck. Deck pool length:', window.deckPool?.length);
            break;
        }
    }
    
    // Check if blocked card is still in hand - clear it if not
    if (window.blockedCardId) {
        const blockedCardStillInHand = window.playerCardHand.slice(0, 3).some(c => c.id === window.blockedCardId);
        if (!blockedCardStillInHand) {
            window.blockedCardId = null;
        }
    }
    
    // Check if we're in hand reveal mode - show opponent's cards (view only, click anywhere to close)
    if (window.handRevealMode && window.opponentCardsForReveal) {
        // Add class to container to indicate hand reveal mode
        container.classList.add('hand-reveal-mode');
        
        // Update the title to say "Opponent's Hand"
        const cardSelection = document.getElementById('cardSelection');
        if (cardSelection) {
            const titleElement = cardSelection.querySelector('h3');
            if (titleElement) {
                titleElement.textContent = "Opponent's Hand";
            }
        }
        
        // In hand reveal mode, show opponent's cards (view only)
        // Cards will use the same styling as normal card selection (rotations, positioning, etc.)
        const opponentCards = window.opponentCardsForReveal;
        
        opponentCards.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = 'card';
            // Cards look exactly like normal selection cards (including hover effects, cursor, etc.)
            // Just don't add an onclick handler - clicks will bubble up to close
            
            // Create image element for the card
            const cardImage = document.createElement('img');
            cardImage.src = getCardImagePath(card.id);
            cardImage.alt = card.title;
            cardImage.className = 'card-image';
            cardElement.appendChild(cardImage);
            
            // Add hover sound for consistency with normal card selection
            cardElement.addEventListener('mouseenter', () => {
                if (typeof soundManager !== 'undefined') {
                    soundManager.playCardHover();
                }
            });
            
            container.appendChild(cardElement);
        });
        
        // Add click handler to close when clicking anywhere in the card selection area
        const handleCardAreaClick = () => {
            // Clear hand reveal mode
            window.handRevealMode = false;
            window.opponentCardsForReveal = null;
            
            // Remove hand reveal mode class from container
            container.classList.remove('hand-reveal-mode');
            
            // Restore the title to default
            if (cardSelection) {
                const titleElement = cardSelection.querySelector('h3');
                if (titleElement) {
                    titleElement.textContent = "Choose a Card";
                }
            }
            
            // Remove click handler
            if (cardSelection) {
                cardSelection.removeEventListener('click', handleCardAreaClick);
            }
            
            // Hide card selection and show game board
            hideCardSelection();
            showGameBoard();
        };
        
        // Add click handler to cardSelection so clicks anywhere (including on cards) close it
        if (cardSelection) {
            cardSelection.addEventListener('click', handleCardAreaClick, { once: true });
        }
        
        
        // Update hand panel after cards are generated (keep showing player's hand)
        updateHandPanel();
        return;
    }
    
    // Check if we're in Finesse mode - show opponent's cards instead of player's cards
    if (window.finesseMode && window.opponentCardsForFinesse) {
        // Add class to container to indicate Finesse mode
        container.classList.add('finesse-mode');
        
        // In Finesse mode, show opponent's cards
        const opponentCards = window.opponentCardsForFinesse;
        
        opponentCards.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = 'card';
            
            // Create image element for the card
            const cardImage = document.createElement('img');
            cardImage.src = getCardImagePath(card.id);
            cardImage.alt = card.title;
            cardImage.className = 'card-image';
            cardElement.appendChild(cardImage);
            
            // All opponent cards are selectable in Finesse mode
            cardElement.onclick = () => selectCard(card, cardElement);
            
            // Add hover sound to card
            cardElement.addEventListener('mouseenter', () => {
                if (typeof soundManager !== 'undefined') {
                    soundManager.playCardHover();
                }
            });
            
            container.appendChild(cardElement);
        });
        
        // Update hand panel after cards are generated (keep showing player's hand)
        updateHandPanel();
        return;
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
                // CSS class .card.blocked will handle opacity and filter with !important
                cardElement.style.cursor = 'not-allowed';
                cardElement.style.pointerEvents = 'none';
                // Animation will still run (for transform), but opacity stays at 0.4 via CSS
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
        // Remove Finesse mode class if not in Finesse mode
        container.classList.remove('finesse-mode');
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
            if (replacementCard && 
                !window.playerCardHand.some(handCard => handCard.id === replacementCard.id) &&
                (!isModifierCard(replacementCard.id) || !cardsInChain.includes(replacementCard.id))) {
                availableCards.push(replacementCard);
            } else if (!replacementCard) {
                // If we can't draw a card, break to prevent infinite loop
                console.error('Cannot draw replacement card from deck');
                break;
            }
        }
    }
    
    // Show available cards (up to 3, including blocked card but greyed out)
    const selectedCards = availableCards.slice(0, 3);
    
    selectedCards.forEach((card, index) => {
        const cardElement = document.createElement('div');
        const isBlocked = window.blockedCardId === card.id;
        const shouldGrayOut = forceGrayOut || isBlocked;
        cardElement.className = 'card';
        if (shouldGrayOut) {
            cardElement.classList.add('blocked');
            // CSS class .card.blocked will handle opacity and filter with !important
            cardElement.style.cursor = 'not-allowed';
            cardElement.style.pointerEvents = 'none';
            // Animation will still run (for transform), but opacity stays at 0.4 via CSS
        }
        
        // Create image element for the card
        const cardImage = document.createElement('img');
        cardImage.src = getCardImagePath(card.id);
        cardImage.alt = card.title;
        cardImage.className = 'card-image';
        cardElement.appendChild(cardImage);
        
        if (!shouldGrayOut) {
        cardElement.onclick = () => selectCard(card, cardElement);
        }
        
        // Add hover sound to card
        cardElement.addEventListener('mouseenter', () => {
            if (typeof soundManager !== 'undefined' && !shouldGrayOut) {
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
        showGameMessage('Forced Miss', 'You cannot use a card this turn!', '🔒');
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
    
    // Show tutorial message after card selection (only once, when first card is selected)
    if (window.tutorialMode && !window.tutorialMessagesShown?.has('makeGuess')) {
        console.log('Card selected, queueing makeGuess tutorial');
        setTimeout(() => {
            if (window.tutorialMode && !window.tutorialMessagesShown.has('makeGuess')) {
                queueTutorialMessage('makeGuess');
                window.tutorialStep = 2;
                console.log('Tutorial step updated to:', window.tutorialStep);
            }
        }, 800);
    }
    
    // Play card select sound
    if (typeof soundManager !== 'undefined') {
        soundManager.playCardSelect();
    }
    
    selectedCard = card;
    document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
    cardElement.classList.add('selected');
    
    console.log('Selecting card:', card);
    
    // Check if we're in Finesse mode - if so, send selectOpponentCard instead
    if (window.finesseMode && window.opponentCardsForFinesse) {
        // Send the selected opponent card to server
        socket.emit('selectOpponentCard', {
            gameId: window.finesseGameId || gameState.gameId,
            card: card
        });
        
        // Don't clear Finesse mode or hide selection here - wait for cardSelected event
        // The server will emit cardPlayed for splash animation, then cardSelected
        // We'll handle cleanup in the cardSelected handler
        return; // Exit early, don't process as normal card selection
    }
    
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
                        if (newCard) {
                        window.playerCardHand.push(newCard);
                        } else {
                            break; // Prevent infinite loop if drawCardFromDeck returns null
                        }
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
    // If this is the Finesse card, don't hide selection - opponentHandForSteal is coming
    // Otherwise, hide card selection and show game board
    if (cardIsModifier) {
        // cardChainActive will be set by the cardSelected event handler
        // Don't hide selection yet - wait for next card
    } else if (window.snackTimeMode) {
        // In snack time mode, wait for server to confirm before hiding
        // The server will emit cardSelected with allowSecondCard: false
        cardChainActive = false;
    } else if (card.id === 'cardSteal') {
        // Finesse card - don't hide selection, opponentHandForSteal event will show opponent's cards
        cardChainActive = false;
    } else if (card.id === 'handReveal') {
        // Dead Hand card - don't hide selection, opponentHandRevealed event will show opponent's cards
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
            indicator.textContent = 'Your Turn - Forced Miss!';
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
        showGameMessage('⚠️', 'Incomplete Deck', `Please fill all ${DECK_SIZE} deck slots.`);
        return;
    }
    
    // Validate: Check that special cards are only in special slots
    for (let i = 0; i < DECK_SIZE; i++) {
        const cardId = currentDeckSelection[i];
        if (cardId && isSpecialCard(cardId) && i >= SPECIAL_CARD_SLOTS) {
            showGameMessage('⚠️', 'Invalid Card Placement', 'Special cards can only be placed in special card slots (★)!');
            return;
        }
    }
    
    // Validate: Count special cards (should be max 2, but that's enforced by slots)
    const specialCardCount = currentDeckSelection.filter(id => id && isSpecialCard(id)).length;
    if (specialCardCount > SPECIAL_CARD_SLOTS) {
        showGameMessage('⚠️', 'Too Many Special Cards', `You can only have ${SPECIAL_CARD_SLOTS} special cards in your deck!`);
        return;
    }
    
    await savePlayerDeck(filledSlots);
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

document.getElementById('findMatchBtn').addEventListener('click', async () => {
    const name = getPlayerName();
    if (!name) {
        showGameMessage('⚠️', 'Name Required', 'Please enter your name');
        return;
    }
    
    // Ensure decks are loaded before starting matchmaking
    // Clear cache to ensure fresh data
    cachedDecks = null;
    await getAllDecks();
    
    // Double-check that deck is actually loaded
    const testDeck = await getPlayerDeck();
    if (!testDeck || testDeck.length === 0) {
        console.error('Deck is empty after loading!');
        showGameMessage('⚠️', 'Deck Error', 'Your deck could not be loaded. Please check your deck in the lobby.');
        setTimeout(() => {
            switchTab('deck');
        }, 100);
        return;
    }
    
    // Validate deck before starting matchmaking
    const validation = validateDeckForGame();
    if (!validation.valid) {
        showGameMessage('⚠️', 'Incomplete Deck', validation.message);
        // Switch to deck tab so user can fix their deck (delay to ensure popup is visible)
        setTimeout(() => {
            switchTab('deck');
        }, 100);
        return;
    }
    
    const firebaseUid = currentUser ? currentUser.uid : null;
    const photoURL = window.currentUserPhotoURL || (currentUser ? currentUser.photoURL : null);
    socket.emit('findMatch', { playerName: name, firebaseUid: firebaseUid, photoURL: photoURL });
});

document.getElementById('cancelMatchmakingBtn').addEventListener('click', () => {
    socket.emit('cancelMatchmaking');
});

document.getElementById('createGameBtn').addEventListener('click', async () => {
    const name = getPlayerName();
    if (name) {
        // Cancel matchmaking if active
        socket.emit('cancelMatchmaking');
        
        // Ensure decks are loaded before creating game
        // Clear cache to ensure fresh data
        cachedDecks = null;
        await getAllDecks();
        
        // Double-check that deck is actually loaded
        const testDeck = await getPlayerDeck();
        if (!testDeck || testDeck.length === 0) {
            console.error('Deck is empty after loading!');
            showGameMessage('⚠️', 'Deck Error', 'Your deck could not be loaded. Please check your deck in the lobby.');
            setTimeout(() => {
                switchTab('deck');
            }, 100);
            return;
        }
        
        // Validate deck before creating game
        const validation = validateDeckForGame();
        if (!validation.valid) {
            showGameMessage('⚠️', 'Incomplete Deck', validation.message);
            // Switch to deck tab so user can fix their deck (delay to ensure popup is visible)
            setTimeout(() => {
                switchTab('deck');
            }, 100);
            return;
        }
        
        const firebaseUid = currentUser ? currentUser.uid : null;
        const photoURL = window.currentUserPhotoURL || (currentUser ? currentUser.photoURL : null);
        socket.emit('createGame', { playerName: name, firebaseUid: firebaseUid, photoURL: photoURL });
    } else {
        showGameMessage('⚠️', 'Sign In Required', 'Please sign in to create a game');
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
    
    // If switching to leaderboard tab, load leaderboard
    if (tabName === 'leaderboard') {
        loadLeaderboard().catch(error => {
            console.error('Error loading leaderboard:', error);
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

// Leaderboard functionality
async function loadLeaderboard() {
    const loadingEl = document.getElementById('leaderboardLoading');
    const errorEl = document.getElementById('leaderboardError');
    const topEl = document.getElementById('leaderboardTop');
    const userEntryEl = document.getElementById('leaderboardUserEntry');
    const userSectionEl = document.getElementById('leaderboardUser');
    
    // Show loading state
    if (loadingEl) loadingEl.style.display = 'block';
    if (errorEl) errorEl.style.display = 'none';
    if (topEl) topEl.innerHTML = '';
    if (userEntryEl) userEntryEl.innerHTML = '';
    
    try {
        // Check if user is authenticated and Firestore is available
        if (!window.firebaseDb || !currentUser || !currentUser.uid) {
            throw new Error('Firebase not available or user not authenticated');
        }
        
        // Fetch top 10 players by chipPoints
        const statsRef = window.firebaseDb.collection('stats');
        const topPlayersQuery = await statsRef
            .orderBy('chipPoints', 'desc')
            .limit(10)
            .get();
        
        // Also get user's stats to find their rank
        const userStatsDoc = await statsRef.doc(currentUser.uid).get();
        const userStats = userStatsDoc.exists ? userStatsDoc.data() : { chipPoints: 0 };
        
        // Get user info from users collection
        let userName = 'Player';
        let userPhotoURL = null;
        try {
            const userDoc = await window.firebaseDb.collection('users').doc(currentUser.uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                userName = userData.displayName || currentUser.displayName || 'Player';
                userPhotoURL = userData.photoURL || currentUser.photoURL || null;
            }
        } catch (error) {
            console.error('Error fetching user info:', error);
            userName = currentUser.displayName || 'Player';
            userPhotoURL = currentUser.photoURL || null;
        }
        
        // Fetch user info for top 10 players
        const topPlayers = [];
        for (const doc of topPlayersQuery.docs) {
            const stats = doc.data();
            const uid = doc.id;
            let name = 'Player';
            let photoURL = null;
            
            try {
                const userDoc = await window.firebaseDb.collection('users').doc(uid).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    name = userData.displayName || 'Player';
                    photoURL = userData.photoURL || null;
                }
            } catch (error) {
                console.error('Error fetching user info for', uid, ':', error);
            }
            
            topPlayers.push({
                uid: uid,
                name: name,
                photoURL: photoURL,
                chipPoints: stats.chipPoints || 0,
                stats: stats
            });
        }
        
        // Calculate user's rank by counting players with higher chipPoints
        const userRank = await calculateUserRank(userStats.chipPoints || 0);
        
        // Display top 10
        if (topEl) {
            displayTopPlayers(topPlayers);
        }
        
        // Display user's rank
        if (userEntryEl && userSectionEl) {
            displayUserRank({
                uid: currentUser.uid,
                name: userName,
                photoURL: userPhotoURL,
                chipPoints: userStats.chipPoints || 0,
                rank: userRank,
                stats: userStats
            });
        }
        
    } catch (error) {
        console.error('Error loading leaderboard:', error);
        if (errorEl) {
            errorEl.style.display = 'block';
            errorEl.textContent = error.message || 'Failed to load leaderboard. Please try again later.';
        }
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

async function calculateUserRank(userChipPoints) {
    if (!window.firebaseDb) return { rank: 'N/A', totalPlayers: 0 };
    
    try {
        // Count players with chipPoints greater than the user's
        const statsRef = window.firebaseDb.collection('stats');
        const higherPlayersQuery = await statsRef
            .where('chipPoints', '>', userChipPoints)
            .get();
        
        const userRank = higherPlayersQuery.size + 1;
        
        // Get total players count (approximate)
        const allStatsQuery = await statsRef.get();
        const totalPlayers = allStatsQuery.size;
        
        return { rank: userRank, totalPlayers: totalPlayers };
    } catch (error) {
        console.error('Error calculating user rank:', error);
        return { rank: 'N/A', totalPlayers: 0 };
    }
}

function displayTopPlayers(players) {
    const topEl = document.getElementById('leaderboardTop');
    if (!topEl) return;
    
    topEl.innerHTML = '';
    
    players.forEach((player, index) => {
        const rank = index + 1;
        const rankInfo = getRankFromChips(player.chipPoints);
        
        const entry = document.createElement('div');
        entry.className = `leaderboard-entry ${rank <= 3 ? `top-${rank}` : ''}`;
        
        // Create avatar div with photo or first letter
        const avatarInitial = player.name ? player.name.charAt(0).toUpperCase() : '?';
        const avatarStyle = player.photoURL 
            ? `background-image: url(${player.photoURL}); background-size: cover; background-position: center;` 
            : '';
        
        const rankImagePath = getRankImagePath(rankInfo.tier, rankInfo.subRank);
        
        entry.innerHTML = `
            <div class="leaderboard-rank">#${rank}</div>
            <div class="leaderboard-avatar" style="${avatarStyle}">${player.photoURL ? '' : avatarInitial}</div>
            <div class="leaderboard-info">
                <div class="leaderboard-name">${escapeHtml(player.name)}</div>
                <div class="leaderboard-stats">
                    <div class="leaderboard-stat">
                        <img src="${rankImagePath}" alt="${rankInfo.fullRank}" class="leaderboard-rank-image">
                        <span>${rankInfo.fullRank}</span>
                    </div>
                    <div class="leaderboard-stat">
                        <span class="leaderboard-stat-label">Chips:</span>
                        <span>${Math.round(player.chipPoints)}</span>
                    </div>
                </div>
            </div>
        `;
        
        topEl.appendChild(entry);
    });
}

function displayUserRank(user) {
    const userEntryEl = document.getElementById('leaderboardUserEntry');
    const userSectionEl = document.getElementById('leaderboardUser');
    if (!userEntryEl || !userSectionEl) return;
    
    const rankInfo = getRankFromChips(user.chipPoints);
    const rankText = user.rank && typeof user.rank.rank === 'number'
        ? `#${user.rank.rank}` 
        : 'N/A';
    
    // Create avatar div with photo or first letter
    const avatarInitial = user.name ? user.name.charAt(0).toUpperCase() : '?';
    const avatarStyle = user.photoURL 
        ? `background-image: url(${user.photoURL}); background-size: cover; background-position: center;` 
        : '';
    
    const rankImagePath = getRankImagePath(rankInfo.tier, rankInfo.subRank);
    
    userEntryEl.innerHTML = `
        <div class="leaderboard-rank">${rankText}</div>
        <div class="leaderboard-avatar" style="${avatarStyle}">${user.photoURL ? '' : avatarInitial}</div>
        <div class="leaderboard-info">
            <div class="leaderboard-name">${escapeHtml(user.name)}</div>
            <div class="leaderboard-stats">
                <div class="leaderboard-stat">
                    <img src="${rankImagePath}" alt="${rankInfo.fullRank}" class="leaderboard-rank-image">
                    <span>${rankInfo.fullRank}</span>
                </div>
                <div class="leaderboard-stat">
                    <span class="leaderboard-stat-label">Chips:</span>
                    <span>${Math.round(user.chipPoints)}</span>
                </div>
            </div>
        </div>
    `;
    
    userEntryEl.className = 'leaderboard-entry user-entry';
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

// Tutorial system
let tutorialWord = null;
let tutorialHints = {
    'APPLE': { hint1: 'It\'s a red or green fruit', hint2: 'It grows on trees', hint3: 'Common snack, starts with A' },
    'HEART': { hint1: 'It beats in your chest', hint2: 'Symbol of love', hint3: 'Pumps blood through your body' },
    'MUSIC': { hint1: 'You listen to it', hint2: 'Has rhythm and melody', hint3: 'Made with instruments' },
    'WATER': { hint1: 'You drink it', hint2: 'Falls from the sky as rain', hint3: 'Essential for life' },
    'LIGHT': { hint1: 'Comes from the sun', hint2: 'Makes things visible', hint3: 'Opposite of dark' },
    'DREAM': { hint1: 'Happens when you sleep', hint2: 'Can be good or bad', hint3: 'Your imagination at night' },
    'HAPPY': { hint1: 'A feeling of joy', hint2: 'Opposite of sad', hint3: 'When you smile' },
    'SMILE': { hint1: 'What you do when happy', hint2: 'Uses your mouth', hint3: 'Shows your teeth' }
};

let tutorialMessages = {
    welcome: {
        icon: '🎓',
        title: 'Welcome to the Tutorial!',
        getText: () => {
            return 'This is a practice game against Bot. You\'ll learn how to play Cardle step by step. Let\'s start!';
        }
    },
    cardSelection: {
        icon: '🃏',
        title: 'Choose a Card',
        getText: () => {
            return 'At the start of each turn, you\'ll see 3 cards. Click on one to play it. Cards can help you or hinder your opponent!';
        }
    },
    makeGuess: {
        icon: '⌨️',
        title: 'Make Your Guess',
        getText: () => {
            return 'Now type a 5-letter word and press Enter or click Submit. Try starting with common letters like E, A, R, T, or O!';
        }
    },
    feedback: {
        icon: '💡',
        title: 'Understanding Feedback',
        getText: () => {
            return '<span class="highlight">Green</span> = correct letter in correct position<br><span class="highlight">Yellow</span> = letter is in the word but wrong position<br><span class="highlight">Gray</span> = letter is not in the word<br><br>Use this feedback to narrow down the word!';
        }
    },
    opponentTurn: {
        icon: '⏳',
        title: 'Opponent\'s Turn',
        getText: () => {
            return 'Now it\'s Bot\'s turn. Watch their guess and learn from their feedback too!';
        }
    },
    opponentCard: {
        icon: '🃏',
        title: 'Bot Played a Card',
        getText: () => {
            let baseText = 'Bot just played a card! Cards can affect the game in different ways - some help the player, some hinder them. Pay attention to what happens next!';
            if (tutorialWord && tutorialHints[tutorialWord]) {
                const allHints = [
                    tutorialHints[tutorialWord].hint1,
                    tutorialHints[tutorialWord].hint2,
                    tutorialHints[tutorialWord].hint3
                ].filter(Boolean);
                if (allHints.length > 0) {
                    baseText += `<br><br><strong>Hint for the word:</strong> ${allHints.join('. ')}.`;
                }
            }
            return baseText;
        }
    },
    gameOver: {
        icon: '🎉',
        title: 'Game Over!',
        getText: () => {
            return 'Great job completing the tutorial! You now know how to play Cardle. Try a real match to test your skills!';
        }
    }
};

// Tutorial message queue system
let tutorialMessageQueue = [];
let isShowingTutorialMessage = false;

function queueTutorialMessage(messageKey) {
    if (!window.tutorialMode) {
        console.log('Tutorial message requested but tutorial mode is off');
        return;
    }
    
    // Don't queue if already shown
    if (window.tutorialMessagesShown?.has(messageKey)) {
        console.log('Tutorial message already shown:', messageKey);
        return;
    }
    
    console.log('Queueing tutorial message:', messageKey);
    tutorialMessageQueue.push(messageKey);
    
    // If no message is currently showing, show the next one
    if (!isShowingTutorialMessage) {
        showNextTutorialMessage();
    }
}

function showNextTutorialMessage() {
    if (tutorialMessageQueue.length === 0) {
        isShowingTutorialMessage = false;
        return;
    }
    
    if (isShowingTutorialMessage) {
        return; // Already showing a message, wait for user to click
    }
    
    const messageKey = tutorialMessageQueue.shift();
    const message = tutorialMessages[messageKey];
    
    if (!message) {
        console.error('Tutorial message not found:', messageKey);
        showNextTutorialMessage(); // Try next message
        return;
    }
    
    // Mark as shown
    if (window.tutorialMessagesShown) {
        window.tutorialMessagesShown.add(messageKey);
    }
    
    isShowingTutorialMessage = true;
    const text = typeof message.getText === 'function' ? message.getText() : message.text;
    console.log('Showing tutorial message:', messageKey);
    
    // Show message with custom button handler
    showTutorialMessageWithCallback(message.icon, message.title, text, () => {
        isShowingTutorialMessage = false;
        // Show next message in queue
        showNextTutorialMessage();
    });
}

function showTutorialMessageWithCallback(icon, title, text, onClose) {
    const overlay = document.getElementById('gameMessage');
    const iconEl = document.getElementById('gameMessageIcon');
    const titleEl = document.getElementById('gameMessageTitle');
    const textEl = document.getElementById('gameMessageText');
    const buttonEl = document.getElementById('gameMessageButton');
    
    if (!overlay || !iconEl || !titleEl || !textEl || !buttonEl) {
        console.error('Game message elements not found');
        if (onClose) onClose();
        return;
    }
    
    // Set content
    iconEl.textContent = icon || '🎮';
    titleEl.textContent = title || 'Game Message';
    textEl.innerHTML = text || '';
    
    // Set button text based on whether there are more messages
    const hasMoreMessages = tutorialMessageQueue.length > 0;
    buttonEl.textContent = hasMoreMessages ? 'Next' : 'Got it!';
    
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
            if (onClose) onClose();
        }, 300);
    };
    
    // Button click - remove old handlers and add new one
    buttonEl.onclick = closeMessage;
}

function showTutorialMessage(messageKey) {
    queueTutorialMessage(messageKey);
}

// Help button event listeners
document.getElementById('helpBtn').addEventListener('click', openHelp);
document.getElementById('closeHelpBtn').addEventListener('click', closeHelp);
document.getElementById('closeHelpBtnBottom').addEventListener('click', closeHelp);

// Rank Ladder Popup
function openRankLadder() {
    const rankLadderOverlay = document.getElementById('rankLadderOverlay');
    if (rankLadderOverlay) {
        rankLadderOverlay.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
        // Regenerate ladder to ensure current rank is highlighted
        generateRankLadder();
    }
}

function closeRankLadder() {
    const rankLadderOverlay = document.getElementById('rankLadderOverlay');
    if (rankLadderOverlay) {
        rankLadderOverlay.style.display = 'none';
        document.body.style.overflow = ''; // Restore scrolling
    }
}

// Add event listeners for rank ladder (wait for DOM to be ready)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const currentRankCard = document.getElementById('currentRankCard');
        if (currentRankCard) {
            currentRankCard.addEventListener('click', openRankLadder);
        }

        const closeRankLadderBtn = document.getElementById('closeRankLadderBtn');
        if (closeRankLadderBtn) {
            closeRankLadderBtn.addEventListener('click', closeRankLadder);
        }

        // Close rank ladder when clicking outside
        const rankLadderOverlay = document.getElementById('rankLadderOverlay');
        if (rankLadderOverlay) {
            rankLadderOverlay.addEventListener('click', (e) => {
                if (e.target.id === 'rankLadderOverlay') {
                    closeRankLadder();
                }
            });
        }
    });
} else {
    // DOM already loaded
    const currentRankCard = document.getElementById('currentRankCard');
    if (currentRankCard) {
        currentRankCard.addEventListener('click', openRankLadder);
    }

    const closeRankLadderBtn = document.getElementById('closeRankLadderBtn');
    if (closeRankLadderBtn) {
        closeRankLadderBtn.addEventListener('click', closeRankLadder);
    }

    // Close rank ladder when clicking outside
    const rankLadderOverlay = document.getElementById('rankLadderOverlay');
    if (rankLadderOverlay) {
        rankLadderOverlay.addEventListener('click', (e) => {
            if (e.target.id === 'rankLadderOverlay') {
                closeRankLadder();
            }
        });
    }
}

// Start Tutorial button
document.getElementById('startTutorialBtn').addEventListener('click', async () => {
    const name = getPlayerName();
    if (!name) {
        showGameMessage('⚠️', 'Name Required', 'Please enter your name first');
        return;
    }
    
    closeHelp();
    
    // Get Firebase UID if available
    const firebaseUid = window.firebaseAuth?.currentUser?.uid || null;
    
    console.log('Starting tutorial for player:', name, 'firebaseUid:', firebaseUid);
    
    // Check if socket is connected
    if (!socket || !socket.connected) {
        showGameMessage('⚠️', 'Connection Error', 'Not connected to server. Please refresh the page.');
        return;
    }
    
    // Emit tutorial start event
    socket.emit('startTutorial', { 
        playerName: name,
        firebaseUid: firebaseUid
    });
    
    // Show loading message
    showGameMessage('🎓', 'Starting Tutorial', 'Setting up your practice game...', 0);
    
    // Set a timeout to show error if game doesn't start
    setTimeout(() => {
        if (!gameState || !gameState.gameId) {
            showGameMessage('⚠️', 'Tutorial Error', 'Failed to start tutorial. Please try again.');
        }
    }, 10000);
});

// Close help when clicking outside the modal
document.getElementById('helpOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'helpOverlay') {
        closeHelp();
    }
});

// Friends functionality
// Store friends list and activity status
let friendsListData = [];
let friendsActivityStatus = {}; // Map of friendId -> { isActive: boolean, gameId: string }

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
        
        // Store friends list data
        friendsListData = friendsWithDetails;
        
        // Sort and render friends list
        sortAndRenderFriendsList();
        renderFriendRequests(requestsWithDetails);
        
        // Check which friends are in games
        checkFriendsInGames(friendsWithDetails);
    } catch (error) {
        console.error('Error loading friends:', error);
        renderFriendsList([]);
        renderFriendRequests([]);
    }
}

// Sort friends by activity status (active first) and render
function sortAndRenderFriendsList() {
    // Sort friends: active first, then inactive
    const sortedFriends = [...friendsListData].sort((a, b) => {
        const aActive = friendsActivityStatus[a.id]?.isActive || false;
        const bActive = friendsActivityStatus[b.id]?.isActive || false;
        
        if (aActive && !bActive) return -1; // a is active, b is not - a comes first
        if (!aActive && bActive) return 1;  // b is active, a is not - b comes first
        return 0; // Both have same status, maintain original order
    });
    
    renderFriendsList(sortedFriends);
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
    // Update friends list to show eye icons for friends in games and sort by online status
    console.log('friendsInGames received:', data);
    const friendsList = document.getElementById('friendsList');
    if (!friendsList) {
        console.log('friendsInGames: friendsList not found');
        return;
    }
    
    // Update activity status for all friends based on online status
    // First, mark all friends as inactive
    friendsListData.forEach(friend => {
        if (!friendsActivityStatus[friend.id]) {
            friendsActivityStatus[friend.id] = { isActive: false, gameId: null };
        }
    });
    
    // Update status based on online status (not just in games)
    if (data.friendsOnline) {
        Object.keys(data.friendsOnline).forEach(friendId => {
            const isOnline = data.friendsOnline[friendId] === true;
            friendsActivityStatus[friendId] = {
                isActive: isOnline,
                gameId: data.friendsInGames?.[friendId]?.gameId || null
            };
        });
    }
    
    // If no friendsOnline data, mark all as inactive
    if (!data.friendsOnline || Object.keys(data.friendsOnline).length === 0) {
        friendsListData.forEach(friend => {
            friendsActivityStatus[friend.id] = { isActive: false, gameId: null };
        });
    }
    
    console.log('friendsInGames: Updating UI with', Object.values(friendsActivityStatus).filter(s => s.isActive).length, 'friends online');
    
    // Re-sort and re-render friends list with updated activity status
    sortAndRenderFriendsList();
    
    // Update online indicators and spectate buttons for all friend items
    const friendItems = friendsList.querySelectorAll('.friend-item');
    console.log('friendsInGames: Found', friendItems.length, 'friend items in DOM');
    
    friendItems.forEach(item => {
        const friendId = item.dataset.friendId;
        if (!friendId) {
            console.log('friendsInGames: Friend item missing friendId');
            return;
        }
        
        // Update online indicator
        const onlineIndicator = item.querySelector('.friend-online-indicator');
        const isActive = friendsActivityStatus[friendId]?.isActive || false;
        if (onlineIndicator) {
            onlineIndicator.className = `friend-online-indicator ${isActive ? 'online' : 'offline'}`;
            onlineIndicator.title = isActive ? 'Online' : 'Offline';
        }
        
        // Update challenge button visibility
        const challengeBtn = item.querySelector('.challenge-btn');
        if (challengeBtn) {
            challengeBtn.style.display = isActive ? 'flex' : 'none';
        }
        
        // Check if this friend is in a game
        const gameInfo = data.friendsInGames?.[friendId];
        console.log('friendsInGames: Friend', friendId, 'gameInfo:', gameInfo);
        
        let spectateBtn = item.querySelector('.spectate-btn');
        
        if (gameInfo && (gameInfo.status === 'playing' || gameInfo.status === 'waiting')) {
            // Show spectate button if friend is in a game
            if (!spectateBtn) {
                const statusIndicators = item.querySelector('.friend-status-indicators');
                if (statusIndicators) {
                    spectateBtn = document.createElement('button');
                    spectateBtn.className = 'spectate-btn';
                    spectateBtn.innerHTML = '<span class="btn-icon">👁️</span>';
                    spectateBtn.title = 'Spectate Game';
                    // Insert after online indicator
                    statusIndicators.insertBefore(spectateBtn, challengeBtn);
                    console.log('friendsInGames: Created spectate button for', friendId);
                }
            }
            if (spectateBtn) {
                spectateBtn.dataset.gameId = gameInfo.gameId;
                spectateBtn.onclick = () => spectateFriendGame(friendId, gameInfo.gameId);
                spectateBtn.style.display = 'flex';
                console.log('friendsInGames: Showing spectate button for', friendId, 'game:', gameInfo.gameId);
            }
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
    
    friendsList.innerHTML = friends.map(friend => {
        const isActive = friendsActivityStatus[friend.id]?.isActive || false;
        return `
        <div class="friend-item" data-friend-id="${friend.id || ''}" data-friend-name="${friend.name || 'Unknown'}" data-friend-email="${friend.email || ''}">
            <div class="friend-avatar">${friend.name ? friend.name.charAt(0).toUpperCase() : '👤'}</div>
            <div class="friend-info">
                <div class="friend-name-container">
                    <div class="friend-name">${friend.name || 'Unknown'}</div>
                    <div class="friend-status-indicators">
                        <button class="challenge-btn" style="display: ${isActive ? 'flex' : 'none'};" onclick="challengeFriend('${friend.id || ''}', '${friend.name || 'Unknown'}', event)" title="Challenge Friend">
                            <span class="btn-icon">⚔️</span>
                        </button>
                        <button class="spectate-btn" style="display: none;" onclick="spectateFriendGame('${friend.id || ''}', '')" title="Spectate Game">
                            <span class="btn-icon">👁️</span>
                        </button>
                        <div class="friend-online-indicator ${isActive ? 'online' : 'offline'}" title="${isActive ? 'Online' : 'Offline'}"></div>
                    </div>
                </div>
                <div class="friend-status">${friend.email || ''}</div>
            </div>
        </div>
    `;
    }).join('');
    
    // Add click handlers to friend items
    friendsList.querySelectorAll('.friend-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't trigger if clicking on spectate button or challenge button
            if (e.target.closest('.spectate-btn') || e.target.closest('.challenge-btn')) {
                return;
            }
            const friendId = item.dataset.friendId;
            const friendName = item.dataset.friendName;
            const friendEmail = item.dataset.friendEmail;
            if (friendId) {
                openFriendStats(friendId, friendName, friendEmail);
            }
        });
    });
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

// Fetch friend stats from Firestore
async function getFriendStats(friendId) {
    if (!window.firebaseDb || !friendId) {
        console.warn('Firebase not available or friend ID missing');
        return getDefaultStats();
    }
    
    try {
        const statsDoc = await window.firebaseDb.collection('stats').doc(friendId).get();
        if (statsDoc.exists) {
            return statsDoc.data();
        } else {
            // No stats yet, return defaults
            return getDefaultStats();
        }
    } catch (error) {
        console.error('Error loading friend stats from Firestore:', error);
        return getDefaultStats();
    }
}

// Open friend stats popup
async function openFriendStats(friendId, friendName, friendEmail) {
    const overlay = document.getElementById('friendStatsOverlay');
    if (!overlay) return;
    
    // Show loading state
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    // Set friend name
    const nameEl = document.getElementById('friendStatsName');
    if (nameEl) {
        nameEl.textContent = friendName || 'Friend Stats';
    }
    
    // Set avatar
    const avatarEl = document.getElementById('friendStatsAvatar');
    if (avatarEl) {
        avatarEl.textContent = friendName ? friendName.charAt(0).toUpperCase() : '👤';
    }
    
    // Fetch and display stats
    try {
        const stats = await getFriendStats(friendId);
        
        // Calculate rank
        const chipPoints = stats.chipPoints !== undefined && stats.chipPoints !== null ? stats.chipPoints : 0;
        const rank = getRankFromChips(chipPoints);
        
        // Display rank
        const rankEl = document.getElementById('friendStatsRank');
        if (rankEl) {
            rankEl.textContent = `${rank.tier} ${rank.subRank}`;
            rankEl.style.color = rank.color;
        }
        
        // Display all stats
        const chipsEl = document.getElementById('friendStatChips');
        if (chipsEl) chipsEl.textContent = Math.round(chipPoints);
        
        const gamesPlayedEl = document.getElementById('friendStatGamesPlayed');
        if (gamesPlayedEl) gamesPlayedEl.textContent = stats.gamesPlayed || 0;
        
        const winsEl = document.getElementById('friendStatWins');
        if (winsEl) winsEl.textContent = stats.wins || 0;
        
        const lossesEl = document.getElementById('friendStatLosses');
        if (lossesEl) lossesEl.textContent = stats.losses || 0;
        
        const winRateEl = document.getElementById('friendStatWinRate');
        if (winRateEl) {
            if (stats.gamesPlayed > 0) {
                const winRate = Math.round((stats.wins / stats.gamesPlayed) * 100);
                winRateEl.textContent = winRate + '%';
            } else {
                winRateEl.textContent = '0%';
            }
        }
        
        const avgGuessesEl = document.getElementById('friendStatAvgGuesses');
        if (avgGuessesEl) {
            if (stats.gamesWithGuesses > 0) {
                const avgGuesses = (stats.totalGuesses / stats.gamesWithGuesses).toFixed(1);
                avgGuessesEl.textContent = avgGuesses;
            } else {
                avgGuessesEl.textContent = '-';
            }
        }
        
        const winStreakEl = document.getElementById('friendStatWinStreak');
        if (winStreakEl) {
            const winStreak = stats.winStreak !== undefined && stats.winStreak !== null ? stats.winStreak : 0;
            winStreakEl.textContent = winStreak;
        }
        
        const bestWinStreakEl = document.getElementById('friendStatBestWinStreak');
        if (bestWinStreakEl) {
            const bestWinStreak = stats.bestWinStreak !== undefined && stats.bestWinStreak !== null ? stats.bestWinStreak : 0;
            bestWinStreakEl.textContent = bestWinStreak;
        }
    } catch (error) {
        console.error('Error loading friend stats:', error);
    }
}

// Close friend stats popup
function closeFriendStats() {
    const overlay = document.getElementById('friendStatsOverlay');
    if (overlay) {
        overlay.style.display = 'none';
        document.body.style.overflow = '';
    }
}

async function searchFriend() {
    const searchInput = document.getElementById('friendSearchInput');
    if (!searchInput || !searchInput.value.trim()) {
        showGameMessage('⚠️', 'Search Required', 'Please enter a username or email to search');
        return;
    }
    
    const searchTerm = searchInput.value.trim().toLowerCase();
    
    if (!currentUser || !window.firebaseDb) {
        showGameMessage('⚠️', 'Sign In Required', 'You must be logged in to search for friends');
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
        showGameMessage('⚠️', 'Search Error', `Error searching for friend: ${error.message || 'Unknown error'}. Please check the console for details.`);
    }
}

async function sendFriendRequest(foundUserId, foundUserName) {
    if (!currentUser || !window.firebaseDb) {
        showGameMessage('⚠️', 'Sign In Required', 'You must be logged in to send friend requests');
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
            showGameMessage('ℹ️', 'Already Friends', 'You are already friends with this user');
            return;
        }
        
        if (pendingRequest) {
            showGameMessage('ℹ️', 'Request Pending', 'A friend request already exists between you and this user');
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
        
        showGameMessage('✅', 'Friend Request Sent', `Friend request sent to ${foundUserName}`, 3000);
        
        // Reload friends list to show the new request
        loadFriends();
        
        return Promise.resolve();
    } catch (error) {
        console.error('Error sending friend request:', error);
        showGameMessage('⚠️', 'Error', 'Error sending friend request. Please try again.');
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
        showGameMessage('⚠️', 'Error', 'Error accepting friend request. Please try again.');
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
        showGameMessage('⚠️', 'Error', 'Error rejecting friend request. Please try again.');
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

// Challenge a friend
async function challengeFriend(friendFirebaseUid, friendName, event) {
    // Prevent event propagation to avoid triggering friend stats popup
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    
    if (!socket || !socket.connected) {
        showGameMessage('⚠️', 'Connection Error', 'Not connected to server. Please refresh the page.');
        return;
    }
    
    if (!currentUser || !currentUser.uid) {
        showGameMessage('⚠️', 'Sign In Required', 'You must be signed in to challenge friends.');
        return;
    }
    
    const playerName = getPlayerName();
    if (!playerName) {
        showGameMessage('⚠️', 'Name Required', 'Please enter your name first');
        return;
    }
    
    console.log('Challenging friend:', friendFirebaseUid, friendName);
    const challengerPhotoURL = currentUser ? currentUser.photoURL : null;
    // Try to get target photoURL from Firestore
    let targetPhotoURL = null;
    if (window.firebaseDb && friendFirebaseUid) {
        try {
            const targetUserDoc = await window.firebaseDb.collection('users').doc(friendFirebaseUid).get();
            if (targetUserDoc.exists) {
                targetPhotoURL = targetUserDoc.data().photoURL || null;
            }
        } catch (error) {
            console.error('Error fetching target photoURL:', error);
        }
    }
    socket.emit('challengeFriend', {
        challengerFirebaseUid: currentUser.uid,
        challengerName: playerName,
        challengerPhotoURL: challengerPhotoURL,
        targetFirebaseUid: friendFirebaseUid,
        targetName: friendName,
        targetPhotoURL: targetPhotoURL
    });
    
    showGameMessage('⚔️', 'Challenge Sent', `Challenge sent to ${friendName}!`, 2000);
}

// Handle incoming challenge request
socket.on('challengeRequest', (data) => {
    console.log('Received challenge request:', data);
    const challengerName = data.challengerName || 'Unknown';
    
    const overlay = document.getElementById('challengeRequestOverlay');
    const titleEl = document.getElementById('challengeRequestTitle');
    const textEl = document.getElementById('challengeRequestText');
    const acceptBtn = document.getElementById('challengeAcceptBtn');
    const denyBtn = document.getElementById('challengeDenyBtn');
    
    if (!overlay || !titleEl || !textEl || !acceptBtn || !denyBtn) {
        console.error('Challenge popup elements not found');
        return;
    }
    
    titleEl.textContent = 'Challenge Request';
    textEl.textContent = `${challengerName} wants to challenge you to a game!`;
    
    // Store challenge data
    overlay.dataset.challengeId = data.challengeId;
    overlay.dataset.challengerFirebaseUid = data.challengerFirebaseUid;
    overlay.dataset.challengerName = data.challengerName;
    
    // Show overlay using the same pattern as gameMessage (with class, not direct display)
    overlay.classList.remove('show', 'hiding');
    void overlay.offsetWidth; // Force reflow
    overlay.classList.add('show');
    
    // Set up button handlers
    acceptBtn.onclick = () => acceptChallenge(data.challengeId, data.challengerFirebaseUid, data.challengerName);
    denyBtn.onclick = () => denyChallenge(data.challengeId);
    
    // Close on overlay click (outside content)
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            denyChallenge(data.challengeId);
        }
    };
});

// Accept challenge
function acceptChallenge(challengeId, challengerFirebaseUid, challengerName) {
    if (!socket || !socket.connected) {
        showGameMessage('⚠️', 'Connection Error', 'Not connected to server.');
        return;
    }
    
    console.log('Accepting challenge:', challengeId);
    socket.emit('acceptChallenge', { challengeId: challengeId });
    
    // Close popup with animation
    const overlay = document.getElementById('challengeRequestOverlay');
    if (overlay) {
        overlay.classList.add('hiding');
        setTimeout(() => {
            overlay.classList.remove('show', 'hiding');
            overlay.style.display = 'none';
        }, 300);
    }
    
    showGameMessage('✅', 'Challenge Accepted', `Starting game with ${challengerName}...`, 2000);
}

// Deny challenge
function denyChallenge(challengeId) {
    if (!socket || !socket.connected) {
        return;
    }
    
    console.log('Denying challenge:', challengeId);
    socket.emit('denyChallenge', { challengeId: challengeId });
    
    // Close popup with animation
    const overlay = document.getElementById('challengeRequestOverlay');
    if (overlay) {
        overlay.classList.add('hiding');
        setTimeout(() => {
            overlay.classList.remove('show', 'hiding');
            overlay.style.display = 'none';
        }, 300);
    }
}

// Handle challenge accepted (start game)
socket.on('challengeAccepted', (data) => {
    console.log('Challenge accepted, starting game:', data);
    // Close challenge popup if open
    const overlay = document.getElementById('challengeRequestOverlay');
    if (overlay) {
        overlay.classList.add('hiding');
        setTimeout(() => {
            overlay.classList.remove('show', 'hiding');
            overlay.style.display = 'none';
        }, 300);
    }
    // The game will start automatically via the normal game flow
    // Cancel any active matchmaking
    if (socket && socket.connected) {
        socket.emit('cancelMatchmaking');
    }
});

// Handle challenge denied
socket.on('challengeDenied', (data) => {
    console.log('Challenge denied:', data);
    showGameMessage('❌', 'Challenge Declined', `${data.targetName || 'Your friend'} declined the challenge.`, 3000);
});

function spectateFriendGame(friendFirebaseUid, gameId) {
    if (!socket) {
        showGameMessage('⚠️', 'Connection Error', 'Not connected to server');
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
        showGameMessage('⚠️', 'Game Not Available', 'Game information not available. Friend may have left the game.');
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
    
    // Disable all interactive elements for spectators (but keep them visible to match player view)
    const wordInput = document.getElementById('wordInput');
    const submitBtn = document.getElementById('submitBtn');
    const cardsContainer = document.getElementById('cardsContainer');
    const cardSelectionPanel = document.getElementById('cardSelection');
    const keyboard = document.getElementById('keyboard');
    
    if (wordInput) {
        wordInput.disabled = true;
        wordInput.style.pointerEvents = 'none';
        wordInput.style.opacity = '0.6';
        wordInput.placeholder = 'Spectating...';
    }
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.pointerEvents = 'none';
        submitBtn.style.opacity = '0.6';
    }
    if (cardsContainer) {
        cardsContainer.style.pointerEvents = 'none';
        cardsContainer.style.opacity = '0.6';
    }
    if (cardSelectionPanel) {
        cardSelectionPanel.style.display = 'none'; // Hide card selection (not part of normal view)
    }
    if (keyboard) {
        // Disable keyboard clicks but keep it visible
        const keyboardButtons = keyboard.querySelectorAll('button');
        keyboardButtons.forEach(btn => {
            btn.disabled = true;
            btn.style.pointerEvents = 'none';
            btn.style.opacity = '0.6';
        });
    }
    
    // Show hand panel for spectators (will be populated when hand is received)
    const handPanel = document.querySelector('.hand-panel');
    if (handPanel) {
        handPanel.style.display = 'block';
        // Initialize empty hand for spectator
        window.spectatedPlayerHand = [];
        updateSpectatorHandPanel();
    }
    
    // Set currentPlayer to spectated player ID so the view matches exactly
    if (window.spectatedPlayerId) {
        currentPlayer = window.spectatedPlayerId;
    }
}

// Store spectated player's hand
window.spectatedPlayerHand = [];

// Update hand panel for spectators
function updateSpectatorHandPanel() {
    const handCardsContainer = document.getElementById('handCards');
    const nextCardContainer = document.getElementById('nextCardContainer');
    
    if (!handCardsContainer || !nextCardContainer) {
        return;
}
    
    // Clear existing content
    handCardsContainer.innerHTML = '';
    
    // Display spectated player's hand (up to 3 cards)
    if (window.spectatedPlayerHand && window.spectatedPlayerHand.length > 0) {
        window.spectatedPlayerHand.slice(0, 3).forEach((card) => {
            const cardElement = document.createElement('div');
            cardElement.className = 'hand-card-item';
            cardElement.style.pointerEvents = 'none'; // Disable interaction
            cardElement.style.opacity = '0.8'; // Slightly dimmed to show it's not interactive
            
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
        emptyState.innerHTML = '<div class="hand-card-description">Loading hand...</div>';
        handCardsContainer.appendChild(emptyState);
    }
    
    // Don't show next card for spectators (they don't need to know)
    nextCardContainer.innerHTML = '';
}

// Listen for spectated player's hand
socket.on('spectatedPlayerHand', (data) => {
    if (window.isSpectator && data.gameId === window.spectatorGameId && data.playerId === window.spectatedPlayerId) {
        window.spectatedPlayerHand = data.cards || [];
        updateSpectatorHandPanel();
    }
});

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
        
        // If the spectated player played a card, remove it from their hand and request updated hand
        if (data.playerId === window.spectatedPlayerId && window.spectatedPlayerHand) {
            // Remove the played card from hand (find by ID)
            const cardIndex = window.spectatedPlayerHand.findIndex(c => c.id === data.card.id);
            if (cardIndex !== -1) {
                window.spectatedPlayerHand.splice(cardIndex, 1);
                updateSpectatorHandPanel();
            }
            
            // Request updated hand from spectated player after a short delay (to allow card draw)
            setTimeout(() => {
                if (window.isSpectator && window.spectatorGameId && window.spectatedPlayerId) {
                    // Request hand update through server
                    socket.emit('requestHandForSpectatorUpdate', {
                        gameId: window.spectatorGameId,
                        spectatedPlayerId: window.spectatedPlayerId
                    });
                }
            }, 500);
        }
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
    
    // Friend stats popup event listeners
    const closeFriendStatsBtn = document.getElementById('closeFriendStatsBtn');
    if (closeFriendStatsBtn) {
        closeFriendStatsBtn.addEventListener('click', closeFriendStats);
    }
    
    const friendStatsOverlay = document.getElementById('friendStatsOverlay');
    if (friendStatsOverlay) {
        friendStatsOverlay.addEventListener('click', (e) => {
            if (e.target.id === 'friendStatsOverlay') {
                closeFriendStats();
            }
        });
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
    
    // Profile picture change functionality
    const editPictureBtn = document.getElementById('editPictureBtn');
    const savePictureBtn = document.getElementById('savePictureBtn');
    const cancelPictureBtn = document.getElementById('cancelPictureBtn');
    const pictureUrlInput = document.getElementById('pictureUrlInput');
    const pictureFileInput = document.getElementById('pictureFileInput');
    const pictureFileInputForm = document.getElementById('pictureFileInputForm');
    const pictureError = document.getElementById('pictureError');
    const pictureSuccess = document.getElementById('pictureSuccess');
    const pictureSection = document.getElementById('profilePictureSection');
    
    if (editPictureBtn) {
        editPictureBtn.addEventListener('click', () => {
            if (pictureSection) {
                pictureSection.style.display = 'block';
                // Set current photoURL as placeholder
                if (pictureUrlInput && currentUser) {
                    pictureUrlInput.value = '';
                    pictureUrlInput.placeholder = currentUser.photoURL ? `Current: ${currentUser.photoURL}` : 'Enter image URL';
                    setTimeout(() => pictureUrlInput.focus(), 100);
                }
            }
        });
    }
    
    // Handle file input change (direct upload)
    if (pictureFileInput) {
        pictureFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleFileUpload(file);
            }
        });
    }
    
    // Handle file input from form
    if (pictureFileInputForm) {
        pictureFileInputForm.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                // Validate file type
                if (!file.type.startsWith('image/')) {
                    if (pictureError) {
                        pictureError.textContent = 'Please select an image file';
                        pictureError.style.display = 'block';
                    }
                    pictureFileInputForm.value = '';
                    return;
                }
                
                // Validate file size (max 5MB)
                if (file.size > 5 * 1024 * 1024) {
                    if (pictureError) {
                        pictureError.textContent = 'File size must be less than 5MB';
                        pictureError.style.display = 'block';
                    }
                    pictureFileInputForm.value = '';
                    return;
                }
                
                // Clear any previous errors
                if (pictureError) pictureError.style.display = 'none';
                
                // Convert file to data URL and set in URL input
                const reader = new FileReader();
                reader.onload = (event) => {
                    if (pictureUrlInput) {
                        pictureUrlInput.value = event.target.result;
                        // Show success message that file is ready
                        if (pictureSuccess) {
                            pictureSuccess.textContent = 'File loaded! Click Save to update your profile picture.';
                            pictureSuccess.style.display = 'block';
                        }
                    }
                };
                reader.onerror = () => {
                    if (pictureError) {
                        pictureError.textContent = 'Error reading file. Please try again.';
                        pictureError.style.display = 'block';
                    }
                };
                reader.readAsDataURL(file);
            }
        });
    }
    
    if (savePictureBtn) {
        savePictureBtn.addEventListener('click', handleChangePicture);
    }
    
    if (cancelPictureBtn) {
        cancelPictureBtn.addEventListener('click', () => {
            if (pictureSection) {
                pictureSection.style.display = 'none';
            }
            if (pictureUrlInput) {
                pictureUrlInput.value = '';
            }
            if (pictureFileInputForm) {
                pictureFileInputForm.value = '';
            }
            if (pictureError) pictureError.style.display = 'none';
            if (pictureSuccess) pictureSuccess.style.display = 'none';
        });
    }
    
    if (pictureUrlInput) {
        pictureUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleChangePicture();
            } else if (e.key === 'Escape') {
                if (cancelPictureBtn) cancelPictureBtn.click();
            }
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

document.getElementById('joinWithIdBtn').addEventListener('click', async () => {
    const name = getPlayerName();
    const gameId = document.getElementById('gameIdInput').value.trim();
    if (name && gameId) {
        // Cancel matchmaking if active
        socket.emit('cancelMatchmaking');
        
        // Ensure decks are loaded before joining game
        // Clear cache to ensure fresh data
        cachedDecks = null;
        await getAllDecks();
        
        // Double-check that deck is actually loaded
        const testDeck = await getPlayerDeck();
        if (!testDeck || testDeck.length === 0) {
            console.error('Deck is empty after loading!');
            showGameMessage('⚠️', 'Deck Error', 'Your deck could not be loaded. Please check your deck in the lobby.');
            setTimeout(() => {
                switchTab('deck');
            }, 100);
            return;
        }
        
        // Validate deck before joining game
        const validation = validateDeckForGame();
        if (!validation.valid) {
            showGameMessage('⚠️', 'Incomplete Deck', validation.message);
            // Switch to deck tab so user can fix their deck (delay to ensure popup is visible)
            setTimeout(() => {
                switchTab('deck');
            }, 100);
            return;
        }
        
        const firebaseUid = currentUser ? currentUser.uid : null;
        const photoURL = window.currentUserPhotoURL || (currentUser ? currentUser.photoURL : null);
        socket.emit('joinGame', { playerName: name, gameId: gameId, firebaseUid: firebaseUid, photoURL: photoURL });
    } else {
        showGameMessage('⚠️', 'Sign In Required', 'Please sign in and enter a game ID');
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
                showGameMessage('⚠️', 'Rematch Error', 'Unable to rematch: Game ID not found');
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
        showGameMessage('⚠️', "Not Your Turn", "It's not your turn!");
        return;
    }
    
    // Allow submitting without a card if player is card locked
    const locked = isCardLocked();
    if (!selectedCard && !locked) {
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        showGameMessage('⚠️', 'No Card Selected', 'Please select a card first!');
        return;
    }
    
    // Can't submit if we're in a card chain (modifier card selected but no final card)
    if (cardChainActive && selectedCard && isModifierCard(selectedCard.id)) {
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        showGameMessage('⚠️', 'Complete Chain', 'Please select a final card to complete the chain!');
        return;
    }
    
    const guess = document.getElementById('wordInput').value.toUpperCase();
    
    if (guess.length !== 5) {
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        showGameMessage('⚠️', 'Invalid Word', 'Please enter a 5-letter word');
        return;
    }
    
    // Play submit sound
    if (typeof soundManager !== 'undefined') {
        soundManager.playWordSubmit();
    }
    
    // Store the guess and card before sending (in case we need to restore on error)
    const submittedGuess = guess;
    const submittedCard = selectedCard;
    const submittedCardChain = cardChainActive;
    
    socket.emit('submitGuess', {
        gameId: gameState.gameId,
        playerId: currentPlayer,
        guess: guess,
        card: selectedCard
    });
    
    // Don't clear input/card immediately - wait for server confirmation
    // This allows the player to fix their guess if it's invalid
    // The input/card will be cleared when guessSubmitted event is received
}

// Username change functionality
async function checkUsernameAvailable(username) {
    if (!window.firebaseDb || !currentUser) {
        return { available: false, message: 'Not authenticated' };
    }
    
    const trimmedUsername = username.trim().toLowerCase();
    
    // Validate username format
    const usernameRegex = /^[a-zA-Z0-9_-]{3,12}$/;
    if (!usernameRegex.test(trimmedUsername)) {
        return { 
            available: false, 
            message: 'Username must be 3-12 characters and contain only letters, numbers, underscores, or hyphens' 
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

// Profile picture change functionality
async function handleChangePicture() {
    const pictureUrlInput = document.getElementById('pictureUrlInput');
    const pictureError = document.getElementById('pictureError');
    const pictureSuccess = document.getElementById('pictureSuccess');
    const savePictureBtn = document.getElementById('savePictureBtn');
    const pictureSection = document.getElementById('profilePictureSection');
    
    if (!pictureUrlInput || !currentUser || !window.firebaseAuth || !window.firebaseDb) {
        if (pictureError) {
            pictureError.textContent = 'Please sign in to change your profile picture';
            pictureError.style.display = 'block';
        }
        return;
    }
    
    let newPhotoURL = pictureUrlInput.value.trim();
    
    // If empty, check if there's a file selected and convert it
    if (!newPhotoURL) {
        const pictureFileInputForm = document.getElementById('pictureFileInputForm');
        if (pictureFileInputForm && pictureFileInputForm.files && pictureFileInputForm.files[0]) {
            const file = pictureFileInputForm.files[0];
            
            // Validate file type
            if (!file.type.startsWith('image/')) {
                if (pictureError) {
                    pictureError.textContent = 'Please select an image file';
                    pictureError.style.display = 'block';
                }
                if (pictureSuccess) pictureSuccess.style.display = 'none';
                return;
            }
            
            // Validate file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                if (pictureError) {
                    pictureError.textContent = 'File size must be less than 5MB';
                    pictureError.style.display = 'block';
                }
                if (pictureSuccess) pictureSuccess.style.display = 'none';
                return;
            }
            
            // Convert file to data URL
            try {
                newPhotoURL = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (event) => resolve(event.target.result);
                    reader.onerror = () => reject(new Error('Failed to read file'));
                    reader.readAsDataURL(file);
                });
                
                // Update the input field with the data URL
                if (pictureUrlInput) {
                    pictureUrlInput.value = newPhotoURL;
                }
            } catch (error) {
                console.error('Error converting file to data URL:', error);
                if (pictureError) {
                    pictureError.textContent = 'Error processing file. Please try again.';
                    pictureError.style.display = 'block';
                }
                if (pictureSuccess) pictureSuccess.style.display = 'none';
                return;
            }
        } else {
            // No URL and no file selected
            if (pictureError) {
                pictureError.textContent = 'Please enter an image URL or upload a file';
                pictureError.style.display = 'block';
            }
            if (pictureSuccess) pictureSuccess.style.display = 'none';
            return;
        }
    }
    
    // Validate URL format (skip validation for data URLs)
    if (newPhotoURL && !newPhotoURL.startsWith('data:image/') && !isValidImageUrl(newPhotoURL)) {
        if (pictureError) {
            pictureError.textContent = 'Please enter a valid image URL (must start with http:// or https://) or upload a file';
            pictureError.style.display = 'block';
        }
        if (pictureSuccess) pictureSuccess.style.display = 'none';
        return;
    }
    
    // Disable button during update
    if (savePictureBtn) {
        savePictureBtn.disabled = true;
        savePictureBtn.innerHTML = '<span>Saving...</span>';
    }
    
    try {
        // If data URL, skip Auth update (Auth may reject long/embedded URLs). Store in Firestore only.
        const isDataUrl = !!(newPhotoURL && newPhotoURL.startsWith('data:image/'));
        if (!isDataUrl) {
            // Try to update Firebase Auth photoURL for http(s) URLs
            await window.firebaseAuth.currentUser.updateProfile({
                photoURL: newPhotoURL || null
            });
        }
        // Always persist to Firestore (source of truth for avatars)
        await window.firebaseDb.collection('users').doc(currentUser.uid).set({
            photoURL: newPhotoURL || null,
            photoURLUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        // Update local override immediately without waiting for reload
        window.currentUserPhotoURL = newPhotoURL || null;
        
        // Reload user (best effort) to refresh Auth photoURL if we set it
        try {
            await window.firebaseAuth.currentUser.reload();
            currentUser = window.firebaseAuth.currentUser;
        } catch (_) {}
        
        // Update UI
        updateLobbyUserInfo();
        
        // Show success message
        if (pictureSuccess) {
            pictureSuccess.textContent = newPhotoURL ? 'Profile picture updated successfully!' : 'Profile picture removed successfully!';
            pictureSuccess.style.display = 'block';
        }
        if (pictureError) pictureError.style.display = 'none';
        
        // Clear inputs and hide form after a delay
        pictureUrlInput.value = '';
        const pictureFileInputForm = document.getElementById('pictureFileInputForm');
        if (pictureFileInputForm) {
            pictureFileInputForm.value = '';
        }
        
        // Re-enable button
        if (savePictureBtn) {
            savePictureBtn.disabled = false;
            savePictureBtn.innerHTML = '<span class="btn-icon">✓</span><span>Save</span>';
        }
        
        // Hide form and success message after 2 seconds
        setTimeout(() => {
            if (pictureSection) {
                pictureSection.style.display = 'none';
            }
            if (pictureSuccess) pictureSuccess.style.display = 'none';
        }, 2000);
        
    } catch (error) {
        console.error('Error updating profile picture:', error);
        console.error('Error details:', error.code, error.message);
        
        let errorMessage = 'Failed to update profile picture. Please try again.';
        
        // Provide more specific error messages
        if (error.code === 'auth/invalid-photo-url') {
            errorMessage = 'Invalid image URL. Please use a valid image URL or upload a file.';
        } else if (error.message && error.message.includes('photoURL')) {
            errorMessage = 'The image URL is too long or invalid. Please try a smaller image or a different URL.';
        }
        
        if (pictureError) {
            pictureError.textContent = errorMessage;
            pictureError.style.display = 'block';
        }
        if (pictureSuccess) pictureSuccess.style.display = 'none';
        
        // Re-enable button
        if (savePictureBtn) {
            savePictureBtn.disabled = false;
            savePictureBtn.innerHTML = '<span class="btn-icon">✓</span><span>Save</span>';
        }
    }
}

function isValidImageUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
        return false;
    }
}

// Handle direct file upload (when clicking edit button)
async function handleFileUpload(file) {
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
        const pictureError = document.getElementById('pictureError');
        if (pictureError) {
            pictureError.textContent = 'Please select an image file';
            pictureError.style.display = 'block';
        }
        return;
    }
    
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        const pictureError = document.getElementById('pictureError');
        if (pictureError) {
            pictureError.textContent = 'File size must be less than 5MB';
            pictureError.style.display = 'block';
        }
        return;
    }
    
    const pictureError = document.getElementById('pictureError');
    const pictureSuccess = document.getElementById('pictureSuccess');
    
    if (pictureError) pictureError.style.display = 'none';
    
    try {
        // Convert file to data URL
        const reader = new FileReader();
        reader.onload = async (event) => {
            const dataURL = event.target.result;
            
            if (!currentUser || !window.firebaseAuth || !window.firebaseDb) {
                if (pictureError) {
                    pictureError.textContent = 'Please sign in to change your profile picture';
                    pictureError.style.display = 'block';
                }
                return;
            }
            
            try {
                // Update Firebase Auth photoURL
                await window.firebaseAuth.currentUser.updateProfile({
                    photoURL: dataURL
                });
                
                // Update Firestore user document
                await window.firebaseDb.collection('users').doc(currentUser.uid).set({
                    photoURL: dataURL,
                    photoURLUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                
                // Reload user to get updated photoURL
                await window.firebaseAuth.currentUser.reload();
                currentUser = window.firebaseAuth.currentUser;
                
                // Update UI
                updateLobbyUserInfo();
                
                // Show success message
                if (pictureSuccess) {
                    pictureSuccess.textContent = 'Profile picture updated successfully!';
                    pictureSuccess.style.display = 'block';
                }
                if (pictureError) pictureError.style.display = 'none';
                
                // Clear file input
                const pictureFileInput = document.getElementById('pictureFileInput');
                if (pictureFileInput) {
                    pictureFileInput.value = '';
                }
                
                // Hide success message after 2 seconds
                setTimeout(() => {
                    if (pictureSuccess) pictureSuccess.style.display = 'none';
                }, 2000);
                
            } catch (error) {
                console.error('Error updating profile picture:', error);
                if (pictureError) {
                    pictureError.textContent = 'Failed to update profile picture. Please try again.';
                    pictureError.style.display = 'block';
                }
                if (pictureSuccess) pictureSuccess.style.display = 'none';
            }
        };
        
        reader.onerror = () => {
            if (pictureError) {
                pictureError.textContent = 'Error reading file. Please try again.';
                pictureError.style.display = 'block';
            }
        };
        
        reader.readAsDataURL(file);
        
    } catch (error) {
        console.error('Error handling file upload:', error);
        if (pictureError) {
            pictureError.textContent = 'Failed to process file. Please try again.';
            pictureError.style.display = 'block';
        }
    }
}


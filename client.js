// Configure Socket.io with reconnection settings
const socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    timeout: 20000,
    transports: ['websocket', 'polling']
});

// Global error handler for unhandled Firestore CORS/network errors and image loading errors
window.addEventListener('error', (event) => {
    // Suppress CORS errors from Firestore - these are often temporary network issues
    if (event.message && (
        event.message.includes('CORS') || 
        event.message.includes('firestore.googleapis.com') ||
        event.message.includes('access control checks')
    )) {
        // Silently handle - these are expected in some network configurations
        event.preventDefault();
        return true;
    }
    
    // Suppress 429 (rate limit) errors from image loading - these are temporary
    // Check for IMG elements
    if (event.target && event.target.tagName === 'IMG' && (
        event.target.src?.includes('googleusercontent.com') ||
        event.target.src?.includes('s96-c') ||
        event.target.src?.includes('s48-c') ||
        event.target.src?.includes('s128-c') ||
        event.message?.includes('429') ||
        event.filename?.includes('googleusercontent.com') ||
        event.filename?.includes('s96-c') ||
        event.filename?.includes('s48-c') ||
        event.filename?.includes('s128-c')
    )) {
        // Silently handle image rate limit errors
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    
    // Suppress resource loading errors (429) for any resource
    if (event.message && (
        event.message.includes('429') ||
        event.message.includes('Failed to load resource')
    )) {
        // Check if it's a Google profile image
        const source = event.filename || event.target?.src || event.target?.href || event.message || '';
        if (source.includes('googleusercontent.com') || 
            source.includes('s96-c') || 
            source.includes('s48-c') || 
            source.includes('s128-c') ||
            (source.includes('429') && source.includes('s96-c'))) {
            // Silently handle Google profile image rate limit errors
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
    }
    
    // Also check the error message itself for 429 with Google image patterns
    const errorMessage = event.message || event.filename || '';
    if (errorMessage.includes('429') && (
        errorMessage.includes('googleusercontent.com') ||
        errorMessage.includes('s96-c') ||
        errorMessage.includes('s48-c') ||
        errorMessage.includes('s128-c')
    )) {
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
}, true);

// Also catch unhandled promise rejections from Firestore and image loading
window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    if (error && (
        error.message?.includes('CORS') ||
        error.message?.includes('firestore.googleapis.com') ||
        error.message?.includes('access control checks') ||
        error.code === 'unavailable' ||
        error.status === 429 ||
        (typeof error === 'string' && error.includes('429')) ||
        (error.message && error.message.includes('429'))
    )) {
        // Silently handle Firestore network errors and rate limit errors
        event.preventDefault();
    }
});

// Suppress console errors for failed resource loads (429 errors from Google images)
// Note: Browser's native "Failed to load resource" errors may still appear in console
// but this will catch JavaScript-thrown errors related to image loading
const originalConsoleError = console.error;
console.error = function(...args) {
    // Filter out 429 errors for Google profile images
    const message = args.join(' ');
    if (message) {
        // Check for any combination of 429 and Google image patterns
        const has429 = message.includes('429');
        const hasGoogleImage = message.includes('googleusercontent.com') ||
                              message.includes('s96-c') ||
                              message.includes('s48-c') ||
                              message.includes('s128-c') ||
                              message.match(/s\d+-c/); // Match any sXX-c pattern
        
        // Check for "Failed to load resource" pattern
        const hasFailedToLoad = message.includes('Failed to load resource') ||
                                message.includes('the server responded with a status of 429');
        
        // Suppress if it's a 429 error related to Google images
        if (has429 && hasGoogleImage) {
            // Suppress these specific errors - they're rate limits from Google's CDN
            return;
        }
        
        // Also suppress "Failed to load resource" errors for Google images (even without explicit 429)
        if (hasFailedToLoad && hasGoogleImage) {
            return;
        }
    }
    // Call original console.error for other errors
    originalConsoleError.apply(console, args);
};

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
let turnTimeRemaining = 60; // 60 seconds per turn (will be updated from game settings)
let TURN_TIME_LIMIT = 60; // Will be updated from game settings

// State tracking to prevent duplicate event processing and freezing
let lastProcessedTurnChange = null; // Track last processed turnChange event
let turnChangeTimeoutId = null; // Track timeout to prevent conflicts
let cardSelectionTimeoutId = null; // Track card selection timeout
let isProcessingTurnChange = false; // Prevent concurrent processing

// Recovery function to ensure UI state is correct
function ensureUIStateCorrect() {
    if (!gameState || !currentPlayer) return;
    
    const wordInput = document.getElementById('wordInput');
    if (!wordInput) return;
    
    const isMyTurn = gameState.currentTurn === currentPlayer;
    const shouldBeEnabled = isMyTurn && !window.isSpectator;
    
    // If input state doesn't match turn state, fix it
    // wordInput.disabled should be !shouldBeEnabled (if shouldBeEnabled is true, disabled should be false)
    if (wordInput.disabled !== !shouldBeEnabled) {
        console.warn('UI state mismatch detected - fixing input state', {
            disabled: wordInput.disabled,
            shouldBeEnabled,
            isMyTurn,
            currentTurn: gameState.currentTurn,
            currentPlayer
        });
        wordInput.disabled = !shouldBeEnabled;
        
        // If it's my turn, ensure card selection is shown
        if (shouldBeEnabled && !document.getElementById('cardSelection')?.style.display) {
            const cardSelection = document.getElementById('cardSelection');
            if (cardSelection && cardSelection.style.display === 'none') {
                console.warn('Card selection should be visible but is hidden - fixing');
                showCardSelection();
            }
        }
    }
}

// Run recovery check periodically
let uiStateRecoveryInterval = setInterval(ensureUIStateCorrect, 2000); // Check every 2 seconds

// Clear interval on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
    // Clean up global listeners on page unload
    if (globalMessageListener) {
        globalMessageListener();
    }
    if (giftBadgeListener) {
        giftBadgeListener();
    }
    // Clean up per-conversation listeners
    Object.values(messageListeners).forEach(unsubscribe => unsubscribe());
    if (uiStateRecoveryInterval) {
        clearInterval(uiStateRecoveryInterval);
    }
});

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
        showNewCardAnnouncement();
    }, 4500);
    
    // Click to skip credits
    const creditsScreen = document.getElementById('credits');
    if (creditsScreen) {
        const skipCredits = (e) => {
            clearTimeout(creditsTimeout);
            creditsScreen.removeEventListener('click', skipCredits);
            showNewCardAnnouncement();
        };
        creditsScreen.addEventListener('click', skipCredits);
    }
}

function showNewCardAnnouncement() {
    ScreenManager.show('newCardAnnouncement');
    
    // Don't apply camo to new card announcement - show default card appearance
    const newCardFaces = document.querySelectorAll('.new-card-face');
    newCardFaces.forEach(face => {
        face.style.backgroundImage = '';
    });
    
    // Scale the announcement screen to fit after a small delay to ensure layout is complete
    setTimeout(() => {
        scaleNewCardAnnouncement();
    }, 100);
    
    // Set up mouse tracking for card rotation
    setupCardRotationTracking();
    
    // Wait for user click to continue - then return to lobby
    const announcementScreen = document.getElementById('newCardAnnouncement');
    if (announcementScreen) {
        const skipAnnouncement = (e) => {
            cleanupCardRotationTracking();
            announcementScreen.removeEventListener('click', skipAnnouncement);
            // Call showLobby() instead of just ScreenManager.show() to ensure all initialization happens
            showLobby();
        };
        announcementScreen.addEventListener('click', skipAnnouncement);
    }
}

let cardRotationTracker = null;
let continuousRotationAngle = 0;

function setupCardRotationTracking() {
    // Clean up any existing tracking first
    cleanupCardRotationTracking();
    
    // Find which card announcement screen is currently active
    const announcementScreen = document.getElementById('newCardAnnouncement');
    
    // Find the card flip inner within the active screen
    const cardFlipInner = announcementScreen ? announcementScreen.querySelector('.new-card-flip-inner') : null;
    
    if (!cardFlipInner || !announcementScreen) return;
    
    // Get center of the card container within the active screen
    const cardContainer = announcementScreen.querySelector('.new-card-container');
    if (!cardContainer) return;
    
    let continuousRotationAngle = 0;
    let currentRotationX = 0;
    let currentRotationY = 0;
    let targetRotationX = 0;
    let targetRotationY = 0;
    
    // Use time-based rotation for consistent speed regardless of frame rate
    let lastTime = performance.now();
    
    // Continuous rotation speed: 30 degrees per second (one full rotation every 12 seconds)
    const rotationSpeedPerSecond = 30;
    let animationFrameId = null;
    
    const handleMouseMove = (e) => {
        const rect = cardContainer.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        
        // Calculate angle from center to mouse (in degrees)
        const deltaX = mouseX - centerX;
        const deltaY = mouseY - centerY;
        
        // Convert to rotation angles (inverse Y for natural feel)
        // Limit the rotation range for a subtle effect
        targetRotationY = (deltaX / rect.width) * 15; // Max 15 degrees
        targetRotationX = -(deltaY / rect.height) * 15; // Max 15 degrees (inverted)
    };
    
    const handleMouseLeave = () => {
        targetRotationX = 0;
        targetRotationY = 0;
    };
    
    // Smooth animation function using time-based updates
    const animateRotation = (currentTime) => {
        // Calculate delta time for frame-rate independent rotation
        const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.1); // Cap at 0.1s to prevent jumps
        lastTime = currentTime;
        
        // Update continuous rotation angle based on time (frame-rate independent)
        continuousRotationAngle += rotationSpeedPerSecond * deltaTime;
        if (continuousRotationAngle >= 360) {
            continuousRotationAngle -= 360;
        }
        
        // Smoothly interpolate towards target rotation for mouse following
        currentRotationX += (targetRotationX - currentRotationX) * 0.1;
        currentRotationY += (targetRotationY - currentRotationY) * 0.1;
        
        // Apply continuous rotation first (rotateY for spinning), then mouse-following rotations
        // rotateY is the continuous circle rotation, rotateX is the mouse tilt
        cardFlipInner.style.transform = `rotateY(${continuousRotationAngle + currentRotationY}deg) rotateX(${currentRotationX}deg)`;
        
        animationFrameId = requestAnimationFrame(animateRotation);
    };
    
    // Initialize lastTime
    lastTime = performance.now();
    
    // Start animation loop
    animationFrameId = requestAnimationFrame(animateRotation);
    
    // Add mouse move listener
    announcementScreen.addEventListener('mousemove', handleMouseMove);
    announcementScreen.addEventListener('mouseleave', handleMouseLeave);
    
    // Store cleanup function
    cardRotationTracker = {
        handleMouseMove,
        handleMouseLeave,
        animationFrameId,
        cleanup: () => {
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            announcementScreen.removeEventListener('mousemove', handleMouseMove);
            announcementScreen.removeEventListener('mouseleave', handleMouseLeave);
        }
    };
}

function cleanupCardRotationTracking() {
    if (cardRotationTracker) {
        cardRotationTracker.cleanup();
        if (cardRotationTracker.animationFrameId !== null) {
            cancelAnimationFrame(cardRotationTracker.animationFrameId);
        }
        cardRotationTracker = null;
    }
}

// Scale new card announcement screen to fit viewport
function scaleNewCardAnnouncement() {
    const announcementScreen = document.getElementById('newCardAnnouncement');
    const scalingContainer = document.getElementById('newCardAnnouncementScalingContainer');
    
    if (!announcementScreen || !scalingContainer) return;
    
    // Use shared scaling logic
    scaleCardAnnouncementScreen(announcementScreen, scalingContainer);
}

// Shared scaling logic for card announcement screens
function scaleCardAnnouncementScreen(announcementScreen, scalingContainer) {
    if (!announcementScreen || !scalingContainer) return;
    
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
    const availableWidth = announcementScreen.clientWidth - (padding * 2);
    const availableHeight = announcementScreen.clientHeight - (padding * 2);
    
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

function showLobby() {
    // Stop intro music before showing lobby
    if (typeof soundManager !== 'undefined') {
        soundManager.stopBackgroundMusic();
    }

    // Register user as online when showing lobby
    registerUserAsOnline();
    
    // Hide game ID displays when returning to lobby
    const gameIdDisplay = document.getElementById('gameIdDisplay');
    const gameIdDisplayWaiting = document.getElementById('gameIdDisplayWaiting');
    if (gameIdDisplay) gameIdDisplay.style.display = 'none';
    if (gameIdDisplayWaiting) gameIdDisplayWaiting.style.display = 'none';

    if (ScreenManager.show('lobby')) {
        // Use setTimeout to ensure DOM is ready and screen is fully shown
        setTimeout(async () => {
            updateLobbyUserInfo();
            // Load and display stats
            updateStatsDisplay().catch(error => {
                console.error('Error loading stats:', error);
            });
            // Update rank display
            updateRankDisplay().catch(error => {
                console.error('Error loading rank:', error);
            });
            // Update header currency
            updateHeaderCurrency().catch(error => {
                console.error('Error loading header currency:', error);
            });
            // Load owned camos to cache
            await getOwnedCamos();
            // Load community posts on startup
            if (currentUser && window.firebaseDb) {
                loadCommunityPosts().catch(error => {
                    console.error('Error loading community posts:', error);
                });
            }
            // Load messages on startup
            if (currentUser && window.firebaseDb) {
                loadMessagesFriends().catch(error => {
                    console.error('Error loading messages:', error);
                });
                // Also load unread message counts on startup
                loadUnreadMessageCounts().catch(error => {
                    console.error('Error loading unread message counts:', error);
                });
                // Load packs on startup to update shop tab badge
                loadYourPacks().catch(error => {
                    console.error('Error loading packs:', error);
                });
                // Set up real-time listeners for notifications
                setupGlobalMessageListener();
                setupGiftBadgeListener(); // Lightweight listener just for badge updates
            }
        }, 100);
        
        // Generate rank ladder (doesn't need DOM elements)
        generateRankLadder();
        // Update daily bit claim UI
        updateDailyClaimUI();
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
        cachedOwnedCamos = null; // Clear owned camos cache
        // Show splash/credits then lobby
        showSplashThenLobby();
        return;
    }
    
    // Clear any pending verification data if user is not signed in (on fresh page load)
    // This ensures we start at login screen, not verification screen
    if (!window.firebaseAuth?.currentUser) {
        sessionStorage.removeItem('pendingVerificationEmail');
        sessionStorage.removeItem('pendingVerificationUid');
    }
    
    if (window.firebaseAuth) {
        window.firebaseAuth.onAuthStateChanged(async (user) => {
            if (user) {
                currentUser = user;
                isGuestMode = false;
                guestName = null;
                console.log('User signed in:', user.email);
                
                // Ensure email is saved to Firestore (important for admin checks)
                if (window.firebaseDb && user.email) {
                    try {
                        await window.firebaseDb.collection('users').doc(user.uid).set({
                            email: user.email,
                            displayName: user.displayName || null,
                            photoURL: user.photoURL || null
                        }, { merge: true });
                    } catch (error) {
                        console.error('Error syncing user email to Firestore:', error);
                    }
                }
                
                // Check if user is banned
                const banned = await isUserBanned(user.uid);
                if (banned) {
                    showGameMessage('🚫', 'Account Banned', 'Your account has been banned. Please contact support if you believe this is an error.');
                    // Sign them out
                    await window.firebaseAuth.signOut();
                    return;
                }
                
                // Check if email is verified
                if (window.firebaseDb) {
                    try {
                        const userDoc = await window.firebaseDb.collection('users').doc(user.uid).get();
                        if (userDoc.exists) {
                            const userData = userDoc.data();
                            // If emailVerified is explicitly false AND we have pending verification in sessionStorage
                            // (meaning they just signed up), show verification screen
                            // Otherwise, if they're just loading the page, let them access the app
                            const hasPendingVerification = sessionStorage.getItem('pendingVerificationUid') === user.uid;
                            if (userData.emailVerified === false && hasPendingVerification) {
                                // Store user info for verification screen
                                sessionStorage.setItem('pendingVerificationEmail', user.email);
                                sessionStorage.setItem('pendingVerificationUid', user.uid);
                                
                                // Show verification screen instead of lobby
                                ScreenManager.show('emailVerification');
                                document.getElementById('verificationCode').value = '';
                                document.getElementById('verificationCode').focus();
                                return;
                            }
                            // If email is not verified but no pending verification, clear it and let them through
                            // (they can verify later or we can add a prompt in the lobby)
                            if (userData.emailVerified === false && !hasPendingVerification) {
                                // Clear any stale verification data
                                sessionStorage.removeItem('pendingVerificationEmail');
                                sessionStorage.removeItem('pendingVerificationUid');
                            }
                        }
                    } catch (error) {
                        console.error('Error checking email verification:', error);
                    }
                }
                
                // Clear stats cache when user changes
                clearStatsCache();
        clearDecksCache();
                cachedOwnedCamos = null; // Clear owned camos cache
                // Register user as online
                registerUserAsOnline();
                // User is signed in - show splash/credits then lobby
                showSplashThenLobby();
            } else {
                currentUser = null;
                isGuestMode = false;
                guestName = null;
                console.log('User signed out');
                
                // Clean up global listeners on sign out
                if (globalMessageListener) {
                    globalMessageListener();
                    globalMessageListener = null;
                }
                if (giftBadgeListener) {
                    giftBadgeListener();
                    giftBadgeListener = null;
                }
                // Clean up per-conversation listeners
                Object.values(messageListeners).forEach(unsubscribe => unsubscribe());
                messageListeners = {};
                
                // Clear stats cache on logout
                clearStatsCache();
                clearDecksCache();
                
                // Clear any pending verification data when signing out
                sessionStorage.removeItem('pendingVerificationEmail');
                sessionStorage.removeItem('pendingVerificationUid');
                
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
        
        // Check if email is verified in Firestore
        if (window.firebaseDb) {
            const userDoc = await window.firebaseDb.collection('users').doc(userCredential.user.uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                if (userData.emailVerified === false) {
                    // Email not verified - sign out and show verification screen
                    await window.firebaseAuth.signOut();
                    showAuthError('loginError', 'Please verify your email before signing in. Check your inbox for the verification code.');
                    
                    // Store user info for verification
                    sessionStorage.setItem('pendingVerificationEmail', email);
                    sessionStorage.setItem('pendingVerificationUid', userCredential.user.uid);
                    
                    // Show verification screen
                    setTimeout(() => {
                        hideAuthErrors();
                        ScreenManager.show('emailVerification');
                        document.getElementById('verificationCode').value = '';
                        document.getElementById('verificationCode').focus();
                    }, 1000);
                    return;
                }
            }
        }
        
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
        } else if (error.code === 'auth/user-disabled') {
            errorMessage = 'This account has been disabled.';
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
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showAuthError('signupError', 'Please enter a valid email address');
        return;
    }
    
    // Note: We'll check if email exists when creating the account after verification
    // This avoids unnecessary API calls and handles the check at the right time
    
    try {
        // Generate verification code BEFORE creating account
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + (15 * 60 * 1000); // 15 minutes from now
        
        // Store pending signup data in sessionStorage (temporarily)
        // We'll create the account after email is verified
        sessionStorage.setItem('pendingSignupName', name);
        sessionStorage.setItem('pendingSignupEmail', email);
        sessionStorage.setItem('pendingSignupPassword', password); // Note: This is temporary, will be cleared after account creation
        sessionStorage.setItem('pendingVerificationCode', verificationCode);
        sessionStorage.setItem('pendingVerificationExpires', expiresAt.toString());
        
        // Store verification code in Firestore (using email as document ID since we don't have UID yet)
        if (window.firebaseDb) {
            try {
                // Use a temporary collection for pre-signup verification
                // Note: Password is stored in sessionStorage only, not in Firestore for security
                await window.firebaseDb.collection('pendingSignups').doc(email).set({
                    code: verificationCode,
                    name: name,
                    email: email,
                    expiresAt: firebase.firestore.Timestamp.fromDate(new Date(expiresAt)),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } catch (firestoreError) {
                console.error('Firestore error storing pending signup:', firestoreError);
                // Continue anyway - we have sessionStorage backup
            }
        }
        
        // Send verification email with code via server
        try {
            const response = await fetch('/api/send-verification-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: email,
                    code: verificationCode,
                    name: name
                })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                console.error('Failed to send verification email:', result);
                // If server returned the code, show it to user for debugging
                if (result.code) {
                    console.log('Verification code (email failed):', result.code);
                    showAuthError('signupError', `Failed to send email. Check server console for code: ${result.code}`);
                } else {
                    showAuthError('signupError', 'Failed to send verification email. Please check your email settings and try again.');
                }
                return;
            }
            
            // Log success
            console.log('Verification email request sent:', result);
        } catch (error) {
            console.error('Error sending verification email:', error);
            showAuthError('signupError', 'Failed to send verification email. Please check your connection and try again.');
            return;
        }
        
        // Show verification screen (account not created yet)
        hideAuthErrors();
        ScreenManager.show('emailVerification');
        document.getElementById('verificationCode').value = '';
        document.getElementById('verificationCode').focus();
        
        // Show a brief message about checking spam folder
        const verificationError = document.getElementById('verificationError');
        if (verificationError) {
            verificationError.style.display = 'none';
        }
        
        console.log('Verification code sent. Please verify your email before account is created.');
    } catch (error) {
        console.error('Signup error:', error);
        showAuthError('signupError', 'Failed to start signup process. Please try again.');
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

// Forgot Password Functions
async function handleForgotPassword() {
    if (!window.firebaseAuth) {
        showAuthError('forgotPasswordError', 'Firebase is not configured. Please set up Firebase first.');
        return;
    }
    
    const email = document.getElementById('forgotPasswordEmail').value.trim();
    const errorDiv = document.getElementById('forgotPasswordError');
    const successDiv = document.getElementById('forgotPasswordSuccess');
    
    if (!email) {
        showAuthError('forgotPasswordError', 'Please enter your email address');
        return;
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showAuthError('forgotPasswordError', 'Please enter a valid email address');
        return;
    }
    
    // Hide error, show success
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';
    
    try {
        // Send password reset email
        await window.firebaseAuth.sendPasswordResetEmail(email);
        
        successDiv.innerHTML = 'Password reset email sent! Please check your inbox (and spam folder) and follow the instructions to reset your password.';
        successDiv.style.display = 'block';
        errorDiv.style.display = 'none';
        
        console.log('Password reset email sent to:', email);
    } catch (error) {
        console.error('Password reset error:', error);
        let errorMessage = 'Failed to send reset email. Please try again.';
        if (error.code === 'auth/user-not-found') {
            errorMessage = 'No account found with this email address.';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = 'Invalid email address.';
        } else if (error.code === 'auth/too-many-requests') {
            errorMessage = 'Too many requests. Please try again later.';
        }
        showAuthError('forgotPasswordError', errorMessage);
        successDiv.style.display = 'none';
    }
}

// Email Verification Functions
async function handleEmailVerification() {
    if (!window.firebaseAuth || !window.firebaseDb) {
        showAuthError('verificationError', 'Firebase is not configured. Please set up Firebase first.');
        return;
    }
    
    const code = document.getElementById('verificationCode').value.trim();
    const errorDiv = document.getElementById('verificationError');
    
    if (!code || code.length !== 6) {
        showAuthError('verificationError', 'Please enter the 6-digit verification code');
        return;
    }
    
    // Check if this is a pre-signup verification (account not created yet)
    const pendingEmail = sessionStorage.getItem('pendingSignupEmail');
    const pendingName = sessionStorage.getItem('pendingSignupName');
    const pendingPassword = sessionStorage.getItem('pendingSignupPassword');
    const storedCode = sessionStorage.getItem('pendingVerificationCode');
    const expiresAt = parseInt(sessionStorage.getItem('pendingVerificationExpires') || '0');
    
    if (pendingEmail && pendingName && pendingPassword) {
        // This is a pre-signup verification - verify code first, then create account
        try {
            // Check if code matches
            if (storedCode !== code) {
                // Also check Firestore in case sessionStorage was cleared
                const pendingDoc = await window.firebaseDb.collection('pendingSignups').doc(pendingEmail).get();
                if (pendingDoc.exists) {
                    const pendingData = pendingDoc.data();
                    let codeExpiresAt;
                    if (pendingData.expiresAt && pendingData.expiresAt.toDate) {
                        codeExpiresAt = pendingData.expiresAt.toDate().getTime();
                    } else {
                        codeExpiresAt = expiresAt;
                    }
                    
                    // Check expiration
                    if (Date.now() > codeExpiresAt) {
                        showAuthError('verificationError', 'Verification code has expired. Please sign up again.');
                        // Clean up
                        sessionStorage.removeItem('pendingSignupName');
                        sessionStorage.removeItem('pendingSignupEmail');
                        sessionStorage.removeItem('pendingSignupPassword');
                        sessionStorage.removeItem('pendingVerificationCode');
                        sessionStorage.removeItem('pendingVerificationExpires');
                        await window.firebaseDb.collection('pendingSignups').doc(pendingEmail).delete();
                        return;
                    }
                    
                    if (pendingData.code !== code) {
                        showAuthError('verificationError', 'Invalid verification code. Please try again.');
                        return;
                    }
                } else {
                    // Check sessionStorage expiration
                    if (Date.now() > expiresAt) {
                        showAuthError('verificationError', 'Verification code has expired. Please sign up again.');
                        // Clean up
                        sessionStorage.removeItem('pendingSignupName');
                        sessionStorage.removeItem('pendingSignupEmail');
                        sessionStorage.removeItem('pendingSignupPassword');
                        sessionStorage.removeItem('pendingVerificationCode');
                        sessionStorage.removeItem('pendingVerificationExpires');
                        return;
                    }
                    
                    if (storedCode !== code) {
                        showAuthError('verificationError', 'Invalid verification code. Please try again.');
                        return;
                    }
                }
            } else {
                // Check expiration from sessionStorage
                if (Date.now() > expiresAt) {
                    showAuthError('verificationError', 'Verification code has expired. Please sign up again.');
                    // Clean up
                    sessionStorage.removeItem('pendingSignupName');
                    sessionStorage.removeItem('pendingSignupEmail');
                    sessionStorage.removeItem('pendingSignupPassword');
                    sessionStorage.removeItem('pendingVerificationCode');
                    sessionStorage.removeItem('pendingVerificationExpires');
                    return;
                }
            }
            
            // Code is valid - NOW create the Firebase account
            showAuthError('verificationError', ''); // Clear error
            errorDiv.style.display = 'none';
            
            const successDiv = document.createElement('div');
            successDiv.className = 'auth-success';
            successDiv.textContent = 'Email verified! Creating your account...';
            successDiv.style.display = 'block';
            const form = document.querySelector('#emailVerification .auth-form');
            form.insertBefore(successDiv, errorDiv);
            
            try {
                // Create the Firebase account
                const userCredential = await window.firebaseAuth.createUserWithEmailAndPassword(pendingEmail, pendingPassword);
                
                // Update user profile with display name
                await userCredential.user.updateProfile({
                    displayName: pendingName
                });
                
                // Wait a moment for auth token to propagate
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Save user data to Firestore with emailVerified: true (since we just verified)
                if (window.firebaseDb) {
                    await window.firebaseDb.collection('users').doc(userCredential.user.uid).set({
                        displayName: pendingName,
                        email: pendingEmail,
                        emailVerified: true,
                        emailVerifiedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                }
                
                // Delete pending signup from Firestore
                await window.firebaseDb.collection('pendingSignups').doc(pendingEmail).delete();
                
                // Clear session storage
                sessionStorage.removeItem('pendingSignupName');
                sessionStorage.removeItem('pendingSignupEmail');
                sessionStorage.removeItem('pendingSignupPassword');
                sessionStorage.removeItem('pendingVerificationCode');
                sessionStorage.removeItem('pendingVerificationExpires');
                
                // Also send Firebase's built-in verification email (for good measure)
                await userCredential.user.sendEmailVerification();
                
                successDiv.textContent = 'Account created successfully! Redirecting...';
                
                // Auth state change will automatically show lobby
                console.log('Account created and email verified successfully');
            } catch (createError) {
                console.error('Error creating account:', createError);
                let errorMessage = 'Failed to create account. Please try again.';
                if (createError.code === 'auth/email-already-in-use') {
                    errorMessage = 'An account with this email already exists. Please sign in instead.';
                } else if (createError.code === 'auth/invalid-email') {
                    errorMessage = 'Invalid email address.';
                } else if (createError.code === 'auth/weak-password') {
                    errorMessage = 'Password is too weak.';
                }
                showAuthError('verificationError', errorMessage);
                successDiv.remove();
            }
        } catch (error) {
            console.error('Verification error:', error);
            showAuthError('verificationError', 'Failed to verify email. Please try again.');
        }
        return;
    }
    
    // Legacy flow: User already has account, just verifying email
    const pendingUid = sessionStorage.getItem('pendingVerificationUid');
    if (!pendingEmail && !pendingUid) {
        showAuthError('verificationError', 'Verification session expired. Please sign up again.');
        return;
    }
    
    try {
        // Get verification code from Firestore
        const codeDoc = await window.firebaseDb.collection('emailVerificationCodes').doc(pendingUid).get();
        
        if (!codeDoc.exists) {
            showAuthError('verificationError', 'Verification code not found. Please request a new code.');
            return;
        }
        
        const codeData = codeDoc.data();
        // Handle both Timestamp and Date objects
        let expiresAt;
        if (codeData.expiresAt && codeData.expiresAt.toDate) {
            expiresAt = codeData.expiresAt.toDate();
        } else if (codeData.expiresAt) {
            expiresAt = new Date(codeData.expiresAt);
        } else {
            showAuthError('verificationError', 'Invalid verification code. Please request a new code.');
            return;
        }
        
        // Check if code is expired
        if (new Date() > expiresAt) {
            showAuthError('verificationError', 'Verification code has expired. Please request a new code.');
            return;
        }
        
        // Check if code matches
        if (codeData.code !== code) {
            showAuthError('verificationError', 'Invalid verification code. Please try again.');
            return;
        }
        
        // Code is valid - update user's emailVerified status
        await window.firebaseDb.collection('users').doc(pendingUid).update({
            emailVerified: true,
            emailVerifiedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // Delete the verification code
        await window.firebaseDb.collection('emailVerificationCodes').doc(pendingUid).delete();
        
        // Clear session storage
        sessionStorage.removeItem('pendingVerificationEmail');
        sessionStorage.removeItem('pendingVerificationUid');
        
        // Clear error and show success
        showAuthError('verificationError', ''); // Clear error
        errorDiv.style.display = 'none';
        
        // Show success message
        const successMessage = 'Email verified successfully! Redirecting...';
        const successDiv = document.createElement('div');
        successDiv.className = 'auth-success';
        successDiv.textContent = successMessage;
        successDiv.style.display = 'block';
        const form = document.querySelector('#emailVerification .auth-form');
        form.insertBefore(successDiv, errorDiv);
        
        // Auth state change will automatically show lobby
        console.log('Email verified successfully');
    } catch (error) {
        console.error('Verification error:', error);
        showAuthError('verificationError', 'Failed to verify email. Please try again.');
    }
}

async function handleResendVerificationCode() {
    const pendingEmail = sessionStorage.getItem('pendingSignupEmail') || sessionStorage.getItem('pendingVerificationEmail');
    const pendingName = sessionStorage.getItem('pendingSignupName');
    const pendingUid = sessionStorage.getItem('pendingVerificationUid');
    
    if (!pendingEmail) {
        showAuthError('verificationError', 'Verification session expired. Please sign up again.');
        return;
    }
    
    try {
        let name = pendingName || 'User';
        
        // If this is a pre-signup verification, get name from sessionStorage
        // Otherwise, get from Firestore
        if (!pendingName && pendingUid && window.firebaseDb) {
            const userDoc = await window.firebaseDb.collection('users').doc(pendingUid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                name = userData.displayName || 'User';
            }
        }
        
        // Generate new verification code
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + (15 * 60 * 1000); // 15 minutes from now
        
        // Update sessionStorage
        sessionStorage.setItem('pendingVerificationCode', verificationCode);
        sessionStorage.setItem('pendingVerificationExpires', expiresAt.toString());
        
        // Update in Firestore
        if (window.firebaseDb) {
            if (pendingUid) {
                // Existing user - update emailVerificationCodes
                await window.firebaseDb.collection('emailVerificationCodes').doc(pendingUid).set({
                    code: verificationCode,
                    email: pendingEmail,
                    expiresAt: firebase.firestore.Timestamp.fromDate(new Date(expiresAt)),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // Pre-signup - update pendingSignups
                await window.firebaseDb.collection('pendingSignups').doc(pendingEmail).update({
                    code: verificationCode,
                    expiresAt: firebase.firestore.Timestamp.fromDate(new Date(expiresAt)),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        }
        
        // Send verification email with code via server
        try {
            const response = await fetch('/api/send-verification-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: pendingEmail,
                    code: verificationCode,
                    name: name
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to send verification email');
            }
            
            showAuthError('verificationError', ''); // Clear error
            document.getElementById('verificationError').style.display = 'none';
            
            // Show success message temporarily
            const successDiv = document.createElement('div');
            successDiv.className = 'auth-success';
            successDiv.innerHTML = 'Verification code sent! Please check your email (and spam folder).';
            successDiv.style.display = 'block';
            const form = document.querySelector('#emailVerification .auth-form');
            const errorDiv = document.getElementById('verificationError');
            form.insertBefore(successDiv, errorDiv);
            
            setTimeout(() => {
                successDiv.remove();
            }, 5000);
            
        } catch (error) {
            console.error('Error sending verification email:', error);
            showAuthError('verificationError', 'Failed to send verification email. Please try again.');
        }
    } catch (error) {
        console.error('Resend verification error:', error);
        showAuthError('verificationError', 'Failed to resend verification code. Please try again.');
    }
}

async function handleLogout() {
    // Clean up global listeners
    if (globalMessageListener) {
        globalMessageListener();
        globalMessageListener = null;
    }
    if (giftBadgeListener) {
        giftBadgeListener();
        giftBadgeListener = null;
    }
    
    // Clean up per-conversation listeners
    Object.values(messageListeners).forEach(unsubscribe => unsubscribe());
    messageListeners = {};
    
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
    const forgotPasswordError = document.getElementById('forgotPasswordError');
    const verificationError = document.getElementById('verificationError');
    if (loginError) loginError.style.display = 'none';
    if (signupError) signupError.style.display = 'none';
    if (guestNameError) guestNameError.style.display = 'none';
    if (forgotPasswordError) forgotPasswordError.style.display = 'none';
    if (verificationError) verificationError.style.display = 'none';
}

// Add global error handler for all IMG elements to catch 429 errors before they bubble
document.addEventListener('DOMContentLoaded', () => {
    // Use event delegation to catch image errors on all images
    document.addEventListener('error', (event) => {
        if (event.target && event.target.tagName === 'IMG') {
            const src = event.target.src || '';
            if (src.includes('googleusercontent.com') || 
                src.includes('s96-c') || 
                src.includes('s48-c') || 
                src.includes('s128-c')) {
                // Suppress 429 errors for Google profile images
                event.preventDefault();
                event.stopPropagation();
                // Don't show broken image icon - keep fallback (initial) visible
                event.target.style.display = 'none';
                return false;
            }
        }
    }, true); // Use capture phase to catch early
}, { once: true });

// Helper function to safely apply a profile image to an element with fallback
function applyProfileImage(element, photoURL, fallbackInitial) {
    if (!element) return;
    
    // Set initial immediately
    if (fallbackInitial) {
        element.textContent = fallbackInitial;
    }
    
    if (!photoURL) {
        element.style.backgroundImage = '';
        element.style.backgroundSize = '';
        element.style.backgroundPosition = '';
        return;
    }
    
    // Try to load image
    testImageLoad(photoURL).then(() => {
        // Image loaded successfully
        element.style.backgroundImage = `url(${photoURL})`;
        element.style.backgroundSize = 'cover';
        element.style.backgroundPosition = 'center';
        element.textContent = '';
    }).catch(() => {
        // Image failed to load - keep initial visible
        element.style.backgroundImage = '';
        element.style.backgroundSize = '';
        element.style.backgroundPosition = '';
        if (fallbackInitial) {
            element.textContent = fallbackInitial;
        }
    });
}

// Helper function to test if an image URL loads successfully
function testImageLoad(url) {
    return new Promise((resolve, reject) => {
        if (!url) {
            reject(new Error('No URL provided'));
            return;
        }
        
        // Skip loading if it's a Google image URL that might be rate-limited
        // We'll just use the fallback (initials) instead
        if (url.includes('googleusercontent.com') && (
            url.includes('s96-c') || 
            url.includes('s48-c') || 
            url.includes('s128-c')
        )) {
            // For Google images, we'll try to load but expect it might fail
            // The error handler will catch 429 errors gracefully
        }
        
        const img = new Image();
        // Set a timeout to avoid hanging on slow/broken URLs
        const timeout = setTimeout(() => {
            reject(new Error('Image load timeout'));
        }, 5000);
        
        img.onload = () => {
            clearTimeout(timeout);
            resolve();
        };
        img.onerror = (error) => {
            clearTimeout(timeout);
            // Don't log 429 errors - they're expected rate limits
            if (!url.includes('googleusercontent.com') || !url.match(/s\d+-c/)) {
                // Only log non-Google image errors
            }
            reject(new Error('Image failed to load'));
        };
        img.src = url;
    });
}

function updateLobbyUserInfo() {
    // Ensure DOM elements are ready - wait for next tick if needed
    const userInfoHeader = document.getElementById('userInfoHeader');
    const userDisplayNameHeader = document.getElementById('userDisplayNameHeader');
    const logoutBtn = document.getElementById('logoutBtn');
    const profileName = document.getElementById('profileName');
    const profileEmail = document.getElementById('profileEmail');
    const profileAccountType = document.getElementById('profileAccountType');
    const profileAvatar = document.getElementById('profileAvatar');
    
    // Show/hide admin tab based on admin status
    updateAdminTabVisibility();
    
    // Debug: Check if profile elements exist
    if (!profileName || !profileEmail || !profileAccountType || !profileAvatar) {
        console.warn('Profile elements not found, retrying...', {
            profileName: !!profileName,
            profileEmail: !!profileEmail,
            profileAccountType: !!profileAccountType,
            profileAvatar: !!profileAvatar,
            readyState: document.readyState
        });
        // Retry after a short delay if elements aren't ready
        if (document.readyState === 'loading' || !profileName) {
            setTimeout(() => updateLobbyUserInfo(), 200);
            return;
        }
    }
    
    console.log('updateLobbyUserInfo called:', {
        isGuestMode: isGuestMode,
        guestName: guestName,
        hasCurrentUser: !!currentUser,
        currentUserEmail: currentUser?.email
    });
    
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
        const displayName = (currentUser.displayName && currentUser.displayName.trim()) || currentUser.email?.split('@')[0] || 'Player';
        if (userDisplayNameHeader) {
            userDisplayNameHeader.textContent = displayName;
        }
        if (userInfoHeader) {
            userInfoHeader.style.display = 'block';
        }
        if (logoutBtn) {
            logoutBtn.style.display = 'block';
        }
        // Update profile tab - ensure it's not still showing "Loading..."
        if (profileName) {
            profileName.textContent = displayName || 'Player';
        }
        if (profileEmail) {
            profileEmail.textContent = currentUser.email || '-';
        }
        if (profileAccountType) {
            const provider = currentUser.providerData?.[0]?.providerId || 'email';
            profileAccountType.textContent = provider === 'google.com' ? 'Google Account' : 'Email Account';
        }
        if (profileAvatar) {
            // Prefer Firestore photoURL if available
            const applyAvatar = (url) => {
                if (url) {
                    // Show initial immediately
                    const initial = displayName.charAt(0).toUpperCase();
                    profileAvatar.textContent = initial;
                    
                    // Try to load image in background - if it fails, keep the initial
                    testImageLoad(url).then(() => {
                        // Image loaded successfully - apply it
                        profileAvatar.style.backgroundImage = `url(${url})`;
                        profileAvatar.style.backgroundSize = 'cover';
                        profileAvatar.style.backgroundPosition = 'center';
                        profileAvatar.textContent = '';
                    }).catch(() => {
                        // Image failed to load (429, network error, etc.) - keep initial visible
                        profileAvatar.style.backgroundImage = '';
                        profileAvatar.style.backgroundSize = '';
                        profileAvatar.style.backgroundPosition = '';
                        // Initial is already set above
                    });
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
                }).catch((error) => {
                    // Ignore Firestore errors here, keep initial photo
                    console.warn('Error fetching user photo from Firestore:', error);
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
        'hiddenKeyboard': 'CardeBlanche.png',
        'blackHand': 'BlackHand.png',
        'amnesia': 'Amnesia.png',
        'moonshine': 'MoonShine.png',
        'slowMotion': 'SlowMotion.png'
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

// Camo Management
const CAMO_STORAGE_KEY = 'cardle_card_camos';
const OWNED_CAMOS_KEY = 'cardle_owned_camos';
const ALPHA_PACK_COST = 100; // Cost in bits

// Camo rarities: common, rare, epic
const AVAILABLE_CAMOS = [
    { id: 'None', name: 'None', filename: 'BlackBase.png', rarity: 'common', owned: true }, // Always owned, default
    { id: 'CamoBase', name: 'Camo', filename: 'CamoBase.png', rarity: 'common' },
    { id: 'PinkCamoBase', name: 'Pink Camo', filename: 'PinkCamoBase.png', rarity: 'common' },
    { id: 'USABase', name: 'USA', filename: 'USABase.png', rarity: 'common' },
    { id: 'LeafyBase', name: 'Leafy', filename: 'LeafyBase.png', rarity: 'common' },
    { id: 'ChillBase', name: 'Chill', filename: 'ChillBase.png', rarity: 'common' },
    { id: 'OilSpillBase', name: 'Oil Spill', filename: 'OilSpillBase.png', rarity: 'rare' },
    { id: 'AruaBase', name: 'Aura', filename: 'AruaBase.png', rarity: 'epic' },
    { id: 'JohnPorkBase', name: 'John Pork', filename: 'JohnPorkBase.png', rarity: 'rare' },
    { id: 'CarbonCoatBase', name: 'Carbon Coat', filename: 'CarbonCoatBase.png', rarity: 'rare' },
    { id: 'MatrixBase', name: 'Matrix', filename: 'MatrixBase.png', rarity: 'rare' },
    { id: 'PlamsaBase', name: 'Plasma', filename: 'PlamsaBase.png', rarity: 'rare' },
    { id: 'InfernoBase', name: 'Inferno', filename: 'InfernoBase.png', rarity: 'rare' },
    { id: 'ReaperBase', name: 'Reaper', filename: 'ReaperBase.png', rarity: 'rare' },
    { id: 'VoidBase', name: 'Void', filename: 'VoidBase.png', rarity: 'common' },
    { id: 'WereWolfBase', name: 'Werewolf', filename: 'WereWolfBase.png', rarity: 'common' },
    { id: 'BlackIceBase', name: 'Black Ice', filename: 'BlackIceBase.png', rarity: 'epic' },
    { id: 'AmethystBase', name: 'Amethyst', filename: 'AmethystBase_.png', rarity: 'epic' },
    { id: 'DivineBase', name: 'Divine', filename: 'DivineBase.png', rarity: 'epic' },
    { id: 'DarkTideBase', name: 'Dark Tide', filename: 'DarkTideBase.png', rarity: 'epic' },
    // New Epic Camos (Best 6)
    { id: 'CorruptionBase', name: 'Corruption', filename: 'CorruptionBase.png', rarity: 'epic' },
    { id: 'CosmosBase', name: 'Cosmos', filename: 'CosmosBase.png', rarity: 'epic' },
    { id: 'DarkKnightBase', name: 'Dark Knight', filename: 'DarkKnightBase.png', rarity: 'epic' },
    { id: 'DevilBase', name: 'Devil', filename: 'DevilBase.png', rarity: 'epic' },
    { id: 'DragonScrollBase', name: 'Dragon Scroll', filename: 'DragonScrollBase.png', rarity: 'epic' },
    { id: 'HellRaiserBase', name: 'Hell Raiser', filename: 'HellRaiserBase.png', rarity: 'epic' },
    // New Rare Camos (Next Best 7)
    { id: 'EnergyBase', name: 'Energy', filename: 'EnergyBase.png', rarity: 'rare' },
    { id: 'ExtinctionBase', name: 'Extinction', filename: 'ExtinctionBase.png', rarity: 'rare' },
    { id: 'RoyalBase', name: 'Royal', filename: 'RoyalBase.png', rarity: 'rare' },
    { id: 'SupremeBase', name: 'Supreme', filename: 'SupremeBase.png', rarity: 'rare' },
    { id: 'TheBeyondBase', name: 'The Beyond', filename: 'TheBeyondBase.png', rarity: 'rare' },
    { id: 'VengefulMenaceBase', name: 'Vengeful Menace', filename: 'VengefulMenaceBase.png', rarity: 'rare' },
    { id: 'ZeroTimeBase', name: 'Zero Time', filename: 'ZeroTimeBase.png', rarity: 'rare' },
    // New Common Camos (Rest)
    { id: 'BarrelBase', name: 'Barrel', filename: 'BarrelBase.png', rarity: 'common' },
    { id: 'CallToActionBase', name: 'Call To Action', filename: 'CallToActionBase.png', rarity: 'common' },
    { id: 'CanIHaveAWaterBase', name: 'Can I Have A Water', filename: 'CanIHaveAWaterBase.png', rarity: 'common' },
    { id: 'CapturedBase', name: 'Captured', filename: 'CapturedBase.png', rarity: 'common' },
    { id: 'ChillGuyBase', name: 'Chill Guy', filename: 'ChillGuyBase.png', rarity: 'common' },
    { id: 'CivilizedWeaponBase', name: 'Civilized Weapon', filename: 'CivilizedWeaponBase.png', rarity: 'common' },
    { id: 'CowPrintBase', name: 'Cow Print', filename: 'CowPrintBase.png', rarity: 'common' },
    { id: 'DeadManWalkinngBase', name: 'Dead Man Walking', filename: 'DeadManWalkinngBase.png', rarity: 'common' },
    { id: 'FiringRangeBase', name: 'Firing Range', filename: 'FiringRangeBase.png', rarity: 'common' },
    { id: 'FullHandBase', name: 'Full Hand', filename: 'FullHandBase.png', rarity: 'common' },
    { id: 'HackedBase', name: 'Hacked', filename: 'HackedBase.png', rarity: 'common' },
    { id: 'HopeBase', name: 'Hope', filename: 'HopeBase.png', rarity: 'common' },
    { id: 'JammingBase', name: 'Jamming', filename: 'JammingBase.png', rarity: 'common' },
    { id: 'JeffAndDonald', name: 'Jeff And Donald', filename: 'JeffAndDonald.png', rarity: 'common' },
    { id: 'LeopardPrintBase', name: 'Leopard Print', filename: 'LeopardPrintBase.png', rarity: 'common' },
    { id: 'LonesomeWallBase', name: 'Lonesome Wall', filename: 'LonesomeWallBase.png', rarity: 'common' },
    { id: 'McLovinBase', name: 'McLovin', filename: 'McLovinBase.png', rarity: 'common' },
    { id: 'MercenaryBase', name: 'Mercenary', filename: 'MercenaryBase.png', rarity: 'common' },
    { id: 'MyMommaskindaHomelessBase', name: 'My Momma\'s Kinda Homeless', filename: 'MyMommasKindaHomelessBase.png', rarity: 'common' },
    { id: 'PirateBase', name: 'Pirate', filename: 'PirateBase.png', rarity: 'common' },
    { id: 'PortalHoppersBase', name: 'Portal Hoppers', filename: 'PortalHoppersBase.png', rarity: 'common' },
    { id: 'PunishmentBase', name: 'Punishment', filename: 'PunishmentBase.png', rarity: 'common' },
    { id: 'SnakeSkinBase', name: 'Snake Skin', filename: 'SnakeSkinBase.png', rarity: 'common' },
    { id: 'SolidStealthBase', name: 'Solid Stealth', filename: 'SolidStealthBase.png', rarity: 'common' },
    { id: 'VirusBase', name: 'Virus', filename: 'VirusBase.png', rarity: 'common' },
    { id: 'YesKingBase', name: 'Yes King', filename: 'YesKingBase.png', rarity: 'common' },
    { id: 'ZenBase', name: 'Zen', filename: 'ZenBase.png', rarity: 'common' }
];

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
        bits: 0, // Bits currency for Alpha Packs and achievements
        winStreak: 0, // Current consecutive wins
        bestWinStreak: 0, // Best win streak achieved
        consecutiveLosses: 0, // Current consecutive losses
        achievements: [], // Array of unlocked achievement IDs
        claimedAchievements: [], // Array of claimed achievement IDs (for bit rewards)
        lastDailyClaim: null // Timestamp of last daily claim (ISO string)
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

// Achievement definitions
const ACHIEVEMENTS = [
    {
        id: 'speed_demon',
        name: 'Speed Demon',
        description: 'Win a game in 2 guesses or less',
        icon: '⚡',
        check: (gameResult, stats) => gameResult.won && gameResult.guesses <= 2
    },
    {
        id: 'no_a_allowed',
        name: 'No A Allowed',
        description: 'Win a game without guessing any word containing "A"',
        icon: '🚫',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const guesses = gameData?.guesses || [];
            return guesses.every(guess => !guess || !guess.toUpperCase().includes('A'));
        }
    },
    {
        id: 'comeback_king',
        name: 'Comeback King',
        description: 'Win a game after losing 3 games in a row',
        icon: '👑',
        check: (gameResult, stats) => {
            if (!gameResult.won) return false;
            // Check if previous consecutive losses were 3 or more
            // This is checked before stats are updated, so we need to check the previous value
            // We'll track this differently - check if winStreak is 1 and previous losses were tracked
            return stats.consecutiveLosses >= 3;
        }
    },
    {
        id: 'streak_master',
        name: 'Streak Master',
        description: 'Achieve a 10 game win streak',
        icon: '🔥',
        check: (gameResult, stats) => stats.winStreak >= 10
    },
    {
        id: 'vowel_hater',
        name: 'Vowel Hater',
        description: 'Win a game without using any vowels (A, E, I, O, U) in any guess',
        icon: '🔇',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const guesses = gameData?.guesses || [];
            const vowels = ['A', 'E', 'I', 'O', 'U'];
            return guesses.every(guess => {
                if (!guess) return true;
                return !vowels.some(vowel => guess.toUpperCase().includes(vowel));
            });
        }
    },
    {
        id: 'patience_pays',
        name: 'Patience Pays',
        description: 'Win a game using 6 or more guesses',
        icon: '⏳',
        check: (gameResult, stats) => gameResult.won && gameResult.guesses >= 6
    },
    {
        id: 'first_win',
        name: 'First Victory',
        description: 'Win your first game',
        icon: '🏆',
        check: (gameResult, stats) => gameResult.won && stats.wins === 1
    },
    {
        id: 'century_club',
        name: 'Century Club',
        description: 'Play 100 games',
        icon: '💯',
        check: (gameResult, stats) => stats.gamesPlayed >= 100
    },
    {
        id: 'letter_master',
        name: 'Letter Master',
        description: 'Win using only words with unique letters (no repeated letters)',
        icon: '🔤',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const guesses = gameData?.guesses || [];
            return guesses.every(guess => {
                if (!guess) return true;
                const upper = guess.toUpperCase();
                return new Set(upper).size === upper.length;
            });
        }
    },
    {
        id: 'early_bird',
        name: 'Early Bird',
        description: 'Win a game in your first 3 guesses',
        icon: '🐦',
        check: (gameResult, stats) => gameResult.won && gameResult.guesses <= 3
    },
    {
        id: 'persistence',
        name: 'Persistence',
        description: 'Win a game after 10 or more guesses',
        icon: '🔨',
        check: (gameResult, stats) => gameResult.won && gameResult.guesses >= 10
    },
    {
        id: 'winning_percentage',
        name: 'Winning Percentage',
        description: 'Achieve a 75% win rate with at least 20 games played',
        icon: '📊',
        check: (gameResult, stats) => {
            if (stats.gamesPlayed < 20) return false;
            const winRate = (stats.wins / stats.gamesPlayed) * 100;
            return winRate >= 75;
        }
    },
    {
        id: 'consistency',
        name: 'Consistency',
        description: 'Win 3 games in a row',
        icon: '🎯',
        check: (gameResult, stats) => stats.winStreak >= 3
    },
    {
        id: 'veteran',
        name: 'Veteran',
        description: 'Play 200 games',
        icon: '🎖️',
        check: (gameResult, stats) => stats.gamesPlayed >= 200
    },
    {
        id: 'word_master',
        name: 'Word Master',
        description: 'Win 50 games',
        icon: '📚',
        check: (gameResult, stats) => stats.wins >= 50
    },
    {
        id: 'dedication',
        name: 'Dedication',
        description: 'Play 50 games',
        icon: '💪',
        check: (gameResult, stats) => stats.gamesPlayed >= 50
    },
    {
        id: 'lucky_streak',
        name: 'Lucky Streak',
        description: 'Achieve a 5 game win streak',
        icon: '🍀',
        check: (gameResult, stats) => stats.winStreak >= 5
    },
    {
        id: 'drunk_victory',
        name: 'Drunk Victory',
        description: 'Win a game while moonshine effect is active on you',
        icon: '🍺',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const activeEffects = gameData?.activeEffects || [];
            return activeEffects.some(e => e.type === 'moonshine' && e.target === gameResult.playerId);
        }
    },
    {
        id: 'amnesia_legend',
        name: 'Amnesia Legend',
        description: 'Win a game while amnesia effect is active (all guesses hidden)',
        icon: '🧠',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const activeEffects = gameData?.activeEffects || [];
            return activeEffects.some(e => e.type === 'amnesia' && e.target === gameResult.playerId);
        }
    },
    {
        id: 'time_crunch',
        name: 'Time Crunch',
        description: 'Win a game while time rush effect is active (20 second timer)',
        icon: '⏰',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const activeEffects = gameData?.activeEffects || [];
            return activeEffects.some(e => e.type === 'timeRush' && e.target === gameResult.playerId);
        }
    },
    {
        id: 'blind_faith',
        name: 'Blind Faith',
        description: 'Win a game while blind guess effect is active',
        icon: '👁️‍🗨️',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const activeEffects = gameData?.activeEffects || [];
            return activeEffects.some(e => e.type === 'blindGuess' && e.target === gameResult.playerId);
        }
    },
    {
        id: 'card_locked_champion',
        name: 'Card Locked Champion',
        description: 'Win a game while card locked (unable to play cards)',
        icon: '🔐',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const activeEffects = gameData?.activeEffects || [];
            return activeEffects.some(e => e.type === 'cardLock' && e.target === gameResult.playerId);
        }
    },
    {
        id: 'false_feedback_master',
        name: 'False Feedback Master',
        description: 'Win a game while false feedback effect is active',
        icon: '🎭',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const activeEffects = gameData?.activeEffects || [];
            return activeEffects.some(e => e.type === 'falseFeedback' && e.target === gameResult.playerId);
        }
    },
    {
        id: 'word_scrambled_winner',
        name: 'Word Scrambled Winner',
        description: 'Win a game while word scramble effect is active',
        icon: '🔀',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const activeEffects = gameData?.activeEffects || [];
            return activeEffects.some(e => e.type === 'wordScramble' && e.target === gameResult.playerId);
        }
    },
    {
        id: 'green_to_grey_warrior',
        name: 'Green to Grey Warrior',
        description: 'Win a game while green to grey effect is active',
        icon: '🔄',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const activeEffects = gameData?.activeEffects || [];
            return activeEffects.some(e => e.type === 'greenToGrey' && e.target === gameResult.playerId);
        }
    },
    {
        id: 'black_hand_legend',
        name: 'Black Hand Legend',
        description: 'Win a game while black hand effect is active (cards flipped)',
        icon: '🖤',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const activeEffects = gameData?.activeEffects || [];
            return activeEffects.some(e => e.type === 'blackHand' && e.target === gameResult.playerId);
        }
    },
    {
        id: 'hidden_guess_master',
        name: 'Hidden Guess Master',
        description: 'Win a game while your guesses are hidden from opponent',
        icon: '🔒',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const activeEffects = gameData?.activeEffects || [];
            return activeEffects.some(e => e.type === 'hiddenGuess' && e.target === gameResult.playerId);
        }
    },
    {
        id: 'perfect_storm',
        name: 'Perfect Storm',
        description: 'Win a game while affected by 3 or more negative effects at once',
        icon: '⚡',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const activeEffects = gameData?.activeEffects || [];
            const negativeEffects = ['moonshine', 'timeRush', 'blindGuess', 'cardLock', 'falseFeedback', 'wordScramble', 'greenToGrey', 'blackHand', 'hiddenGuess'];
            const playerNegativeEffects = activeEffects.filter(e => 
                negativeEffects.includes(e.type) && e.target === gameResult.playerId
            );
            return playerNegativeEffects.length >= 3;
        }
    },
    {
        id: 'underdog_victory',
        name: 'Underdog Victory',
        description: 'Win a ranked game with fewer chips than your opponent',
        icon: '🐕',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won || !gameResult.isRanked) return false;
            // This would need opponent chip data, simplified for now - just check if ranked
            return gameResult.isRanked;
        }
    },
    {
        id: 'flawless_victory',
        name: 'Flawless Victory',
        description: 'Win a game without being affected by any negative effects',
        icon: '✨',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const activeEffects = gameData?.activeEffects || [];
            const negativeEffects = ['moonshine', 'timeRush', 'blindGuess', 'cardLock', 'falseFeedback', 'wordScramble', 'greenToGrey', 'blackHand', 'hiddenGuess', 'amnesia'];
            const playerNegativeEffects = activeEffects.filter(e => 
                negativeEffects.includes(e.type) && e.target === gameResult.playerId
            );
            return playerNegativeEffects.length === 0;
        }
    },
    {
        id: 'all_vowels_win',
        name: 'All Vowels Win',
        description: 'Win a game using only words that contain all 5 vowels (A, E, I, O, U)',
        icon: '🔤',
        check: (gameResult, stats, gameData) => {
            if (!gameResult.won) return false;
            const guesses = gameData?.guesses || [];
            const vowels = ['A', 'E', 'I', 'O', 'U'];
            return guesses.length > 0 && guesses.every(guess => {
                if (!guess) return false;
                const upper = guess.toUpperCase();
                return vowels.every(vowel => upper.includes(vowel));
            });
        }
    },
    {
        id: 'achievement_collector',
        name: 'Achievement Collector',
        description: 'Claim your first achievement',
        icon: '🏅',
        check: (gameResult, stats, gameData) => {
            const claimedAchievements = stats.claimedAchievements || [];
            return claimedAchievements.length >= 1;
        }
    }
];

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
    if (stats.bits === undefined || stats.bits === null) {
        stats.bits = 0;
    }
    if (stats.winStreak === undefined || stats.winStreak === null) {
        stats.winStreak = 0;
    }
    if (stats.bestWinStreak === undefined || stats.bestWinStreak === null) {
        stats.bestWinStreak = 0;
    }
    if (stats.consecutiveLosses === undefined || stats.consecutiveLosses === null) {
        stats.consecutiveLosses = 0;
    }
    if (!stats.achievements) {
        stats.achievements = [];
    }
    
    // Track consecutive losses before updating
    const previousConsecutiveLosses = stats.consecutiveLosses;
    
    stats.gamesPlayed++;
    
    if (gameResult.won) {
        stats.wins++;
        // Update win streak
        stats.winStreak++;
        // Update best win streak if current streak is better
        if (stats.winStreak > stats.bestWinStreak) {
            stats.bestWinStreak = stats.winStreak;
        }
        // Reset consecutive losses on win
        stats.consecutiveLosses = 0;
    } else {
        stats.losses++;
        // Reset win streak on loss
        stats.winStreak = 0;
        // Increment consecutive losses
        stats.consecutiveLosses++;
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
            const oldChipPoints = stats.chipPoints;
            stats.chipPoints = gameResult.chipPoints;
            
            // Calculate Bits earned from chips won (only if player won)
            if (gameResult.won && gameResult.chipPointsChange !== undefined && gameResult.chipPointsChange > 0) {
                // Formula: (chipsWon / 5) * 2, rounded up
                const bitsEarned = Math.ceil((gameResult.chipPointsChange / 5) * 2);
                stats.bits = (stats.bits || 0) + bitsEarned;
                console.log(`Earned ${bitsEarned} Bits from winning ${gameResult.chipPointsChange} chips`);
            }
        } else {
            // If server didn't provide chipPoints, don't update (security measure)
            console.warn('Server did not provide chipPoints. Skipping chip update for security.');
        }
    }
    
    // Check for new achievements (before updating consecutive losses for comeback_king)
    // For comeback_king, we need to check before resetting consecutiveLosses
    // Only check achievements for ranked games
    const statsBeforeUpdate = {
        ...stats,
        gamesPlayed: stats.gamesPlayed + 1,
        wins: gameResult.won ? stats.wins + 1 : stats.wins,
        losses: gameResult.won ? stats.losses : stats.losses + 1,
        winStreak: gameResult.won ? stats.winStreak + 1 : 0,
        consecutiveLosses: gameResult.won ? stats.consecutiveLosses : stats.consecutiveLosses + 1
    };
    
    // Only check achievements if this is a ranked game
    if (isRanked) {
        const newAchievements = checkAchievements(gameResult, statsBeforeUpdate, gameResult.gameData || {});
        if (newAchievements.length > 0) {
            // Add new achievements to stats
            newAchievements.forEach(achievementId => {
                if (!stats.achievements.includes(achievementId)) {
                    stats.achievements.push(achievementId);
                    const achievement = ACHIEVEMENTS.find(a => a.id === achievementId);
                    if (achievement) {
                        console.log(`🎉 New achievement unlocked: ${achievement.name} - ${achievement.description}`);
                        // Show notification to user
                        showGameMessage('🎉', 'Achievement Unlocked!', `${achievement.name}: ${achievement.description}`);
                    }
                }
            });
        }
    }
    
    await savePlayerStats(stats);
    await updateStatsDisplay();
    await updateRankDisplay();
    await updateAchievementsDisplay();
    await updateHeaderCurrency();
}

function checkAchievements(gameResult, stats, gameData) {
    const unlocked = [];
    
    ACHIEVEMENTS.forEach(achievement => {
        // Skip if already unlocked
        if (stats.achievements && stats.achievements.includes(achievement.id)) {
            return;
        }
        
        // Check if achievement is unlocked
        try {
            if (achievement.check(gameResult, stats, gameData)) {
                unlocked.push(achievement.id);
            }
        } catch (error) {
            console.error(`Error checking achievement ${achievement.id}:`, error);
        }
    });
    
    return unlocked;
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
    
    // Also update rank display and header currency
    updateRankDisplay().catch(error => {
        console.error('Error updating rank display:', error);
    });
    updateHeaderCurrency().catch(error => {
        console.error('Error updating header currency:', error);
    });
}

// Update currency display in header (Bits and Chips)
async function updateHeaderCurrency() {
    const stats = await getPlayerStats();
    
    const bitsValue = document.getElementById('headerBitsValue');
    const chipsValue = document.getElementById('headerChipsValue');
    
    if (bitsValue) {
        const bits = stats.bits !== undefined && stats.bits !== null ? stats.bits : 0;
        bitsValue.textContent = Math.round(bits).toLocaleString();
    }
    
    if (chipsValue) {
        const chips = stats.chipPoints !== undefined && stats.chipPoints !== null ? stats.chipPoints : 0;
        chipsValue.textContent = Math.round(chips).toLocaleString();
    }
}

async function updateAchievementsDisplay() {
    const stats = await getPlayerStats();
    const achievementsGrid = document.getElementById('achievementsGrid');
    
    if (!achievementsGrid) return;
    
    // Clear existing achievements
    achievementsGrid.innerHTML = '';
    
    const unlockedAchievements = stats.achievements || [];
    const claimedAchievements = stats.claimedAchievements || [];
    
    ACHIEVEMENTS.forEach(achievement => {
        const isUnlocked = unlockedAchievements.includes(achievement.id);
        const isClaimed = claimedAchievements.includes(achievement.id);
        const canClaim = isUnlocked && !isClaimed;
        
        const achievementCard = document.createElement('div');
        achievementCard.className = `achievement-card ${isUnlocked ? 'unlocked' : 'locked'} ${isClaimed ? 'claimed' : ''} ${canClaim ? 'claimable' : ''}`;
        
        if (canClaim) {
            achievementCard.addEventListener('click', async () => {
                await claimAchievement(achievement.id);
            });
            achievementCard.style.cursor = 'pointer';
        }
        
        achievementCard.innerHTML = `
            <div class="achievement-icon">${isUnlocked ? achievement.icon : '🔒'}</div>
            <div class="achievement-info">
                <div class="achievement-name">${achievement.name}</div>
                <div class="achievement-description">${achievement.description}</div>
            </div>
            ${canClaim ? '<div class="achievement-claim-overlay">Claim 10 Bits</div>' : ''}
        `;
        
        achievementsGrid.appendChild(achievementCard);
    });
}

async function claimAchievement(achievementId) {
    if (!currentUser && !isGuestMode) {
        showGameMessage('⚠️', 'Sign In Required', 'Please sign in to claim achievements');
        return;
    }
    
    const stats = await getPlayerStats();
    const claimedAchievements = stats.claimedAchievements || [];
    
    // Check if already claimed
    if (claimedAchievements.includes(achievementId)) {
        showGameMessage('⚠️', 'Already Claimed', 'This achievement has already been claimed');
        return;
    }
    
    // Check if achievement is unlocked
    const unlockedAchievements = stats.achievements || [];
    if (!unlockedAchievements.includes(achievementId)) {
        showGameMessage('⚠️', 'Not Unlocked', 'You must unlock this achievement first');
        return;
    }
    
    // Add to claimed achievements
    if (!stats.claimedAchievements) {
        stats.claimedAchievements = [];
    }
    stats.claimedAchievements.push(achievementId);
    
    // Add 10 bits
    stats.bits = (stats.bits || 0) + 10;
    
    // Save stats
    await savePlayerStats(stats);
    
    // Check for new achievements (like "Achievement Collector" - claiming first achievement)
    const statsAfterClaim = await getPlayerStats();
    const newAchievements = checkAchievements(
        { won: true, guesses: 0, isRanked: false, playerId: currentUser?.uid || null },
        statsAfterClaim,
        { guesses: [], isRanked: false, playerId: currentUser?.uid || null, activeEffects: [] }
    );
    
    if (newAchievements.length > 0) {
        statsAfterClaim.achievements = [...(statsAfterClaim.achievements || []), ...newAchievements];
        await savePlayerStats(statsAfterClaim);
        
        // Show notification for new achievements
        newAchievements.forEach(newAchievementId => {
            const newAchievement = ACHIEVEMENTS.find(a => a.id === newAchievementId);
            if (newAchievement) {
                showGameMessage('🎉', 'Achievement Unlocked!', `${newAchievement.name} - ${newAchievement.description}`);
            }
        });
    }
    
    // Update displays
    await updateStatsDisplay();
    await updateAchievementsDisplay();
    await updateRankDisplay();
    
    // Show success message
    const achievement = ACHIEVEMENTS.find(a => a.id === achievementId);
    showGameMessage('🎉', 'Achievement Claimed!', `You received 10 bits for ${achievement?.name || 'this achievement'}!`);
}

// Daily Bit Claim System
const DAILY_BIT_REWARD = 30;
const DAILY_CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Check if daily claim is available
function isDailyClaimAvailable(lastClaimDate) {
    if (!lastClaimDate) {
        return true; // Never claimed before
    }
    
    const lastClaim = new Date(lastClaimDate);
    const now = new Date();
    const timeSinceLastClaim = now.getTime() - lastClaim.getTime();
    
    return timeSinceLastClaim >= DAILY_CLAIM_COOLDOWN_MS;
}

// Get time until next claim is available (in milliseconds)
function getTimeUntilNextClaim(lastClaimDate) {
    if (!lastClaimDate) {
        return 0; // Available now
    }
    
    const lastClaim = new Date(lastClaimDate);
    const now = new Date();
    const timeSinceLastClaim = now.getTime() - lastClaim.getTime();
    const timeUntilNext = DAILY_CLAIM_COOLDOWN_MS - timeSinceLastClaim;
    
    return Math.max(0, timeUntilNext);
}

// Format time remaining as human-readable string
function formatTimeRemaining(ms) {
    if (ms <= 0) return 'Available now';
    
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((ms % (60 * 1000)) / 1000);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    } else {
        return `${seconds}s`;
    }
}

// Claim daily bits
async function claimDailyChips() {
    const stats = await getPlayerStats();
    
    // Check if claim is available
    if (!isDailyClaimAvailable(stats.lastDailyClaim)) {
        const timeRemaining = getTimeUntilNextClaim(stats.lastDailyClaim);
        showGameMessage('⏰', 'Daily Claim', `You can claim again in ${formatTimeRemaining(timeRemaining)}`);
        return;
    }
    
    // Update stats - give bits instead of chips
    stats.bits = (stats.bits || 0) + DAILY_BIT_REWARD;
    stats.lastDailyClaim = new Date().toISOString();
    
    // Save stats
    await savePlayerStats(stats);
    
    // Update UI
    await updateStatsDisplay();
    await updateHeaderCurrency();
    updateDailyClaimUI();
    
    // Show success message
    showGameMessage('🎁', 'Daily Bonus Claimed!', `You received ${DAILY_BIT_REWARD} bits!`);
    
    // Play success sound if available
    if (typeof soundManager !== 'undefined') {
        soundManager.playCardSelect();
    }
}

// Update daily claim UI
async function updateDailyClaimUI() {
    // Clear any existing countdown interval
    if (window.dailyClaimCountdownInterval) {
        clearInterval(window.dailyClaimCountdownInterval);
        window.dailyClaimCountdownInterval = null;
    }
    
    const dailyClaimContainer = document.getElementById('dailyChipClaim');
    const claimBtn = document.getElementById('dailyChipClaimBtn');
    const claimSubtitle = document.getElementById('dailyChipClaimSubtitle');
    
    if (!dailyClaimContainer || !claimBtn || !claimSubtitle) {
        return; // UI elements not found
    }
    
    const stats = await getPlayerStats();
    const isAvailable = isDailyClaimAvailable(stats.lastDailyClaim);
    
    if (isAvailable) {
        // Claim is available
        claimBtn.disabled = false;
        claimBtn.textContent = 'Claim';
        claimSubtitle.textContent = `Claim ${DAILY_BIT_REWARD} bits!`;
        dailyClaimContainer.classList.remove('daily-claim-cooldown');
        dailyClaimContainer.classList.add('daily-claim-available');
    } else {
        // Claim is on cooldown
        claimBtn.disabled = true;
        const timeRemaining = getTimeUntilNextClaim(stats.lastDailyClaim);
        claimSubtitle.textContent = `Next claim in ${formatTimeRemaining(timeRemaining)}`;
        dailyClaimContainer.classList.remove('daily-claim-available');
        dailyClaimContainer.classList.add('daily-claim-cooldown');
        
        // Update countdown every second (only if still on cooldown)
        if (timeRemaining > 0) {
            window.dailyClaimCountdownInterval = setInterval(() => {
                getPlayerStats().then(updatedStats => {
                    const timeRemaining = getTimeUntilNextClaim(updatedStats.lastDailyClaim);
                    if (timeRemaining <= 0) {
                        if (window.dailyClaimCountdownInterval) {
                            clearInterval(window.dailyClaimCountdownInterval);
                            window.dailyClaimCountdownInterval = null;
                        }
                        updateDailyClaimUI(); // Refresh UI
                    } else {
                        const subtitleEl = document.getElementById('dailyChipClaimSubtitle');
                        if (subtitleEl) {
                            subtitleEl.textContent = `Next claim in ${formatTimeRemaining(timeRemaining)}`;
                        }
                    }
                });
            }, 1000);
        }
    }
}

// Clear cached stats when user changes (login/logout)
function clearStatsCache() {
    cachedStats = null;
}

// Ranking System (Rainbow Six Siege style)
const RANK_TIERS = [
    { name: 'Copper', subRanks: ['V', 'IV', 'III', 'II', 'I'], minChips: 0, maxChips: 1199, color: '#8B4513' },
    { name: 'Bronze', subRanks: ['V', 'IV', 'III', 'II', 'I'], minChips: 1200, maxChips: 2399, color: '#CD7F32', protected: true },
    { name: 'Silver', subRanks: ['V', 'IV', 'III', 'II', 'I'], minChips: 2400, maxChips: 3599, color: '#C0C0C0' },
    { name: 'Gold', subRanks: ['V', 'IV', 'III', 'II', 'I'], minChips: 3600, maxChips: 4799, color: '#FFD700', protected: true },
    { name: 'Platinum', subRanks: ['V', 'IV', 'III', 'II', 'I'], minChips: 4800, maxChips: 5999, color: '#00CED1' },
    { name: 'Diamond', subRanks: ['V', 'IV', 'III', 'II', 'I'], minChips: 6000, maxChips: 7999, color: '#B9F2FF', protected: true },
    { name: 'Champion', subRanks: ['V', 'IV', 'III', 'II', 'I'], minChips: 8000, maxChips: 9999, color: '#FF1493' }
];

// Get the highest protected rank threshold that the player has reached
// Protected ranks (every other rank): Bronze (1200), Gold (3600), Diamond (6000)
// Once you reach a protected rank, you cannot drop below its minimum chip threshold
function getProtectedRankThreshold(chipPoints) {
    // Check in reverse order (highest first) to find the highest protected rank reached
    const protectedThresholds = [
        { rank: 'Diamond', minChips: 6000 },
        { rank: 'Gold', minChips: 3600 },
        { rank: 'Bronze', minChips: 1200 }
    ];
    
    for (const threshold of protectedThresholds) {
        if (chipPoints >= threshold.minChips) {
            return threshold.minChips;
        }
    }
    
    return 0; // No protection below Bronze
}

// Apply rank protection - prevents dropping below protected rank thresholds
// Example: If player has 1500 chips (Bronze), they cannot drop below 1200 (Bronze minimum)
// Example: If player has 4000 chips (Gold), they cannot drop below 3600 (Gold minimum)
function applyRankProtection(currentChipPoints, newChipPoints) {
    // Get the highest protected rank threshold the player has reached
    const protectedThreshold = getProtectedRankThreshold(currentChipPoints);
    
    // If player has reached a protected rank, don't let them drop below it
    if (protectedThreshold > 0 && newChipPoints < protectedThreshold) {
        console.log(`Rank protection: Preventing drop from ${currentChipPoints} to ${newChipPoints}. Setting to ${protectedThreshold} (protected rank threshold)`);
        return protectedThreshold;
    }
    
    return newChipPoints;
}

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
    
    // Also update header currency when rank is updated
    updateHeaderCurrency().catch(error => {
        console.error('Error updating header currency:', error);
    });
    
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
        
        // Calculate total chip range across all tiers
        const minChips = RANK_TIERS[0].minChips;
        const maxChips = RANK_TIERS[RANK_TIERS.length - 1].maxChips;
        const totalChipRange = maxChips - minChips;
        
        // Calculate position based on chip value within total range
        // Clamp chipPoints to valid range
        const clampedChips = Math.max(minChips, Math.min(maxChips, chipPoints));
        const chipsFromStart = clampedChips - minChips;
        const rankPosition = chipsFromStart / totalChipRange;
        
        const fillPercentage = rankPosition * 100;
        const indicatorPosition = fillPercentage;
        progressBarFill.style.width = `${fillPercentage}%`;
        progressBarFill.style.background = `linear-gradient(90deg, ${currentRank.color}, ${currentRank.color})`;
        
        // Position current rank indicator (clamp to 0-100%)
        const clampedPosition = Math.max(0, Math.min(100, indicatorPosition));
        currentRankIndicator.style.left = `${clampedPosition}%`;
        
        // Update rank badge with image
        const rankImagePath = getRankImagePath(currentRank.tier, currentRank.subRank);
        currentRankBadge.innerHTML = `<img src="${rankImagePath}" alt="${currentRank.fullRank}" class="rank-badge-image">`;
        currentRankBadge.style.backgroundColor = currentRank.color;
        currentRankBadge.style.borderColor = currentRank.color;
        
        // Create markers for each tier (not each sub-rank to avoid clutter)
        RANK_TIERS.forEach((tier, tierIndex) => {
            const marker = document.createElement('div');
            marker.className = 'rank-marker';
            
            // Calculate position for this tier based on chip value
            const tierChipsFromStart = tier.minChips - minChips;
            const markerPosition = (tierChipsFromStart / totalChipRange) * 100;
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
            
            // Apply camo to falling card
            const camoId = getCardCamo(randomCard.id);
            const camo = AVAILABLE_CAMOS.find(c => c.id === camoId);
            if (camo && camo.filename) {
                element.style.backgroundImage = `url('images/Card Camo/${camo.filename}')`;
                element.style.backgroundSize = 'cover';
                element.style.backgroundPosition = 'center';
                element.style.backgroundRepeat = 'no-repeat';
            } else {
                element.style.backgroundImage = '';
            }
            
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
        const screenIds = ['splash', 'credits', 'newCardAnnouncement', 'login', 'signup', 'guestName', 'forgotPassword', 'emailVerification', 'lobby', 'gameSettings', 'customWordInput', 'waiting', 'vs', 'game', 'gameOver', 'spectatorGameOver'];
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
            // CRITICAL: Clear all game effects when leaving game screen
            removeDrunkEffect();
            if (gameState) {
                gameState.activeEffects = [];
                console.log('Cleared all active effects when leaving game screen');
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
    
    // Hide any connection error messages
    const connectionErrorEl = document.getElementById('connectionError');
    if (connectionErrorEl) {
        connectionErrorEl.style.display = 'none';
    }
});

socket.on('disconnect', (reason) => {
    console.warn('Disconnected from server:', reason);
    
    // Show connection status to user
    if (reason === 'io server disconnect') {
        // Server disconnected the client, manual reconnection needed
        console.log('Server disconnected. Reconnecting...');
        socket.connect();
    } else if (reason === 'io client disconnect') {
        // Client disconnected intentionally, don't reconnect
        console.log('Client disconnected intentionally');
    } else {
        // Network error or other issue, Socket.io will auto-reconnect
        console.log('Connection lost. Attempting to reconnect...');
    }
});

socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected to server after', attemptNumber, 'attempt(s)');
    // Register user as online again after reconnection
    registerUserAsOnline();
    
    // Hide any connection error messages
    const connectionErrorEl = document.getElementById('connectionError');
    if (connectionErrorEl) {
        connectionErrorEl.style.display = 'none';
    }
});

socket.on('reconnect_attempt', (attemptNumber) => {
    console.log('Reconnection attempt', attemptNumber);
});

socket.on('reconnect_error', (error) => {
    console.error('Reconnection error:', error);
});

socket.on('reconnect_failed', () => {
    console.error('Failed to reconnect to server');
    // Show persistent error message to user
    showGameMessage('⚠️', 'Connection Lost', 'Unable to reconnect to server. Please refresh the page.');
});

socket.on('gameCreated', (data) => {
    console.log('gameCreated event received:', data);
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
    
    // Store gameId for custom word input
    window.pendingGameId = data.gameId;
    
    // If duel deck mode, show word input screen
    console.log('Checking gameMode:', data.gameMode);
    if (data.gameMode === 'duelDeck') {
        console.log('Showing duel deck word input screen');
        // Ensure screen is visible
        const customWordScreen = document.getElementById('customWordInput');
        if (customWordScreen) {
            console.log('Duel deck word screen element found');
            // Reset input state before showing screen
            const wordInput = document.getElementById('customWordInputField');
            const submitBtn = document.getElementById('submitCustomWordBtn');
            if (wordInput) {
                wordInput.disabled = false;
                wordInput.readOnly = false;
                wordInput.value = '';
            }
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="btn-icon">✓</span><span>Submit Word</span>';
            }
            ScreenManager.show('customWordInput');
            // Double-check it's visible
            setTimeout(() => {
                if (!customWordScreen.classList.contains('active')) {
                    console.error('Duel deck word screen not active after show!');
                    customWordScreen.classList.add('active');
                }
                initializeCustomWordInput(data.gameId);
            }, 100);
        } else {
            console.error('Duel deck word screen element not found in DOM!');
        }
    } else {
        console.log('Showing waiting screen (classic mode)');
        ScreenManager.show('waiting');
    }
});

socket.on('playerJoinedGame', (data) => {
    console.log('playerJoinedGame event received:', data);
    // Set currentPlayer when joining a game (for player 2)
    if (!currentPlayer) {
        currentPlayer = data.playerId;
        console.log('Set currentPlayer from joinGame:', currentPlayer);
    }
    
    // Store gameId for custom word input
    window.pendingGameId = data.gameId;
    
    // If duel deck mode, show word input screen
    console.log('Checking gameMode:', data.gameMode);
    if (data.gameMode === 'duelDeck') {
        console.log('Showing duel deck word input screen (joiner)');
        // Ensure screen is visible
        const customWordScreen = document.getElementById('customWordInput');
        if (customWordScreen) {
            console.log('Duel deck word screen element found (joiner)');
            // Reset input state before showing screen
            const wordInput = document.getElementById('customWordInputField');
            const submitBtn = document.getElementById('submitCustomWordBtn');
            if (wordInput) {
                wordInput.disabled = false;
                wordInput.readOnly = false;
                wordInput.value = '';
            }
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="btn-icon">✓</span><span>Submit Word</span>';
            }
            ScreenManager.show('customWordInput');
            // Double-check it's visible
            setTimeout(() => {
                if (!customWordScreen.classList.contains('active')) {
                    console.error('Duel deck word screen not active after show (joiner)!');
                    customWordScreen.classList.add('active');
                }
                initializeCustomWordInput(data.gameId);
            }, 100);
        } else {
            console.error('Duel deck word screen element not found in DOM (joiner)!');
        }
    }
});

socket.on('playerJoined', (data) => {
    updatePlayersList(data.players);
    if (data.players.length === 2) {
        const waitingMessage = document.getElementById('waitingMessage');
        if (waitingMessage) {
            waitingMessage.textContent = 'Starting game...';
        }
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
    console.log('Game mode:', data.settings?.gameMode);
    
    // For duel deck mode, ensure both players have submitted words before starting
    // This should already be handled server-side, but add a safety check
    if (data.settings && data.settings.gameMode === 'duelDeck') {
        console.log('Duel deck mode detected in gameStarted - this should only happen after both words are submitted');
    }
    
    // Set currentPlayer from the event if not already set
    if (data.yourPlayerId) {
        currentPlayer = data.yourPlayerId;
        console.log('Set currentPlayer from gameStarted:', currentPlayer);
    }
    
    console.log('My player ID:', currentPlayer);
    
    // Remove yourPlayerId from data before storing in gameState, but preserve isTutorial
    const { yourPlayerId, ...gameStateData } = data;
    
    // CRITICAL: Clear all game effects when starting a new game
    // Remove drunk effect (moonshine) - ensure it's cleared before new game
    removeDrunkEffect();
    
    // CRITICAL: Ensure activeEffects is always properly initialized for new games
    // This prevents cards from being grayed out due to stale cardLock effects from previous games
    if (!gameStateData.activeEffects || !Array.isArray(gameStateData.activeEffects)) {
        gameStateData.activeEffects = [];
    } else if (gameStateData.activeEffects.length > 0) {
        // If server sent activeEffects with content, log a warning but trust the server
        // (shouldn't happen for new games, but if it does, we want to know)
        console.warn('New game has activeEffects - this should be empty for new games:', gameStateData.activeEffects);
        // However, for safety, clear ALL effects for new game (server should send empty array)
        gameStateData.activeEffects = [];
        console.log('Cleared all active effects from gameStarted event');
    }
    
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
    
    // Update turn time limit from game settings
    if (data.settings && data.settings.turnTimeLimit) {
        TURN_TIME_LIMIT = data.settings.turnTimeLimit;
        turnTimeRemaining = TURN_TIME_LIMIT;
        console.log('Turn time limit set from game settings:', TURN_TIME_LIMIT, 'seconds');
    } else {
        // Default to 60 if no settings
        TURN_TIME_LIMIT = 60;
        turnTimeRemaining = 60;
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
            // Add admin class if current user is admin (permanent list OR /admins/{uid})
            (async () => {
                try {
                    const isMeAdmin = await isAdminAsync();
                    vsPlayer1Name.classList.toggle('admin-name', isMeAdmin === true);
                } catch {
                    vsPlayer1Name.classList.remove('admin-name');
                }
            })();
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
            // Check if opponent is admin (permanent list OR /admins/{uid})
            if (opponentData && opponentData.firebaseUid && window.firebaseDb) {
                window.firebaseDb.collection('users').doc(opponentData.firebaseUid).get()
                    .then(userDoc => {
                        if (userDoc.exists) {
                            const userData = userDoc.data();
                            const opponentEmail = userData.email || '';
                            isUserAdminByUid(opponentData.firebaseUid, opponentEmail)
                                .then(isOppAdmin => {
                                    vsPlayer2Name.classList.toggle('admin-name', isOppAdmin === true);
                                })
                                .catch(() => {
                                    vsPlayer2Name.classList.remove('admin-name');
                                });
                        } else {
                            vsPlayer2Name.classList.remove('admin-name');
                        }
                    })
                    .catch(() => {
                        vsPlayer2Name.classList.remove('admin-name');
                    });
            } else {
                vsPlayer2Name.classList.remove('admin-name');
            }
        }
        
        // Update player 2 avatar
        if (vsPlayer2Avatar) {
            const initial = player2Name.charAt(0).toUpperCase() || '👤';
            // Check if opponent has photoURL in the game data
            if (opponentData && opponentData.photoURL) {
                applyProfileImage(vsPlayer2Avatar, opponentData.photoURL, initial);
            } else if (opponentData && opponentData.firebaseUid && window.firebaseDb) {
                // Try to fetch from Firestore if we have firebaseUid
                window.firebaseDb.collection('users').doc(opponentData.firebaseUid).get()
                    .then(userDoc => {
                        if (userDoc.exists && userDoc.data().photoURL) {
                            applyProfileImage(vsPlayer2Avatar, userDoc.data().photoURL, initial);
                        } else {
                            applyProfileImage(vsPlayer2Avatar, null, initial);
                        }
                    })
                    .catch(() => {
                        applyProfileImage(vsPlayer2Avatar, null, initial);
                    });
            } else {
                applyProfileImage(vsPlayer2Avatar, null, initial);
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
            const findCasualMatchBtn = document.getElementById('findCasualMatchBtn');
            if (matchmakingStatus) {
                matchmakingStatus.style.display = 'none';
            }
            if (findMatchBtn) {
                findMatchBtn.disabled = false;
            }
            if (findCasualMatchBtn) {
                findCasualMatchBtn.disabled = false;
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
    
    // Validate data
    if (!data || !data.playerId || !data.card) {
        console.error('cardSelected: Invalid data received', data);
        return;
    }
    
    // Validate game state
    if (!gameState || !currentPlayer || !gameState.gameId) {
        console.error('cardSelected: Invalid game state', { gameState: !!gameState, currentPlayer, gameId: gameState?.gameId });
        return;
    }
    
    if (data.playerId === currentPlayer) {
        selectedCard = data.card;
        
        // Track card usage for achievements
        if (data.card && data.card.id) {
            if (!window.gameCardsPlayed) {
                window.gameCardsPlayed = [];
            }
            if (!window.gameCardsPlayed.includes(data.card.id)) {
                window.gameCardsPlayed.push(data.card.id);
            }
        }
        
        // Handle Slow Motion card as fallback (primary handler is slowMotionPlayed event)
        // This is a backup in case the server event doesn't fire or arrives late
        // Use a small delay to allow the server event to fire first
        if (data.card && data.card.id === 'slowMotion' && gameState && gameState.currentTurn === currentPlayer) {
            setTimeout(() => {
                // Only use fallback if slowMotionUsed flag wasn't set by the server event
                if (!window.slowMotionUsed && gameState && gameState.currentTurn === currentPlayer) {
                    console.log('Slow Motion: Fallback handler in cardSelected - adding 30 seconds (server event may not have fired)');
                    if (typeof turnTimeRemaining !== 'undefined' && turnTimeRemaining !== null) {
                        const oldTime = turnTimeRemaining;
                        turnTimeRemaining += 30;
                        if (!window.slowMotionMaxTime || turnTimeRemaining > window.slowMotionMaxTime) {
                            window.slowMotionMaxTime = turnTimeRemaining;
                        }
                        window.slowMotionUsed = true;
                        updateTimerDisplay(true);
                        console.log(`Slow Motion (fallback): Timer increased from ${oldTime} to ${turnTimeRemaining} seconds`);
                    }
                } else {
                    console.log('Slow Motion: Fallback skipped - server event already processed');
                }
            }, 100);
        }
        
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
                // Validate state before showing card selection again
                if (gameState && currentPlayer && gameState.gameId && gameState.currentTurn === currentPlayer) {
                    showCardSelection();
                    generateCards(); // Regenerate with player's own cards (not opponent's)
                } else {
                    console.error('cardSelected: Cannot show card selection - invalid state', {
                        hasGameState: !!gameState,
                        currentPlayer,
                        gameId: gameState?.gameId,
                        currentTurn: gameState?.currentTurn
                    });
                    cardChainActive = false; // Reset on error
                    hideCardSelection();
                    showGameBoard();
                }
            }, 100);
        } else {
            // Final card in chain - hide selection and show board
            cardChainActive = false; // Clear flag
            window.snackTimeMode = false; // Clear snack time mode
            hideCardSelection();
            // If Slow Motion was just used, ensure timer is preserved
            if (window.slowMotionUsed && turnTimeRemaining > TURN_TIME_LIMIT) {
                console.log(`Slow Motion active - preserving timer at ${turnTimeRemaining} before showing game board`);
            }
            showGameBoard();
        }
    }
});

socket.on('slowMotionPlayed', (data) => {
    // Handle Slow Motion card - add time to current timer for both players
    // Both players receive this event and both should update their timer display
    console.log('Slow Motion played event received:', data);
    
    // Check if it's for the current game
    if (!gameState || gameState.gameId !== data.gameId) {
        console.log('Slow Motion: Wrong game, skipping timer update', {
            gameId: gameState?.gameId,
            dataGameId: data.gameId
        });
        return;
    }
    
    // Convert to strings for comparison to avoid type mismatch issues
    const currentTurnStr = String(gameState.currentTurn || '').trim();
    const playerIdStr = String(data.playerId || '').trim();
    const currentPlayerStr = String(currentPlayer || '').trim();
    
    // The player who played Slow Motion should be the current turn
    // Both players should update their timer to stay in sync (both are watching the same timer)
    const isCurrentTurn = currentTurnStr === playerIdStr;
    const isMyTurn = currentTurnStr === currentPlayerStr;
    
    console.log('Slow Motion: Processing for both players', {
        currentTurn: currentTurnStr,
        playerId: playerIdStr,
        currentPlayer: currentPlayerStr,
        isCurrentTurn: isCurrentTurn,
        isMyTurn: isMyTurn,
        turnTimeRemaining: turnTimeRemaining
    });
    
    // Update timer for BOTH players - both are watching the same timer countdown
    // Only requirement is that it's the current player's turn (whoever that is)
    // Both players will receive this event and both should update to stay in sync
    if (gameState.currentTurn && isCurrentTurn) {
        // Safety check - ensure turnTimeRemaining is defined
        if (typeof turnTimeRemaining === 'undefined' || turnTimeRemaining === null) {
            console.error('Slow Motion: turnTimeRemaining is not defined, initializing to 60');
            turnTimeRemaining = TURN_TIME_LIMIT || 60;
        }
        
        const oldTime = turnTimeRemaining;
        const addSeconds = data.addSeconds || 30;
        // Add seconds to CURRENT time (not starting from 60)
        turnTimeRemaining += addSeconds;
        // Store the maximum extended time for circle calculation (use this as the "full" time)
        if (!window.slowMotionMaxTime || turnTimeRemaining > window.slowMotionMaxTime) {
            window.slowMotionMaxTime = turnTimeRemaining;
        }
        // Mark that Slow Motion was used so subsequent calls don't reset it
        window.slowMotionUsed = true;
        // Update display immediately - force recalculation of circle with new time
        updateTimerDisplay(true);
        console.log(`✅ Slow Motion: Timer increased from ${oldTime} to ${turnTimeRemaining} seconds (added ${addSeconds}, max: ${window.slowMotionMaxTime}, isMyTurn: ${isMyTurn}, currentPlayer: ${currentPlayerStr})`);
    } else {
        console.warn('❌ Slow Motion: Conditions not met - cannot update timer', {
            hasCurrentTurn: !!gameState.currentTurn,
            currentTurn: currentTurnStr,
            playerId: playerIdStr,
            isCurrentTurn: isCurrentTurn,
            turnTimeRemaining: turnTimeRemaining
        });
    }
});

socket.on('activeEffectsUpdated', (data) => {
    // Update gameState with new active effects
    // CRITICAL: Only update if gameId matches current game (prevent stale updates from previous games)
    if (gameState && gameState.gameId === data.gameId && data.gameId) {
        // Store old activeEffects before updating (for comparison)
        const oldActiveEffects = gameState.activeEffects || [];
        
        // Check effects before updating (using old array)
        const hadAmnesiaBefore = oldActiveEffects.some(e =>
            e.type === 'amnesia' && e.target === currentPlayer && !e.used
        );
        const hadBlackHandBefore = oldActiveEffects.some(e => 
            e.type === 'blackHand' && e.target === currentPlayer && !e.used
        );
        const hadMoonshineBefore = oldActiveEffects.some(e =>
            e.type === 'moonshine' && e.target === currentPlayer && !e.used
        );
        
        // Check timeRush before updating (to detect if it was cleared)
        const currentTurnPlayerId = gameState.currentTurn;
        const hadTimeRushBefore = oldActiveEffects.some(e => 
            e.type === 'timeRush' && e.target === currentTurnPlayerId && !e.used
        );
        const oldTimeLimit = hadTimeRushBefore ? 20 : TURN_TIME_LIMIT;
        
        // Remove any temporary effects that might have been optimistically added
        if (gameState.activeEffects) {
            // Keep only one blackHand effect if multiple exist (server's version is authoritative)
            const blackHandEffects = gameState.activeEffects.filter(e => 
                e.type === 'blackHand' && e.target === currentPlayer
            );
            if (blackHandEffects.length > 1) {
                // Remove temporary ones, keep the first
                gameState.activeEffects = gameState.activeEffects.filter((e, index, arr) => {
                    if (e.type === 'blackHand' && e.target === currentPlayer) {
                        return index === arr.findIndex(ee => ee.type === 'blackHand' && ee.target === currentPlayer);
                    }
                    return true;
                });
            }
        }
        
        // Update with new active effects (server's authoritative version)
        gameState.activeEffects = data.activeEffects;
        console.log('Active effects updated:', data.activeEffects);
        console.log('Previous active effects:', oldActiveEffects);
        
        // Check if amnesia is still active (check new array)
        const hasAmnesiaAfter = gameState.activeEffects && gameState.activeEffects.some(e =>
            e.type === 'amnesia' && e.target === currentPlayer && !e.used
        );
        
        // If amnesia was active before and is now cleared, show all guesses again
        if (hadAmnesiaBefore && !hasAmnesiaAfter) {
            console.log('Amnesia effect cleared - showing all guesses again');
            // Use a small delay to ensure any pending animations complete
            setTimeout(() => {
                showAllGuesses();
            }, 300);
        } else if (!hadAmnesiaBefore && hasAmnesiaAfter) {
            // Amnesia was just added - immediately blank out all previous guesses
            console.log('Amnesia effect just added - blanking out all previous guesses');
            setTimeout(() => {
                hideAllPreviousGuesses();
            }, 100);
        }
        
        // Check if blackHand effect changed
        const hasBlackHandAfter = gameState.activeEffects && gameState.activeEffects.some(e => 
            e.type === 'blackHand' && e.target === currentPlayer && !e.used
        );
        
        // Check if moonshine effect changed
        const hasMoonshineAfter = gameState.activeEffects && gameState.activeEffects.some(e =>
            e.type === 'moonshine' && e.target === currentPlayer && !e.used
        );
        
        console.log('Moonshine effect check:', {
            hadMoonshineBefore,
            hasMoonshineAfter,
            oldEffects: oldActiveEffects.filter(e => e.type === 'moonshine' && e.target === currentPlayer),
            newEffects: (gameState.activeEffects || []).filter(e => e.type === 'moonshine' && e.target === currentPlayer)
        });
        
        // Apply or remove drunk effect based on moonshine status
        if (hadMoonshineBefore && !hasMoonshineAfter) {
            console.log('Moonshine effect cleared - removing drunk effect');
            removeDrunkEffect();
        } else if (!hadMoonshineBefore && hasMoonshineAfter) {
            console.log('Moonshine effect just added - applying drunk effect');
            setTimeout(() => {
                applyDrunkEffect();
            }, 100);
        }
        
        // Update keyboard visibility if hiddenKeyboard effect changed
        updateKeyboardVisibility();
        
        // Update hand panel and card selection if blackHand effect changed
        if (hadBlackHandBefore !== hasBlackHandAfter) {
            console.log('Black Hand effect changed - updating hand panel immediately');
            // Update immediately (activeEffectsUpdated confirms the effect is now in gameState)
            updateHandPanel();
            // Also update card selection if it's visible
            if (document.getElementById('cardSelection') && document.getElementById('cardSelection').classList.contains('active')) {
                generateCards();
            }
        }
        
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
    // Prevent duplicate processing
    if (isProcessingTurnChange) {
        console.warn('turnChanged: Already processing, skipping duplicate event');
        return;
    }
    
    // Clear any pending timeouts to prevent conflicts
    if (turnChangeTimeoutId) {
        clearTimeout(turnChangeTimeoutId);
        turnChangeTimeoutId = null;
    }
    if (cardSelectionTimeoutId) {
        clearTimeout(cardSelectionTimeoutId);
        cardSelectionTimeoutId = null;
    }
    
    isProcessingTurnChange = true;
    
    // Handle spectators in the same handler (removes need for duplicate handler)
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
        isProcessingTurnChange = false;
        return;
    }
    
    // Skip if spectator (but not in spectator mode)
    if (window.isSpectator) {
        isProcessingTurnChange = false;
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
    
    // Clear Slow Motion flag on turn change (new turn, new timer)
    window.slowMotionUsed = false;
    window.slowMotionMaxTime = null; // Clear the max time tracking
    
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
    
    // Update hand panel when turn changes (to reflect blackHand effect changes)
    updateHandPanel();
    
    // Always show game board so players can see previous guesses
    showGameBoard();
    
    // Handle Amnesia effect - check if guesses should be blanked
    const amnesiaActive = gameState && gameState.activeEffects && Array.isArray(gameState.activeEffects) && gameState.activeEffects.some(e =>
        e && e.type === 'amnesia' && e.target === currentPlayer && e.used === false
    );
    
    console.log('turnChanged - amnesia check:', {
        amnesiaActive,
        myTurn,
        currentPlayer,
        activeEffects: gameState?.activeEffects?.filter(e => e?.type === 'amnesia')
    });
    
    if (amnesiaActive) {
        // Amnesia is active on me - blank out all previous guesses (regardless of whose turn it is)
        console.log('Amnesia active - blanking out all previous guesses');
        turnChangeTimeoutId = setTimeout(() => {
            hideAllPreviousGuesses();
        }, 200);
    } else {
        // Amnesia not active - show all guesses that were blanked
        showAllGuesses();
    }
    
    // Handle Moonshine effect - check if drunk effect should be applied
    const moonshineActive = gameState && gameState.activeEffects && Array.isArray(gameState.activeEffects) && gameState.activeEffects.some(e =>
        e && e.type === 'moonshine' && e.target === currentPlayer && e.used === false
    );
    
    if (moonshineActive) {
        // Moonshine is active - apply drunk effect
        turnChangeTimeoutId = setTimeout(() => {
            applyDrunkEffect();
        }, 100);
    } else {
        // Moonshine is not active - remove drunk effect
        removeDrunkEffect();
    }
    
    // Play turn change sound
    if (typeof soundManager !== 'undefined') {
        soundManager.playTurnChange();
    }
    
    if (myTurn) {
        // It's my turn - show card selection and enable input
        console.log('✓ Showing card selection for my turn');
        
        // Helper function to show card selection
        const showCardSelectionNow = () => {
            // Clear processing flag
            isProcessingTurnChange = false;
            
            // Validate state before showing cards
            if (!gameState || !currentPlayer || !gameState.gameId) {
                console.error('showCardSelectionNow: Invalid game state', { gameState: !!gameState, currentPlayer, gameId: gameState?.gameId });
                showGameMessage('⚠️', 'Game Error', 'Game state is invalid. Please refresh.');
                return;
            }
            
            // Double-check it's still our turn (race condition protection)
            if (gameState.currentTurn !== currentPlayer) {
                console.warn('showCardSelectionNow: Turn changed before showing cards', { currentTurn: gameState.currentTurn, currentPlayer });
                return;
            }
            
            selectedCard = null; // Reset selected card for new turn
            cardChainActive = false; // Reset card chain flag
            window.snackTimeMode = false; // Clear snack time mode
            window.finesseMode = false; // Clear finesse mode
            window.handRevealMode = false; // Clear hand reveal mode
            
            showCardSelection();
            const wordInput = document.getElementById('wordInput');
            if (wordInput) {
                wordInput.disabled = false;
                wordInput.value = '';
                // Focus input after a short delay to ensure card selection is visible
                setTimeout(() => {
                    if (wordInput && gameState && gameState.currentTurn === currentPlayer) {
                        wordInput.focus();
                    }
                }, 100);
            }
        };
        
        // Check if it's the first turn (no guesses made yet)
        const isFirstTurn = !gameState || !gameState.totalGuesses || gameState.totalGuesses === 0;
        
        if (isFirstTurn) {
            // First turn - show immediately with small delay for state to settle
            cardSelectionTimeoutId = setTimeout(showCardSelectionNow, 150);
        } else {
            // Not first turn - wait 3 seconds before showing card selection
            cardSelectionTimeoutId = setTimeout(showCardSelectionNow, 3000);
        }
    } else {
        // It's opponent's turn - hide card selection, disable input
        console.log('✗ Hiding card selection - opponent\'s turn');
        isProcessingTurnChange = false; // Clear flag immediately for opponent's turn
        
        hideCardSelection();
        const wordInput = document.getElementById('wordInput');
        if (wordInput) {
            wordInput.disabled = true;
            wordInput.value = '';
        }
        
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
        // Check if amnesia is active - if so, blank out this guess (it's a previous guess)
        const amnesiaActive = gameState && gameState.activeEffects && gameState.activeEffects.some(e =>
            e.type === 'amnesia' && e.target === currentPlayer && !e.used
        );
        
        // Note: Previous guesses are already blanked when amnesia is played
        // New guesses during the turn will be displayed normally
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
                
                // Get camo for this card (using current player's camo since they're playing it)
                const camoId = getCardCamo(card.id);
                
                // Send the selected card to server
                socket.emit('selectOpponentCard', {
                    gameId: gameId,
                    card: card,
                    camoId: camoId // Include camo so both players see the same camo
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
    
    // CRITICAL: Clear all game effects when game ends
    // Remove drunk effect (moonshine)
    removeDrunkEffect();
    
    // Clear all active effects from gameState
    if (gameState) {
        gameState.activeEffects = [];
        console.log('Cleared all active effects on game over');
    }
    
    // CRITICAL: Skip stats updates for spectators - they should use the spectator game over screen
    if (window.isSpectator && window.spectatorGameId) {
        console.log('Spectator detected in gameOver - skipping main handler, using spectator handler');
        return; // Let the spectator handler below handle it
    }
    
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
            
            // Handle duel deck mode - show opponent's word (the word you were trying to guess)
            if (data.gameMode === 'duelDeck') {
                wordEl.textContent = data.opponentWord || 'N/A';
                if (data.opponentWord) {
                    fetchWordDefinition(data.opponentWord);
                }
            } else {
                wordEl.textContent = data.word || '';
                if (data.word) {
                    fetchWordDefinition(data.word);
                }
            }
            
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
            
            // Handle duel deck mode - show opponent's word (the word you were trying to guess)
            if (data.gameMode === 'duelDeck') {
                wordEl.textContent = data.opponentWord || 'N/A';
                if (data.opponentWord) {
                    fetchWordDefinition(data.opponentWord);
                }
            } else {
                wordEl.textContent = data.word || '';
                if (data.word) {
                    fetchWordDefinition(data.word);
                }
            }
            
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
            
            // Handle duel deck mode - show opponent's word (the word you were trying to guess)
            if (data.gameMode === 'duelDeck') {
                wordEl.textContent = data.opponentWord || 'N/A';
                if (data.opponentWord) {
                    fetchWordDefinition(data.opponentWord);
                }
            } else {
                wordEl.textContent = data.word || '';
                if (data.word) {
                    fetchWordDefinition(data.word);
                }
            }
            
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
            
            // Handle duel deck mode - show opponent's word (the word you were trying to guess)
            if (data.gameMode === 'duelDeck') {
                wordEl.textContent = data.opponentWord || 'N/A';
                if (data.opponentWord) {
                    fetchWordDefinition(data.opponentWord);
                }
            } else {
                wordEl.textContent = data.word || '';
                if (data.word) {
                    fetchWordDefinition(data.word);
                }
            }
            
            // Play lose sound
            if (typeof soundManager !== 'undefined') {
                soundManager.playGameLose();
            }
        }
    }
    
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
                // Disconnect scenario: use server-provided chip change (always 10 chips for disconnect wins)
                chipPointsChange = data.chipChange;
                newChipPoints = Math.max(0, currentChipPoints + chipPointsChange);
            } else if (won && data.winnerChipChange !== undefined) {
                // Winner: use server-provided chip gain (only for non-disconnect wins)
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
            
            // Apply rank protection - prevent dropping below protected ranks (Bronze, Gold, Diamond)
            const protectedNewChipPoints = applyRankProtection(currentChipPoints, newChipPoints);
            if (protectedNewChipPoints !== newChipPoints) {
                // Adjust chipPointsChange to reflect the protection
                chipPointsChange = protectedNewChipPoints - currentChipPoints;
                newChipPoints = protectedNewChipPoints;
                console.log(`Rank protection applied: prevented drop below protected rank threshold. New chips: ${newChipPoints}`);
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
        
        // Calculate and display Bits won (only if player won)
        const bitsPointsChangeEl = document.getElementById('gameOverBitsPoints');
        if (bitsPointsChangeEl) {
            if (won && chipPointsChange > 0) {
                // Formula: (chipsWon / 5) * 2, rounded up
                const bitsWon = Math.ceil((chipPointsChange / 5) * 2);
                bitsPointsChangeEl.textContent = `+${bitsWon} Bits`;
                bitsPointsChangeEl.classList.add('bits-points-gain');
                bitsPointsChangeEl.classList.remove('bits-points-loss');
                bitsPointsChangeEl.style.display = 'block';
            } else {
                // Hide bits display if no bits earned (loss or no chips won)
                bitsPointsChangeEl.style.display = 'none';
            }
        }
        
        // Generate and animate rank progress bar
        generateGameOverRankProgress(currentChipPoints, newChipPoints);
            
            // Update stats with the server-provided chip change (SECURITY: only update if server provided values)
            // Use server-provided guesses if available, otherwise fall back to client calculation
            const finalGuesses = (won && data.winnerGuesses !== undefined) ? data.winnerGuesses :
                                (!won && data.loserGuesses !== undefined) ? data.loserGuesses :
                                guesses;
            
            // Prepare game data for achievements
            const player = gameState?.players?.find(p => p.id === currentPlayer);
            const playerGuesses = player?.guesses || [];
            const activeEffects = gameState?.activeEffects || [];
            
            const gameData = {
                guesses: playerGuesses.map(g => (typeof g === 'string' && g) ? g.toUpperCase() : ''),
                isRanked: true,
                playerId: currentPlayer,
                activeEffects: activeEffects
            };
            
            // Reset tracking for next game
            window.gameCardsPlayed = [];
            
            updateStats({
                won: won,
                guesses: finalGuesses,
                chipPoints: newChipPoints,  // Use server-calculated chip points (SECURITY: prevents manipulation)
                chipPointsChange: chipPointsChange,  // Pass chip change for Bits calculation
                isRanked: true,  // Explicitly mark as ranked
                gameData: gameData
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
        // Hide bits display for non-ranked games
        const bitsPointsChangeEl = document.getElementById('gameOverBitsPoints');
        if (bitsPointsChangeEl) {
            bitsPointsChangeEl.style.display = 'none';
        }
    
        // Prepare game data for achievements
        const player = gameState?.players?.find(p => p.id === currentPlayer);
        const playerGuesses = player?.guesses || [];
        const activeEffects = gameState?.activeEffects || [];
        
        const gameData = {
            guesses: playerGuesses.map(g => (typeof g === 'string' && g) ? g.toUpperCase() : ''),
            isRanked: false,
            playerId: currentPlayer,
            activeEffects: activeEffects
        };
        
        // Reset tracking for next game
        window.gameCardsPlayed = [];
        
        // Update statistics for non-ranked games
    updateStats({
        won: won,
            guesses: guesses,
            isRanked: false,  // Explicitly mark as non-ranked
            gameData: gameData
    }).catch(error => {
        console.error('Error updating stats:', error);
    });
    }
    
    // Reset rematch button state - hide for private games
    const rematchBtn = document.getElementById('rematchBtn');
    if (rematchBtn) {
        if (data.isPrivateGame) {
            // Hide rematch button for private games
            rematchBtn.style.display = 'none';
        } else {
            // Show rematch button for matchmade games
            rematchBtn.style.display = '';
            rematchBtn.disabled = false;
            rematchBtn.textContent = 'Rematch';
            rematchBtn.classList.remove('waiting', 'opponent-ready');
        }
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
    // Re-enable custom word input if it was disabled (for custom word errors)
    const wordInput = document.getElementById('customWordInputField');
    const submitBtn = document.getElementById('submitCustomWordBtn');
    if (wordInput) {
        wordInput.disabled = false;
        wordInput.readOnly = false;
    }
    if (submitBtn && submitBtn.disabled) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="btn-icon">✓</span><span>Submit Word</span>';
    }
    
    // Play error sound
    if (typeof soundManager !== 'undefined') {
        soundManager.playError();
    }
    // Use appropriate title based on context, default to 'Error'
    const title = data.title || '⚠️ Error';
    showGameMessage('⚠️', title, data.message || 'An error occurred. Please try again.');
    // Don't clear input/card on error - let player fix their guess or try again
    console.error('Socket error received:', data);
});

socket.on('matchmakingStatus', (data) => {
    const matchmakingStatus = document.getElementById('matchmakingStatus');
    const matchmakingText = document.getElementById('matchmakingText');
    const findMatchBtn = document.getElementById('findMatchBtn');
    const findCasualMatchBtn = document.getElementById('findCasualMatchBtn');
    
    if (data.status === 'searching') {
        // Show matchmaking status
        matchmakingStatus.style.display = 'flex';
        matchmakingText.textContent = 'Searching for opponent...';
        if (findMatchBtn) findMatchBtn.disabled = true;
        if (findCasualMatchBtn) findCasualMatchBtn.disabled = true;
    } else if (data.status === 'matched') {
        // Play match found sound
        if (typeof soundManager !== 'undefined') {
            soundManager.playMatchFound();
        }
        // Hide matchmaking status (game will start)
        matchmakingStatus.style.display = 'none';
        if (findMatchBtn) findMatchBtn.disabled = false;
        if (findCasualMatchBtn) findCasualMatchBtn.disabled = false;
    } else if (data.status === 'cancelled') {
        // Hide matchmaking status
        matchmakingStatus.style.display = 'none';
        if (findMatchBtn) findMatchBtn.disabled = false;
        if (findCasualMatchBtn) findCasualMatchBtn.disabled = false;
    }
});

socket.on('cardPlayed', (data) => {
    // Show splash for both players when a card is played
    console.log('Card played event received:', data);
    if (data && data.card) {
        // If opponent played Black Hand, immediately flip the cards before showing splash
        if (data.card.id === 'blackHand' && data.playerId !== currentPlayer) {
            console.log('Opponent played Black Hand - immediately flipping cards');
            // Optimistically add the effect to gameState temporarily so updateHandPanel will flip cards
            if (gameState && gameState.activeEffects) {
                const tempEffect = {
                    type: 'blackHand',
                    target: currentPlayer,
                    description: 'Your cards are flipped for this turn',
                    used: false
                };
                gameState.activeEffects.push(tempEffect);
                // Update hand panel immediately with animation
                updateHandPanel();
            }
        }
        
        // If opponent played Amnesia, immediately blank out all previous guesses
        if (data.card.id === 'amnesia' && data.playerId !== currentPlayer) {
            console.log('Opponent played Amnesia - immediately blanking out all previous guesses');
            // Optimistically add the effect to gameState temporarily
            if (gameState && gameState.activeEffects) {
                const tempEffect = {
                    type: 'amnesia',
                    target: currentPlayer,
                    description: 'All previous guesses are hidden for your turn',
                    used: false
                };
                gameState.activeEffects.push(tempEffect);
                // Immediately blank out all previous guesses
                setTimeout(() => {
                    hideAllPreviousGuesses();
                }, 100);
            }
        }
        
        // If opponent played Moonshine, immediately apply drunk effect
        if (data.card.id === 'moonshine' && data.playerId !== currentPlayer) {
            console.log('Opponent played Moonshine - immediately applying drunk effect');
            // Optimistically add the effect to gameState temporarily
            if (gameState && gameState.activeEffects) {
                const tempEffect = {
                    type: 'moonshine',
                    target: currentPlayer,
                    description: 'Your screen has a drunk effect for this turn',
                    used: false
                };
                gameState.activeEffects.push(tempEffect);
                // Immediately apply drunk effect
                setTimeout(() => {
                    applyDrunkEffect();
                }, 100);
            }
        }
        
        queueCardSplash(data.card, data.playerName, data.camoId);

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
    displayChatMessage(data.playerName, data.message, data.timestamp, data.playerId === currentPlayer, isSystemMessage, data.cardData);
    
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
    
    // Initialize card tracking for achievements
    window.gameCardsPlayed = [];
    
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
    
    // CRITICAL: Clear all game state that could cause cards to be grayed out
    window.blockedCardId = null; // Clear blocked card for new game
    window.finesseMode = false; // Clear Finesse mode
    window.opponentCardsForFinesse = null;
    window.finesseGameId = null;
    window.handRevealMode = false; // Clear hand reveal mode
    window.opponentCardsForReveal = null;
    window.handBlackHandFlippedState = false; // Clear black hand flip state
    selectedCard = null; // Clear any selected card
    
    // CRITICAL: Clear all game effects when starting a new game
    // Remove drunk effect (moonshine) - ensure it's cleared
    removeDrunkEffect();
    
    // Ensure activeEffects is properly initialized and cleared
    if (gameState) {
        // Clear all active effects for new game
        gameState.activeEffects = [];
        console.log('Cleared all active effects for new game initialization');
    }
    
    // Reset card hand and initialize deck pool for new game
    window.playerCardHand = [];
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
    
    // Ensure selectedCard is cleared for new game
    selectedCard = null;
    cardChainActive = false; // Reset card chain flag
    window.snackTimeMode = false; // Clear snack time mode
    window.finesseMode = false; // Clear finesse mode
    window.handRevealMode = false; // Clear hand reveal mode
    
    // Ensure card selection is in correct state
    const cardSelection = document.getElementById('cardSelection');
    if (cardSelection) {
        cardSelection.classList.remove('active');
        cardSelection.style.display = 'none';
    }
    
    // Validate that currentPlayer is set before checking turn
    if (!currentPlayer) {
        console.error('initializeGame: currentPlayer is not set! Cannot determine turn state.');
        // Try to get it from data if available
        if (data.yourPlayerId) {
            currentPlayer = data.yourPlayerId;
            console.log('initializeGame: Set currentPlayer from data.yourPlayerId:', currentPlayer);
        } else {
            console.error('initializeGame: Cannot determine currentPlayer - game may be in invalid state');
            showGameMessage('⚠️', 'Initialization Error', 'Unable to initialize game. Please try again.');
            return;
        }
    }
    
    // Validate that gameState is set
    if (!gameState || !gameState.gameId) {
        console.error('initializeGame: gameState or gameId is missing!');
        showGameMessage('⚠️', 'Initialization Error', 'Game state is invalid. Please try again.');
        return;
    }
    
    if (data.currentTurn === currentPlayer) {
        // It's my turn - show card selection and enable input
        showGameBoard();
        // First turn - show immediately (no guesses made yet)
        // Small delay to ensure all state is cleared and validated
        setTimeout(() => {
            // Double-check state before showing cards
            if (gameState && currentPlayer && gameState.gameId && gameState.currentTurn === currentPlayer) {
                showCardSelection();
            } else {
                console.error('initializeGame: State validation failed before showing cards', {
                    hasGameState: !!gameState,
                    currentPlayer,
                    gameId: gameState?.gameId,
                    currentTurn: gameState?.currentTurn
                });
                showGameMessage('⚠️', 'Initialization Error', 'Game state invalid. Please refresh.');
            }
        }, 150);
        const wordInput = document.getElementById('wordInput');
        if (wordInput) {
            wordInput.disabled = false;
        }
    } else {
        // It's opponent's turn - hide card selection, disable input
        hideCardSelection();
        showGameBoard();
        const wordInput = document.getElementById('wordInput');
        if (wordInput) {
            wordInput.disabled = true;
        }
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
    const newCardAnnouncementScreen = document.getElementById('newCardAnnouncement');
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
    if (newCardAnnouncementScreen && newCardAnnouncementScreen.classList.contains('active')) {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            scaleNewCardAnnouncement();
        }, 100);
    }
});

// Scale game over screen to fit viewport
function scaleGameOverScreen(containerElement = null) {
    // If container is provided, use it; otherwise use default gameOver screen
    let gameOverScreen, scalingContainer;
    
    if (containerElement) {
        // For spectator game over screen
        scalingContainer = containerElement;
        gameOverScreen = document.getElementById('spectatorGameOver');
    } else {
        // For regular game over screen
        gameOverScreen = document.getElementById('gameOver');
        scalingContainer = document.getElementById('gameOverScalingContainer');
    }
    
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
    
    // Validate game state before showing card selection
    if (!gameState || !currentPlayer || !gameState.gameId) {
        console.error('showCardSelection: Invalid game state', { gameState: !!gameState, currentPlayer, gameId: gameState?.gameId });
        showGameMessage('⚠️', 'Game Error', 'Game state is invalid. Cannot show card selection.');
        return;
    }
    
    // Check if it's actually the player's turn
    if (gameState.currentTurn !== currentPlayer) {
        console.warn('showCardSelection: Not player\'s turn', { currentTurn: gameState.currentTurn, currentPlayer });
        // Don't show card selection if it's not our turn
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
        // Double-check that we have valid gameState and the lock is legitimate
        const cardLocked = isCardLocked();
        if (cardLocked) {
            // Verify this is a legitimate card lock (not stale state)
            if (!gameState || !gameState.gameId || !currentPlayer) {
                console.error('showCardSelection: Invalid game state when checking card lock, ignoring lock');
                generateCards(false); // Don't gray out if state is invalid
                return;
            }
            
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
    const gameBoard = document.getElementById('gameBoard');
    if (gameBoard) gameBoard.style.display = 'block';
}

// Proper Fisher-Yates shuffle algorithm for truly random shuffling
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
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
            window.deckPool = shuffleArray(premadeCards);
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
                window.deckPool = shuffleArray(premadeCards);
            } else {
                console.error('Premade deck is also empty! Cannot initialize deck pool.');
                window.deckPool = [];
            }
        } else {
        // Create a shuffled pool of deck cards using proper shuffle algorithm
        window.deckPool = shuffleArray(deckCards);
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
    
    // Create a shuffled pool of deck cards using proper shuffle algorithm
    window.deckPool = shuffleArray(deckCards);
    
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
    
    // Check if blackHand effect is active (cards are flipped)
    const isBlackHandActive = gameState && gameState.activeEffects && 
        gameState.activeEffects.some(e => 
            e.type === 'blackHand' && e.target === currentPlayer && !e.used
        );
    
    // Check previous state to determine if we need to animate
    const wasFlippedBefore = window.handBlackHandFlippedState || false;
    const shouldFlipNow = isBlackHandActive;
    const needsFlipAnimation = wasFlippedBefore !== shouldFlipNow;
    
    // If existing cards need to flip, animate them first
    if (needsFlipAnimation && handCardsContainer.children.length > 0) {
        const existingCards = Array.from(handCardsContainer.querySelectorAll('.hand-card-item'));
        existingCards.forEach((cardElement, index) => {
            if (shouldFlipNow) {
                // Flip to back
                setTimeout(() => {
                    cardElement.classList.add('flipped');
                }, index * 50);
            } else {
                // Flip to front
                setTimeout(() => {
                    cardElement.classList.remove('flipped');
                }, index * 50);
            }
        });
        
        // Wait for animation to complete before rebuilding
        setTimeout(() => {
            // Rebuild cards after animation
            updateHandPanel();
        }, 600 + (existingCards.length * 50));
        
        // Update state
        window.handBlackHandFlippedState = shouldFlipNow;
        return; // Exit early, rebuild will happen in setTimeout
    }
    
    // Clear existing content if no animation needed
    handCardsContainer.innerHTML = '';
    
    // Update state
    window.handBlackHandFlippedState = shouldFlipNow;
    
    // Display current hand (up to 3 cards)
    if (window.playerCardHand && window.playerCardHand.length > 0) {
        window.playerCardHand.slice(0, 3).forEach((card, index) => {
            const cardElement = document.createElement('div');
            const isBlocked = window.blockedCardId === card.id;
            cardElement.className = 'hand-card-item';
            
            // Add flipped class if blackHand is active
            if (isBlackHandActive) {
                cardElement.classList.add('flipped');
            }
            
            if (isBlocked) {
                cardElement.classList.add('blocked');
                // CSS class .card.blocked will handle opacity and filter with !important
                // Animation will still run, but opacity stays at 0.4 via CSS
            }
            
            // Create flip container
            const flipContainer = document.createElement('div');
            flipContainer.className = 'hand-card-flip-container';
            
            // Apply camo background
            const camoId = getCardCamo(card.id);
            const camo = AVAILABLE_CAMOS.find(c => c.id === camoId) || AVAILABLE_CAMOS[0]; // Default to None (BlackBase)
            const camoPath = camo && camo.filename ? `url('images/Card Camo/${camo.filename}')` : 'none';
            
            if (camoPath !== 'none') {
                cardElement.style.backgroundImage = camoPath;
                cardElement.style.backgroundSize = 'cover';
                cardElement.style.backgroundPosition = 'center';
                cardElement.style.backgroundRepeat = 'no-repeat';
            } else {
                cardElement.style.backgroundImage = '';
            }
            cardElement.dataset.cardId = card.id;
            
            // Create front face (normal card)
            const frontFace = document.createElement('div');
            frontFace.className = 'hand-card-face hand-card-front';
            if (camoPath !== 'none') {
                frontFace.style.backgroundImage = camoPath;
                frontFace.style.backgroundSize = 'cover';
                frontFace.style.backgroundPosition = 'center';
                frontFace.style.backgroundRepeat = 'no-repeat';
            } else {
                frontFace.style.backgroundImage = '';
            }
            const frontImage = document.createElement('img');
            frontImage.src = getCardImagePath(card.id);
            frontImage.alt = card.title || 'Unknown Card';
            frontImage.className = 'hand-card-image';
            frontFace.appendChild(frontImage);
            
            // Create back face (flipped card)
            const backFace = document.createElement('div');
            backFace.className = 'hand-card-face hand-card-back';
            if (camoPath !== 'none') {
                backFace.style.backgroundImage = camoPath;
                backFace.style.backgroundSize = 'cover';
                backFace.style.backgroundPosition = 'center';
                backFace.style.backgroundRepeat = 'no-repeat';
            } else {
                backFace.style.backgroundImage = '';
            }
            const backImage = document.createElement('img');
            backImage.src = 'images/Card Images/FlipedCard.png';
            backImage.alt = 'Flipped Card';
            backImage.className = 'hand-card-image';
            backFace.appendChild(backImage);
            
            flipContainer.appendChild(frontFace);
            flipContainer.appendChild(backFace);
            cardElement.appendChild(flipContainer);
            
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
        
        // Apply camo background
        const camoId = getCardCamo(nextCard.id);
        const camo = AVAILABLE_CAMOS.find(c => c.id === camoId) || AVAILABLE_CAMOS[0]; // Default to None (BlackBase)
        if (camo && camo.filename) {
            nextCardElement.style.backgroundImage = `url('images/Card Camo/${camo.filename}')`;
            nextCardElement.style.backgroundSize = 'cover';
            nextCardElement.style.backgroundPosition = 'center';
            nextCardElement.style.backgroundRepeat = 'no-repeat';
        } else {
            nextCardElement.style.backgroundImage = '';
        }
        nextCardElement.dataset.cardId = nextCard.id;
        
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
        window.deckPool = shuffleArray(deckCards);
        } else {
            // If still empty, try fallback
            const fallbackCards = getDeckCards();
            if (fallbackCards && fallbackCards.length > 0) {
                window.deckPool = shuffleArray(fallbackCards);
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
    if (!container) {
        console.error('generateCards: cardsContainer not found');
        return;
    }
    container.innerHTML = '';
    
    // Validate game state before generating cards
    if (!gameState || !currentPlayer || !gameState.gameId) {
        console.error('generateCards: Invalid game state - cannot generate cards', {
            hasGameState: !!gameState,
            currentPlayer,
            gameId: gameState?.gameId
        });
        // Don't show error message here - it might be called during initialization
        // Just log and return empty
        return;
    }
    
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
    
    // Final check - if we still don't have cards, show error
    if (!window.playerCardHand || window.playerCardHand.length === 0) {
        console.error('generateCards: No cards in hand after initialization');
        container.innerHTML = '<div class="error-message">Unable to load cards. Please refresh.</div>';
        return;
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
            
            // Apply camo background
            const camoId = getCardCamo(card.id);
            const camo = AVAILABLE_CAMOS.find(c => c.id === camoId) || AVAILABLE_CAMOS[0]; // Default to None (BlackBase)
            if (camo && camo.filename) {
                cardElement.style.backgroundImage = `url('images/Card Camo/${camo.filename}')`;
                cardElement.style.backgroundSize = 'cover';
                cardElement.style.backgroundPosition = 'center';
                cardElement.style.backgroundRepeat = 'no-repeat';
            } else {
                cardElement.style.backgroundImage = '';
            }
            cardElement.dataset.cardId = card.id;
            
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
    
    // Check if blackHand effect is active (cards are flipped)
    const isBlackHandActive = gameState && gameState.activeEffects && Array.isArray(gameState.activeEffects) &&
        gameState.activeEffects.some(e => 
            e && e.type === 'blackHand' && e.target === currentPlayer && e.used === false
        );
    
    // Safety check: Don't force gray out unless explicitly requested and cardLock is active
    // If forceGrayOut is true but cardLock is not actually active, don't gray out
    const isActuallyLocked = isCardLocked();
    const shouldForceGrayOut = forceGrayOut && isActuallyLocked;
    
    selectedCards.forEach((card, index) => {
        const cardElement = document.createElement('div');
        const isBlocked = window.blockedCardId === card.id;
        const shouldGrayOut = shouldForceGrayOut || isBlocked;
        cardElement.className = 'card';
        if (shouldGrayOut) {
            cardElement.classList.add('blocked');
            // CSS class .card.blocked will handle opacity and filter with !important
            cardElement.style.cursor = 'not-allowed';
            cardElement.style.pointerEvents = 'none';
            // Animation will still run (for transform), but opacity stays at 0.4 via CSS
        }
        
            // Apply camo background
            const camoId = getCardCamo(card.id);
            const camo = AVAILABLE_CAMOS.find(c => c.id === camoId) || AVAILABLE_CAMOS[0]; // Default to None (BlackBase)
            if (camo && camo.filename) {
                cardElement.style.backgroundImage = `url('images/Card Camo/${camo.filename}')`;
                cardElement.style.backgroundSize = 'cover';
                cardElement.style.backgroundPosition = 'center';
                cardElement.style.backgroundRepeat = 'no-repeat';
            } else {
                cardElement.style.backgroundImage = '';
            }
            cardElement.dataset.cardId = card.id;
        
        // Create image element for the card
        const cardImage = document.createElement('img');
        // If blackHand is active, show flipped card image instead
        if (isBlackHandActive) {
            cardImage.src = 'images/Card Images/FlipedCard.png';
        } else {
            cardImage.src = getCardImagePath(card.id);
        }
        cardImage.alt = card.title;
        cardImage.className = 'card-image';
        cardElement.appendChild(cardImage);
        
        if (!shouldGrayOut) {
            // Only add onclick if gameState and currentPlayer are ready
            cardElement.onclick = () => {
                // Additional validation before allowing click
                if (!gameState || !currentPlayer || !gameState.gameId) {
                    console.error('Card clicked but game state not ready:', { gameState: !!gameState, currentPlayer, gameId: gameState?.gameId });
                    if (typeof soundManager !== 'undefined') {
                        soundManager.playError();
                    }
                    showGameMessage('⚠️', 'Game Not Ready', 'Game is still initializing. Please wait a moment.');
                    return;
                }
                // Check if it's actually the player's turn
                if (gameState.currentTurn !== currentPlayer) {
                    console.warn('Card clicked but not player\'s turn');
                    if (typeof soundManager !== 'undefined') {
                        soundManager.playError();
                    }
                    showGameMessage('⚠️', 'Not Your Turn', 'Please wait for your turn.');
                    return;
                }
                selectCard(card, cardElement);
            };
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
    // Safety check: Ensure we have valid game state
    if (!gameState || !currentPlayer) {
        console.error('selectCard: Invalid game state or currentPlayer', { gameState: !!gameState, currentPlayer });
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        showGameMessage('⚠️', 'Game Not Ready', 'Game is still initializing. Please wait a moment and try again.');
        return;
    }
    
    // Check if gameState has a valid gameId
    if (!gameState.gameId) {
        console.error('selectCard: Missing gameId in gameState');
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        showGameMessage('⚠️', 'Game Error', 'Game ID is missing. Please try refreshing.');
        return;
    }
    
    // Check if it's actually the player's turn
    if (gameState.currentTurn !== currentPlayer) {
        console.warn('selectCard: Not player\'s turn', { currentTurn: gameState.currentTurn, currentPlayer });
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        showGameMessage('⚠️', 'Not Your Turn', 'Please wait for your turn to select a card.');
        return;
    }
    
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
        // Get camo for this card (using current player's camo since they're playing it)
        const camoId = getCardCamo(card.id);
        
        // Send the selected opponent card to server
        socket.emit('selectOpponentCard', {
            gameId: window.finesseGameId || gameState.gameId,
            card: card,
            camoId: camoId // Include camo so both players see the same camo
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
    
    // Double-check gameId and currentPlayer before emitting
    if (!gameState.gameId || !currentPlayer) {
        console.error('selectCard: Cannot emit - missing gameId or currentPlayer', { gameId: gameState.gameId, currentPlayer });
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        showGameMessage('⚠️', 'Game Error', 'Unable to select card. Game state is invalid.');
        return;
    }
    
    // Get camo for this card
    const camoId = getCardCamo(card.id);
    
    socket.emit('selectCard', {
        gameId: gameState.gameId,
        playerId: currentPlayer,
        card: card,
        hidden: isInChain, // Mark as hidden if we're in a chain
        camoId: camoId // Include camo so both players see the same camo
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
            const wordInput = document.getElementById('wordInput');
            if (wordInput) {
                wordInput.disabled = false;
                wordInput.focus();
            }
        }, 100);
    }
}

function isCardLocked() {
    // Safety checks to prevent false positives
    if (!gameState || !currentPlayer) return false;
    if (!gameState.activeEffects || !Array.isArray(gameState.activeEffects)) {
        // If activeEffects is not an array, assume not locked (shouldn't happen, but safety check)
        return false;
    }
    // Only check cardLock effects that target the current player and are not used
    return gameState.activeEffects.some(e => 
        e && e.type === 'cardLock' && e.target === currentPlayer && e.used === false
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
    // BUT: Never reset if Slow Motion was used (time will exceed normal limit)
    if (!preserveTimeRemaining) {
        // Check if Slow Motion was used (time significantly exceeds limit)
        if (window.slowMotionUsed && turnTimeRemaining > timeLimit) {
            // Slow Motion was used - don't reset, preserve the extended time
            console.log(`Preserving Slow Motion time: ${turnTimeRemaining} (limit: ${timeLimit})`);
        } else if (turnTimeRemaining <= timeLimit + 1) {
            // Normal case - reset to limit
            turnTimeRemaining = timeLimit;
        } else {
            // Time exceeds limit but Slow Motion flag not set - preserve anyway (edge case)
            console.log(`Preserving extended time: ${turnTimeRemaining} (limit: ${timeLimit})`);
        }
    } else {
        // When preserving time, only cap if Slow Motion wasn't used
        if (!window.slowMotionUsed && turnTimeRemaining > timeLimit) {
            // Normal preservation (timeRush cleared scenario) - cap it
            turnTimeRemaining = timeLimit;
        } else if (window.slowMotionUsed && turnTimeRemaining > timeLimit) {
            // Slow Motion was used - don't cap
            console.log(`Preserving Slow Motion time when preserving: ${turnTimeRemaining} (limit: ${timeLimit})`);
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
    
    // Update display - use allowExceedLimit if Slow Motion was used or time exceeds normal limit
    const shouldAllowExceed = window.slowMotionUsed || turnTimeRemaining > timeLimit;
    updateTimerDisplay(shouldAllowExceed);
    updateTimerDisplay(shouldAllowExceed);
    
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

function updateTimerDisplay(allowExceedLimit = false) {
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
    // UNLESS allowExceedLimit is true (for Slow Motion card) OR slowMotionUsed flag is set
    if (!allowExceedLimit && !window.slowMotionUsed && turnTimeRemaining > timeLimit) {
        turnTimeRemaining = timeLimit;
    }
    
    // Both players see the same countdown
    if (timerText) {
        timerText.textContent = Math.max(0, turnTimeRemaining);
    }
    
    if (timerCircle) {
        // Calculate progress - when Slow Motion extends time, use the extended time as the base
        // This ensures the circle shows 100% when time is extended, then counts down from there
        let effectiveLimit = timeLimit;
        if (window.slowMotionUsed && turnTimeRemaining > timeLimit) {
            // Slow Motion was used - use the current extended time as the "full" time
            // Store the maximum extended time if not already stored
            if (!window.slowMotionMaxTime || turnTimeRemaining > window.slowMotionMaxTime) {
                window.slowMotionMaxTime = turnTimeRemaining;
            }
            effectiveLimit = window.slowMotionMaxTime;
        }
        const progressPercent = (turnTimeRemaining / effectiveLimit) * 100;
        const circumference = 2 * Math.PI * 15.9155; // radius of the circle
        const offset = circumference - (progressPercent / 100) * circumference;
        
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
    
    // Check if amnesia is active - if so, this guess should be blanked (it's a previous guess)
    const amnesiaActive = gameState && gameState.activeEffects && gameState.activeEffects.some(e =>
        e.type === 'amnesia' && e.target === currentPlayer && !e.used
    );
    
    // First, fill in the letters
    for (let i = 0; i < 5; i++) {
        const cell = document.getElementById(`cell-${row}-${i}`);
        if (cell) {
            // If amnesia is active, blank this cell immediately (it's a previous guess)
            if (amnesiaActive && !cell.hasAttribute('data-amnesia-blanked')) {
                // Store original content before blanking - need to store what the cell SHOULD have
                const originalText = guess[i] || '';
                // Store the feedback class that should be applied
                const feedbackClass = feedback && feedback[i] ? feedback[i] : 'absent';
                const originalClasses = Array.from(cell.classList).join(' ');
                
                cell.setAttribute('data-amnesia-original-text', originalText);
                cell.setAttribute('data-amnesia-original-classes', originalClasses);
                cell.setAttribute('data-amnesia-feedback-class', feedbackClass);
                
                // Blank it out
                cell.textContent = '';
                cell.classList.remove('correct', 'present', 'absent');
                cell.classList.add('absent');
                cell.style.backgroundColor = '#3a3a3c';
                cell.setAttribute('data-amnesia-blanked', 'true');
            } else {
                // Normal display
                cell.textContent = guess[i];
                cell.classList.add('filled');
            }
        }
    }
    
    // Only animate feedback if amnesia is not active (previous guesses are already blanked)
    if (!amnesiaActive) {
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
}

// Blank out all previous guesses (for Amnesia effect) - makes them gray/blank instead of hiding
function hideAllPreviousGuesses() {
    const boardContainer = document.getElementById('boardContainer');
    if (!boardContainer) {
        console.log('hideAllPreviousGuesses: boardContainer not found');
        return;
    }
    
    let blankedCount = 0;
    const rows = boardContainer.querySelectorAll('.board-row');
    rows.forEach(row => {
        const cells = row.querySelectorAll('.board-cell');
        cells.forEach(cell => {
            // Blank out all filled cells (previous guesses) - make them gray/blank
            if (cell.classList.contains('filled') && !cell.hasAttribute('data-amnesia-blanked')) {
                // Store original content - preserve everything
                const originalText = cell.textContent || '';
                const originalClasses = Array.from(cell.classList).join(' ');
                const originalBgColor = cell.style.backgroundColor || '';
                
                cell.setAttribute('data-amnesia-original-text', originalText);
                cell.setAttribute('data-amnesia-original-classes', originalClasses);
                if (originalBgColor) {
                    cell.setAttribute('data-amnesia-original-bg', originalBgColor);
                }
                
                // Blank out the cell - make it gray and empty
                cell.textContent = '';
                // Remove feedback classes but keep 'filled' and 'board-cell'
                cell.classList.remove('correct', 'present', 'absent');
                cell.classList.add('absent'); // Gray background
                cell.style.backgroundColor = '#3a3a3c'; // Dark gray background
                cell.setAttribute('data-amnesia-blanked', 'true');
                blankedCount++;
            }
        });
    });
    console.log(`hideAllPreviousGuesses: Blanked ${blankedCount} cells`);
}

// Show all guesses (when Amnesia effect ends) - restore by directly fixing blanked cells
function showAllGuesses() {
    const boardContainer = document.getElementById('boardContainer');
    if (!boardContainer) return;
    
    // Find all blanked cells and restore them from gameState data
    if (gameState && gameState.players) {
        gameState.players.forEach(player => {
            if (player.guesses && Array.isArray(player.guesses)) {
                player.guesses.forEach(guessData => {
                    if (guessData.guess && guessData.feedback && guessData.row !== undefined) {
                        const row = guessData.row;
                        
                        // Check each cell in this row and restore if it was blanked
                        for (let i = 0; i < 5; i++) {
                            const cell = document.getElementById(`cell-${row}-${i}`);
                            if (cell && cell.hasAttribute('data-amnesia-blanked')) {
                                // Restore the text
                                cell.textContent = guessData.guess[i] || '';
                                
                                // Remove amnesia styling
                                cell.style.backgroundColor = '';
                                cell.classList.remove('absent');
                                
                                // Restore proper classes
                                cell.classList.add('filled');
                                
                                // Apply the correct feedback class
                                if (guessData.feedback && guessData.feedback[i]) {
                                    cell.classList.remove('correct', 'present', 'absent');
                                    if (guessData.feedback[i] === 'correct') {
                                        cell.classList.add('correct');
                                    } else if (guessData.feedback[i] === 'present') {
                                        cell.classList.add('present');
                                    } else {
                                        cell.classList.add('absent');
                                    }
                                } else {
                                    cell.classList.add('absent');
                                }
                                
                                // Clean up data attributes
                                cell.removeAttribute('data-amnesia-blanked');
                                cell.removeAttribute('data-amnesia-original-text');
                                cell.removeAttribute('data-amnesia-original-classes');
                                cell.removeAttribute('data-amnesia-original-bg');
                                cell.removeAttribute('data-amnesia-feedback-class');
                            }
                        }
                    }
                });
            }
        });
    }
    
    console.log('showAllGuesses: Restored all blanked guesses from gameState');
}

// Apply drunk effect to game screen (for Moonshine card)
function applyDrunkEffect() {
    const gameScreen = document.getElementById('game');
    if (gameScreen) {
        gameScreen.classList.add('drunk-effect');
        console.log('Drunk effect applied to game screen');
    }
}

// Remove drunk effect from game screen (when Moonshine effect ends)
function removeDrunkEffect() {
    const gameScreen = document.getElementById('game');
    if (gameScreen) {
        gameScreen.classList.remove('drunk-effect');
        console.log('Drunk effect removed from game screen');
    }
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

function queueCardSplash(card, playerName, camoId) {
    splashQueue.push({ card, playerName, camoId });
    processSplashQueue();
}

function processSplashQueue() {
    // If already showing a splash or queue is empty, do nothing
    if (isShowingSplash || splashQueue.length === 0) {
        return;
    }
    
    // Mark as showing and get the next splash
    isShowingSplash = true;
    const { card, playerName, camoId } = splashQueue.shift();
    
    // Show the splash
    showCardSplash(card, playerName, camoId, () => {
        // Callback when splash completes
        isShowingSplash = false;
        // Process next splash in queue after a short delay
        setTimeout(() => {
            processSplashQueue();
        }, 100);
    });
}

function showCardSplash(card, playerName, camoId, onComplete) {
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
    
    // Apply camo to splash card container - use camo from event data (player who played the card)
    const splashCard = document.getElementById('splashCard');
    if (splashCard) {
        // Use camoId from event data, or fallback to local player's camo if not provided
        const camoToUse = camoId || getCardCamo(card.id);
        const camo = AVAILABLE_CAMOS.find(c => c.id === camoToUse) || AVAILABLE_CAMOS[0]; // Default to None (BlackBase)
        if (camo && camo.filename) {
            splashCard.style.backgroundImage = `url('images/Card Camo/${camo.filename}')`;
            splashCard.style.backgroundSize = 'cover';
            splashCard.style.backgroundPosition = 'center';
            splashCard.style.backgroundRepeat = 'no-repeat';
        } else {
            splashCard.style.backgroundImage = '';
        }
    }
    
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
    
    // Apply camo background
    const camoId = getCardCamo(card.id);
    const camo = AVAILABLE_CAMOS.find(c => c.id === camoId) || AVAILABLE_CAMOS[0];
    if (camo && camo.filename) {
        cardElement.style.backgroundImage = `url('images/Card Camo/${camo.filename}')`;
        cardElement.style.backgroundSize = 'cover';
        cardElement.style.backgroundPosition = 'center';
        cardElement.style.backgroundRepeat = 'no-repeat';
    } else {
        cardElement.style.backgroundImage = '';
    }
    cardElement.dataset.cardId = card.id;
    
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
        
        // Apply camo background
        const camoId = getCardCamo(card.id);
        const camo = AVAILABLE_CAMOS.find(c => c.id === camoId) || AVAILABLE_CAMOS[0];
        if (camo && camo.filename) {
            cardElement.style.backgroundImage = `url('images/Card Camo/${camo.filename}')`;
            cardElement.style.backgroundSize = 'cover';
            cardElement.style.backgroundPosition = 'center';
            cardElement.style.backgroundRepeat = 'no-repeat';
        } else {
            cardElement.style.backgroundImage = '';
        }
        
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
    
    // Add click handler for camos button
    const camosBtn = document.getElementById('dropdownCamos');
    if (camosBtn) {
        camosBtn.onclick = async (e) => {
            e.stopPropagation();
            await showCamoSelection(card);
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

// Camo Management Functions
let currentCamoCard = null;
let isApplyingToAll = false;

// Cache for owned camos
let cachedOwnedCamos = null;

async function getOwnedCamos() {
    // For guests, use localStorage
    if (isGuestMode || !currentUser) {
        const stored = localStorage.getItem(OWNED_CAMOS_KEY);
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error('Error loading owned camos from localStorage:', e);
            }
        }
        // Default: only "None" is owned
        return { 'None': true };
    }
    
    // For authenticated users, try Firestore first
    if (window.firebaseDb && currentUser && currentUser.uid) {
        // Return cached if available
        if (cachedOwnedCamos !== null) {
            return cachedOwnedCamos;
        }
        
        try {
            const ownedDoc = await window.firebaseDb.collection('ownedCamos').doc(currentUser.uid).get();
            if (ownedDoc.exists) {
                cachedOwnedCamos = ownedDoc.data();
                // Also sync to localStorage
                localStorage.setItem(OWNED_CAMOS_KEY, JSON.stringify(cachedOwnedCamos));
                return cachedOwnedCamos;
            }
        } catch (error) {
            // Permission denied is expected if Firestore rules don't allow reading ownedCamos
            // Silently fall back to localStorage - this is fine for now
            if (error.code !== 'permission-denied') {
                console.warn('Error loading owned camos from Firestore:', error);
            }
            // Continue to localStorage fallback below
        }
    }
    
    // Fallback to localStorage
    const stored = localStorage.getItem(OWNED_CAMOS_KEY);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            cachedOwnedCamos = parsed;
            return parsed;
        } catch (e) {
            console.error('Error loading owned camos from localStorage:', e);
        }
    }
    
    // Default: only "None" is owned
    const defaultOwned = { 'None': true };
    cachedOwnedCamos = defaultOwned;
    return defaultOwned;
}

// Save owned camos
async function saveOwnedCamos(ownedCamos) {
    localStorage.setItem(OWNED_CAMOS_KEY, JSON.stringify(ownedCamos));
    cachedOwnedCamos = ownedCamos;
    
    if (currentUser && window.firebaseDb && currentUser.uid) {
        try {
            await window.firebaseDb.collection('ownedCamos').doc(currentUser.uid).set(ownedCamos, { merge: true });
        } catch (error) {
            // Permission denied is expected if Firestore rules don't allow writing ownedCamos
            // localStorage is the primary storage, Firestore is just for sync
            if (error.code !== 'permission-denied') {
                console.warn('Error saving owned camos to Firestore:', error);
            }
            // Continue - localStorage save already succeeded above
        }
    }
}

// Add a camo to owned camos
async function addOwnedCamo(camoId) {
    const owned = await getOwnedCamos();
    owned[camoId] = true;
    await saveOwnedCamos(owned);
    // Clear cache so next time it refreshes
    cachedOwnedCamos = owned;
}

// Check if camo is owned (synchronous version using cache)
function isCamoOwned(camoId) {
    // Use cached value if available, otherwise check localStorage
    if (cachedOwnedCamos !== null) {
        return cachedOwnedCamos[camoId] === true || camoId === 'None';
    }
    
    // Fallback to localStorage check
    const stored = localStorage.getItem(OWNED_CAMOS_KEY);
    if (stored) {
        try {
            const owned = JSON.parse(stored);
            return owned[camoId] === true || camoId === 'None';
        } catch (e) {
            // Error parsing, default to None only
            return camoId === 'None';
        }
    }
    
    // Default: only None is owned
    return camoId === 'None';
}

// Get camo for a specific card
function getCardCamo(cardId) {
    const camos = getCardCamos();
    const camoId = camos[cardId] || 'None'; // Default to None (BlackBase)
    // If the selected camo is not owned, default to None
    return isCamoOwned(camoId) ? camoId : 'None';
}

// Get all card camos
function getCardCamos() {
    if (isGuestMode || !currentUser) {
        const stored = localStorage.getItem(CAMO_STORAGE_KEY);
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error('Error loading camos from localStorage:', e);
            }
        }
        return {};
    }
    
    // For authenticated users, could use Firestore, but for now use localStorage
    const stored = localStorage.getItem(CAMO_STORAGE_KEY);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error('Error loading camos from localStorage:', e);
        }
    }
    return {};
}

// Save card camos
async function saveCardCamos(camos) {
    localStorage.setItem(CAMO_STORAGE_KEY, JSON.stringify(camos));
    
    // For authenticated users, could save to Firestore
    if (currentUser && window.firebaseDb && currentUser.uid) {
        try {
            await window.firebaseDb.collection('cardCamos').doc(currentUser.uid).set(camos, { merge: true });
        } catch (error) {
            console.error('Error saving camos to Firestore:', error);
        }
    }
}

// Set camo for a card
async function setCardCamo(cardId, camoId) {
    const camos = getCardCamos();
    camos[cardId] = camoId;
    await saveCardCamos(camos);
    updateCardCamoDisplay(cardId, camoId);
    // Re-render deck builder to show updated camo
    renderDeckBuilder();
}

// Set camo for all cards
async function setCamoForAllCards(camoId) {
    const allCards = getAllCards();
    const camos = getCardCamos();
    
    allCards.forEach(card => {
        camos[card.id] = camoId;
    });
    
    await saveCardCamos(camos);
    
    // Update all card displays
    updateAllCardCamoDisplays();
    
    // Re-render deck builder to show updated camos
    renderDeckBuilder();
}

// Update camo display for a specific card
function updateCardCamoDisplay(cardId, camoId) {
    const camo = AVAILABLE_CAMOS.find(c => c.id === camoId) || AVAILABLE_CAMOS[0]; // Default to None (BlackBase)
    const camoPath = camo && camo.filename ? `url('images/Card Camo/${camo.filename}')` : 'none';
    
    // Update all instances of this card by data attribute
    const cardElements = document.querySelectorAll(`[data-card-id="${cardId}"]`);
    cardElements.forEach(element => {
        if (camoPath === 'none') {
            element.style.backgroundImage = '';
        } else {
            element.style.backgroundImage = camoPath;
            element.style.backgroundSize = 'cover';
            element.style.backgroundPosition = 'center';
            element.style.backgroundRepeat = 'no-repeat';
        }
    });
    
    // Also update cards by checking their image src
    const allCardElements = document.querySelectorAll('.card, .hand-card-item, .deck-slot-card, .deck-card-item');
    allCardElements.forEach(element => {
        const img = element.querySelector('img');
        if (img) {
            const imgPath = getCardImagePath(cardId);
            if (img.src.includes(imgPath.split('/').pop()) || element.dataset.cardId === cardId) {
                if (camoPath === 'none') {
                    element.style.backgroundImage = '';
                } else {
                    element.style.backgroundImage = camoPath;
                    element.style.backgroundSize = 'cover';
                    element.style.backgroundPosition = 'center';
                    element.style.backgroundRepeat = 'no-repeat';
                }
            }
        }
    });
    
    // Update hand card faces
    const handCardFaces = document.querySelectorAll('.hand-card-face');
    handCardFaces.forEach(face => {
        const img = face.querySelector('img');
        if (img) {
            const imgPath = getCardImagePath(cardId);
            if (img.src.includes(imgPath.split('/').pop())) {
                if (camoPath === 'none') {
                    face.style.backgroundImage = '';
                } else {
                    face.style.backgroundImage = camoPath;
                    face.style.backgroundSize = 'cover';
                    face.style.backgroundPosition = 'center';
                    face.style.backgroundRepeat = 'no-repeat';
                }
            }
        }
    });
}

// Update all card camo displays
function updateAllCardCamoDisplays() {
    const camos = getCardCamos();
    const allCards = getAllCards();
    
    allCards.forEach(card => {
        const camoId = camos[card.id] || 'None';
        updateCardCamoDisplay(card.id, camoId);
    });
    
    // Re-render deck builder to update camos
    renderDeckBuilder();
}

// Show camo selection modal
let selectedCamoId = null;

async function showCamoSelection(card) {
    currentCamoCard = card;
    isApplyingToAll = false;
    selectedCamoId = getCardCamo(card.id); // Initialize with current camo
    
    const modal = document.getElementById('camoSelectionModal');
    const grid = document.getElementById('camoSelectionGrid');
    
    if (!modal || !grid) {
        console.error('Camo selection modal elements not found');
        return;
    }
    
    // Clear grid
    grid.innerHTML = '';
    
    // Refresh owned camos cache to get latest unlocks
    cachedOwnedCamos = null;
    const ownedCamos = await getOwnedCamos();
    
    // Get current camo for this card
    const currentCamo = getCardCamo(card.id);
    
    // Create camo options - only show owned camos
    AVAILABLE_CAMOS.forEach(camo => {
        // Only show owned camos - check the fresh owned camos data
        if (!ownedCamos[camo.id] && camo.id !== 'None') {
            return;
        }
        
        const camoItem = document.createElement('div');
        camoItem.className = 'camo-item';
        if (camo.id === currentCamo) {
            camoItem.classList.add('selected');
        }
        
        const camoPreview = document.createElement('div');
        camoPreview.className = 'camo-preview';
        if (camo.filename) {
            camoPreview.style.backgroundImage = `url('images/Card Camo/${camo.filename}')`;
            camoPreview.style.backgroundSize = 'cover';
            camoPreview.style.backgroundPosition = 'center';
        }
        
        const camoName = document.createElement('div');
        camoName.className = 'camo-name';
        camoName.textContent = camo.name;
        
        // Add rarity indicator for all camos (shown on hover)
        const rarityBadge = document.createElement('div');
        rarityBadge.className = `camo-rarity-badge rarity-${camo.rarity || 'common'}`;
        rarityBadge.textContent = (camo.rarity || 'common').toUpperCase();
        camoItem.appendChild(rarityBadge);
        
        camoItem.appendChild(camoPreview);
        camoItem.appendChild(camoName);
        
        camoItem.addEventListener('click', () => {
            // Remove selected from all items
            grid.querySelectorAll('.camo-item').forEach(item => {
                item.classList.remove('selected');
            });
            // Add selected to clicked item
            camoItem.classList.add('selected');
            selectedCamoId = camo.id;
        });
        
        grid.appendChild(camoItem);
    });
    
    // Setup apply button
    const applyBtn = document.getElementById('camoApply');
    if (applyBtn) {
        applyBtn.onclick = async (e) => {
            e.stopPropagation();
            if (selectedCamoId !== null) {
                await setCardCamo(card.id, selectedCamoId);
                showGameMessage('🎨', 'Camo Applied', `Camo applied to ${card.title || 'card'}!`);
                hideCamoSelection();
            }
        };
    }
    
    // Setup apply to all button
    const applyToAllBtn = document.getElementById('camoApplyToAll');
    if (applyToAllBtn) {
        applyToAllBtn.onclick = async (e) => {
            e.stopPropagation();
            if (selectedCamoId !== null) {
                await setCamoForAllCards(selectedCamoId);
                showGameMessage('🎨', 'Camo Applied', 'Camo applied to all cards!');
                hideCamoSelection();
            }
        };
    }
    
    // Setup close button
    const closeBtn = document.getElementById('camoModalClose');
    if (closeBtn) {
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            hideCamoSelection();
        };
    }
    
    // Close on outside click
    modal.onclick = (e) => {
        if (e.target === modal) {
            hideCamoSelection();
        }
    };
    
    modal.style.display = 'flex';
}

// Select a camo (deprecated - now using buttons)
async function selectCamo(camoId) {
    if (isApplyingToAll) {
        await setCamoForAllCards(camoId);
        showGameMessage('🎨', 'Camo Applied', 'Camo applied to all cards!');
    } else if (currentCamoCard) {
        await setCardCamo(currentCamoCard.id, camoId);
        showGameMessage('🎨', 'Camo Applied', `Camo applied to ${currentCamoCard.title || 'card'}!`);
    }
    
    hideCamoSelection();
}

// Hide camo selection modal
function hideCamoSelection() {
    const modal = document.getElementById('camoSelectionModal');
    if (modal) {
        modal.style.display = 'none';
    }
    currentCamoCard = null;
    isApplyingToAll = false;
    selectedCamoId = null;
}

// Shop and Alpha Pack Functions
async function initializeShop() {
    await updateShopChipsDisplay();
    
    // Setup buy alpha pack button
    const buyBtn = document.getElementById('buyAlphaPackBtn');
    if (buyBtn) {
        buyBtn.onclick = () => {
            buyAlphaPack();
        };
    }
    
    // Setup gift alpha pack button
    const giftBtn = document.getElementById('giftAlphaPackBtn');
    if (giftBtn) {
        giftBtn.onclick = () => {
            showGiftFriendModal();
        };
    }
    
    // Load owned packs
    await loadYourPacks();
    
    // Check for gift notifications when opening shop tab (restore old behavior)
    await checkGiftNotifications();
}

async function updateShopChipsDisplay() {
    const chipsValue = document.getElementById('shopChipsValue');
    if (chipsValue) {
        // Get bits from player stats
        const stats = await getPlayerStats();
        const bits = stats.bits !== undefined && stats.bits !== null ? stats.bits : 0;
        chipsValue.textContent = Math.round(bits);
    }
    // Also update header currency
    await updateHeaderCurrency();
}

async function updateCollectionDisplay() {
    const collectionGrid = document.getElementById('collectionGrid');
    if (!collectionGrid) return;
    
    collectionGrid.innerHTML = '';
    const owned = await getOwnedCamos();
    
    AVAILABLE_CAMOS.forEach(camo => {
        if (camo.id === 'None') return; // Skip None from collection
        
        const ownedItem = document.createElement('div');
        ownedItem.className = 'collection-item';
        if (!owned[camo.id]) {
            ownedItem.classList.add('locked');
        }
        
        const preview = document.createElement('div');
        preview.className = 'collection-preview';
        if (camo.filename) {
            preview.style.backgroundImage = `url('images/Card Camo/${camo.filename}')`;
            preview.style.backgroundSize = 'cover';
            preview.style.backgroundPosition = 'center';
        }
        if (!owned[camo.id]) {
            preview.style.filter = 'grayscale(100%) brightness(0.3)';
        }
        
        const name = document.createElement('div');
        name.className = 'collection-name';
        name.textContent = camo.name;
        
        const rarity = document.createElement('div');
        rarity.className = `collection-rarity rarity-${camo.rarity}`;
        rarity.textContent = camo.rarity ? camo.rarity.toUpperCase() : 'COMMON';
        
        ownedItem.appendChild(preview);
        ownedItem.appendChild(name);
        ownedItem.appendChild(rarity);
        
        if (!owned[camo.id]) {
            const lockIcon = document.createElement('div');
            lockIcon.className = 'collection-lock';
            lockIcon.textContent = '🔒';
            ownedItem.appendChild(lockIcon);
        }
        
        collectionGrid.appendChild(ownedItem);
    });
}

async function buyAlphaPack() {
    if (!currentUser) {
        showGameMessage('⚠️', 'Sign In Required', 'Please sign in to purchase alpha packs');
        return;
    }
    
    // Get current bits from stats
    const stats = await getPlayerStats();
    const currentBits = stats.bits !== undefined && stats.bits !== null ? stats.bits : 0;
    
    if (currentBits < ALPHA_PACK_COST) {
        showGameMessage('💰', 'Not Enough Bits', `You need ${ALPHA_PACK_COST} bits to buy an alpha pack. You have ${Math.round(currentBits)} bits.`);
        return;
    }
    
    // Deduct bits from stats
    stats.bits = (stats.bits || 0) - ALPHA_PACK_COST;
    await savePlayerStats(stats);
    
    // Update displays
    await updateShopChipsDisplay();
    await updateStatsDisplay(); // Update profile stats if visible
    
    // Open the alpha pack
    openAlphaPack();
}

function openAlphaPack(packId = null) {
    const modal = document.getElementById('alphaPackModal');
    const pack = document.getElementById('alphaPackPack');
    const wheel = document.getElementById('alphaPackWheel');
    const result = document.getElementById('alphaPackResult');
    const closeBtn = document.getElementById('alphaPackCloseBtn');
    
    if (!modal || !pack || !result || !wheel) return;
    
    // Store packId for later use if needed
    if (packId) {
        modal.dataset.packId = packId;
    }
    
    // Reset state
    modal.style.display = 'flex';
    pack.style.display = 'block';
    result.style.display = 'none';
    closeBtn.style.display = 'none';
    
    // Reset wheel rotation (so repeated opens look right)
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    // Force reflow
    void wheel.offsetWidth;
    
    // Determine rarity using your current drop rates
    // Common: 75%, Rare: 23%, Epic: 2%
    const rarityRoll = Math.random();
    const selectedRarity = rarityRoll < 0.75 ? 'common' : (rarityRoll < 0.97 ? 'rare' : 'epic');
    
    // Spin wheel to land on the chosen rarity slice (match the visual slice sizes)
    const segments = {
        common: { start: 0, end: 270 },       // 75%
        rare: { start: 270, end: 352.8 },     // 23%
        epic: { start: 352.8, end: 360 }      // 2%
    };
    const seg = segments[selectedRarity];
    // Keep away from edges; for tiny epic slice use a smaller margin
    const sliceSize = (seg.end - seg.start);
    const margin = Math.min(4, Math.max(0.6, sliceSize * 0.15));
    const usable = Math.max(0.2, sliceSize - (margin * 2));
    const targetAngle = seg.start + margin + (Math.random() * usable);
    
    const spins = 5 + Math.floor(Math.random() * 3); // 5-7 full spins
    const finalDeg = (spins * 360) + (360 - targetAngle);
    const SPIN_MS = 3400;
    
    wheel.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.9, 0.2, 1)`;
    wheel.style.transform = `rotate(${finalDeg}deg)`;
    
    // Reveal result after the wheel stops
    setTimeout(async () => {
        // Get available camos (excluding None, duplicates are allowed)
        const availableCamos = AVAILABLE_CAMOS.filter(c => c.id !== 'None');
        
        // Pick a camo from the selected rarity (with fallbacks if a rarity is empty)
        let pool = availableCamos.filter(c => c.rarity === selectedRarity);
        if (pool.length === 0) {
            // Fallback order: rare -> common -> epic -> any
            pool = availableCamos.filter(c => c.rarity === 'rare');
        }
        if (pool.length === 0) {
            pool = availableCamos.filter(c => c.rarity === 'common');
        }
        if (pool.length === 0) {
            pool = availableCamos.filter(c => c.rarity === 'epic');
        }
        if (pool.length === 0) {
            pool = availableCamos;
        }
        
        const selectedCamo = pool[Math.floor(Math.random() * pool.length)];
        
        // Check if this is a duplicate
        const owned = await getOwnedCamos();
        const isDuplicate = owned[selectedCamo.id] === true;
        pack.style.display = 'none';
        result.style.display = 'block';
        
        const preview = document.getElementById('alphaPackResultPreview');
        const name = document.getElementById('alphaPackResultName');
        const rarity = document.getElementById('alphaPackResultRarity');
        
        if (preview && selectedCamo.filename) {
            preview.style.backgroundImage = `url('images/Card Camo/${selectedCamo.filename}')`;
            preview.style.backgroundSize = 'cover';
            preview.style.backgroundPosition = 'center';
        }
        
        if (name) {
            if (isDuplicate) {
                name.textContent = `${selectedCamo.name} (Duplicate!)`;
            } else {
                name.textContent = selectedCamo.name;
            }
        }
        if (rarity) {
            if (isDuplicate) {
                rarity.textContent = 'DUPLICATE - +50 BITS';
                rarity.className = 'alpha-pack-result-rarity rarity-duplicate';
            } else {
                rarity.textContent = selectedCamo.rarity ? selectedCamo.rarity.toUpperCase() : 'COMMON';
                rarity.className = `alpha-pack-result-rarity rarity-${selectedCamo.rarity}`;
            }
        }
        
        // Handle duplicate or new camo
        if (isDuplicate) {
            // Give 50 bits back for duplicate
            const stats = await getPlayerStats();
            stats.bits = (stats.bits || 0) + 50;
            await savePlayerStats(stats);
            await updateShopChipsDisplay();
            await updateStatsDisplay();
        } else {
            // Add to owned camos
            await addOwnedCamo(selectedCamo.id);
        }
        
        closeBtn.style.display = 'block';
        
        // Play sound if available
        if (typeof soundManager !== 'undefined') {
            if (selectedCamo.rarity === 'epic') {
                soundManager.playCardSelect(); // Use special sound for epic
            } else {
                soundManager.playCardSelect();
            }
        }
    }, SPIN_MS + 100);
    
    // Close button handler
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.display = 'none';
        };
    }
}

// Gift System Functions
async function showGiftFriendModal() {
    if (!currentUser) {
        showGameMessage('⚠️', 'Sign In Required', 'Please sign in to gift alpha packs');
        return;
    }
    
    const modal = document.getElementById('giftFriendModal');
    const friendList = document.getElementById('giftFriendList');
    const closeBtn = document.getElementById('giftFriendCloseBtn');
    
    if (!modal || !friendList) return;
    
    // Check bits
    const stats = await getPlayerStats();
    const currentBits = stats.bits !== undefined && stats.bits !== null ? stats.bits : 0;
    
    if (currentBits < ALPHA_PACK_COST) {
        showGameMessage('💰', 'Not Enough Bits', `You need ${ALPHA_PACK_COST} bits to gift an alpha pack. You have ${Math.round(currentBits)} bits.`);
        return;
    }
    
    // Load friends
    if (friendsListData.length === 0) {
        await loadFriends();
    }
    
    if (friendsListData.length === 0) {
        friendList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <div class="empty-state-text">No friends to gift. Add friends first!</div>
            </div>
        `;
    } else {
        friendList.innerHTML = '';
        friendsListData.forEach(friend => {
            const friendItem = document.createElement('div');
            friendItem.className = 'gift-friend-item';
            
            const avatar = document.createElement('div');
            avatar.className = 'gift-friend-avatar';
            const initial = friend.name ? friend.name.charAt(0).toUpperCase() : '?';
            avatar.textContent = initial; // Show initial immediately as fallback
            
            if (friend.photoURL) {
                // Use testImageLoad to handle 429 errors gracefully
                testImageLoad(friend.photoURL).then(() => {
                    // Image loaded successfully - apply it
                    avatar.style.backgroundImage = `url(${friend.photoURL})`;
                    avatar.style.backgroundSize = 'cover';
                    avatar.style.backgroundPosition = 'center';
                    avatar.textContent = ''; // Hide initial when image loads
                }).catch(() => {
                    // Image failed to load (429, network error, etc.) - keep initial visible
                    avatar.style.backgroundImage = '';
                    avatar.style.backgroundSize = '';
                    avatar.style.backgroundPosition = '';
                    // Initial is already set above
                });
            }
            
            const name = document.createElement('div');
            name.className = 'gift-friend-name';
            name.textContent = friend.name || 'Unknown';
            
            friendItem.appendChild(avatar);
            friendItem.appendChild(name);
            
            friendItem.onclick = () => {
                const messageInput = document.getElementById('giftMessageInput');
                const message = messageInput ? messageInput.value.trim() : '';
                giftAlphaPackToFriend(friend.id, friend.name, message);
            };
            
            friendList.appendChild(friendItem);
        });
    }
    
    modal.style.display = 'flex';
    
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.display = 'none';
        };
    }
}

async function giftAlphaPackToFriend(friendId, friendName, message = '') {
    if (!currentUser || !window.firebaseDb) return;
    
    // Check bits again
    const stats = await getPlayerStats();
    const currentBits = stats.bits !== undefined && stats.bits !== null ? stats.bits : 0;
    
    if (currentBits < ALPHA_PACK_COST) {
        showGameMessage('💰', 'Not Enough Bits', `You need ${ALPHA_PACK_COST} bits to gift an alpha pack.`);
        return;
    }
    
    try {
        // Deduct bits
        stats.bits = (stats.bits || 0) - ALPHA_PACK_COST;
        await savePlayerStats(stats);
        
        // Create gift pack document in Firestore
        const giftData = {
            receiverId: friendId,
            senderId: currentUser.uid,
            senderName: currentUser.displayName || currentUser.email || 'Someone',
            message: message || null,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            opened: false
        };
        
        await window.firebaseDb.collection('giftedPacks').add(giftData);
        
        // Update displays
        await updateShopChipsDisplay();
        await updateStatsDisplay();
        
        // Close modal and clear message
        const modal = document.getElementById('giftFriendModal');
        const messageInput = document.getElementById('giftMessageInput');
        if (modal) {
            modal.style.display = 'none';
        }
        if (messageInput) {
            messageInput.value = '';
        }
        
        showGameMessage('🎁', 'Gift Sent!', `You gifted an Alpha Pack to ${friendName}!`);
    } catch (error) {
        console.error('Error gifting alpha pack:', error);
        showGameMessage('❌', 'Error', 'Failed to send gift. Please try again.');
    }
}

async function loadYourPacks() {
    if (!currentUser || !window.firebaseDb) {
        const container = document.getElementById('yourPacksContainer');
        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📦</div>
                    <div class="empty-state-text">Sign in to view your packs!</div>
                </div>
            `;
        }
        // Update shop tab badge (0 packs when not signed in)
        updateShopTabNotificationBadge(0);
        return;
    }
    
    try {
        // Load packs where current user is receiver and not opened
        // Try with orderBy first (requires index)
        const packsQuery = window.firebaseDb.collection('giftedPacks')
            .where('receiverId', '==', currentUser.uid)
            .where('opened', '==', false)
            .orderBy('timestamp', 'desc');
        
        const snapshot = await packsQuery.get();
        const packs = [];
        
        snapshot.forEach(doc => {
            packs.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        renderYourPacks(packs);
        // Update shop tab badge
        updateShopTabNotificationBadge(packs.length);
    } catch (error) {
        // Check if it's a failed-precondition (missing index) error
        if (error.code === 'failed-precondition') {
            console.warn('Index not found, using fallback query:', error);
            // Fallback: try without orderBy if index doesn't exist
            try {
                const packsQuery = window.firebaseDb.collection('giftedPacks')
                    .where('receiverId', '==', currentUser.uid)
                    .where('opened', '==', false);
                
                const snapshot = await packsQuery.get();
                const packs = [];
                
                snapshot.forEach(doc => {
                    packs.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });
                
                // Sort by timestamp client-side
                packs.sort((a, b) => {
                    const aTime = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp || 0);
                    const bTime = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp || 0);
                    return bTime.getTime() - aTime.getTime();
                });
                
                renderYourPacks(packs);
                // Update shop tab badge
                updateShopTabNotificationBadge(packs.length);
            } catch (fallbackError) {
                console.error('Error loading packs (fallback):', fallbackError);
                const container = document.getElementById('yourPacksContainer');
                if (container) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon">⚠️</div>
                            <div class="empty-state-text">Error loading packs</div>
                        </div>
                    `;
                }
            }
        } else {
            // Other errors
            console.error('Error loading your packs:', error);
            const container = document.getElementById('yourPacksContainer');
            if (container) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">⚠️</div>
                        <div class="empty-state-text">Error loading packs</div>
                    </div>
                `;
            }
        }
    }
}

function renderYourPacks(packs) {
    const container = document.getElementById('yourPacksContainer');
    if (!container) return;
    
    if (packs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📦</div>
                <div class="empty-state-text">No packs yet. Buy or receive a gift to get started!</div>
            </div>
        `;
        // Update shop tab badge
        updateShopTabNotificationBadge(0);
        return;
    }
    
    container.innerHTML = '';
    
    packs.forEach(pack => {
        const packItem = document.createElement('div');
        packItem.className = 'your-pack-item';
        if (pack.senderId) {
            packItem.classList.add('gifted');
        }
        
        const icon = document.createElement('div');
        icon.className = 'your-pack-icon';
        icon.textContent = '📦';
        
        const label = document.createElement('div');
        label.className = 'your-pack-label';
        label.textContent = 'Alpha Pack';
        
        packItem.appendChild(icon);
        packItem.appendChild(label);
        
        if (pack.senderName) {
            const sender = document.createElement('div');
            sender.className = 'your-pack-sender';
            sender.textContent = `From: ${pack.senderName}`;
            packItem.appendChild(sender);
        }
        
        packItem.onclick = () => {
            openGiftedPack(pack.id);
        };
        
        container.appendChild(packItem);
    });
    
    // Update shop tab badge with unopened packs count
    updateShopTabNotificationBadge(packs.length);
}

// Update shop tab notification badge
function updateShopTabNotificationBadge(unopenedPacksCount) {
    const badge = document.getElementById('shopTabNotificationBadge');
    if (!badge) return;
    
    if (unopenedPacksCount > 0) {
        badge.style.display = 'flex';
        badge.textContent = unopenedPacksCount > 99 ? '99+' : unopenedPacksCount.toString();
    } else {
        badge.style.display = 'none';
    }
}

async function openGiftedPack(packId) {
    if (!currentUser || !window.firebaseDb) return;
    
    try {
        // Mark pack as opened
        await window.firebaseDb.collection('giftedPacks').doc(packId).update({
            opened: true
        });
        
        // Open the pack (same as regular pack opening)
        openAlphaPack(packId);
        
        // Reload packs list (this will update the badge automatically)
        await loadYourPacks();
    } catch (error) {
        console.error('Error opening gifted pack:', error);
        showGameMessage('❌', 'Error', 'Failed to open pack. Please try again.');
    }
}

async function checkGiftNotifications() {
    if (!currentUser || !window.firebaseDb) return;
    
    try {
        // Get all unopened packs that haven't been shown yet
        // Try with orderBy first (requires index)
        const packsQuery = window.firebaseDb.collection('giftedPacks')
            .where('receiverId', '==', currentUser.uid)
            .where('opened', '==', false)
            .orderBy('timestamp', 'desc');
        
        const snapshot = await packsQuery.get();
        
        if (!snapshot.empty) {
            const packs = [];
            snapshot.forEach(doc => {
                packs.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            // Get list of already shown gift IDs
            const shownGifts = JSON.parse(localStorage.getItem('shownGiftIds') || '[]');
            
            // Show notification for each unshown gift (oldest first)
            const unshownPacks = packs.filter(pack => !shownGifts.includes(pack.id));
            unshownPacks.reverse(); // Show oldest first
            
            if (unshownPacks.length > 0) {
                // Show notifications one at a time with a delay
                for (let i = 0; i < unshownPacks.length; i++) {
                    const pack = unshownPacks[i];
                    setTimeout(() => {
                        showGiftNotification(pack.senderName || 'Someone', pack.message || null);
                        // Mark as shown
                        shownGifts.push(pack.id);
                        localStorage.setItem('shownGiftIds', JSON.stringify(shownGifts));
                    }, i * 2000); // 2 second delay between each notification
                }
            }
        }
    } catch (error) {
        // Check if it's a failed-precondition (missing index) error
        if (error.code === 'failed-precondition') {
            console.warn('Index not found for gift notifications, using fallback query:', error);
            // Fallback: try without orderBy if index doesn't exist
            try {
                const packsQuery = window.firebaseDb.collection('giftedPacks')
                    .where('receiverId', '==', currentUser.uid)
                    .where('opened', '==', false);
                
                const snapshot = await packsQuery.get();
                
                if (!snapshot.empty) {
                    const packs = [];
                    snapshot.forEach(doc => {
                        packs.push({
                            id: doc.id,
                            ...doc.data()
                        });
                    });
                    
                    // Sort by timestamp client-side
                    packs.sort((a, b) => {
                        const aTime = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp || 0);
                        const bTime = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp || 0);
                        return aTime.getTime() - bTime.getTime(); // Oldest first
                    });
                    
                    // Get list of already shown gift IDs
                    const shownGifts = JSON.parse(localStorage.getItem('shownGiftIds') || '[]');
                    
                    // Show notification for each unshown gift
                    const unshownPacks = packs.filter(pack => !shownGifts.includes(pack.id));
                    
                    if (unshownPacks.length > 0) {
                        // Show notifications one at a time with a delay
                        for (let i = 0; i < unshownPacks.length; i++) {
                            const pack = unshownPacks[i];
                            setTimeout(() => {
                                showGiftNotification(pack.senderName || 'Someone', pack.message || null);
                                // Mark as shown
                                shownGifts.push(pack.id);
                                localStorage.setItem('shownGiftIds', JSON.stringify(shownGifts));
                            }, i * 2000); // 2 second delay between each notification
                        }
                    }
                }
            } catch (fallbackError) {
                console.error('Error checking gift notifications (fallback):', fallbackError);
            }
        } else {
            console.error('Error checking gift notifications:', error);
        }
    }
}

function showGiftNotification(senderName, giftMessage = null) {
    const modal = document.getElementById('giftNotificationModal');
    const senderEl = document.getElementById('giftNotificationSender');
    const messageEl = document.getElementById('giftNotificationMessage');
    const noteEl = document.getElementById('giftNotificationNote');
    const okBtn = document.getElementById('giftNotificationOkBtn');
    
    if (!modal) return;
    
    if (senderEl) {
        senderEl.textContent = `From: ${senderName}`;
    }
    
    if (messageEl) {
        if (giftMessage) {
            messageEl.textContent = `"${giftMessage}"`;
            messageEl.style.display = 'block';
        } else {
            messageEl.style.display = 'none';
        }
    }
    
    if (noteEl) {
        noteEl.textContent = 'Check "Your Packs" to open it!';
    }
    
    modal.style.display = 'flex';
    
    if (okBtn) {
        okBtn.onclick = () => {
            modal.style.display = 'none';
        };
    }
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
    
    // Ensure card has id and title (handle different card data structures)
    const cardId = card.id || card.metadata?.id;
    const cardTitle = card.title || card.metadata?.title || 'Card';
    
    if (!cardId) {
        console.error('Card info: Card missing id', card);
        return;
    }
    
    cardImage.src = getCardImagePath(cardId);
    cardImage.alt = cardTitle;
    
    // Don't apply camo to card info overlay - show default card appearance
    const cardInfoContent = overlay.querySelector('.card-info-content');
    if (cardInfoContent) {
        cardInfoContent.style.backgroundImage = '';
    }
    
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
    
    // Initialize game settings
    initializeGameSettings();
    
    // Initialize custom word input (will be re-initialized when needed)
    initializeCustomWordInput();
    
    // Wait a bit for CARD_CONFIG to be injected by server
    setTimeout(async () => {
        // Ensure valid decks exist for all slots
        const allCards = getAllCards();
        if (allCards.length === 0) {
            console.warn('No cards available yet, decks will be initialized when cards load');
            return;
        }
        
        // Initialize camos for all cards (set default if not set)
        const camos = getCardCamos();
        let camosUpdated = false;
        allCards.forEach(card => {
            if (!camos[card.id]) {
                camos[card.id] = 'None'; // Default to None (no camo)
                camosUpdated = true;
            }
        });
        if (camosUpdated) {
            await saveCardCamos(camos);
        }
        
        // Apply camos to all cards
        updateAllCardCamoDisplays();
        
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
    
    // Forgot Password
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    const sendResetEmailBtn = document.getElementById('sendResetEmailBtn');
    const backToLoginFromForgotBtn = document.getElementById('backToLoginFromForgotBtn');
    
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            hideAuthErrors();
            ScreenManager.show('forgotPassword');
            document.getElementById('forgotPasswordEmail').value = document.getElementById('loginEmail').value || '';
            document.getElementById('forgotPasswordEmail').focus();
        });
    }
    
    if (sendResetEmailBtn) {
        sendResetEmailBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleForgotPassword();
        });
    }
    
    // Enter key on forgot password form
    const forgotPasswordEmail = document.getElementById('forgotPasswordEmail');
    if (forgotPasswordEmail) {
        forgotPasswordEmail.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleForgotPassword();
            }
        });
    }
    
    if (backToLoginFromForgotBtn) {
        backToLoginFromForgotBtn.addEventListener('click', () => {
            hideAuthErrors();
            document.getElementById('forgotPasswordError').style.display = 'none';
            document.getElementById('forgotPasswordSuccess').style.display = 'none';
            ScreenManager.show('login');
        });
    }
    
    // Email Verification
    const verifyEmailBtn = document.getElementById('verifyEmailBtn');
    const resendVerificationBtn = document.getElementById('resendVerificationBtn');
    const backToSignupFromVerificationBtn = document.getElementById('backToSignupFromVerificationBtn');
    
    if (verifyEmailBtn) {
        verifyEmailBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleEmailVerification();
        });
    }
    
    // Enter key on verification code input and restrict to numbers only
    const verificationCode = document.getElementById('verificationCode');
    if (verificationCode) {
        // Only allow numbers
        verificationCode.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });
        
        verificationCode.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleEmailVerification();
            } else if (!/[0-9]/.test(e.key) && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'Tab') {
                e.preventDefault();
            }
        });
    }
    
    if (resendVerificationBtn) {
        resendVerificationBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleResendVerificationCode();
        });
    }
    
    if (backToSignupFromVerificationBtn) {
        backToSignupFromVerificationBtn.addEventListener('click', () => {
            hideAuthErrors();
            // Clear all pending verification data
            sessionStorage.removeItem('pendingVerificationEmail');
            sessionStorage.removeItem('pendingVerificationUid');
            sessionStorage.removeItem('pendingSignupName');
            sessionStorage.removeItem('pendingSignupEmail');
            sessionStorage.removeItem('pendingSignupPassword');
            sessionStorage.removeItem('pendingVerificationCode');
            sessionStorage.removeItem('pendingVerificationExpires');
            ScreenManager.show('signup');
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

// Daily bit claim button
document.getElementById('dailyChipClaimBtn')?.addEventListener('click', async () => {
    await claimDailyChips();
});

// Shared function for starting matchmaking (ranked or casual)
async function startMatchmaking(isRanked = true) {
    // Check if user is banned
    if (currentUser && currentUser.uid) {
        const banned = await isUserBanned(currentUser.uid);
        if (banned) {
            showGameMessage('🚫', 'Account Banned', 'Your account has been banned. Please contact support if you believe this is an error.');
            return;
        }
    }
    
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
    
    // Get chip points for bot skill matching (ranked games)
    let chipPoints = null;
    if (isRanked) {
        try {
            const stats = await getPlayerStats();
            chipPoints = stats.chipPoints !== undefined && stats.chipPoints !== null ? stats.chipPoints : 0;
        } catch (error) {
            console.error('Error getting chip points for matchmaking:', error);
            chipPoints = 0;
        }
    }
    
    if (isRanked) {
        socket.emit('findMatch', { playerName: name, firebaseUid: firebaseUid, photoURL: photoURL, chipPoints: chipPoints });
    } else {
        socket.emit('findCasualMatch', { playerName: name, firebaseUid: firebaseUid, photoURL: photoURL, chipPoints: chipPoints });
    }
}

// Play tab button event listeners
// Game Settings Management
let gameSettings = {
    turnTimeLimit: 60,
    gameMode: 'classic',
    startingPlayer: 'random'
};

// Update game mode name in settings initialization if needed

function initializeGameSettings() {
    // Initialize settings option buttons
    const optionButtons = document.querySelectorAll('.settings-option-btn');
    optionButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const setting = btn.dataset.setting;
            const value = btn.dataset.value;
            
            // Remove active class from all buttons in the same setting group
            const settingGroup = btn.closest('.settings-section');
            const groupButtons = settingGroup.querySelectorAll('.settings-option-btn');
            groupButtons.forEach(b => b.classList.remove('active'));
            
            // Add active class to clicked button
            btn.classList.add('active');
            
            // Update settings object
            if (setting === 'turnTimeLimit') {
                gameSettings.turnTimeLimit = parseInt(value) || 0; // 0 = unlimited
            } else if (setting === 'gameMode') {
                gameSettings.gameMode = value;
            } else if (setting === 'startingPlayer') {
                gameSettings.startingPlayer = value;
            }
        });
    });
    
    // Close/Cancel buttons
    const closeBtn = document.getElementById('closeGameSettingsBtn');
    const cancelBtn = document.getElementById('cancelGameSettingsBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            ScreenManager.show('lobby');
        });
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            ScreenManager.show('lobby');
        });
    }
    
    // Start Game button
    const startGameBtn = document.getElementById('startGameWithSettingsBtn');
    if (startGameBtn) {
        startGameBtn.addEventListener('click', async () => {
            const name = getPlayerName();
            if (!name) {
                showGameMessage('⚠️', 'Sign In Required', 'Please sign in to create a game');
                ScreenManager.show('lobby');
                return;
            }
            
            // Ensure decks are loaded
            cachedDecks = null;
            await getAllDecks();
            
            const testDeck = await getPlayerDeck();
            if (!testDeck || testDeck.length === 0) {
                console.error('Deck is empty after loading!');
                showGameMessage('⚠️', 'Deck Error', 'Your deck could not be loaded. Please check your deck in the lobby.');
                ScreenManager.show('lobby');
                setTimeout(() => {
                    switchTab('deck');
                }, 100);
                return;
            }
            
            // Validate deck
            const validation = validateDeckForGame();
            if (!validation.valid) {
                showGameMessage('⚠️', 'Incomplete Deck', validation.message);
                ScreenManager.show('lobby');
                setTimeout(() => {
                    switchTab('deck');
                }, 100);
                return;
            }
            
            // Create game with settings
            const firebaseUid = currentUser ? currentUser.uid : null;
            const photoURL = window.currentUserPhotoURL || (currentUser ? currentUser.photoURL : null);
            console.log('Creating game with settings:', gameSettings);
            socket.emit('createGame', { 
                playerName: name, 
                firebaseUid: firebaseUid, 
                photoURL: photoURL,
                settings: gameSettings
            });
            
            // Store gameId for custom word input (will be set when gameCreated event fires)
            window.pendingGameSettings = gameSettings;
        });
    }
}

function attachPlayTabListeners() {
    const findMatchBtn = document.getElementById('findMatchBtn');
    if (findMatchBtn) {
        findMatchBtn.addEventListener('click', async () => {
            await startMatchmaking(true); // Ranked
        });
    }

    const findCasualMatchBtn = document.getElementById('findCasualMatchBtn');
    if (findCasualMatchBtn) {
        findCasualMatchBtn.addEventListener('click', async () => {
            console.log('Casual matchmaking button clicked');
            await startMatchmaking(false); // Casual
        });
    } else {
        console.error('findCasualMatchBtn not found in DOM');
    }

    const cancelMatchmakingBtn = document.getElementById('cancelMatchmakingBtn');
    if (cancelMatchmakingBtn) {
        cancelMatchmakingBtn.addEventListener('click', () => {
            socket.emit('cancelMatchmaking');
        });
    }

    const createGameBtn = document.getElementById('createGameBtn');
    if (createGameBtn) {
        createGameBtn.addEventListener('click', async () => {
            const name = getPlayerName();
            if (name) {
                // Cancel matchmaking if active
                socket.emit('cancelMatchmaking');
                
                // Ensure decks are loaded before showing settings
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
                
                // Validate deck before showing settings
                const validation = validateDeckForGame();
                if (!validation.valid) {
                    showGameMessage('⚠️', 'Incomplete Deck', validation.message);
                    // Switch to deck tab so user can fix their deck (delay to ensure popup is visible)
                    setTimeout(() => {
                        switchTab('deck');
                    }, 100);
                    return;
                }
                
                // Show game settings screen instead of creating game directly
                ScreenManager.show('gameSettings');
            } else {
                showGameMessage('⚠️', 'Sign In Required', 'Please sign in to create a game');
            }
        });
    }

    const joinGameBtn = document.getElementById('joinGameBtn');
    if (joinGameBtn) {
        joinGameBtn.addEventListener('click', () => {
            // Cancel matchmaking if active
            socket.emit('cancelMatchmaking');
            const joinGroup = document.getElementById('joinGroup');
            if (joinGroup) {
                joinGroup.style.display = 'block';
            }
        });
    }
}

// Attach listeners when DOM is ready or immediately if already ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachPlayTabListeners);
} else {
    // DOM is already ready, attach immediately
    attachPlayTabListeners();
}

// More tab menu functionality
let moreTabMenuOpen = false;

function updateMoreMenuActiveState() {
    const moreMenuItems = document.querySelectorAll('.more-tab-item');
    moreMenuItems.forEach(item => {
        const tabName = item.getAttribute('data-tab');
        const tabPanel = document.getElementById(`${tabName}Tab`);
        if (tabPanel && tabPanel.classList.contains('active')) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

function toggleMoreTabMenu() {
    const moreMenu = document.getElementById('moreTabMenu');
    if (!moreMenu) return;
    
    moreTabMenuOpen = !moreTabMenuOpen;
    moreMenu.style.display = moreTabMenuOpen ? 'block' : 'none';
    
    // Update active state of items in more menu
    updateMoreMenuActiveState();
}

function closeMoreTabMenu() {
    const moreMenu = document.getElementById('moreTabMenu');
    if (!moreMenu) return;
    
    moreTabMenuOpen = false;
    moreMenu.style.display = 'none';
}

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
    const selectedTab = document.querySelector(`.lobby-tab[data-tab="${tabName}"]`);
    const selectedPanel = document.getElementById(`${tabName}Tab`);
    
    if (selectedTab) selectedTab.classList.add('active');
    if (selectedPanel) selectedPanel.classList.add('active');
    
    // Update active state in more menu
    updateMoreMenuActiveState();
    
    // If switching to deck tab, initialize deck builder
    if (tabName === 'deck') {
        renderDeckBuilder().then(() => {
        updateDeckCount();
        });
    }
    
    // If switching to admin tab, initialize admin panel
    if (tabName === 'admin') {
        // Load activity log when opening admin tab (only visible to creator)
        loadAdminActivityLog();
        // Verify admin access
        isAdminAsync().then(isAdmin => {
            if (!isAdmin) {
                // Not admin, switch back to play tab
                switchTab('play');
                showGameMessage('⚠️', 'Access Denied', 'Admin access required');
            } else {
                // Initialize admin panel
                initializeAdminPanel();
            }
        });
    }
    
    // If switching to profile tab, update stats display and user info
    if (tabName === 'profile') {
        // Update user info (name, email, avatar) first
        updateLobbyUserInfo();
        // Then update stats display
        updateStatsDisplay().catch(error => {
            console.error('Error loading stats:', error);
        });
        // Update achievements display
        updateAchievementsDisplay().catch(error => {
            console.error('Error loading achievements:', error);
        });
    }
    
    // If switching to leaderboard tab, load leaderboard
    if (tabName === 'leaderboard') {
        loadLeaderboard().catch(error => {
            console.error('Error loading leaderboard:', error);
        });
    }
    
    // If switching to shop tab, initialize shop
    if (tabName === 'shop') {
        initializeShop();
    }
    
    // If switching to settings tab, initialize settings
    if (tabName === 'settings') {
        initializeSettings();
    }
    
    // If switching to messages tab, refresh messages (already loaded on startup)
    if (tabName === 'messages') {
        // Only refresh if not already loaded or if friends list is empty
        const friendsListEl = document.getElementById('messagesFriendsList');
        if (friendsListEl && (friendsListEl.innerHTML.includes('Loading') || friendsListEl.querySelectorAll('.friend-item').length === 0)) {
            loadMessagesFriends();
        }
        // Also load unread counts
        loadUnreadMessageCounts();
        // Note: Individual friend unread counts (green dots) remain until you open their specific chat
        // The notification badge will update automatically based on remaining unread counts
    } else {
        // When switching away from messages tab, clear currentChatFriendId so notifications work again
        if (currentChatFriendId !== null) {
            currentChatFriendId = null;
        }
    }
    
    // If switching to community tab, refresh posts display (already loaded on startup)
    if (tabName === 'community') {
        // Only reload if posts aren't already displayed
        const bulletinList = document.getElementById('bulletinBoardPosts');
        const communityList = document.getElementById('communityPostsList');
        if (bulletinList && communityList && 
            (bulletinList.innerHTML.includes('Loading') || communityList.innerHTML.includes('Loading') || 
             bulletinList.innerHTML.trim() === '' || communityList.innerHTML.trim() === '')) {
            loadCommunityPosts();
        } else {
            // Just refresh the display with current data
            renderPostsWithShowMore(allBulletinPosts.slice(0, bulletinPostsShown), bulletinList, true, allBulletinPosts.length);
            renderPostsWithShowMore(allCommunityPosts.slice(0, communityPostsShown), communityList, false, allCommunityPosts.length);
        }
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
        let userEmail = currentUser.email || '';
        try {
            const userDoc = await window.firebaseDb.collection('users').doc(currentUser.uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                userName = userData.displayName || currentUser.displayName || 'Player';
                userPhotoURL = userData.photoURL || currentUser.photoURL || null;
                userEmail = userData.email || currentUser.email || '';
            }
        } catch (error) {
            console.error('Error fetching user info:', error);
            userName = currentUser.displayName || 'Player';
            userPhotoURL = currentUser.photoURL || null;
            userEmail = currentUser.email || '';
        }
        
        const currentUserIsAdmin = await isAdminAsync();
        
        // Fetch user info for top 10 players
        const topPlayers = [];
        for (const doc of topPlayersQuery.docs) {
            const stats = doc.data();
            const uid = doc.id;
            let name = 'Player';
            let photoURL = null;
            let email = '';
            let isAdminUser = false;
            
            try {
                const userDoc = await window.firebaseDb.collection('users').doc(uid).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    name = userData.displayName || 'Player';
                    photoURL = userData.photoURL || null;
                    email = userData.email || '';
                }
            } catch (error) {
                console.error('Error fetching user info for', uid, ':', error);
            }
            
            try {
                isAdminUser = await isUserAdminByUid(uid, email);
            } catch {
                isAdminUser = false;
            }
            
            topPlayers.push({
                uid: uid,
                name: name,
                photoURL: photoURL,
                email: email,
                chipPoints: stats.chipPoints || 0,
                stats: stats,
                isAdmin: isAdminUser
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
                email: userEmail,
                chipPoints: userStats.chipPoints || 0,
                rank: userRank,
                stats: userStats,
                isAdmin: currentUserIsAdmin === true
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
        const isPlayerAdmin = player.isAdmin === true || isAdminEmail(player.email || '');
        
        entry.innerHTML = `
            <div class="leaderboard-rank">#${rank}</div>
            <div class="leaderboard-avatar" style="${avatarStyle}">${player.photoURL ? '' : avatarInitial}</div>
            <div class="leaderboard-info">
                <div class="leaderboard-name ${isPlayerAdmin ? 'admin-name' : ''}">${escapeHtml(player.name)}</div>
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
    const isUserAdmin = user.isAdmin === true || isAdminEmail(user.email || '');
    
    userEntryEl.innerHTML = `
        <div class="leaderboard-rank">${rankText}</div>
        <div class="leaderboard-avatar" style="${avatarStyle}">${user.photoURL ? '' : avatarInitial}</div>
        <div class="leaderboard-info">
            <div class="leaderboard-name ${isUserAdmin ? 'admin-name' : ''}">${escapeHtml(user.name)}</div>
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
document.addEventListener('DOMContentLoaded', () => {
    // Main tab buttons
    document.querySelectorAll('.lobby-tab[data-tab]').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            const tabName = tab.getAttribute('data-tab');
            switchTab(tabName);
            // Close more menu if open
            closeMoreTabMenu();
        });
    });
    
    // More tab button click handler
    const moreTabBtn = document.getElementById('moreTabBtn');
    if (moreTabBtn) {
        moreTabBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMoreTabMenu();
        });
    }
    
    // More menu item click handlers
    document.querySelectorAll('.more-tab-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const tabName = item.getAttribute('data-tab');
            switchTab(tabName);
            closeMoreTabMenu();
        });
    });
    
    // Close more menu when clicking outside
    document.addEventListener('click', (e) => {
        const moreContainer = document.querySelector('.lobby-tab-more-container');
        if (moreContainer && !moreContainer.contains(e.target)) {
            closeMoreTabMenu();
        }
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
const helpBtn = document.getElementById('helpBtn');
if (helpBtn) helpBtn.addEventListener('click', openHelp);
const closeHelpBtn = document.getElementById('closeHelpBtn');
if (closeHelpBtn) closeHelpBtn.addEventListener('click', closeHelp);
const closeHelpBtnBottom = document.getElementById('closeHelpBtnBottom');
if (closeHelpBtnBottom) closeHelpBtnBottom.addEventListener('click', closeHelp);

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
                    const email = userDoc.data().email || '';
                    const isAdminUser = await isUserAdminByUid(friend.id, email);
                    return {
                        ...friend,
                        name: userDoc.data().displayName || 'Unknown',
                        email: email,
                        photoURL: userDoc.data().photoURL || null,
                        isAdmin: isAdminUser
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
                    const senderEmail = userDoc.data().email || '';
                    const senderIsAdmin = await isUserAdminByUid(request.senderId, senderEmail);
                    return {
                        ...request,
                        senderName: userDoc.data().displayName || 'Unknown',
                        senderEmail: senderEmail,
                        senderPhotoURL: userDoc.data().photoURL || null,
                        senderIsAdmin: senderIsAdmin
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
        const avatarInitial = friend.name ? friend.name.charAt(0).toUpperCase() : '👤';
        const avatarStyle = friend.photoURL 
            ? `background-image: url(${friend.photoURL}); background-size: cover; background-position: center;` 
            : '';
        const isFriendAdmin = friend.isAdmin === true || isAdminEmail(friend.email || '');
        return `
        <div class="friend-item" data-friend-id="${friend.id || ''}" data-friend-name="${friend.name || 'Unknown'}" data-friend-email="${friend.email || ''}" data-friend-photourl="${friend.photoURL || ''}">
            <div class="friend-avatar" style="${avatarStyle}">${friend.photoURL ? '' : avatarInitial}</div>
            <div class="friend-info">
                <div class="friend-name-container">
                    <div class="friend-name ${isFriendAdmin ? 'admin-name' : ''}">${friend.name || 'Unknown'}</div>
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
            const friendPhotoURL = item.dataset.friendPhotourl || '';
            if (friendId) {
                openFriendStats(friendId, friendName, friendEmail, friendPhotoURL);
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
    
    requestsList.innerHTML = requests.map(request => {
        const avatarInitial = request.senderName ? request.senderName.charAt(0).toUpperCase() : '👤';
        const avatarStyle = request.senderPhotoURL 
            ? `background-image: url(${request.senderPhotoURL}); background-size: cover; background-position: center;` 
            : '';
        const isRequestAdmin = request.senderIsAdmin === true || isAdminEmail(request.senderEmail || '');
        return `
        <div class="friend-item">
            <div class="friend-avatar" style="${avatarStyle}">${request.senderPhotoURL ? '' : avatarInitial}</div>
            <div class="friend-info">
                <div class="friend-name ${isRequestAdmin ? 'admin-name' : ''}">${request.senderName || 'Unknown'}</div>
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
    `;
    }).join('');
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
async function openFriendStats(friendId, friendName, friendEmail, friendPhotoURL = '') {
    const overlay = document.getElementById('friendStatsOverlay');
    if (!overlay) return;
    
    // Show loading state
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    // Set friend name
    const nameEl = document.getElementById('friendStatsName');
    if (nameEl) {
        nameEl.textContent = friendName || 'Friend Stats';
        // Add admin class if friend is admin
        try {
            const isFriendAdmin = await isUserAdminByUid(friendId, friendEmail || '');
            nameEl.classList.toggle('admin-name', isFriendAdmin === true);
        } catch {
            nameEl.classList.remove('admin-name');
        }
    }
    
    // Set avatar - use provided photoURL or fetch from Firestore
    const avatarEl = document.getElementById('friendStatsAvatar');
    if (avatarEl) {
        // First set initial as fallback
        const initial = friendName ? friendName.charAt(0).toUpperCase() : '👤';
        avatarEl.textContent = initial;
        avatarEl.style.backgroundImage = '';
        avatarEl.style.backgroundSize = '';
        avatarEl.style.backgroundPosition = '';
        
        // Use provided photoURL if available, otherwise fetch from Firestore
        let photoURL = friendPhotoURL || null;
        
        if (!photoURL && window.firebaseDb && friendId) {
            try {
                const userDoc = await window.firebaseDb.collection('users').doc(friendId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    photoURL = userData.photoURL || null;
                }
            } catch (error) {
                console.error('Error fetching friend photoURL:', error);
            }
        }
        
        // Set avatar image or initial
        if (photoURL) {
            avatarEl.style.backgroundImage = `url(${photoURL})`;
            avatarEl.style.backgroundSize = 'cover';
            avatarEl.style.backgroundPosition = 'center';
            avatarEl.textContent = '';
        } else {
            avatarEl.textContent = initial;
        }
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
            relationshipStatus,
            isAdmin: await isUserAdminByUid(user.id, user.email || '')
        };
    })).then(usersWithStatus => {
        searchResultsList.innerHTML = usersWithStatus.map(user => {
            const avatarInitial = user.displayName ? user.displayName.charAt(0).toUpperCase() : '👤';
            const avatarStyle = user.photoURL 
                ? `background-image: url(${user.photoURL}); background-size: cover; background-position: center;` 
                : '';
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
            
            const isUserAdmin = user.isAdmin === true || isAdminEmail(user.email || '');
            return `
                <div class="friend-search-result-item">
                    <div class="friend-avatar" style="${avatarStyle}">${user.photoURL ? '' : avatarInitial}</div>
                    <div class="friend-info">
                        <div class="friend-name ${isUserAdmin ? 'admin-name' : ''}">${user.displayName || 'Unknown'}</div>
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
    
    console.log('[CLIENT] ===== SENDING CHALLENGE =====');
    console.log('[CLIENT] Challenging friend:', friendFirebaseUid, friendName);
    console.log('[CLIENT] Socket connected:', socket && socket.connected);
    console.log('[CLIENT] Socket ID:', socket ? socket.id : 'NO SOCKET');
    
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
            console.error('[CLIENT] Error fetching target photoURL:', error);
        }
    }
    
    const challengeData = {
        challengerFirebaseUid: currentUser.uid,
        challengerName: playerName,
        challengerPhotoURL: challengerPhotoURL,
        targetFirebaseUid: friendFirebaseUid,
        targetName: friendName,
        targetPhotoURL: targetPhotoURL
    };
    
    console.log('[CLIENT] Emitting challengeFriend with data:', challengeData);
    socket.emit('challengeFriend', challengeData);
    console.log('[CLIENT] ✅ challengeFriend event emitted');
    console.log('[CLIENT] ===== CHALLENGE EMIT COMPLETE =====\n');
    
    // Show optimistic success message immediately
    showGameMessage('⚔️', 'Challenge Sent', `Challenge sent to ${friendName}!`, 2000);
}

// Handle challenge sent confirmation from server
socket.on('challengeSent', (data) => {
    if (data && data.success) {
        console.log('[CLIENT] ✅ Challenge confirmed sent by server:', data.challengeId);
        // Server has confirmed the challenge was sent successfully
    } else {
        console.log('[CLIENT] ⚠️ Challenge sent confirmation received but success=false:', data);
    }
});

// Handle incoming challenge request
socket.on('challengeRequest', (data) => {
    console.log('[CLIENT] ===== RECEIVED CHALLENGE REQUEST =====');
    console.log('[CLIENT] Challenge data:', data);
    const challengerName = data.challengerName || 'Unknown';
    
    const overlay = document.getElementById('challengeRequestOverlay');
    const titleEl = document.getElementById('challengeRequestTitle');
    const textEl = document.getElementById('challengeRequestText');
    const acceptBtn = document.getElementById('challengeAcceptBtn');
    const denyBtn = document.getElementById('challengeDenyBtn');
    
    console.log('[CLIENT] Overlay element:', overlay);
    console.log('[CLIENT] Title element:', titleEl);
    console.log('[CLIENT] Text element:', textEl);
    console.log('[CLIENT] Accept button:', acceptBtn);
    console.log('[CLIENT] Deny button:', denyBtn);
    
    if (!overlay || !titleEl || !textEl || !acceptBtn || !denyBtn) {
        console.error('[CLIENT] ❌ Challenge popup elements not found!');
        console.error('[CLIENT] Missing elements:', {
            overlay: !overlay,
            titleEl: !titleEl,
            textEl: !textEl,
            acceptBtn: !acceptBtn,
            denyBtn: !denyBtn
        });
        return;
    }
    
    titleEl.textContent = 'Challenge Request';
    textEl.textContent = `${challengerName} wants to challenge you to a game!`;
    
    // Store challenge data
    overlay.dataset.challengeId = data.challengeId;
    overlay.dataset.challengerFirebaseUid = data.challengerFirebaseUid;
    overlay.dataset.challengerName = data.challengerName;
    
    console.log('[CLIENT] Challenge data stored in overlay dataset');
    
    // CRITICAL: Ensure overlay is visible by removing display:none and adding show class
    // Remove inline display:none that might have been set when closing
    overlay.style.display = ''; // Clear inline display style so CSS class can work
    overlay.classList.remove('hiding'); // Remove hiding class if present
    overlay.classList.remove('show'); // Remove show class first to reset animation
    void overlay.offsetWidth; // Force reflow to reset animation
    overlay.classList.add('show'); // Add show class - this sets display:flex via CSS
    
    console.log('[CLIENT] Overlay classes after update:', overlay.className);
    console.log('[CLIENT] Overlay display style:', overlay.style.display);
    console.log('[CLIENT] Overlay computed display:', window.getComputedStyle(overlay).display);
    
    // Set up button handlers
    acceptBtn.onclick = () => {
        console.log('[CLIENT] Accept button clicked');
        acceptChallenge(data.challengeId, data.challengerFirebaseUid, data.challengerName);
    };
    denyBtn.onclick = () => {
        console.log('[CLIENT] Deny button clicked');
        denyChallenge(data.challengeId);
    };
    
    // Close on overlay click (outside content)
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            console.log('[CLIENT] Overlay background clicked, denying challenge');
            denyChallenge(data.challengeId);
        }
    };
    
    console.log('[CLIENT] ✅ Challenge popup should now be visible');
    console.log('[CLIENT] ===== CHALLENGE REQUEST HANDLED =====\n');
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
    
    // If already spectating a different game, leave it first
    if (window.isSpectator && window.spectatorGameId && window.spectatorGameId !== gameId) {
        console.log('Already spectating a different game, leaving first');
        leaveSpectatorMode();
        // Wait a moment for cleanup before starting new spectate
        setTimeout(() => {
            spectateFriendGame(friendFirebaseUid, gameId);
        }, 100);
        return;
    }
    
    // Clear chat messages before starting to spectate (in case switching games)
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        chatMessages.innerHTML = '';
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
    
    // Clear chat messages when starting to spectate a new game
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        chatMessages.innerHTML = '';
    }
    
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
            
            // Apply camo background
            const camoId = getCardCamo(card.id);
            const camo = AVAILABLE_CAMOS.find(c => c.id === camoId) || AVAILABLE_CAMOS[0]; // Default to None (BlackBase)
            if (camo && camo.filename) {
                cardElement.style.backgroundImage = `url('images/Card Camo/${camo.filename}')`;
                cardElement.style.backgroundSize = 'cover';
                cardElement.style.backgroundPosition = 'center';
                cardElement.style.backgroundRepeat = 'no-repeat';
            } else {
                cardElement.style.backgroundImage = '';
            }
            cardElement.dataset.cardId = card.id;
            
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

// REMOVED: Duplicate turnChanged handler - now handled in main handler above
// The main handler now handles both regular players and spectators

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
        // Queue splash for spectator mode
        queueCardSplash(data.card, data.playerName, data.camoId);
        
        // If the spectated player played a card, remove it from their hand and request updated hand
        if (data.playerId === window.spectatedPlayerId && window.spectatedPlayerHand) {
            // Remove the played card from hand (find by ID)
            const cardIndex = window.spectatedPlayerHand.findIndex(c => c.id === data.card.id);
            if (cardIndex !== -1) {
                window.spectatedPlayerHand.splice(cardIndex, 1);
                updateSpectatorHandPanel();
            }
            
            // Request updated hand from spectated player after a short delay (to allow card draw)
            // Store timeout ID so we can clear it if leaving spectator mode
            if (!window.spectatorHandUpdateTimeouts) {
                window.spectatorHandUpdateTimeouts = [];
            }
            const timeoutId = setTimeout(() => {
                // Remove this timeout from the array when it executes
                if (window.spectatorHandUpdateTimeouts) {
                    const index = window.spectatorHandUpdateTimeouts.indexOf(timeoutId);
                    if (index > -1) window.spectatorHandUpdateTimeouts.splice(index, 1);
                }
                
                if (window.isSpectator && window.spectatorGameId && window.spectatedPlayerId) {
                    // Request hand update through server
                    socket.emit('requestHandForSpectatorUpdate', {
                        gameId: window.spectatorGameId,
                        spectatedPlayerId: window.spectatedPlayerId
                    });
                }
            }, 500);
            window.spectatorHandUpdateTimeouts.push(timeoutId);
        }
    }
});

// Spectator game over handler - separate from main handler to prevent chip loss
socket.on('gameOver', (data) => {
    if (window.isSpectator && window.spectatorGameId) {
        console.log('Spectator game over event received:', data);
        
        // CRITICAL: Clear all game effects when spectator game ends
        removeDrunkEffect();
        if (gameState) {
            gameState.activeEffects = [];
            console.log('Cleared all active effects on spectator game over');
        }
        
        // Exit spectator mode first (but keep spectator flag temporarily for display)
        const wasSpectating = window.isSpectator;
        const spectatedGameId = window.spectatorGameId;
        leaveSpectatorMode();
        
        // Show spectator-specific game over screen
        showSpectatorGameOver(data, wasSpectating, spectatedGameId);
    }
});

function showSpectatorGameOver(data, wasSpectating, spectatedGameId) {
    // Prepare UI elements
    const titleEl = document.getElementById('spectatorGameOverTitle');
    const messageEl = document.getElementById('spectatorGameOverMessage');
    const iconEl = document.getElementById('spectatorGameOverIcon');
    const wordEl = document.getElementById('spectatorGameOverWord');
    const definitionEl = document.getElementById('spectatorGameOverDefinition');
    
    if (!titleEl || !messageEl || !iconEl || !wordEl) {
        console.error('Spectator game over elements not found');
        ScreenManager.show('lobby');
        return;
    }
    
    // Determine winner from game state
    let winnerName = 'Unknown';
    let winnerId = null;
    
    if (gameState && gameState.players && data.winner) {
        const winner = gameState.players.find(p => p.id === data.winner);
        if (winner) {
            winnerName = winner.name || 'Player';
            winnerId = winner.id;
        }
    }
    
    // Set icon and title
    iconEl.textContent = '👁️';
    titleEl.textContent = 'Game Ended';
    
    // Set message
    messageEl.textContent = `${winnerName} won the game!`;
    
    // Show the word
    if (data.word) {
        wordEl.textContent = data.word ? data.word.toUpperCase() : '';
        wordEl.style.display = 'block';
    } else {
        wordEl.style.display = 'none';
    }
    
    // Hide definition (can be added later if needed)
    if (definitionEl) {
        definitionEl.style.display = 'none';
    }
    
    // Show the spectator game over screen
    if (!ScreenManager.show('spectatorGameOver')) {
        console.error('Failed to show spectatorGameOver screen!');
        ScreenManager.show('lobby');
        return;
    }
    
    // Scale the screen
    setTimeout(() => {
        const container = document.getElementById('spectatorGameOverScalingContainer');
        if (container) {
            scaleGameOverScreen(container);
        } else {
            // Fallback: try to scale without container parameter
            scaleGameOverScreen();
        }
    }, 100);
    
    // Initialize back to lobby button
    const backToLobbyBtn = document.getElementById('spectatorBackToLobbyBtn');
    if (backToLobbyBtn) {
        // Remove any existing listeners
        const newBtn = backToLobbyBtn.cloneNode(true);
        backToLobbyBtn.parentNode.replaceChild(newBtn, backToLobbyBtn);
        
        newBtn.addEventListener('click', () => {
            // Hide game ID displays when returning to lobby
            const gameIdDisplay = document.getElementById('gameIdDisplay');
            const gameIdDisplayWaiting = document.getElementById('gameIdDisplayWaiting');
            if (gameIdDisplay) gameIdDisplay.style.display = 'none';
            if (gameIdDisplayWaiting) gameIdDisplayWaiting.style.display = 'none';
            ScreenManager.show('lobby');
        });
    }
    
    // CRITICAL: Do NOT call updateStats - spectators should never lose chips
    console.log('Spectator game over - stats NOT updated (spectators cannot lose chips)');
}

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
    
    // Clear chat messages when leaving spectator mode
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        chatMessages.innerHTML = '';
    }
    
    // Clear any pending timeouts for spectator hand updates
    if (window.spectatorHandUpdateTimeouts && Array.isArray(window.spectatorHandUpdateTimeouts)) {
        window.spectatorHandUpdateTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        window.spectatorHandUpdateTimeouts = [];
    }
    
    // Clear spectator state
    window.isSpectator = false;
    window.spectatorGameId = null;
    window.spectatorGameWord = null;
    window.spectatedPlayerId = null;
    
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
            // Hide game ID displays when returning to lobby
            const gameIdDisplay = document.getElementById('gameIdDisplay');
            const gameIdDisplayWaiting = document.getElementById('gameIdDisplayWaiting');
            if (gameIdDisplay) gameIdDisplay.style.display = 'none';
            if (gameIdDisplayWaiting) gameIdDisplayWaiting.style.display = 'none';
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
function displayChatMessage(playerName, message, timestamp, isOwnMessage, isSystemMessage = false, cardData = null) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    
    const messageDiv = document.createElement('div');
    let className = 'chat-message';
    if (isSystemMessage) {
        className += ' system-message';
    } else if (isOwnMessage) {
        className += ' own-message';
    }
    
    // Add clickable class if this is a card notification
    if (cardData && isSystemMessage && message.includes('played')) {
        className += ' chat-message-clickable';
        messageDiv.dataset.cardId = cardData.id;
        messageDiv.dataset.hasCard = 'true';
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
    
    // Add click handler if this is a card notification
    if (cardData && isSystemMessage && message.includes('played')) {
        messageDiv.style.cursor = 'pointer';
        messageDiv.title = 'Click to view card info';
        messageDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            // Ensure card has required properties for showCardInfo
            const cardForInfo = {
                id: cardData.id,
                title: cardData.title || cardData.metadata?.title || 'Card'
            };
            showCardInfo(cardForInfo);
        });
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
    const gameScreen = document.getElementById('game');
    if (gameScreen && gameScreen.classList.contains('active')) {
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
    // Safety checks
    if (!gameState || !gameState.gameId) {
        console.error('submitGuess: Invalid game state');
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        showGameMessage('⚠️', 'Game Error', 'Game state is invalid. Please refresh.');
        return;
    }
    
    if (!currentPlayer) {
        console.error('submitGuess: No current player');
        if (typeof soundManager !== 'undefined') {
            soundManager.playError();
        }
        showGameMessage('⚠️', 'Game Error', 'Player not initialized. Please refresh.');
        return;
    }
    
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
    
    const wordInput = document.getElementById('wordInput');
    if (!wordInput) {
        console.error('submitGuess: wordInput element not found');
        return;
    }
    
    const guess = wordInput.value.toUpperCase();
    
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

// Admin Panel Functions
async function updateAdminTabVisibility() {
    const adminTabBtn = document.getElementById('adminTabBtn');
    if (!adminTabBtn) return;
    
    const isAdmin = await isAdminAsync();
    adminTabBtn.style.display = isAdmin ? 'flex' : 'none';
}

// Search for players by email or name (like friend search)
async function searchPlayers(searchQuery) {
    if (!window.firebaseDb || !searchQuery || searchQuery.trim() === '') {
        return [];
    }
    
    const searchTerm = searchQuery.trim().toLowerCase();
    
    try {
        const usersRef = window.firebaseDb.collection('users');
        const allUsersSnapshot = await usersRef.get();
        
        const matchingUsers = [];
        
        // Filter users client-side based on similar name/email
        for (const doc of allUsersSnapshot.docs) {
            const userData = doc.data();
            const userId = doc.id;
            
            const displayName = (userData.displayName || '').toLowerCase();
            const email = (userData.email || '').toLowerCase();
            
            // Check if search term matches (contains or starts with)
            const nameMatches = displayName.includes(searchTerm) || displayName.startsWith(searchTerm);
            const emailMatches = email.includes(searchTerm) || email.startsWith(searchTerm);
            
            if (nameMatches || emailMatches) {
                // Get stats for each matching user
                const statsDoc = await window.firebaseDb.collection('stats').doc(userId).get();
                const stats = statsDoc.exists ? statsDoc.data() : {};
                
                matchingUsers.push({
                    id: userId,
                    displayName: userData.displayName || 'Unknown',
                    email: userData.email || '',
                    photoURL: userData.photoURL || null,
                    chipPoints: stats.chipPoints !== undefined ? stats.chipPoints : 0,
                    bits: stats.bits !== undefined ? stats.bits : 0
                });
            }
        }
        
        return matchingUsers;
    } catch (error) {
        console.error('Error searching for players:', error);
        return [];
    }
}

// Update player chips and bits
async function updatePlayerStats(uid, chipPoints, bits, targetName = null) {
    if (!window.firebaseDb || !uid) {
        throw new Error('Firebase not available or UID missing');
    }
    
    // Verify user is admin
    const isAdmin = await isAdminAsync();
    if (!isAdmin) {
        throw new Error('Unauthorized: Admin access required');
    }
    
    try {
        // Get old values for logging
        const oldStatsDoc = await window.firebaseDb.collection('stats').doc(uid).get();
        const oldStats = oldStatsDoc.exists ? oldStatsDoc.data() : {};
        const oldChips = oldStats.chipPoints !== undefined ? oldStats.chipPoints : 0;
        const oldBits = oldStats.bits !== undefined ? oldStats.bits : 0;
        
        const newChips = chipPoints !== undefined && chipPoints !== null ? Math.max(0, Math.round(chipPoints)) : 0;
        const newBits = bits !== undefined && bits !== null ? Math.max(0, Math.round(bits)) : 0;
        
        const statsUpdate = {
            chipPoints: newChips,
            bits: newBits
        };
        
        await window.firebaseDb.collection('stats').doc(uid).set(statsUpdate, { merge: true });
        
        // Log changes if values actually changed
        const changes = {};
        if (oldChips !== newChips) {
            changes.chips = { old: oldChips, new: newChips };
        }
        if (oldBits !== newBits) {
            changes.bits = { old: oldBits, new: newBits };
        }
        if (Object.keys(changes).length > 0) {
            await logAdminActivity('stats_changed', uid, targetName, changes);
        }
        
        return true;
    } catch (error) {
        console.error('Error updating player stats:', error);
        throw error;
    }
}

// Log admin activity (only creator can view)
async function logAdminActivity(action, targetUid, targetName, changes) {
    if (!window.firebaseDb || !currentUser) return;
    
    try {
        const adminName = currentUser.displayName || currentUser.email?.split('@')[0] || 'Unknown';
        const adminEmail = currentUser.email || '';
        
        await window.firebaseDb.collection('adminActivityLogs').add({
            action: action, // 'chips_changed', 'bits_changed', 'admin_granted', 'admin_revoked'
            adminUid: currentUser.uid,
            adminName: adminName,
            adminEmail: adminEmail,
            targetUid: targetUid,
            targetName: targetName || 'Unknown',
            changes: changes, // Object with old/new values
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error('Error logging admin activity:', error);
        // Don't throw - logging failure shouldn't break admin actions
    }
}

// Set/unset admin status for a user (requires current user to be admin)
async function setPlayerAdminStatus(targetUid, targetEmail, makeAdmin) {
    if (!window.firebaseDb || !currentUser || !targetUid) {
        throw new Error('Firebase not available or UID missing');
    }
    
    // Verify user is admin
    const isAdminUser = await isAdminAsync();
    if (!isAdminUser) {
        throw new Error('Unauthorized: Admin access required');
    }
    
    const normalizedEmail = (targetEmail || '').toLowerCase().trim();
    const isProtected = normalizedEmail === 'cjcleve2008@gmail.com';
    if (isProtected && makeAdmin === false) {
        throw new Error('The creator admin cannot be removed');
    }
    
    const adminRef = window.firebaseDb.collection('admins').doc(targetUid);
    
    if (makeAdmin) {
        await adminRef.set({
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedByUid: currentUser.uid || null,
            // Clean up legacy fields (older versions stored emails here)
            email: firebase.firestore.FieldValue.delete(),
            updatedByEmail: firebase.firestore.FieldValue.delete()
        }, { merge: true });
    } else {
        await adminRef.delete();
    }
    
    // Update local cache so UI reflects immediately
    try {
        adminUidCache.set(targetUid, makeAdmin === true);
    } catch {}
    
    // Log admin status change
    const targetName = targetEmail?.split('@')[0] || 'Unknown';
    await logAdminActivity(
        makeAdmin ? 'admin_granted' : 'admin_revoked',
        targetUid,
        targetName,
        { adminStatus: { old: !makeAdmin, new: makeAdmin } }
    );
    
    return true;
}

// Set player banned status (only creator can ban)
async function setPlayerBannedStatus(targetUid, targetEmail, isBanned) {
    if (!window.firebaseDb || !targetUid) {
        throw new Error('Firebase not available or UID missing');
    }
    
    // Verify user is creator (only creator can ban)
    if (!isCreator()) {
        throw new Error('Unauthorized: Only the creator can ban accounts');
    }
    
    const normalizedEmail = (targetEmail || '').toLowerCase().trim();
    const isProtected = normalizedEmail === 'cjcleve2008@gmail.com';
    if (isProtected && isBanned === true) {
        throw new Error('The creator cannot be banned');
    }
    
    // Update banned status in users collection
    const userRef = window.firebaseDb.collection('users').doc(targetUid);
    await userRef.set({
        banned: isBanned,
        bannedAt: isBanned ? firebase.firestore.FieldValue.serverTimestamp() : firebase.firestore.FieldValue.delete(),
        bannedBy: isBanned ? currentUser.uid : firebase.firestore.FieldValue.delete()
    }, { merge: true });
    
    // Get target name for logging
    let targetName = null;
    try {
        const userDoc = await userRef.get();
        if (userDoc.exists) {
            targetName = userDoc.data().displayName || userDoc.data().name || null;
        }
    } catch (error) {
        console.error('Error fetching target name for logging:', error);
    }
    
    await logAdminActivity('ban_status_changed', targetUid, targetName, {
        action: isBanned ? 'banned' : 'unbanned',
        email: normalizedEmail
    });
    
    return true;
}

// Check if a user is banned
async function isUserBanned(uid) {
    if (!window.firebaseDb || !uid) {
        return false;
    }
    
    try {
        const userDoc = await window.firebaseDb.collection('users').doc(uid).get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            return userData.banned === true;
        }
    } catch (error) {
        console.error('Error checking banned status:', error);
    }
    
    return false;
}

// Load and display admin activity log (only for creator)
async function loadAdminActivityLog() {
    const logSection = document.getElementById('adminActivityLogSection');
    const logList = document.getElementById('adminActivityLogList');
    
    if (!logSection || !logList) return;
    
    // Only show for creator
    if (!isCreator()) {
        logSection.style.display = 'none';
        return;
    }
    
    logSection.style.display = 'block';
    logList.innerHTML = '<div class="admin-loading">Loading all activity logs...</div>';
    
    if (!window.firebaseDb) {
        logList.innerHTML = '<div class="admin-error">Firebase not available</div>';
        return;
    }
    
    try {
        // Load ALL activity logs (no limit)
        // Firestore has a limit per query, so we need to paginate to get all
        const logs = [];
        let lastDoc = null;
        let hasMore = true;
        const batchSize = 100; // Firestore limit is 1000, but we'll use 100 per batch
        
        console.log('Loading all admin activity logs...');
        
        while (hasMore) {
            let logsQuery = window.firebaseDb.collection('adminActivityLogs')
                .orderBy('timestamp', 'desc')
                .limit(batchSize);
            
            // If we have a last document, start from there (pagination)
            if (lastDoc) {
                logsQuery = logsQuery.startAfter(lastDoc);
            }
            
            const logsSnapshot = await logsQuery.get();
            
            if (logsSnapshot.empty) {
                hasMore = false;
                break;
            }
            
            logsSnapshot.forEach(doc => {
                const data = doc.data();
                logs.push({
                    id: doc.id,
                    ...data
                });
                lastDoc = doc;
            });
            
            // If we got fewer than batchSize, we've reached the end
            if (logsSnapshot.size < batchSize) {
                hasMore = false;
            }
        }
        
        console.log(`Loaded ${logs.length} activity log entries`);
        
        if (logs.length === 0) {
            logList.innerHTML = '<div class="admin-empty">No admin activity yet</div>';
            return;
        }
        
        // Render logs (show count at top)
        const logCount = `<div class="admin-activity-log-count" style="padding: 12px; margin-bottom: 16px; background: rgba(106, 170, 100, 0.1); border-radius: 8px; border: 1px solid rgba(106, 170, 100, 0.3); color: #6aaa64; font-weight: 600;">
            Total Activity Logs: ${logs.length}
        </div>`;
        
        logList.innerHTML = logCount + logs.map(log => {
            const timeAgo = formatTimeAgo(log.timestamp?.toDate?.() || new Date(log.timestamp || Date.now()));
            const actionText = getActionText(log.action);
            const changesText = formatChanges(log.changes);
            
            return `
                <div class="admin-activity-log-item">
                    <div class="admin-activity-log-header">
                        <div class="admin-activity-log-action">${actionText}</div>
                        <div class="admin-activity-log-time">${timeAgo}</div>
                    </div>
                    <div class="admin-activity-log-details">
                        <div class="admin-activity-log-admin">
                            <strong>Admin:</strong> ${escapeHtml(log.adminName || 'Unknown')} (${escapeHtml(log.adminEmail || 'N/A')})
                        </div>
                        <div class="admin-activity-log-target">
                            <strong>Target:</strong> ${escapeHtml(log.targetName || 'Unknown')}
                        </div>
                        ${changesText ? `<div class="admin-activity-log-changes">${changesText}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading admin activity log:', error);
        logList.innerHTML = '<div class="admin-error">Error loading activity log</div>';
    }
}

// Get human-readable action text
function getActionText(action) {
    const actionMap = {
        'stats_changed': '📊 Stats Changed',
        'chips_changed': '🪙 Chips Changed',
        'bits_changed': '💎 Bits Changed',
        'admin_granted': '👑 Admin Granted',
        'admin_revoked': '❌ Admin Revoked'
    };
    return actionMap[action] || action;
}

// Format changes object into readable text
function formatChanges(changes) {
    if (!changes || typeof changes !== 'object') return '';
    
    const parts = [];
    
    if (changes.chips) {
        parts.push(`Chips: ${changes.chips.old} → ${changes.chips.new}`);
    }
    if (changes.bits) {
        parts.push(`Bits: ${changes.bits.old} → ${changes.bits.new}`);
    }
    if (changes.adminStatus) {
        const status = changes.adminStatus.new ? 'Granted' : 'Revoked';
        parts.push(`Admin Status: ${status}`);
    }
    
    return parts.join(' | ');
}

// Initialize admin panel
function initializeAdminPanel() {
    const searchBtn = document.getElementById('adminSearchBtn');
    const searchInput = document.getElementById('adminPlayerSearch');
    const saveBtn = document.getElementById('adminSaveBtn');
    const closeResultsBtn = document.getElementById('closeAdminSearchResults');
    const adminToggle = document.getElementById('adminPlayerIsAdminToggle');
    
    if (searchBtn) {
        searchBtn.onclick = async () => {
            await performAdminSearch();
        };
    }
    
    // Allow Enter key to search
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchBtn?.click();
            }
        });
    }
    
    // Close search results
    if (closeResultsBtn) {
        closeResultsBtn.onclick = () => {
            hideAdminSearchResults();
        };
    }
    
    if (saveBtn) {
        saveBtn.onclick = async () => {
            const uid = saveBtn.dataset.playerUid;
            if (!uid) {
                showAdminError('No player selected');
                return;
            }
            
            const chipsInput = document.getElementById('adminPlayerChips');
            const bitsInput = document.getElementById('adminPlayerBits');
            const nameEl = document.getElementById('adminPlayerName');
            const chips = chipsInput ? parseFloat(chipsInput.value) : 0;
            const bits = bitsInput ? parseFloat(bitsInput.value) : 0;
            const targetName = nameEl ? nameEl.textContent : null;
            
            if (isNaN(chips) || isNaN(bits) || chips < 0 || bits < 0) {
                showAdminError('Please enter valid numbers (0 or greater)');
                return;
            }
            
            try {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<span class="btn-icon">⏳</span><span>Saving...</span>';
                
                await updatePlayerStats(uid, chips, bits, targetName);
                
                const statusEl = document.getElementById('adminSaveStatus');
                if (statusEl) {
                    statusEl.textContent = '✓ Changes saved successfully!';
                    statusEl.style.color = '#6aaa64';
                    statusEl.style.display = 'block';
                }
                
                // Refresh player info
                const player = await loadPlayerData(uid);
                if (player) {
                    displayPlayerInfo(player);
                }
                
                setTimeout(() => {
                    if (statusEl) {
                        statusEl.style.display = 'none';
                    }
                }, 3000);
            } catch (error) {
                showAdminError('Failed to save changes: ' + (error.message || 'Unknown error'));
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<span class="btn-icon">💾</span><span>Save Changes</span>';
            }
        };
    }
    
    // Admin toggle handler
    if (adminToggle) {
        adminToggle.onchange = async () => {
            const uid = adminToggle.dataset.playerUid;
            const email = adminToggle.dataset.playerEmail || '';
            const statusEl = document.getElementById('adminAdminStatus');
            
            if (!uid) {
                // No player selected; revert
                adminToggle.checked = !adminToggle.checked;
                return;
            }
            
            // Creator protection (UI-side)
            if ((email || '').toLowerCase() === 'cjcleve2008@gmail.com' && adminToggle.checked === false) {
                adminToggle.checked = true;
                if (statusEl) {
                    statusEl.textContent = 'Creator admin cannot be removed.';
                    statusEl.style.color = '#dc3545';
                    statusEl.style.display = 'block';
                }
                return;
            }
            
            try {
                adminToggle.disabled = true;
                if (statusEl) {
                    statusEl.textContent = adminToggle.checked ? 'Saving admin…' : 'Removing admin…';
                    statusEl.style.color = '#818384';
                    statusEl.style.display = 'block';
                }
                
                await setPlayerAdminStatus(uid, email, adminToggle.checked);
                
                if (statusEl) {
                    statusEl.textContent = adminToggle.checked ? '✓ Admin enabled' : '✓ Admin removed';
                    statusEl.style.color = '#6aaa64';
                    statusEl.style.display = 'block';
                }
                
                // Refresh player info (so isAdmin reflects DB state)
                const player = await loadPlayerData(uid);
                if (player) {
                    displayPlayerInfo(player);
                }
                
                setTimeout(() => {
                    if (statusEl) statusEl.style.display = 'none';
                }, 2500);
            } catch (error) {
                // Revert toggle on error
                adminToggle.checked = !adminToggle.checked;
                if (statusEl) {
                    statusEl.textContent = 'Failed: ' + (error?.message || 'Unknown error');
                    statusEl.style.color = '#dc3545';
                    statusEl.style.display = 'block';
                }
            } finally {
                adminToggle.disabled = false;
            }
        };
    }
    
    // Ban toggle handler
    const banToggle = document.getElementById('adminPlayerBannedToggle');
    if (banToggle) {
        banToggle.onchange = async () => {
            const uid = banToggle.dataset.playerUid;
            const email = banToggle.dataset.playerEmail || '';
            const statusEl = document.getElementById('adminBannedStatus');
            
            if (!uid) {
                // No player selected; revert
                banToggle.checked = !banToggle.checked;
                return;
            }
            
            // Creator protection (UI-side)
            if ((email || '').toLowerCase() === 'cjcleve2008@gmail.com') {
                banToggle.checked = false;
                if (statusEl) {
                    statusEl.textContent = 'Creator cannot be banned.';
                    statusEl.style.color = '#dc3545';
                    statusEl.style.display = 'block';
                }
                return;
            }
            
            try {
                banToggle.disabled = true;
                if (statusEl) {
                    statusEl.textContent = banToggle.checked ? 'Banning player…' : 'Unbanning player…';
                    statusEl.style.color = '#818384';
                    statusEl.style.display = 'block';
                }
                
                await setPlayerBannedStatus(uid, email, banToggle.checked);
                
                if (statusEl) {
                    statusEl.textContent = banToggle.checked ? '✓ Player banned' : '✓ Player unbanned';
                    statusEl.style.color = '#6aaa64';
                    statusEl.style.display = 'block';
                }
                
                // Refresh player info
                const player = await loadPlayerData(uid);
                if (player) {
                    displayPlayerInfo(player);
                }
                
                setTimeout(() => {
                    if (statusEl) statusEl.style.display = 'none';
                }, 2500);
            } catch (error) {
                // Revert toggle on error
                banToggle.checked = !banToggle.checked;
                if (statusEl) {
                    statusEl.textContent = 'Failed: ' + (error?.message || 'Unknown error');
                    statusEl.style.color = '#dc3545';
                    statusEl.style.display = 'block';
                }
            } finally {
                banToggle.disabled = false;
            }
        };
    }
}

// Perform admin search (like friend search)
async function performAdminSearch() {
    const searchInput = document.getElementById('adminPlayerSearch');
    if (!searchInput || !searchInput.value.trim()) {
        showGameMessage('⚠️', 'Search Required', 'Please enter a username or email to search');
        return;
    }
    
    const searchTerm = searchInput.value.trim();
    
    if (!window.firebaseDb) {
        showGameMessage('⚠️', 'Error', 'Firebase database is not initialized');
        return;
    }
    
    try {
        const matchingUsers = await searchPlayers(searchTerm);
        
        if (matchingUsers.length === 0) {
            showAdminError('No players found');
            hideAdminSearchResults();
            return;
        }
        
        const usersWithAdmin = await Promise.all(matchingUsers.map(async (u) => {
            return {
                ...u,
                isAdmin: await isUserAdminByUid(u.id, u.email || '')
            };
        }));
        
        showAdminSearchResults(usersWithAdmin);
    } catch (error) {
        console.error('Error searching for players:', error);
        showAdminError(`Error searching: ${error.message || 'Unknown error'}`);
        hideAdminSearchResults();
    }
}

// Show admin search results (like friend search results)
function showAdminSearchResults(users) {
    const resultsContainer = document.getElementById('adminSearchResults');
    const resultsList = document.getElementById('adminSearchResultsList');
    const errorEl = document.getElementById('adminSearchError');
    
    if (!resultsContainer || !resultsList) return;
    
    if (errorEl) errorEl.style.display = 'none';
    
    // Render results
    resultsList.innerHTML = users.map(user => {
        const avatarInitial = user.displayName ? user.displayName.charAt(0).toUpperCase() : '👤';
        const avatarStyle = user.photoURL 
            ? `background-image: url(${user.photoURL}); background-size: cover; background-position: center;` 
            : '';
        const isUserAdmin = user.isAdmin === true || isAdminEmail(user.email || '');
        
        return `
            <div class="friend-search-result-item" onclick="selectAdminPlayer('${user.id}', '${(user.displayName || 'Unknown').replace(/'/g, "\\'")}')">
                <div class="friend-avatar" style="${avatarStyle}">${user.photoURL ? '' : avatarInitial}</div>
                <div class="friend-info">
                    <div class="friend-name ${isUserAdmin ? 'admin-name' : ''}">${user.displayName || 'Unknown'}</div>
                    <div class="friend-status">${user.email || ''}</div>
                </div>
            </div>
        `;
    }).join('');
    
    resultsContainer.style.display = 'block';
}

// Hide admin search results
function hideAdminSearchResults() {
    const resultsContainer = document.getElementById('adminSearchResults');
    if (resultsContainer) {
        resultsContainer.style.display = 'none';
    }
}

// Select a player from search results
async function selectAdminPlayer(userId, userName) {
    hideAdminSearchResults();
    
    const player = await loadPlayerData(userId);
    if (player) {
        displayPlayerInfo(player);
        const editPanel = document.getElementById('adminPlayerEditPanel');
        if (editPanel) {
            editPanel.style.display = 'block';
        }
    } else {
        showAdminError('Failed to load player data');
    }
}

// Load player data by UID
async function loadPlayerData(uid) {
    if (!window.firebaseDb || !uid) {
        return null;
    }
    
    // Check if user is banned first (for security)
    const isBanned = await isUserBanned(uid);
    
    try {
        const userDoc = await window.firebaseDb.collection('users').doc(uid).get();
        if (!userDoc.exists) {
            return null;
        }
        
        const userData = userDoc.data();
        const statsDoc = await window.firebaseDb.collection('stats').doc(uid).get();
        const stats = statsDoc.exists ? statsDoc.data() : {};
        
        // Admin status: permanent email list OR dynamic /admins/{uid} doc
        const email = (userData.email || '').toLowerCase();
        let isAdminUser = isAdminEmail(email);
        if (!isAdminUser) {
            try {
                const adminDoc = await window.firebaseDb.collection('admins').doc(uid).get();
                isAdminUser = adminDoc.exists === true;
            } catch (error) {
                // If rules don't allow, just treat as non-admin for display
                if (error?.code !== 'permission-denied') {
                    console.warn('Error loading admin status:', error);
                }
            }
        }
        
        // Banned status
        const isBanned = userData.banned === true;
        
        return {
            uid: uid,
            email: userData.email || '',
            displayName: userData.displayName || userData.email?.split('@')[0] || 'Unknown',
            photoURL: userData.photoURL || null,
            chipPoints: stats.chipPoints !== undefined ? stats.chipPoints : 0,
            bits: stats.bits !== undefined ? stats.bits : 0,
            isAdmin: isAdminUser,
            banned: isBanned,
            // Include all stats for display
            gamesPlayed: stats.gamesPlayed !== undefined ? stats.gamesPlayed : 0,
            wins: stats.wins !== undefined ? stats.wins : 0,
            losses: stats.losses !== undefined ? stats.losses : 0,
            winStreak: stats.winStreak !== undefined ? stats.winStreak : 0,
            bestWinStreak: stats.bestWinStreak !== undefined ? stats.bestWinStreak : 0,
            totalGuesses: stats.totalGuesses !== undefined ? stats.totalGuesses : 0,
            gamesWithGuesses: stats.gamesWithGuesses !== undefined ? stats.gamesWithGuesses : 0
        };
    } catch (error) {
        console.error('Error loading player data:', error);
        return null;
    }
}

function displayPlayerInfo(player) {
    const resultsEl = document.getElementById('adminSearchResults');
    const errorEl = document.getElementById('adminSearchError');
    const nameEl = document.getElementById('adminPlayerName');
    const emailEl = document.getElementById('adminPlayerEmail');
    const uidEl = document.getElementById('adminPlayerUid');
    const avatarEl = document.getElementById('adminPlayerAvatar');
    const chipsInput = document.getElementById('adminPlayerChips');
    const bitsInput = document.getElementById('adminPlayerBits');
    const saveBtn = document.getElementById('adminSaveBtn');
    const adminToggle = document.getElementById('adminPlayerIsAdminToggle');
    const adminNote = document.getElementById('adminPlayerAdminNote');
    const adminStatus = document.getElementById('adminAdminStatus');
    
    if (resultsEl) resultsEl.style.display = 'block';
    if (errorEl) errorEl.style.display = 'none';
    
    if (nameEl) {
        nameEl.textContent = player.displayName;
        nameEl.classList.toggle('admin-name', player.isAdmin === true);
    }
    if (emailEl) emailEl.textContent = player.email;
    if (uidEl) uidEl.textContent = `UID: ${player.uid}`;
    
    if (avatarEl) {
        const initial = player.displayName ? player.displayName.charAt(0).toUpperCase() : '?';
        applyProfileImage(avatarEl, player.photoURL, initial);
    }
    
    if (chipsInput) chipsInput.value = Math.round(player.chipPoints);
    if (bitsInput) bitsInput.value = Math.round(player.bits);
    if (saveBtn) saveBtn.dataset.playerUid = player.uid;
    
    // Display view-only stats
    const gamesPlayedEl = document.getElementById('adminPlayerGamesPlayed');
    const winsEl = document.getElementById('adminPlayerWins');
    const lossesEl = document.getElementById('adminPlayerLosses');
    const winRateEl = document.getElementById('adminPlayerWinRate');
    const winStreakEl = document.getElementById('adminPlayerWinStreak');
    const bestWinStreakEl = document.getElementById('adminPlayerBestWinStreak');
    const totalGuessesEl = document.getElementById('adminPlayerTotalGuesses');
    const gamesWithGuessesEl = document.getElementById('adminPlayerGamesWithGuesses');
    
    if (gamesPlayedEl) gamesPlayedEl.textContent = player.gamesPlayed || 0;
    if (winsEl) winsEl.textContent = player.wins || 0;
    if (lossesEl) lossesEl.textContent = player.losses || 0;
    
    // Calculate win rate
    if (winRateEl) {
        const gamesPlayed = player.gamesPlayed || 0;
        const wins = player.wins || 0;
        if (gamesPlayed > 0) {
            const winRate = ((wins / gamesPlayed) * 100).toFixed(1);
            winRateEl.textContent = `${winRate}%`;
        } else {
            winRateEl.textContent = '0%';
        }
    }
    
    if (winStreakEl) winStreakEl.textContent = player.winStreak || 0;
    if (bestWinStreakEl) bestWinStreakEl.textContent = player.bestWinStreak || 0;
    if (totalGuessesEl) totalGuessesEl.textContent = player.totalGuesses || 0;
    if (gamesWithGuessesEl) gamesWithGuessesEl.textContent = player.gamesWithGuesses || 0;
    
    // Admin toggle setup
    if (adminToggle) {
        adminToggle.dataset.playerUid = player.uid;
        adminToggle.dataset.playerEmail = (player.email || '').toLowerCase();
        
        const isProtected = (player.email || '').toLowerCase() === 'cjcleve2008@gmail.com';
        adminToggle.checked = player.isAdmin === true;
        adminToggle.disabled = isProtected;
        
        if (adminNote) {
            if (isProtected) {
                adminNote.textContent = 'Creator admin (cannot be removed).';
            } else {
                adminNote.textContent = 'Toggle admin access for this player.';
            }
        }
        
        if (adminStatus) {
            adminStatus.style.display = 'none';
            adminStatus.textContent = '';
        }
    }
    
    // Ban toggle setup
    const banToggle = document.getElementById('adminPlayerBannedToggle');
    const banNote = document.getElementById('adminPlayerBannedNote');
    const banStatus = document.getElementById('adminBannedStatus');
    
    if (banToggle) {
        banToggle.dataset.playerUid = player.uid;
        banToggle.dataset.playerEmail = (player.email || '').toLowerCase();
        
        const isProtected = (player.email || '').toLowerCase() === 'cjcleve2008@gmail.com';
        banToggle.checked = player.banned === true;
        banToggle.disabled = isProtected;
        
        if (banNote) {
            if (isProtected) {
                banNote.textContent = 'Creator cannot be banned.';
            } else {
                banNote.textContent = banToggle.checked ? 'Player is banned from the game.' : 'Ban this player from accessing the game.';
            }
        }
        
        if (banStatus) {
            banStatus.style.display = 'none';
            banStatus.textContent = '';
        }
    }
}

function hidePlayerInfo() {
    const editPanel = document.getElementById('adminPlayerEditPanel');
    if (editPanel) editPanel.style.display = 'none';
}

function showAdminError(message) {
    const errorEl = document.getElementById('adminSearchError');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }
    hidePlayerInfo();
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

// Community functionality
// Creator identifier - can be email or Firebase UID
let currentCommunityCategory = 'all';
let currentPostDetailId = null;

// Check if current user is the creator
function isCreator() {
    if (!currentUser) return false;
    const email = currentUser.email?.toLowerCase() || '';
    // Only cjcleve2008@gmail.com is the creator
    return email === 'cjcleve2008@gmail.com';
}

// Check if current user is an admin
// Get list of admin emails
function getAdminEmails() {
    return [
        // Permanent/protected admin(s)
        'cjcleve2008@gmail.com'
    ];
}

async function isAdminAsync() {
    if (!currentUser) return false;
    
    // First check currentUser.email
    let email = currentUser.email?.toLowerCase() || '';
    
    // If email is missing, try fetching from Firestore
    if (!email && window.firebaseDb) {
        try {
            const userDoc = await window.firebaseDb.collection('users').doc(currentUser.uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                email = (userData.email || '').toLowerCase();
            }
        } catch (error) {
            console.error('Error fetching user email for admin check:', error);
        }
    }
    
    // Permanent admins by email
    if (getAdminEmails().includes(email)) return true;
    
    // Dynamic admins via Firestore document: /admins/{uid}
    if (window.firebaseDb && currentUser.uid) {
        try {
            const adminDoc = await window.firebaseDb.collection('admins').doc(currentUser.uid).get();
            return adminDoc.exists === true;
        } catch (error) {
            // If missing permissions / offline, fall back to email-only check
            if (error?.code !== 'permission-denied') {
                console.warn('Error checking admin doc:', error);
            }
        }
    }
    
    return false;
}

function isAdmin() {
    if (!currentUser) return false;
    const email = currentUser.email?.toLowerCase() || '';
    // Note: This synchronous version may miss Firestore emails. Use isAdminAsync() when possible.
    return getAdminEmails().includes(email);
}

// Check if an email belongs to an admin (helper for checking other users)
function isAdminEmail(email) {
    if (!email) return false;
    const normalizedEmail = email.toLowerCase().trim();
    const adminList = getAdminEmails();
    const isAdmin = adminList.includes(normalizedEmail);
    
    // Debug logging to help identify issues
    if (normalizedEmail && (normalizedEmail.includes('cjcleve') || normalizedEmail.includes('perkere'))) {
        console.log('Admin check:', {
            email: email,
            normalized: normalizedEmail,
            adminList: adminList,
            isAdmin: isAdmin
        });
    }
    
    return isAdmin;
}

// Cache admin status lookups to avoid repetitive reads
const adminUidCache = new Map();

// Check if another user is admin (permanent email list OR /admins/{uid} exists)
async function isUserAdminByUid(uid, email = '') {
    const normalizedEmail = (email || '').toLowerCase().trim();
    
    // Permanent admins (e.g., creator)
    if (normalizedEmail && getAdminEmails().includes(normalizedEmail)) {
        return true;
    }
    
    if (!uid || !window.firebaseDb) return false;
    
    if (adminUidCache.has(uid)) {
        return adminUidCache.get(uid) === true;
    }
    
    try {
        const adminDoc = await window.firebaseDb.collection('admins').doc(uid).get();
        const isAdminUser = adminDoc.exists === true;
        adminUidCache.set(uid, isAdminUser);
        return isAdminUser;
    } catch (error) {
        // If rules don't allow or offline, treat as non-admin for display.
        // (If you want everyone to see admin glow, allow reads on /admins/* for authed users.)
        if (error?.code !== 'permission-denied') {
            console.warn('Error checking admin status for uid:', uid, error);
        }
        adminUidCache.set(uid, false);
        return false;
    }
}

// Store all loaded posts globally
let allBulletinPosts = [];
let allCommunityPosts = [];
let bulletinPostsShown = 3;
let communityPostsShown = 3;

// Load community posts
async function loadCommunityPosts() {
    if (!window.firebaseDb || !currentUser) {
        console.log('User not authenticated or Firebase not available');
        return;
    }
    
    const bulletinPostsList = document.getElementById('bulletinBoardPosts');
    const communityPostsList = document.getElementById('communityPostsList');
    
    // If elements don't exist yet (loading on startup), store data and return
    // They will be rendered when the tab is opened
    if (!bulletinPostsList || !communityPostsList) {
        // Still load the data so it's ready when tab opens
        try {
            let allPostsSnapshot;
            try {
                const allPostsQuery = window.firebaseDb.collection('communityPosts')
                    .orderBy('createdAt', 'desc')
                    .limit(200);
                allPostsSnapshot = await allPostsQuery.get();
            } catch (indexError) {
                const allPostsQuery = window.firebaseDb.collection('communityPosts')
                    .limit(500);
                allPostsSnapshot = await allPostsQuery.get();
            }
            
            const bulletinPosts = [];
            const communityPosts = [];
            
            for (const doc of allPostsSnapshot.docs) {
                const data = doc.data();
                const authorInfo = await getUserInfo(data.authorId);
                
                const postData = {
                    id: doc.id,
                    ...data,
                    authorName: authorInfo.name,
                    authorPhotoURL: authorInfo.photoURL,
                    authorIsAdmin: authorInfo.isAdmin === true
                };
                
                if (data.isBulletin === true) {
                    bulletinPosts.push(postData);
                } else {
                    if (currentCommunityCategory === 'all' || data.category === currentCommunityCategory) {
                        communityPosts.push(postData);
                    }
                }
            }
            
            bulletinPosts.sort((a, b) => {
                const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
                const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
                return bTime.getTime() - aTime.getTime();
            });
            
            communityPosts.sort((a, b) => {
                const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
                const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
                return bTime.getTime() - aTime.getTime();
            });
            
            allBulletinPosts = bulletinPosts;
            allCommunityPosts = communityPosts;
            bulletinPostsShown = 3;
            communityPostsShown = 3;
        } catch (error) {
            console.error('Error preloading community posts:', error);
        }
        return;
    }
    
    // Only show loading if lists are empty or showing loading state
    if (bulletinPostsList.innerHTML.includes('Loading') || bulletinPostsList.innerHTML.trim() === '') {
        bulletinPostsList.innerHTML = '<div class="community-loading">Loading bulletin board...</div>';
    }
    if (communityPostsList.innerHTML.includes('Loading') || communityPostsList.innerHTML.trim() === '') {
        communityPostsList.innerHTML = '<div class="community-loading">Loading posts...</div>';
    }
    
    try {
        // Load all posts and filter/sort client-side to avoid composite index requirements
        // Use a simple query without orderBy first, then sort client-side
        // This avoids needing any indexes
        let allPostsSnapshot;
        try {
            // Try with orderBy first (more efficient if index exists)
            const allPostsQuery = window.firebaseDb.collection('communityPosts')
                .orderBy('createdAt', 'desc')
                .limit(200);
            allPostsSnapshot = await allPostsQuery.get();
        } catch (indexError) {
            // If index doesn't exist, load all posts without orderBy and sort client-side
            console.log('Index not found, loading all posts and sorting client-side');
            const allPostsQuery = window.firebaseDb.collection('communityPosts')
                .limit(500);
            allPostsSnapshot = await allPostsQuery.get();
        }
        
        // Separate bulletin and community posts
        const bulletinPosts = [];
        const communityPosts = [];
        
        for (const doc of allPostsSnapshot.docs) {
            const data = doc.data();
            const authorInfo = await getUserInfo(data.authorId);
            
            // Recalculate comment count to ensure it includes replies
            // This fixes existing posts that were created before replies were counted
            try {
                const commentsSnapshot = await window.firebaseDb.collection('communityPosts')
                    .doc(doc.id)
                    .collection('comments')
                    .get();
                
                const actualCount = commentsSnapshot.size;
                // If the count doesn't match, recalculate it
                if (data.commentCount !== actualCount) {
                    console.log(`Fixing comment count for post ${doc.id}: ${data.commentCount || 0} -> ${actualCount}`);
                    await window.firebaseDb.collection('communityPosts').doc(doc.id).update({
                        commentCount: actualCount
                    });
                    data.commentCount = actualCount;
                }
            } catch (recalcError) {
                // If recalculation fails, just use the existing count
                console.warn(`Could not recalculate comment count for post ${doc.id}:`, recalcError);
            }
            
            const postData = {
                id: doc.id,
                ...data,
                authorName: authorInfo.name,
                authorPhotoURL: authorInfo.photoURL,
                authorIsAdmin: authorInfo.isAdmin === true
            };
            
            // Separate bulletin posts from community posts
            if (data.isBulletin === true) {
                bulletinPosts.push(postData);
            } else {
                // Filter by category client-side if not 'all'
                if (currentCommunityCategory === 'all' || data.category === currentCommunityCategory) {
                    communityPosts.push(postData);
                }
            }
        }
        
        // Sort both arrays by createdAt (most recent first) - always sort client-side to ensure proper ordering
        bulletinPosts.sort((a, b) => {
            const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
            const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
            return bTime.getTime() - aTime.getTime();
        });
        
        communityPosts.sort((a, b) => {
            const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
            const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
            return bTime.getTime() - aTime.getTime();
        });
        
        // Store all posts globally
        allBulletinPosts = bulletinPosts;
        allCommunityPosts = communityPosts;
        
        // Reset shown counts when reloading
        bulletinPostsShown = 3;
        communityPostsShown = 3;
        
        // Show initial 3 posts for each
        renderPostsWithShowMore(allBulletinPosts.slice(0, bulletinPostsShown), bulletinPostsList, true, allBulletinPosts.length);
        renderPostsWithShowMore(allCommunityPosts.slice(0, communityPostsShown), communityPostsList, false, allCommunityPosts.length);
        
    } catch (error) {
        console.error('Error loading community posts:', error);
        bulletinPostsList.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error loading posts</div></div>';
        communityPostsList.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error loading posts</div></div>';
    }
}

// Get user info helper
async function getUserInfo(userId) {
    try {
        if (!userId || !window.firebaseDb) {
            return { name: 'Unknown', photoURL: null, isAdmin: false };
        }
        const userDoc = await window.firebaseDb.collection('users').doc(userId).get();
        if (userDoc.exists) {
            const data = userDoc.data();
            const email = data.email || '';
            const isAdminUser = await isUserAdminByUid(userId, email);
            return {
                name: data.displayName || 'Unknown',
                photoURL: data.photoURL || null,
                isAdmin: isAdminUser === true
            };
        }
    } catch (error) {
        console.error('Error fetching user info:', error);
    }
    return { name: 'Unknown', photoURL: null, isAdmin: false };
}

// Render posts
function renderPosts(posts, container, isBulletin) {
    if (!container) return;
    
    if (posts.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💭</div><div class="empty-state-text">No posts yet</div></div>';
        return;
    }
    
    container.innerHTML = posts.map(post => {
        const timeAgo = formatTimeAgo(post.createdAt?.toDate?.() || new Date(post.createdAt));
        const authorInitial = post.authorName ? post.authorName.charAt(0).toUpperCase() : '?';
        const avatarStyle = post.authorPhotoURL 
            ? `background-image: url(${post.authorPhotoURL}); background-size: cover; background-position: center;` 
            : '';
        const isBulletinPost = post.isBulletin || isBulletin;
        
        return `
            <div class="community-post ${isBulletinPost ? 'bulletin-post' : ''}" data-post-id="${post.id}" onclick="openPostDetail('${post.id}', event)">
                <div class="post-header">
                    <div class="post-author-avatar ${isBulletinPost ? 'bulletin' : ''}" style="${avatarStyle}">${post.authorPhotoURL ? '' : authorInitial}</div>
                    <div class="post-header-info">
                        <div class="post-author-name ${isBulletinPost ? 'bulletin' : ''} ${post.authorIsAdmin ? 'admin-name' : ''}">${escapeHtml(post.authorName || 'Unknown')}</div>
                        <div class="post-meta">
                            <span class="post-category ${isBulletinPost ? 'bulletin' : ''}">${getCategoryDisplayName(post.category || 'general')}</span>
                            <span class="post-time">${timeAgo}</span>
                        </div>
                    </div>
                </div>
                <div class="post-title">${escapeHtml(post.title || 'Untitled')}</div>
                <div class="post-content">${escapeHtml(post.content || '')}</div>
                <div class="post-footer">
                    <div class="post-actions">
                        <button class="post-action like-action ${post.likedBy && post.likedBy.includes(currentUser?.uid) ? 'liked' : ''}" 
                                onclick="likePost('${post.id}', event)" data-likes="${post.likes || 0}">
                            <span class="post-action-icon">${post.likedBy && post.likedBy.includes(currentUser?.uid) ? '❤️' : '🤍'}</span>
                            <span>${post.likes || 0}</span>
                        </button>
                        <button class="post-action comment-action" onclick="openPostDetail('${post.id}', event)">
                            <span class="post-action-icon">💬</span>
                            <span>${post.commentCount || 0}</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Render posts with "Show more" button
function renderPostsWithShowMore(posts, container, isBulletin, totalCount) {
    if (!container) return;
    
    if (posts.length === 0 && totalCount === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💭</div><div class="empty-state-text">No posts yet</div></div>';
        return;
    }
    
    const postsHtml = posts.map(post => {
        const timeAgo = formatTimeAgo(post.createdAt?.toDate?.() || new Date(post.createdAt));
        const authorInitial = post.authorName ? post.authorName.charAt(0).toUpperCase() : '?';
        const avatarStyle = post.authorPhotoURL 
            ? `background-image: url(${post.authorPhotoURL}); background-size: cover; background-position: center;` 
            : '';
        const isBulletinPost = post.isBulletin || isBulletin;
        
        return `
            <div class="community-post ${isBulletinPost ? 'bulletin-post' : ''}" data-post-id="${post.id}" onclick="openPostDetail('${post.id}', event)">
                <div class="post-header">
                    <div class="post-author-avatar ${isBulletinPost ? 'bulletin' : ''}" style="${avatarStyle}">${post.authorPhotoURL ? '' : authorInitial}</div>
                    <div class="post-header-info">
                        <div class="post-author-name ${isBulletinPost ? 'bulletin' : ''} ${post.authorIsAdmin ? 'admin-name' : ''}">${escapeHtml(post.authorName || 'Unknown')}</div>
                        <div class="post-meta">
                            <span class="post-category ${isBulletinPost ? 'bulletin' : ''}">${getCategoryDisplayName(post.category || 'general')}</span>
                            <span class="post-time">${timeAgo}</span>
                        </div>
                    </div>
                </div>
                <div class="post-title">${escapeHtml(post.title || 'Untitled')}</div>
                <div class="post-content">${escapeHtml(post.content || '')}</div>
                <div class="post-footer">
                    <div class="post-actions">
                        <button class="post-action like-action ${post.likedBy && post.likedBy.includes(currentUser?.uid) ? 'liked' : ''}" 
                                onclick="likePost('${post.id}', event)" data-likes="${post.likes || 0}">
                            <span class="post-action-icon">${post.likedBy && post.likedBy.includes(currentUser?.uid) ? '❤️' : '🤍'}</span>
                            <span>${post.likes || 0}</span>
                        </button>
                        <button class="post-action comment-action" onclick="openPostDetail('${post.id}', event)">
                            <span class="post-action-icon">💬</span>
                            <span>${post.commentCount || 0}</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // Add "Show more" button if there are more posts
    let showMoreHtml = '';
    if (totalCount > posts.length) {
        const buttonId = isBulletin ? 'showMoreBulletinBtn' : 'showMoreCommunityBtn';
        showMoreHtml = `
            <div class="show-more-posts-container">
                <button id="${buttonId}" class="btn btn-secondary show-more-posts-btn">
                    <span>Show More (${totalCount - posts.length} more)</span>
                </button>
            </div>
        `;
    }
    
    container.innerHTML = postsHtml + showMoreHtml;
    
    // Setup show more button
    if (totalCount > posts.length) {
        const buttonId = isBulletin ? 'showMoreBulletinBtn' : 'showMoreCommunityBtn';
        const showMoreBtn = document.getElementById(buttonId);
        if (showMoreBtn) {
            showMoreBtn.onclick = (e) => {
                e.stopPropagation();
                if (isBulletin) {
                    bulletinPostsShown = Math.min(bulletinPostsShown + 10, allBulletinPosts.length);
                    renderPostsWithShowMore(allBulletinPosts.slice(0, bulletinPostsShown), container, true, allBulletinPosts.length);
                } else {
                    communityPostsShown = Math.min(communityPostsShown + 10, allCommunityPosts.length);
                    renderPostsWithShowMore(allCommunityPosts.slice(0, communityPostsShown), container, false, allCommunityPosts.length);
                }
            };
        }
    }
}

// Format time ago
function formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
}

// Get category display name
function getCategoryDisplayName(category) {
    const categories = {
        'bulletin': '📌 Bulletin Board',
        'fixes': '🔧 Fixes',
        'cards': '🃏 Cards',
        'ideas': '💡 Game Ideas',
        'feedback': '💬 Feedback',
        'general': '💭 General'
    };
    return categories[category] || category;
}

// Escape HTML helper
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Create post
async function createPost(title, content, category) {
    if (!window.firebaseDb || !currentUser) {
        console.error('User not authenticated or Firebase not available');
        const errorEl = document.getElementById('createPostError');
        if (errorEl) {
            errorEl.textContent = 'Please sign in to create a post';
            errorEl.style.display = 'block';
        }
        return;
    }
    
    if (!title.trim() || !content.trim()) {
        const errorEl = document.getElementById('createPostError');
        if (errorEl) {
            errorEl.textContent = 'Title and content are required';
            errorEl.style.display = 'block';
        }
        return;
    }
    
    const isAdminUser = await isAdminAsync();
    
    // Prevent non-admins from posting to bulletin
    if (category === 'bulletin' && !isAdminUser) {
        const errorEl = document.getElementById('createPostError');
        if (errorEl) {
            errorEl.textContent = 'Only admins can post to the bulletin board';
            errorEl.style.display = 'block';
        }
        return;
    }
    
    try {
        // Determine if this is a bulletin post (admin only, and category must be 'bulletin')
        const isBulletin = category === 'bulletin' && isAdminUser;
        
        // Get user info
        const userDoc = await window.firebaseDb.collection('users').doc(currentUser.uid).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        
        const postData = {
            title: title.trim(),
            content: content.trim(),
            category: category, // Keep the selected category
            authorId: currentUser.uid,
            authorName: userData.displayName || currentUser.displayName || currentUser.email?.split('@')[0] || 'User',
            isBulletin: isBulletin, // Set to true if admin selected bulletin
            likes: 0,
            likedBy: [],
            commentCount: 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        await window.firebaseDb.collection('communityPosts').add(postData);
        
        // Close modal and reload posts
        closeCreatePostModal();
        loadCommunityPosts();
        
    } catch (error) {
        console.error('Error creating post:', error);
        const errorEl = document.getElementById('createPostError');
        if (errorEl) {
            errorEl.textContent = 'Failed to create post. Please try again.';
            errorEl.style.display = 'block';
        }
    }
}

// Like/unlike post
async function likePost(postId, event) {
    event.stopPropagation();
    
    if (!window.firebaseDb || !currentUser) {
        console.error('User not authenticated or Firebase not available');
        return;
    }
    
    try {
        const postRef = window.firebaseDb.collection('communityPosts').doc(postId);
        const postDoc = await postRef.get();
        
        if (!postDoc.exists) {
            console.error('Post not found');
            return;
        }
        
        const postData = postDoc.data();
        const likedBy = postData.likedBy || [];
        const isLiked = likedBy.includes(currentUser.uid);
        
        if (isLiked) {
            // Unlike
            await postRef.update({
                likes: firebase.firestore.FieldValue.increment(-1),
                likedBy: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
            });
        } else {
            // Like
            await postRef.update({
                likes: firebase.firestore.FieldValue.increment(1),
                likedBy: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
            });
        }
        
        // Reload posts to update UI
        loadCommunityPosts();
        
        // If post detail is open, reload it
        if (currentPostDetailId === postId) {
            openPostDetail(postId, event);
        }
        
    } catch (error) {
        console.error('Error liking post:', error);
    }
}

// Open post detail modal
async function openPostDetail(postId, event) {
    if (event) event.stopPropagation();
    
    if (!window.firebaseDb || !currentUser) {
        console.error('User not authenticated or Firebase not available');
        return;
    }
    
    currentPostDetailId = postId;
    
    const modal = document.getElementById('postDetailModal');
    const titleEl = document.getElementById('postDetailTitle');
    const contentEl = document.getElementById('postDetailContent');
    const commentsListEl = document.getElementById('postCommentsList');
    
    if (!modal || !titleEl || !contentEl || !commentsListEl) return;
    
    try {
        // Load post data
        const postDoc = await window.firebaseDb.collection('communityPosts').doc(postId).get();
        
        if (!postDoc.exists) {
            console.error('Post not found');
            return;
        }
        
        const postData = postDoc.data();
        const authorInfo = await getUserInfo(postData.authorId);
        const timeAgo = formatTimeAgo(postData.createdAt?.toDate?.() || new Date(postData.createdAt));
        const isBulletinPost = postData.isBulletin;
        
        // Render post detail header
        const authorInitial = authorInfo.name ? authorInfo.name.charAt(0).toUpperCase() : '?';
        const avatarStyle = authorInfo.photoURL 
            ? `background-image: url(${authorInfo.photoURL}); background-size: cover; background-position: center;` 
            : '';
        
        // Check if current user is the post author or an admin (for delete button)
        const isPostAuthor = postData.authorId === currentUser.uid;
        const isAdminUser = await isAdminAsync();
        const canDelete = isPostAuthor || isAdminUser;
        
        titleEl.innerHTML = `
            <div class="post-detail-header">
                <div class="post-header">
                    <div class="post-author-avatar ${isBulletinPost ? 'bulletin' : ''}" style="${avatarStyle}">${authorInfo.photoURL ? '' : authorInitial}</div>
                    <div class="post-header-info">
                        <div class="post-author-name ${isBulletinPost ? 'bulletin' : ''} ${authorInfo.isAdmin ? 'admin-name' : ''}">${escapeHtml(authorInfo.name)}</div>
                        <div class="post-meta">
                            <span class="post-category ${isBulletinPost ? 'bulletin' : ''}">${getCategoryDisplayName(postData.category || 'general')}</span>
                            <span class="post-time">${timeAgo}</span>
                        </div>
                    </div>
                    ${canDelete ? `
                    <button class="post-delete-btn" onclick="deletePost('${postId}', event)" title="${isAdminUser && !isPostAuthor ? 'Delete Post (Admin)' : 'Delete Post'}">
                        <span class="post-delete-icon">🗑️</span>
                    </button>
                    ` : ''}
                </div>
                <div class="post-title" style="margin-top: 16px;">${escapeHtml(postData.title || 'Untitled')}</div>
            </div>
        `;
        
        contentEl.innerHTML = `
            <div class="post-detail-content">${escapeHtml(postData.content || '').replace(/\n/g, '<br>')}</div>
            <div class="post-footer">
                <div class="post-actions">
                    <button class="post-action like-action ${postData.likedBy && postData.likedBy.includes(currentUser.uid) ? 'liked' : ''}" 
                            onclick="likePost('${postId}', event)" data-likes="${postData.likes || 0}">
                        <span class="post-action-icon">${postData.likedBy && postData.likedBy.includes(currentUser.uid) ? '❤️' : '🤍'}</span>
                        <span>${postData.likes || 0}</span>
                    </button>
                </div>
            </div>
        `;
        
        // Clear comment input
        const commentInput = document.getElementById('newCommentInput');
        if (commentInput) commentInput.value = '';
        
        // Load comments
        await loadComments(postId);
        
        // Show modal
        modal.style.display = 'flex';
        
    } catch (error) {
        console.error('Error loading post detail:', error);
    }
}

// Load comments for a post
async function loadComments(postId) {
    const commentsListEl = document.getElementById('postCommentsList');
    if (!commentsListEl || !window.firebaseDb) return;
    
    try {
        // Try with orderBy first, fallback to no orderBy if index doesn't exist
        let commentsSnapshot;
        try {
            const commentsQuery = window.firebaseDb.collection('communityPosts')
                .doc(postId)
                .collection('comments')
                .orderBy('createdAt', 'asc');
            commentsSnapshot = await commentsQuery.get();
        } catch (indexError) {
            // If index doesn't exist, load without orderBy and sort client-side
            console.log('Comments index not found, loading and sorting client-side');
            const commentsQuery = window.firebaseDb.collection('communityPosts')
                .doc(postId)
                .collection('comments');
            commentsSnapshot = await commentsQuery.get();
        }
        const comments = [];
        
        for (const doc of commentsSnapshot.docs) {
            const data = doc.data();
            const authorInfo = await getUserInfo(data.authorId);
            comments.push({
                id: doc.id,
                ...data,
                authorName: authorInfo.name,
                authorPhotoURL: authorInfo.photoURL,
                createdAt: data.createdAt // Preserve timestamp for sorting
            });
        }
        
        // Sort by createdAt (oldest first) if we loaded without orderBy
        comments.sort((a, b) => {
            const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
            const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
            return aTime.getTime() - bTime.getTime();
        });
        
        if (comments.length === 0) {
            commentsListEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💭</div><div class="empty-state-text">No comments yet</div></div>';
            return;
        }
        
        // Separate top-level comments from replies
        const topLevelComments = comments.filter(c => !c.parentCommentId);
        const repliesMap = new Map();
        comments.filter(c => c.parentCommentId).forEach(reply => {
            if (!repliesMap.has(reply.parentCommentId)) {
                repliesMap.set(reply.parentCommentId, []);
            }
            repliesMap.get(reply.parentCommentId).push(reply);
        });
        
        // Sort replies by createdAt
        repliesMap.forEach((replies, parentId) => {
            replies.sort((a, b) => {
                const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
                const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
                return aTime.getTime() - bTime.getTime();
            });
        });
        
        // Check if user is admin (async)
        const userIsAdmin = await isAdminAsync();
        
        commentsListEl.innerHTML = topLevelComments.map(comment => {
            const timeAgo = formatTimeAgo(comment.createdAt?.toDate?.() || new Date(comment.createdAt));
            const authorInitial = comment.authorName ? comment.authorName.charAt(0).toUpperCase() : '?';
            const avatarStyle = comment.authorPhotoURL 
                ? `background-image: url(${comment.authorPhotoURL}); background-size: cover; background-position: center;` 
                : '';
            
            const isCommentAuthor = comment.authorId === currentUser?.uid;
            const canDelete = isCommentAuthor || userIsAdmin;
            
            // Get replies for this comment
            const replies = repliesMap.get(comment.id) || [];
            
            // Render replies (no reply button, just display)
            const repliesHtml = replies.map(reply => {
                const replyTimeAgo = formatTimeAgo(reply.createdAt?.toDate?.() || new Date(reply.createdAt));
                const replyAuthorInitial = reply.authorName ? reply.authorName.charAt(0).toUpperCase() : '?';
                const replyAvatarStyle = reply.authorPhotoURL 
                    ? `background-image: url(${reply.authorPhotoURL}); background-size: cover; background-position: center;` 
                    : '';
                const isReplyAuthor = reply.authorId === currentUser?.uid;
                const canDeleteReply = isReplyAuthor || userIsAdmin;
                
                return `
                    <div class="comment-item comment-reply">
                        <div class="comment-header">
                            <div class="comment-author-avatar" style="${replyAvatarStyle}">${reply.authorPhotoURL ? '' : replyAuthorInitial}</div>
                            <div class="comment-author-name">${escapeHtml(reply.authorName || 'Unknown')}</div>
                            <div class="comment-time">${replyTimeAgo}</div>
                            ${canDeleteReply ? `<button class="comment-delete-btn" onclick="deleteComment('${postId}', '${reply.id}', event)" title="${userIsAdmin && !isReplyAuthor ? 'Delete Reply (Admin)' : 'Delete Reply'}">🗑️</button>` : ''}
                        </div>
                        <div class="comment-content">${escapeHtml(reply.content || '').replace(/\n/g, '<br>')}</div>
                    </div>
                `;
            }).join('');
            
            const hasReplies = replies.length > 0;
            const repliesCount = replies.length;
            
            return `
                <div class="comment-item" data-comment-id="${comment.id}">
                    <div class="comment-header">
                        <div class="comment-author-avatar" style="${avatarStyle}">${comment.authorPhotoURL ? '' : authorInitial}</div>
                        <div class="comment-author-name">${escapeHtml(comment.authorName || 'Unknown')}</div>
                        <div class="comment-time">${timeAgo}</div>
                        ${canDelete ? `<button class="comment-delete-btn" onclick="deleteComment('${postId}', '${comment.id}', event)" title="${userIsAdmin && !isCommentAuthor ? 'Delete Comment (Admin)' : 'Delete Comment'}">🗑️</button>` : ''}
                    </div>
                    <div class="comment-content">${escapeHtml(comment.content || '').replace(/\n/g, '<br>')}</div>
                    <div class="comment-actions">
                        <button class="comment-reply-btn" onclick="showReplyInput('${postId}', '${comment.id}', '${escapeHtml(comment.authorName || 'Unknown')}')">Reply</button>
                        ${hasReplies ? `<button class="comment-view-replies-btn" onclick="toggleReplies('${comment.id}')" id="viewRepliesBtn_${comment.id}">
                            <span class="view-replies-text">View ${repliesCount} ${repliesCount === 1 ? 'reply' : 'replies'}</span>
                            <span class="view-replies-icon">▼</span>
                        </button>` : ''}
                    </div>
                    ${repliesHtml ? `<div class="comment-replies" id="replies_${comment.id}" style="display: none;">${repliesHtml}</div>` : ''}
                    <div class="reply-input-container" id="replyInput_${comment.id}" style="display: none;">
                        <textarea class="reply-input-field" id="replyInputField_${comment.id}" placeholder="Write a reply..." maxlength="500" rows="2"></textarea>
                        <div class="reply-input-actions">
                            <button class="btn btn-primary btn-small" onclick="submitReply('${postId}', '${comment.id}')">Reply</button>
                            <button class="btn btn-secondary btn-small" onclick="hideReplyInput('${comment.id}')">Cancel</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading comments:', error);
        commentsListEl.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error loading comments</div></div>';
    }
}

// Add comment to post
async function addComment(postId, content, parentCommentId = null) {
    if (!window.firebaseDb || !currentUser) {
        console.error('User not authenticated or Firebase not available');
        return;
    }
    
    if (!content.trim()) {
        return;
    }
    
    try {
        const commentData = {
            authorId: currentUser.uid,
            content: content.trim(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            parentCommentId: parentCommentId || null
        };
        
        // Add comment to subcollection
        await window.firebaseDb.collection('communityPosts')
            .doc(postId)
            .collection('comments')
            .add(commentData);
        
        // Update comment count (all comments count, including replies)
        try {
            await window.firebaseDb.collection('communityPosts').doc(postId).update({
                commentCount: firebase.firestore.FieldValue.increment(1)
            });
            console.log('Comment count incremented for post:', postId, 'isReply:', !!parentCommentId);
        } catch (updateError) {
            console.error('Error updating comment count:', updateError);
            // If the field doesn't exist, set it to 1 (shouldn't happen, but handle it)
            try {
                const postDoc = await window.firebaseDb.collection('communityPosts').doc(postId).get();
                const currentCount = postDoc.data()?.commentCount || 0;
                await window.firebaseDb.collection('communityPosts').doc(postId).update({
                    commentCount: currentCount + 1
                });
            } catch (fallbackError) {
                console.error('Fallback comment count update also failed:', fallbackError);
            }
        }
        
        // Clear input and reload comments
        if (parentCommentId) {
            const replyInput = document.getElementById(`replyInputField_${parentCommentId}`);
            if (replyInput) replyInput.value = '';
            hideReplyInput(parentCommentId);
        } else {
            const commentInput = document.getElementById('newCommentInput');
            if (commentInput) commentInput.value = '';
        }
        
        await loadComments(postId);
        // Always refresh post list to update comment counts (for both comments and replies)
        loadCommunityPosts();
        
    } catch (error) {
        console.error('Error adding comment:', error);
        alert('Failed to add comment. Please try again.');
    }
}

// Delete comment
async function deleteComment(postId, commentId, event) {
    if (event) {
        event.stopPropagation();
    }
    
    if (!window.firebaseDb || !currentUser) {
        console.error('User not authenticated or Firebase not available');
        return;
    }
    
    try {
        // Get comment to check author and if it has replies
        const commentDoc = await window.firebaseDb.collection('communityPosts')
            .doc(postId)
            .collection('comments')
            .doc(commentId)
            .get();
        
        if (!commentDoc.exists) {
            alert('Comment not found');
            return;
        }
        
        const commentData = commentDoc.data();
        const isCommentAuthor = commentData.authorId === currentUser.uid;
        const userIsAdmin = await isAdminAsync();
        
        if (!isCommentAuthor && !userIsAdmin) {
            alert('You do not have permission to delete this comment');
            return;
        }
        
        // Check if comment has replies
        const repliesSnapshot = await window.firebaseDb.collection('communityPosts')
            .doc(postId)
            .collection('comments')
            .where('parentCommentId', '==', commentId)
            .get();
        
        const hasReplies = !repliesSnapshot.empty;
        
        // Confirm deletion
        const confirmTitle = userIsAdmin && !isCommentAuthor ? 'Delete Comment (Admin)' : 'Delete Comment';
        const confirmMessage = hasReplies
            ? 'This comment has replies. Are you sure you want to delete it? This will also delete all replies. This action cannot be undone.'
            : 'Are you sure you want to delete this comment? This action cannot be undone.';
        
        const confirmed = await showConfirmDialog('🗑️', confirmTitle, confirmMessage);
        if (!confirmed) return;
        
        // Delete all replies first
        if (hasReplies) {
            const batch = window.firebaseDb.batch();
            repliesSnapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();
        }
        
        // Delete the comment
        await window.firebaseDb.collection('communityPosts')
            .doc(postId)
            .collection('comments')
            .doc(commentId)
            .delete();
        
        // Update comment count (all comments count, including replies)
        const decrement = 1 + repliesSnapshot.size; // Comment + its replies
        await window.firebaseDb.collection('communityPosts').doc(postId).update({
            commentCount: firebase.firestore.FieldValue.increment(-decrement)
        });
        
        // Reload comments
        await loadComments(postId);
        loadCommunityPosts(); // Refresh post list to update comment counts
        
    } catch (error) {
        console.error('Error deleting comment:', error);
        alert('Failed to delete comment. Please try again.');
    }
}

// Show reply input
function showReplyInput(postId, parentCommentId, parentAuthorName) {
    const replyInputContainer = document.getElementById(`replyInput_${parentCommentId}`);
    const replyInputField = document.getElementById(`replyInputField_${parentCommentId}`);
    
    if (replyInputContainer && replyInputField) {
        replyInputContainer.style.display = 'block';
        replyInputField.focus();
        
        // Allow Enter to submit (Shift+Enter for new line)
        const handleKeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitReply(postId, parentCommentId);
            }
        };
        
        replyInputField.addEventListener('keydown', handleKeydown, { once: true });
    }
}

// Hide reply input
function hideReplyInput(commentId) {
    const replyInputContainer = document.getElementById(`replyInput_${commentId}`);
    const replyInputField = document.getElementById(`replyInputField_${commentId}`);
    
    if (replyInputContainer) {
        replyInputContainer.style.display = 'none';
    }
    if (replyInputField) {
        replyInputField.value = '';
    }
}

// Submit reply
async function submitReply(postId, parentCommentId) {
    const replyInputField = document.getElementById(`replyInputField_${parentCommentId}`);
    if (!replyInputField) return;
    
    const content = replyInputField.value.trim();
    if (!content) return;
    
    await addComment(postId, content, parentCommentId);
}

// Custom Word Input Management
let currentCustomWordGameId = null;

function initializeCustomWordInput(gameId = null) {
    console.log('initializeCustomWordInput called with gameId:', gameId);
    
    // Wait a bit to ensure DOM is ready
    setTimeout(() => {
        const wordInput = document.getElementById('customWordInputField');
        const submitBtn = document.getElementById('submitCustomWordBtn');
        
        console.log('Word input element:', wordInput);
        console.log('Submit button element:', submitBtn);
        
        if (!wordInput || !submitBtn) {
            console.error('Custom word input elements not found!');
            // Try again after a short delay
            setTimeout(() => {
                const retryWordInput = document.getElementById('customWordInputField');
                const retrySubmitBtn = document.getElementById('submitCustomWordBtn');
                if (retryWordInput && retrySubmitBtn) {
                    console.log('Found elements on retry, initializing...');
                    initializeCustomWordInputElements(gameId, retryWordInput, retrySubmitBtn);
                } else {
                    console.error('Custom word input elements still not found after retry!');
                }
            }, 200);
            return;
        }
        
        initializeCustomWordInputElements(gameId, wordInput, submitBtn);
    }, 50);
}

function initializeCustomWordInputElements(gameId, wordInput, submitBtn) {
    // Store gameId
    if (gameId) {
        currentCustomWordGameId = gameId;
    }
    
    // Remove existing event listeners by cloning
    const newWordInput = wordInput.cloneNode(true);
    const newSubmitBtn = submitBtn.cloneNode(true);
    
    // Replace old elements with new ones
    wordInput.parentNode.replaceChild(newWordInput, wordInput);
    submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);
    
    // Clear previous input and reset state
    newWordInput.value = '';
    newWordInput.disabled = false; // Ensure input is enabled
    newWordInput.readOnly = false; // Ensure input is not read-only
    newSubmitBtn.disabled = true;
    
    // Auto-uppercase and filter input
    newWordInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
        // Enable submit button only if word is 5 letters
        const currentSubmitBtn = document.getElementById('submitCustomWordBtn');
        if (currentSubmitBtn) {
            currentSubmitBtn.disabled = e.target.value.length !== 5;
        }
    });
    
    // Submit on Enter
    newWordInput.addEventListener('keypress', (e) => {
        const currentSubmitBtn = document.getElementById('submitCustomWordBtn');
        if (e.key === 'Enter' && currentSubmitBtn && !currentSubmitBtn.disabled) {
            submitCustomWord();
        }
    });
    
    // Focus input
    setTimeout(() => {
        newWordInput.focus();
        // Double-check that input is enabled and focusable
        if (newWordInput.disabled) {
            console.warn('Input was disabled after focus attempt, re-enabling...');
            newWordInput.disabled = false;
            newWordInput.focus();
        }
    }, 150);
    
    // Submit button handler
    newSubmitBtn.addEventListener('click', () => {
        submitCustomWord();
    });
    
    console.log('Custom word input initialized successfully. Input enabled:', !newWordInput.disabled, 'Read-only:', newWordInput.readOnly);
}

function submitCustomWord() {
    const wordInput = document.getElementById('customWordInputField');
    const submitBtn = document.getElementById('submitCustomWordBtn');
    
    if (!wordInput || !wordInput.value || wordInput.value.length !== 5) {
        showGameMessage('⚠️', 'Invalid Word', 'Please enter a 5-letter word');
        return;
    }
    
    const word = wordInput.value.toUpperCase();
    const gameId = currentCustomWordGameId || window.pendingGameId;
    
    if (!gameId) {
        showGameMessage('⚠️', 'Error', 'Game ID not found');
        return;
    }
    
    // Disable input and button while submitting
    wordInput.disabled = true;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="btn-icon">✓</span><span>Submitting...</span>';
    }
    
    socket.emit('submitCustomWord', {
        gameId: gameId,
        word: word
    });
}

socket.on('customWordAccepted', (data) => {
    // Word was accepted, show waiting message
    const waitingMessage = document.getElementById('waitingMessage');
    if (waitingMessage) {
        waitingMessage.textContent = 'Word submitted! Waiting for opponent to submit their word...';
    }
    ScreenManager.show('waiting');
});

// Toggle replies visibility
function toggleReplies(commentId) {
    const repliesContainer = document.getElementById(`replies_${commentId}`);
    const viewBtn = document.getElementById(`viewRepliesBtn_${commentId}`);
    
    if (!repliesContainer || !viewBtn) return;
    
    const isVisible = repliesContainer.style.display !== 'none';
    
    if (isVisible) {
        repliesContainer.style.display = 'none';
        const icon = viewBtn.querySelector('.view-replies-icon');
        if (icon) icon.textContent = '▼';
    } else {
        repliesContainer.style.display = 'block';
        const icon = viewBtn.querySelector('.view-replies-icon');
        if (icon) icon.textContent = '▲';
    }
}

// Recalculate comment count for a post (counts all comments including replies)
async function recalculateCommentCount(postId) {
    if (!window.firebaseDb) {
        console.error('Firebase not available');
        return;
    }
    
    try {
        // Count all comments (both top-level and replies)
        const commentsSnapshot = await window.firebaseDb.collection('communityPosts')
            .doc(postId)
            .collection('comments')
            .get();
        
        const totalCount = commentsSnapshot.size;
        
        // Update the comment count
        await window.firebaseDb.collection('communityPosts').doc(postId).update({
            commentCount: totalCount
        });
        
        console.log(`Recalculated comment count for post ${postId}: ${totalCount}`);
        return totalCount;
    } catch (error) {
        console.error('Error recalculating comment count:', error);
        throw error;
    }
}

// Recalculate comment counts for all posts (can be called manually by admin)
async function recalculateAllCommentCounts() {
    if (!window.firebaseDb || !currentUser) {
        console.error('Not authenticated or Firebase not available');
        return;
    }
    
    // Check if user is admin
    const userIsAdmin = await isAdminAsync();
    if (!userIsAdmin) {
        console.error('Only admins can recalculate comment counts');
        alert('Only admins can recalculate comment counts');
        return;
    }
    
    try {
        console.log('Starting comment count recalculation for all posts...');
        const postsSnapshot = await window.firebaseDb.collection('communityPosts').get();
        
        let processed = 0;
        let errors = 0;
        
        for (const doc of postsSnapshot.docs) {
            try {
                await recalculateCommentCount(doc.id);
                processed++;
            } catch (error) {
                console.error(`Error recalculating count for post ${doc.id}:`, error);
                errors++;
            }
        }
        
        console.log(`Comment count recalculation complete. Processed: ${processed}, Errors: ${errors}`);
        alert(`Comment count recalculation complete!\nProcessed: ${processed}\nErrors: ${errors}`);
        
        // Reload posts to show updated counts
        loadCommunityPosts();
    } catch (error) {
        console.error('Error recalculating all comment counts:', error);
        alert('Error recalculating comment counts. Check console for details.');
    }
}

// Show confirmation dialog (returns a Promise that resolves to true/false)
function showConfirmDialog(icon, title, message) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirmDialogOverlay');
        const iconEl = document.getElementById('confirmDialogIcon');
        const titleEl = document.getElementById('confirmDialogTitle');
        const textEl = document.getElementById('confirmDialogText');
        const confirmBtn = document.getElementById('confirmDialogConfirmBtn');
        const cancelBtn = document.getElementById('confirmDialogCancelBtn');
        
        if (!overlay || !iconEl || !titleEl || !textEl || !confirmBtn || !cancelBtn) {
            console.error('Confirm dialog elements not found');
            resolve(false);
            return;
        }
        
        // Set content
        iconEl.textContent = icon || '⚠️';
        titleEl.textContent = title || 'Confirm Action';
        textEl.textContent = message || 'Are you sure?';
        
        // Reset classes
        overlay.classList.remove('show', 'hiding');
        
        // Force reflow
        void overlay.offsetWidth;
        
        // Show overlay
        overlay.classList.add('show');
        
        // Close handler
        const closeDialog = (result) => {
            overlay.classList.add('hiding');
            setTimeout(() => {
                overlay.classList.remove('show', 'hiding');
                resolve(result);
            }, 300);
        };
        
        // Button handlers - remove old listeners by replacing onclick
        confirmBtn.onclick = () => closeDialog(true);
        cancelBtn.onclick = () => closeDialog(false);
        
        // Close on overlay click (outside content)
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                closeDialog(false);
            }
        };
        
        // Close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeDialog(false);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
}

// Delete post (post author or admin can delete)
async function deletePost(postId, event) {
    if (event) event.stopPropagation();
    
    if (!window.firebaseDb || !currentUser) {
        console.error('User not authenticated or Firebase not available');
        return;
    }
    
    try {
        // Verify user is the author or admin before deleting
        const postDoc = await window.firebaseDb.collection('communityPosts').doc(postId).get();
        if (!postDoc.exists) {
            showGameMessage('❌', 'Error', 'Post not found');
            return;
        }
        
        const postData = postDoc.data();
        const isPostAuthor = postData.authorId === currentUser.uid;
        const userIsAdmin = await isAdminAsync();
        
        if (!isPostAuthor && !userIsAdmin) {
            showGameMessage('❌', 'Permission Denied', 'You can only delete your own posts');
            return;
        }
        
        // Confirm deletion (different message for admins)
        const confirmTitle = userIsAdmin && !isPostAuthor ? 'Delete Post (Admin)' : 'Delete Post';
        const confirmMessage = userIsAdmin && !isPostAuthor
            ? 'Are you sure you want to delete this post as an admin? This action cannot be undone.'
            : 'Are you sure you want to delete this post? This action cannot be undone.';
        
        const confirmed = await showConfirmDialog('🗑️', confirmTitle, confirmMessage);
        
        if (!confirmed) {
            return;
        }
        
        // Delete all comments first (batch delete)
        const commentsRef = window.firebaseDb.collection('communityPosts')
            .doc(postId)
            .collection('comments');
        
        const commentsSnapshot = await commentsRef.get();
        const batch = window.firebaseDb.batch();
        
        commentsSnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        
        await batch.commit();
        
        // Delete the post
        await window.firebaseDb.collection('communityPosts').doc(postId).delete();
        
        // Close modal and reload posts
        closePostDetailModal();
        await loadCommunityPosts();
        
    } catch (error) {
        console.error('Error deleting post:', error);
        showGameMessage('❌', 'Error', 'Failed to delete post. Please try again.');
    }
}

// Modal functions
async function openCreatePostModal() {
    const modal = document.getElementById('createPostModal');
    if (modal) {
        modal.style.display = 'flex';
        // Reset form
        const titleInput = document.getElementById('postTitleInput');
        const contentInput = document.getElementById('postContentInput');
        const categorySelect = document.getElementById('postCategorySelect');
        const errorEl = document.getElementById('createPostError');
        if (titleInput) titleInput.value = '';
        if (contentInput) contentInput.value = '';
        if (errorEl) errorEl.style.display = 'none';
        
        // Update category select - add bulletin option if admin, remove if not
        if (categorySelect) {
            const existingBulletinOption = categorySelect.querySelector('option[value="bulletin"]');
            const isAdminUser = await isAdminAsync();
            
            if (isAdminUser) {
                // Add bulletin option if admin and it doesn't exist
                if (!existingBulletinOption) {
                    const bulletinOption = document.createElement('option');
                    bulletinOption.value = 'bulletin';
                    bulletinOption.textContent = '📌 Bulletin Board';
                    categorySelect.insertBefore(bulletinOption, categorySelect.firstChild);
                }
            } else {
                // Remove bulletin option if not admin
                if (existingBulletinOption) {
                    existingBulletinOption.remove();
                }
            }
            
            // Add event listeners for dropdown arrow animation
            const inputGroup = categorySelect.closest('.input-group');
            if (inputGroup) {
                // Add class to identify this input-group has a select (for browsers without :has() support)
                inputGroup.classList.add('has-select');
                
                // Remove existing listeners if any (prevent duplicates)
                const handleFocus = () => {
                    inputGroup.classList.add('has-focus');
                };
                const handleBlur = () => {
                    // Delay blur to allow selection to complete
                    setTimeout(() => {
                        if (document.activeElement !== categorySelect) {
                            inputGroup.classList.remove('has-focus');
                        }
                    }, 100);
                };
                const handleMouseDown = () => {
                    inputGroup.classList.add('has-focus');
                };
                
                categorySelect.addEventListener('focus', handleFocus);
                categorySelect.addEventListener('blur', handleBlur);
                categorySelect.addEventListener('mousedown', handleMouseDown);
            }
        }
    }
}

function closeCreatePostModal() {
    const modal = document.getElementById('createPostModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function closePostDetailModal() {
    const modal = document.getElementById('postDetailModal');
    if (modal) {
        modal.style.display = 'none';
        currentPostDetailId = null;
        // Clear comment input when closing
        const commentInput = document.getElementById('newCommentInput');
        if (commentInput) commentInput.value = '';
    }
}

// Category filter handler
function filterCommunityPosts(category) {
    currentCommunityCategory = category;
    
    // Update active state
    document.querySelectorAll('.category-filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.category === category) {
            btn.classList.add('active');
        }
    });
    
    // Reload only community posts section (not bulletin board)
    reloadCommunityPostsOnly();
}

// Reload only community posts (when filtering)
async function reloadCommunityPostsOnly() {
    if (!window.firebaseDb || !currentUser) return;
    
    const communityPostsList = document.getElementById('communityPostsList');
    if (!communityPostsList) return;
    
    try {
        // Load all posts - try with orderBy first, fallback to no orderBy if index doesn't exist
        let allPostsSnapshot;
        try {
            const allPostsQuery = window.firebaseDb.collection('communityPosts')
                .orderBy('createdAt', 'desc')
                .limit(200);
            allPostsSnapshot = await allPostsQuery.get();
        } catch (indexError) {
            // If index doesn't exist, load without orderBy and sort client-side
            console.log('Index not found, loading posts without orderBy');
            const allPostsQuery = window.firebaseDb.collection('communityPosts')
                .limit(500);
            allPostsSnapshot = await allPostsQuery.get();
        }
        const communityPosts = [];
        
        for (const doc of allPostsSnapshot.docs) {
            const data = doc.data();
            // Skip bulletin posts
            if (data.isBulletin === true) continue;
            
            // Filter by category client-side if not 'all'
            if (currentCommunityCategory !== 'all' && data.category !== currentCommunityCategory) {
                continue;
            }
            
            const authorInfo = await getUserInfo(data.authorId);
            communityPosts.push({
                id: doc.id,
                ...data,
                authorName: authorInfo.name,
                authorPhotoURL: authorInfo.photoURL,
                authorIsAdmin: authorInfo.isAdmin === true,
                createdAt: data.createdAt // Preserve timestamp for sorting
            });
        }
        
        // Sort by createdAt (most recent first)
        communityPosts.sort((a, b) => {
            const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
            const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
            return bTime.getTime() - aTime.getTime();
        });
        
        // Store all community posts
        allCommunityPosts = communityPosts;
        communityPostsShown = 3; // Reset to 3 when filtering
        
        renderPostsWithShowMore(allCommunityPosts.slice(0, communityPostsShown), communityPostsList, false, allCommunityPosts.length);
    } catch (error) {
        console.error('Error reloading community posts:', error);
    }
}

// Event listeners for community functionality
document.addEventListener('DOMContentLoaded', () => {
    // Create post button
    const createPostBtn = document.getElementById('createPostBtn');
    if (createPostBtn) {
        createPostBtn.addEventListener('click', openCreatePostModal);
    }
    
    // Close modal buttons
    const closeCreatePostModalBtn = document.getElementById('closeCreatePostModal');
    if (closeCreatePostModalBtn) {
        closeCreatePostModalBtn.addEventListener('click', closeCreatePostModal);
    }
    
    const closePostDetailModalBtn = document.getElementById('closePostDetailModal');
    if (closePostDetailModalBtn) {
        closePostDetailModalBtn.addEventListener('click', closePostDetailModal);
    }
    
    // Submit post button
    const submitPostBtn = document.getElementById('submitPostBtn');
    if (submitPostBtn) {
        submitPostBtn.addEventListener('click', () => {
            const title = document.getElementById('postTitleInput')?.value || '';
            const content = document.getElementById('postContentInput')?.value || '';
            const category = document.getElementById('postCategorySelect')?.value || 'general';
            
            if (!title.trim() || !content.trim()) {
                const errorEl = document.getElementById('createPostError');
                if (errorEl) {
                    errorEl.textContent = 'Title and content are required';
                    errorEl.style.display = 'block';
                }
                return;
            }
            
            createPost(title, content, category);
        });
    }
    
    // Cancel post button
    const cancelPostBtn = document.getElementById('cancelPostBtn');
    if (cancelPostBtn) {
        cancelPostBtn.addEventListener('click', closeCreatePostModal);
    }
    
    // Submit comment button
    const submitCommentBtn = document.getElementById('submitCommentBtn');
    const newCommentInput = document.getElementById('newCommentInput');
    if (submitCommentBtn) {
        submitCommentBtn.addEventListener('click', () => {
            if (!currentPostDetailId) return;
            const content = newCommentInput?.value || '';
            if (content.trim()) {
                addComment(currentPostDetailId, content);
            }
        });
    }
    
    // Allow Enter key to submit comment (Shift+Enter for new line)
    if (newCommentInput) {
        newCommentInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (currentPostDetailId && newCommentInput.value.trim()) {
                    addComment(currentPostDetailId, newCommentInput.value);
                }
            }
        });
    }
    
    // Category filter buttons
    document.querySelectorAll('.category-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const category = btn.dataset.category;
            filterCommunityPosts(category);
        });
    });
    
    // Click outside modal to close
    const createPostModal = document.getElementById('createPostModal');
    if (createPostModal) {
        createPostModal.addEventListener('click', (e) => {
            if (e.target === createPostModal) {
                closeCreatePostModal();
            }
        });
    }
    
    const postDetailModal = document.getElementById('postDetailModal');
    if (postDetailModal) {
        postDetailModal.addEventListener('click', (e) => {
            if (e.target === postDetailModal) {
                closePostDetailModal();
            }
        });
    }
    
    // Make functions globally available
    window.likePost = likePost;
    window.openPostDetail = openPostDetail;
    window.deletePost = deletePost;
    window.deleteComment = deleteComment;
    window.showReplyInput = showReplyInput;
    window.hideReplyInput = hideReplyInput;
    window.submitReply = submitReply;
    window.toggleReplies = toggleReplies;
    window.recalculateCommentCount = recalculateCommentCount;
    window.recalculateAllCommentCounts = recalculateAllCommentCounts;
    
    // Messages tab event listeners
    const messagesSendBtn = document.getElementById('messagesSendBtn');
    const messagesChatInput = document.getElementById('messagesChatInput');
    
    if (messagesSendBtn && messagesChatInput) {
        messagesSendBtn.addEventListener('click', () => {
            if (!currentChatFriendId) return;
            const text = messagesChatInput.value.trim();
            if (text) {
                sendMessage(currentChatFriendId, text);
            }
        });
        
        // Send on Enter (Shift+Enter for new line)
        messagesChatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (currentChatFriendId && messagesChatInput.value.trim()) {
                    sendMessage(currentChatFriendId, messagesChatInput.value);
                }
            }
        });
        
        // Auto-resize textarea
        messagesChatInput.addEventListener('input', () => {
            messagesChatInput.style.height = 'auto';
            messagesChatInput.style.height = Math.min(messagesChatInput.scrollHeight, 120) + 'px';
        });
    }
});

// ==================== MESSAGING FUNCTIONALITY ====================

// Set up global real-time listener for all incoming messages (shows notifications)
function setupGlobalMessageListener() {
    if (!currentUser || !window.firebaseDb) return;
    
    // Clean up existing listener if it exists
    if (globalMessageListener) {
        globalMessageListener();
        globalMessageListener = null;
    }
    
    // Track when listener starts to ignore initial snapshot
    globalMessageListenerStartTime = Date.now();
    let isInitialSnapshot = true; // Track if this is the first snapshot
    
    // Listen for all messages where current user is the receiver
    // Don't filter by 'read' - listen to all messages and check if we've shown notification
    globalMessageListener = window.firebaseDb.collection('messages')
        .where('receiverId', '==', currentUser.uid)
        .orderBy('createdAt', 'desc')
        .limit(50) // Only listen to recent messages to avoid performance issues
        .onSnapshot(snapshot => {
            // Skip all messages from initial snapshot (they're existing, not new)
            if (isInitialSnapshot) {
                isInitialSnapshot = false;
                // Mark all existing messages as processed so we don't process them again
                snapshot.forEach(doc => {
                    shownMessageIds.add(doc.id);
                });
                return; // Don't process initial snapshot
            }
            
            // Process only NEW changes (not from initial snapshot)
            // Use a Set to track messages processed in this snapshot to prevent duplicates within the same snapshot
            const processedInThisSnapshot = new Set();
            
            // First, collect all message IDs that need processing
            const messagesToProcess = [];
            snapshot.docChanges().forEach(change => {
                // Only process 'added' changes (new messages)
                if (change.type !== 'added') {
                    return;
                }
                
                const messageId = change.doc.id;
                
                // CRITICAL: Check shownMessageIds FIRST (before any other logic)
                // This is the most important check to prevent duplicates
                if (shownMessageIds.has(messageId)) {
                    return; // Already processed this message, skip completely
                }
                
                // Also check if processed in this snapshot (defense in depth)
                if (processedInThisSnapshot.has(messageId)) {
                    return; // Already processed in this snapshot iteration
                }
                
                // Mark as processed IMMEDIATELY (synchronously, before any async operations)
                shownMessageIds.add(messageId);
                processedInThisSnapshot.add(messageId);
                
                const message = change.doc.data();
                const senderId = message.senderId;
                
                // Skip if message is already read
                if (message.read === true) {
                    return;
                }
                
                // Don't update unread count if user is currently viewing this conversation
                if (currentChatFriendId === senderId) {
                    return;
                }
                
                // Add to processing queue
                messagesToProcess.push({ messageId, senderId });
            });
            
            // Process all messages (update unread counts)
            if (messagesToProcess.length > 0) {
                messagesToProcess.forEach(({ senderId }) => {
                    unreadMessageCounts[senderId] = (unreadMessageCounts[senderId] || 0) + 1;
                });
                saveUnreadCounts();
                updateMessagesNotificationBadge();
                renderMessagesFriendsList();
            }
        }, error => {
            // If orderBy fails (no index), fall back to listening without orderBy
            if (error.code === 'failed-precondition') {
                console.warn('Message listener index not found, using fallback');
                // Fallback: listen without orderBy (less efficient but works)
                globalMessageListenerStartTime = Date.now();
                let isInitialSnapshotFallback = true;
                globalMessageListener = window.firebaseDb.collection('messages')
                    .where('receiverId', '==', currentUser.uid)
                    .onSnapshot(snapshot => {
                        // Skip all messages from initial snapshot
                        if (isInitialSnapshotFallback) {
                            isInitialSnapshotFallback = false;
                            snapshot.forEach(doc => {
                                shownMessageIds.add(doc.id);
                            });
                            return;
                        }
                        
                        // Process only NEW changes
                        // Use a Set to track messages processed in this snapshot to prevent duplicates
                        const processedInThisSnapshot = new Set();
                        
                        // First, collect all message IDs that need processing
                        const messagesToProcess = [];
                        snapshot.docChanges().forEach(change => {
                            // Only process 'added' changes (new messages)
                            if (change.type !== 'added') {
                                return;
                            }
                            
                            const messageId = change.doc.id;
                            
                            // CRITICAL: Check BOTH global shownMessageIds AND this snapshot's processed set
                            if (shownMessageIds.has(messageId) || processedInThisSnapshot.has(messageId)) {
                                return; // Already processed, skip
                            }
                            
                            // Mark as processed in both sets IMMEDIATELY (synchronously)
                            shownMessageIds.add(messageId);
                            processedInThisSnapshot.add(messageId);
                            
                            const message = change.doc.data();
                            const senderId = message.senderId;
                            
                            // Skip if message is already read
                            if (message.read === true) {
                                return;
                            }
                            
                            // Don't update unread count if user is currently viewing this conversation
                            if (currentChatFriendId === senderId) {
                                return;
                            }
                            
                            // Add to processing queue
                            messagesToProcess.push({ messageId, senderId });
                        });
                        
                        // Process all messages (update unread counts)
                        if (messagesToProcess.length > 0) {
                            messagesToProcess.forEach(({ senderId }) => {
                                unreadMessageCounts[senderId] = (unreadMessageCounts[senderId] || 0) + 1;
                            });
                            saveUnreadCounts();
                            updateMessagesNotificationBadge();
                            renderMessagesFriendsList();
                        }
                    }, error => {
                        if (error.code !== 'unavailable' && !error.message?.includes('CORS') && !error.message?.includes('network')) {
                            console.error('Error in global message listener (fallback):', error);
                        }
                    });
            } else if (error.code !== 'unavailable' && !error.message?.includes('CORS') && !error.message?.includes('network')) {
                console.error('Error in global message listener:', error);
            }
        });
}

// Set up lightweight listener for gift badge updates (no popup, just badge)
function setupGiftBadgeListener() {
    if (!currentUser || !window.firebaseDb) return;
    
    // Clean up existing listener
    if (giftBadgeListener) {
        giftBadgeListener();
        giftBadgeListener = null;
    }
    
    // Listen for new unopened gifts (just to update badge, not show popup)
    try {
        giftBadgeListener = window.firebaseDb.collection('giftedPacks')
            .where('receiverId', '==', currentUser.uid)
            .where('opened', '==', false)
            .onSnapshot(snapshot => {
                // Update badge count based on current unopened packs
                const unopenedCount = snapshot.size;
                updateShopTabNotificationBadge(unopenedCount);
            }, error => {
                // Handle index errors gracefully - badge will update when shop tab opens
                if (error.code === 'failed-precondition') {
                    console.warn('Gift badge listener requires index, badge will update when shop opens');
                } else if (error.code !== 'unavailable' && !error.message?.includes('CORS') && !error.message?.includes('network')) {
                    console.error('Error in gift badge listener:', error);
                }
            });
    } catch (error) {
        console.warn('Could not set up gift badge listener:', error);
    }
}

// Show popup notification for new message
function showMessageNotification(senderName, messageText, senderId) {
    // Create or get notification element
    let notification = document.getElementById('messageNotificationPopup');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'messageNotificationPopup';
        notification.className = 'message-notification-popup';
        document.body.appendChild(notification);
    }
    
    // Truncate message if too long
    const displayText = messageText.length > 50 ? messageText.substring(0, 50) + '...' : messageText;
    
    notification.innerHTML = `
        <div class="message-notification-content">
            <div class="message-notification-header">
                <span class="message-notification-icon">💬</span>
                <span class="message-notification-title">New Message</span>
                <button class="message-notification-close" onclick="closeMessageNotification()">✕</button>
            </div>
            <div class="message-notification-body">
                <div class="message-notification-sender">From: ${escapeHtml(senderName)}</div>
                <div class="message-notification-text">${escapeHtml(displayText)}</div>
            </div>
            <button class="message-notification-action" onclick="openMessagesTab('${senderId}')">Open Messages</button>
        </div>
    `;
    
    // Show notification
    notification.style.display = 'block';
    notification.classList.add('show');
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        closeMessageNotification();
    }, 5000);
}

// Close message notification
function closeMessageNotification() {
    const notification = document.getElementById('messageNotificationPopup');
    if (notification) {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.style.display = 'none';
        }, 300);
    }
}

// Open messages tab and chat with specific friend
function openMessagesTab(friendId) {
    closeMessageNotification();
    switchTab('messages');
    // Small delay to ensure tab is loaded
    setTimeout(() => {
        openChatWithFriend(friendId);
    }, 100);
}

let currentChatFriendId = null;
let messageListeners = {}; // Store listeners for cleanup
let globalMessageListener = null; // Global listener for all incoming messages
let giftBadgeListener = null; // Lightweight listener for gift badge updates only
let shownMessageIds = new Set(); // Track message IDs we've already shown notifications for
let globalMessageListenerStartTime = null; // Track when listener started to ignore initial snapshot
let friendsForMessaging = [];
let unreadMessageCounts = {}; // Track unread messages per friend: { friendId: count }
let lastMessageTimes = {}; // Track last message time per friend: { friendId: timestamp }

// Save lastMessageTimes to localStorage to persist order
function saveMessageTimes() {
    try {
        if (currentUser) {
            localStorage.setItem(`messageTimes_${currentUser.uid}`, JSON.stringify(lastMessageTimes));
        }
    } catch (error) {
        console.error('Error saving message times:', error);
    }
}

// Load lastMessageTimes from localStorage to restore order
function loadMessageTimes() {
    try {
        if (currentUser) {
            const saved = localStorage.getItem(`messageTimes_${currentUser.uid}`);
            if (saved) {
                lastMessageTimes = JSON.parse(saved);
            }
        }
    } catch (error) {
        console.error('Error loading message times:', error);
        lastMessageTimes = {};
    }
}

// Save unreadMessageCounts to localStorage to persist indicators
function saveUnreadCounts() {
    try {
        if (currentUser) {
            localStorage.setItem(`unreadCounts_${currentUser.uid}`, JSON.stringify(unreadMessageCounts));
        }
    } catch (error) {
        console.error('Error saving unread counts:', error);
    }
}

// Load unreadMessageCounts from localStorage to restore indicators
function loadUnreadCounts() {
    try {
        if (currentUser) {
            const saved = localStorage.getItem(`unreadCounts_${currentUser.uid}`);
            if (saved) {
                unreadMessageCounts = JSON.parse(saved);
            }
        }
    } catch (error) {
        console.error('Error loading unread counts:', error);
        unreadMessageCounts = {};
    }
}

// Load friends list for messaging
async function loadMessagesFriends() {
    if (!currentUser || !window.firebaseDb) return;
    
    const friendsListEl = document.getElementById('messagesFriendsList');
    
    try {
        // Load persisted data first (from localStorage - instant)
        loadMessageTimes();
        loadUnreadCounts();
        
        // Reuse the friends list data if available, otherwise load it
        if (friendsListData.length === 0) {
            if (friendsListEl) {
                friendsListEl.innerHTML = `
                    <div class="messages-loading-state">
                        <div class="messages-loading-spinner"></div>
                        <div class="messages-loading-text">Loading friends...</div>
                    </div>
                `;
            }
            await loadFriends();
        }
        
        friendsForMessaging = [...friendsListData];
        
        // Render immediately with cached data (fast!)
        renderMessagesFriendsList();
        
        // Load fresh data in background (non-blocking)
        // This updates the UI incrementally as data loads
        Promise.all([
            loadLastMessageTimesForAllFriends().then(() => {
                saveMessageTimes();
                renderMessagesFriendsList(); // Re-render with updated times
            }),
            loadUnreadMessageCounts().then(() => {
                saveUnreadCounts();
                renderMessagesFriendsList(); // Re-render with updated counts
            })
        ]).catch(error => {
            console.error('Error loading message data in background:', error);
        });
        
    } catch (error) {
        console.error('Error loading friends for messaging:', error);
        if (friendsListEl) {
            friendsListEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">⚠️</div>
                    <div class="empty-state-text">Error loading conversations</div>
                </div>
            `;
        }
    }
}

// Load last message time for all friends (optimized - batches queries)
async function loadLastMessageTimesForAllFriends() {
    if (!currentUser || !window.firebaseDb || friendsForMessaging.length === 0) return;
    
    try {
        // Batch process friends in chunks to avoid overwhelming Firestore
        const BATCH_SIZE = 5; // Process 5 friends at a time
        const friendChunks = [];
        for (let i = 0; i < friendsForMessaging.length; i += BATCH_SIZE) {
            friendChunks.push(friendsForMessaging.slice(i, i + BATCH_SIZE));
        }
        
        // Process chunks sequentially, but friends within each chunk in parallel
        for (const chunk of friendChunks) {
            const promises = chunk.map(async (friend) => {
                try {
                    let sentSnapshot, receivedSnapshot;
                    
                    // Try with orderBy first (more efficient if index exists)
                    try {
                        const sentQuery = window.firebaseDb.collection('messages')
                            .where('senderId', '==', currentUser.uid)
                            .where('receiverId', '==', friend.id)
                            .orderBy('createdAt', 'desc')
                            .limit(1);
                        
                        const receivedQuery = window.firebaseDb.collection('messages')
                            .where('senderId', '==', friend.id)
                            .where('receiverId', '==', currentUser.uid)
                            .orderBy('createdAt', 'desc')
                            .limit(1);
                        
                        [sentSnapshot, receivedSnapshot] = await Promise.all([
                            sentQuery.get(),
                            receivedQuery.get()
                        ]);
                    } catch (indexError) {
                        // If index doesn't exist, load without orderBy and sort client-side
                        if (indexError.code === 'failed-precondition') {
                            // Load all messages for this conversation and sort client-side
                            const sentQuery = window.firebaseDb.collection('messages')
                                .where('senderId', '==', currentUser.uid)
                                .where('receiverId', '==', friend.id);
                            
                            const receivedQuery = window.firebaseDb.collection('messages')
                                .where('senderId', '==', friend.id)
                                .where('receiverId', '==', currentUser.uid);
                            
                            [sentSnapshot, receivedSnapshot] = await Promise.all([
                                sentQuery.get(),
                                receivedQuery.get()
                            ]);
                        } else {
                            throw indexError;
                        }
                    }
                    
                    let latestTime = 0;
                    let latestMessageText = '';
                    
                    // Check sent messages
                    sentSnapshot.forEach(doc => {
                        const msg = doc.data();
                        const msgTime = msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date(msg.createdAt || 0);
                        const time = msgTime.getTime();
                        if (time > latestTime) {
                            latestTime = time;
                            latestMessageText = msg.text || '';
                        }
                    });
                    
                    // Check received messages
                    receivedSnapshot.forEach(doc => {
                        const msg = doc.data();
                        const msgTime = msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date(msg.createdAt || 0);
                        const time = msgTime.getTime();
                        if (time > latestTime) {
                            latestTime = time;
                            latestMessageText = msg.text || '';
                        }
                    });
                    
                    if (latestTime > 0) {
                        // Only update if this is newer than what we have (preserve order)
                        const currentTime = lastMessageTimes[friend.id] || 0;
                        if (latestTime > currentTime) {
                            lastMessageTimes[friend.id] = latestTime;
                        }
                        // Update preview text
                        if (latestMessageText) {
                            updateFriendPreview(friend.id, latestMessageText);
                        }
                    }
                } catch (error) {
                    // Only log non-index errors (index errors are expected and handled above)
                    if (error.code !== 'failed-precondition') {
                        console.warn(`Error loading last message time for friend ${friend.id}:`, error);
                    }
                }
            });
            
            // Wait for this chunk to complete before moving to next
            await Promise.allSettled(promises);
            
            // Update UI after each chunk (progressive loading)
            renderMessagesFriendsList();
        }
    } catch (error) {
        console.error('Error loading last message times:', error);
    }
}

// Render friends list in messages tab
function renderMessagesFriendsList() {
    const friendsListEl = document.getElementById('messagesFriendsList');
    if (!friendsListEl) return;
    
    if (friendsForMessaging.length === 0) {
        friendsListEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <div class="empty-state-text">No friends yet. Add friends to start messaging!</div>
            </div>
        `;
        return;
    }
    
    // Simple Snapchat-style sorting: newest message time first
    // Friends with no messages (time = 0) go to bottom
    const sortedFriends = [...friendsForMessaging].sort((a, b) => {
        const aTime = lastMessageTimes[a.id] || 0;
        const bTime = lastMessageTimes[b.id] || 0;
        
        // Sort by time (newest first) - simple and stable
        return bTime - aTime;
    });
    
    friendsListEl.innerHTML = sortedFriends.map(friend => {
        const initial = friend.name ? friend.name.charAt(0).toUpperCase() : '?';
        const isActive = currentChatFriendId === friend.id ? 'active' : '';
        const unreadCount = unreadMessageCounts[friend.id] || 0;
        const hasUnread = unreadCount > 0 && currentChatFriendId !== friend.id;
        const isFriendAdmin = friend.isAdmin === true || isAdminEmail(friend.email || '');
        
        return `
            <div class="messages-friend-item ${isActive}" data-friend-id="${friend.id}" onclick="openChatWithFriend('${friend.id}')">
                <div class="messages-friend-avatar" data-photo-url="${friend.photoURL || ''}" data-initial="${initial}">${initial}</div>
                ${hasUnread ? '<div class="messages-unread-indicator"></div>' : ''}
                <div class="messages-friend-info">
                    <div class="messages-friend-name ${isFriendAdmin ? 'admin-name' : ''}">${escapeHtml(friend.name || 'Unknown')}</div>
                    <div class="messages-friend-preview" id="friendPreview_${friend.id}">Tap to start chatting</div>
                </div>
            </div>
        `;
    }).join('');
    
    // Apply profile images safely after rendering
    sortedFriends.forEach(friend => {
        const avatarEl = friendsListEl.querySelector(`[data-friend-id="${friend.id}"] .messages-friend-avatar`);
        if (avatarEl) {
            const initial = friend.name ? friend.name.charAt(0).toUpperCase() : '?';
            applyProfileImage(avatarEl, friend.photoURL, initial);
        }
    });
    
    // Update notification badge in More menu
    updateMessagesNotificationBadge();
}

// Open chat with a friend
async function openChatWithFriend(friendId) {
    if (!currentUser || !window.firebaseDb) return;
    
    // Clear unread count for this friend when opening chat
    unreadMessageCounts[friendId] = 0;
    saveUnreadCounts(); // Persist the cleared count
    updateMessagesNotificationBadge();
    
    // Mark all messages from this friend as read (update in Firestore)
    try {
        const unreadMessagesQuery = window.firebaseDb.collection('messages')
            .where('senderId', '==', friendId)
            .where('receiverId', '==', currentUser.uid)
            .where('read', '==', false);
        
        const unreadSnapshot = await unreadMessagesQuery.get();
        const batch = window.firebaseDb.batch();
        
        unreadSnapshot.forEach(doc => {
            batch.update(doc.ref, { read: true });
        });
        
        if (unreadSnapshot.size > 0) {
            await batch.commit();
            // After marking as read, update the count
            unreadMessageCounts[friendId] = 0;
            saveUnreadCounts(); // Persist the cleared count
        }
    } catch (error) {
        console.error('Error marking messages as read:', error);
        // Continue even if marking as read fails
        // Still clear the count locally
        unreadMessageCounts[friendId] = 0;
        saveUnreadCounts();
    }
    
    // Remove active state from all friends
    document.querySelectorAll('.messages-friend-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Add active state to selected friend
    const selectedFriendItem = document.querySelector(`[data-friend-id="${friendId}"]`);
    if (selectedFriendItem) {
        selectedFriendItem.classList.add('active');
        // Remove unread indicator
        const unreadIndicator = selectedFriendItem.querySelector('.messages-unread-indicator');
        if (unreadIndicator) unreadIndicator.remove();
    }
    
    currentChatFriendId = friendId;
    
    // Find friend data
    const friend = friendsForMessaging.find(f => f.id === friendId);
    if (!friend) return;
    
    // Update chat interface
    const chatInterface = document.getElementById('messagesChatInterface');
    const noChatSelected = document.getElementById('noChatSelected');
    
    if (chatInterface) chatInterface.style.display = 'flex';
    if (noChatSelected) noChatSelected.style.display = 'none';
    
    // Update chat header
    const chatAvatar = document.getElementById('messagesChatAvatar');
    const chatName = document.getElementById('messagesChatName');
    const chatStatus = document.getElementById('messagesChatStatus');
    
    if (chatAvatar) {
        const initial = friend.name ? friend.name.charAt(0).toUpperCase() : '?';
        applyProfileImage(chatAvatar, friend.photoURL, initial);
    }
    
    if (chatName) {
        chatName.textContent = friend.name || 'Unknown';
        // Add admin class if friend is admin
        const isFriendAdmin = friend.isAdmin === true || isAdminEmail(friend.email || '');
        chatName.classList.toggle('admin-name', isFriendAdmin === true);
    }
    
    // Check if friend is online (you can enhance this later)
    if (chatStatus) {
        chatStatus.textContent = 'Online'; // Can check from friendsActivityStatus
    }
    
    // Load messages for this conversation
    await loadConversationMessages(friendId);
    
    // Set up real-time listener
    setupMessageListener(friendId);
    
    // Re-render friends list to update unread indicators
    renderMessagesFriendsList();
}

// Create or get conversation ID (sorted user IDs to ensure consistency)
function getConversationId(userId1, userId2) {
    return [userId1, userId2].sort().join('_');
}

// Load messages for a conversation
async function loadConversationMessages(friendId) {
    if (!currentUser || !window.firebaseDb) return;
    
    const messagesEl = document.getElementById('messagesChatMessages');
    if (!messagesEl) return;
    
    // Show loading indicator
    messagesEl.innerHTML = `
        <div class="messages-loading-state">
            <div class="messages-loading-spinner"></div>
            <div class="messages-loading-text">Loading messages...</div>
        </div>
    `;
    
    try {
        const conversationId = getConversationId(currentUser.uid, friendId);
        
        // Query messages where current user is sender and friend is receiver, OR vice versa
        // This matches the security rules which check senderId/receiverId
        const sentMessagesQuery = window.firebaseDb.collection('messages')
            .where('senderId', '==', currentUser.uid)
            .where('receiverId', '==', friendId);
        
        const receivedMessagesQuery = window.firebaseDb.collection('messages')
            .where('senderId', '==', friendId)
            .where('receiverId', '==', currentUser.uid);
        
        // Execute both queries in parallel
        const [sentSnapshot, receivedSnapshot] = await Promise.all([
            sentMessagesQuery.get(),
            receivedMessagesQuery.get()
        ]);
        
        // Combine results
        const messages = [];
        sentSnapshot.forEach(doc => {
            messages.push({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt
            });
        });
        receivedSnapshot.forEach(doc => {
            messages.push({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt
            });
        });
        
        if (messages.length === 0) {
            messagesEl.innerHTML = `
                <div class="messages-empty-state">
                    <div class="empty-state-text">No messages yet. Start the conversation!</div>
                </div>
            `;
            return;
        }
        
        // Sort by createdAt (oldest first)
        messages.sort((a, b) => {
            const aTime = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
            const bTime = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
            return aTime.getTime() - bTime.getTime();
        });
        
        // Update last message time for this friend (only if newer)
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            const lastTime = lastMessage.createdAt?.toDate ? lastMessage.createdAt.toDate() : new Date(lastMessage.createdAt || 0);
            const messageTime = lastTime.getTime();
            const currentTime = lastMessageTimes[friendId] || 0;
            
            // Only update if this is newer (preserve order)
            if (messageTime > currentTime) {
                lastMessageTimes[friendId] = messageTime;
                saveMessageTimes(); // Persist the order
            }
            
            // Count unread messages (messages from friend that haven't been read)
            // Only count if chat is not currently open
            if (currentChatFriendId !== friendId) {
                const unreadMessages = messages.filter(msg => 
                    msg.senderId === friendId && 
                    msg.receiverId === currentUser.uid &&
                    (!msg.read || msg.read === false)
                );
                unreadMessageCounts[friendId] = unreadMessages.length;
                saveUnreadCounts(); // Persist unread counts
            } else {
                // Chat is open, clear unread count
                unreadMessageCounts[friendId] = 0;
                saveUnreadCounts(); // Persist cleared count
            }
        }
        
        renderMessages(messages);
        // Update friends list to show new sorting and indicators
        renderMessagesFriendsList();
        
    } catch (error) {
        console.error('Error loading messages:', error);
        messagesEl.innerHTML = '<div class="messages-empty-state"><div class="empty-state-text">Error loading messages</div></div>';
    }
}

// Render a single message (helper function for incremental updates)
function renderSingleMessage(message) {
    const isOwn = message.senderId === currentUser.uid;
    const timestamp = message.createdAt?.toDate ? message.createdAt.toDate() : new Date(message.createdAt || Date.now());
    const timeStr = formatMessageTime(timestamp);
    
    return `
        <div class="message-item ${isOwn ? 'message-own' : 'message-other'}" data-message-id="${message.id}">
            <div class="message-content">
                ${escapeHtml(message.text || '')}
            </div>
            <div class="message-time">${timeStr}</div>
        </div>
    `;
}

// Render messages in chat
function renderMessages(messages) {
    const messagesEl = document.getElementById('messagesChatMessages');
    if (!messagesEl) return;
    
    if (messages.length === 0) {
        messagesEl.innerHTML = `
            <div class="messages-empty-state">
                <div class="empty-state-text">No messages yet. Start the conversation!</div>
            </div>
        `;
        return;
    }
    
    // Store current scroll position to determine if user was at bottom
    const wasAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop <= messagesEl.clientHeight + 10;
    
    // Simply render all messages - no filtering by text, only by ID to prevent actual duplicates
    messagesEl.innerHTML = messages.map(message => {
        const isOwn = message.senderId === currentUser.uid;
        const timestamp = message.createdAt?.toDate ? message.createdAt.toDate() : new Date(message.createdAt || Date.now());
        const timeStr = formatMessageTime(timestamp);
        
        return `
            <div class="message-item ${isOwn ? 'message-own' : 'message-other'}" data-message-id="${message.id}">
                <div class="message-content">
                    ${escapeHtml(message.text || '')}
                </div>
                <div class="message-time">${timeStr}</div>
            </div>
        `;
    }).join('');
    
    // Scroll to bottom after DOM is updated
    // Use multiple methods to ensure it works
    const scrollToBottom = () => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    };
    
    // Try immediate scroll
    scrollToBottom();
    
    // Also use requestAnimationFrame to ensure layout is complete
    requestAnimationFrame(() => {
        scrollToBottom();
        // Double-check with a small delay to catch any late layout changes
        setTimeout(scrollToBottom, 10);
    });
}

// Format message time
function formatMessageTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    
    // Older than a week, show date
    return date.toLocaleDateString();
}

// Send a message
// Track if a message is currently being sent to prevent duplicates
let isSendingMessage = false;

async function sendMessage(friendId, text) {
    if (!currentUser || !window.firebaseDb) return;
    if (!text.trim()) return;
    
    // Prevent duplicate sends
    if (isSendingMessage) {
        console.log('Message already being sent, ignoring duplicate');
        return;
    }
    
    isSendingMessage = true;
    
    // Disable send button while sending
    const sendBtn = document.getElementById('messagesSendBtn');
    const chatInput = document.getElementById('messagesChatInput');
    if (sendBtn) sendBtn.disabled = true;
    if (chatInput) chatInput.disabled = true;
    
    try {
        const conversationId = getConversationId(currentUser.uid, friendId);
        
        const messageData = {
            conversationId: conversationId,
            senderId: currentUser.uid,
            receiverId: friendId,
            text: text.trim(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            read: false
        };
        
        await window.firebaseDb.collection('messages').add(messageData);
        
        // Clear input
        if (chatInput) chatInput.value = '';
        
        // Simple Snapchat behavior: Immediately update time and move to top
        const now = Date.now();
        lastMessageTimes[friendId] = now;
        saveMessageTimes(); // Persist the order
        
        // Update preview
        updateFriendPreview(friendId, text.trim());
        
        // Move friend to top immediately
        renderMessagesFriendsList();
        
        // The Firestore listener will handle adding the message to chat when it arrives
        // This prevents duplicate messages
        
    } catch (error) {
        console.error('Error sending message:', error);
        showGameMessage('❌', 'Error', 'Failed to send message. Please try again.');
    } finally {
        // Re-enable send button
        isSendingMessage = false;
        if (sendBtn) sendBtn.disabled = false;
        if (chatInput) chatInput.disabled = false;
    }
}

// Update friend preview with last message
function updateFriendPreview(friendId, text) {
    const previewEl = document.getElementById(`friendPreview_${friendId}`);
    if (previewEl) {
        previewEl.textContent = text.length > 50 ? text.substring(0, 50) + '...' : text;
    }
}

// Set up real-time listener for new messages
function setupMessageListener(friendId) {
    // Clean up previous listener
    if (messageListeners[friendId]) {
        messageListeners[friendId]();
        delete messageListeners[friendId];
    }
    
    if (!currentUser || !window.firebaseDb) return;
    
    // Listen for new messages where current user is sender or receiver
    // Use two listeners to match security rules
    let unsubscribeSent, unsubscribeReceived;
    
    // Listen to messages sent by current user to friend
    unsubscribeSent = window.firebaseDb.collection('messages')
        .where('senderId', '==', currentUser.uid)
        .where('receiverId', '==', friendId)
        .onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const message = {
                        id: change.doc.id,
                        ...change.doc.data()
                    };
                    
                    // Simple: Update time and move to top (Snapchat behavior)
                    const messageTime = message.createdAt?.toDate ? message.createdAt.toDate() : new Date(message.createdAt || 0);
                    lastMessageTimes[friendId] = messageTime.getTime();
                    saveMessageTimes(); // Persist the order
                    
                    // Update preview
                    if (message.text) {
                        updateFriendPreview(friendId, message.text);
                    }
                    
                    // Move friend to top
                    renderMessagesFriendsList();
                    
                    // Only update chat UI if chat is open with this friend
                    if (currentChatFriendId === friendId) {
                        const messagesEl = document.getElementById('messagesChatMessages');
                        if (messagesEl) {
                            // Check if message already exists in DOM by ID (to prevent duplicates)
                            const existingMessage = messagesEl.querySelector(`[data-message-id="${message.id}"]`);
                            if (existingMessage) {
                                return; // Already exists, skip
                            }
                            
                            // Remove empty state if present
                            const emptyStateEl = messagesEl.querySelector('.messages-empty-state');
                            if (emptyStateEl) emptyStateEl.remove();
                            
                            // Add the real message
                            const messageHTML = renderSingleMessage(message);
                            messagesEl.insertAdjacentHTML('beforeend', messageHTML);
                            
                            // Smooth scroll to bottom
                            requestAnimationFrame(() => {
                                messagesEl.scrollTop = messagesEl.scrollHeight;
                            });
                        }
                    }
                    // Preview and sorting already handled above
                }
            });
        }, error => {
            // Handle CORS/network errors gracefully - these are often temporary
            if (error.code === 'unavailable' || error.message?.includes('CORS') || error.message?.includes('network')) {
                console.warn('Firestore listener temporarily unavailable (network issue):', error.message);
            } else {
                console.error('Error listening to sent messages:', error);
            }
        });
    
    // Listen to messages received from friend
    unsubscribeReceived = window.firebaseDb.collection('messages')
        .where('senderId', '==', friendId)
        .where('receiverId', '==', currentUser.uid)
        .onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const message = {
                        id: change.doc.id,
                        ...change.doc.data()
                    };
                    
                    // Simple: Update time and move to top (Snapchat behavior)
                    const messageTime = message.createdAt?.toDate ? message.createdAt.toDate() : new Date(message.createdAt || 0);
                    lastMessageTimes[friendId] = messageTime.getTime();
                    saveMessageTimes(); // Persist the order
                    
                    // Update preview
                    if (message.text) {
                        updateFriendPreview(friendId, message.text);
                    }
                    
                    // Note: Unread count is handled by the global listener to prevent duplicates
                    // This per-conversation listener only handles UI updates for the specific conversation
                    if (currentChatFriendId === friendId) {
                        // Chat is open, mark message as read immediately (async, don't await)
                        const messageRef = window.firebaseDb.collection('messages').doc(message.id);
                        messageRef.update({ read: true }).catch(error => {
                            console.error('Error marking message as read:', error);
                        });
                        
                        // Add message to chat smoothly (don't reload everything)
                        const messagesEl = document.getElementById('messagesChatMessages');
                        if (messagesEl) {
                            // Check if message already exists (prevent duplicates)
                            const existingMessage = messagesEl.querySelector(`[data-message-id="${message.id}"]`);
                            if (!existingMessage) {
                                // Remove empty state if present
                                const emptyStateEl = messagesEl.querySelector('.messages-empty-state');
                                if (emptyStateEl) emptyStateEl.remove();
                                
                                // Add the new message to the bottom
                                const messageHTML = renderSingleMessage(message);
                                messagesEl.insertAdjacentHTML('beforeend', messageHTML);
                                
                                // Smooth scroll to bottom
                                requestAnimationFrame(() => {
                                    messagesEl.scrollTop = messagesEl.scrollHeight;
                                });
                            }
                        }
                    }
                    // Preview and sorting already handled above
                }
            });
        }, error => {
            // Handle CORS/network errors gracefully - these are often temporary
            if (error.code === 'unavailable' || error.message?.includes('CORS') || error.message?.includes('network')) {
                console.warn('Firestore listener temporarily unavailable (network issue):', error.message);
            } else {
                console.error('Error listening to received messages:', error);
            }
        });
    
    // Store both unsubscribers
    messageListeners[friendId] = () => {
        if (unsubscribeSent) unsubscribeSent();
        if (unsubscribeReceived) unsubscribeReceived();
    };
}

// Update messages notification badge in More menu
function updateMessagesNotificationBadge() {
    const badge = document.getElementById('messagesNotificationBadge');
    const moreTabBadge = document.getElementById('moreTabNotificationBadge');
    
    const totalUnread = Object.values(unreadMessageCounts).reduce((sum, count) => sum + count, 0);
    
    if (badge) {
        if (totalUnread > 0) {
            badge.style.display = 'flex';
            badge.textContent = totalUnread > 99 ? '99+' : totalUnread.toString();
        } else {
            badge.style.display = 'none';
        }
    }
    
    // Update More tab badge
    if (moreTabBadge) {
        if (totalUnread > 0) {
            moreTabBadge.style.display = 'flex';
            moreTabBadge.textContent = totalUnread > 99 ? '99+' : totalUnread.toString();
        } else {
            moreTabBadge.style.display = 'none';
        }
    }
}

// Load unread message counts for all friends
async function loadUnreadMessageCounts() {
    if (!currentUser || !window.firebaseDb) return;
    
    try {
        // Don't reset - use persisted data as base, then update from Firestore
        // This ensures indicators persist
        
        // Load all friends
        if (friendsForMessaging.length === 0) {
            await loadMessagesFriends();
        }
        
        // For each friend, check for unread messages
        for (const friend of friendsForMessaging) {
            try {
                // Get the most recent message where friend sent to current user
                const recentMessagesQuery = window.firebaseDb.collection('messages')
                    .where('senderId', '==', friend.id)
                    .where('receiverId', '==', currentUser.uid)
                    .limit(1);
                
                const snapshot = await recentMessagesQuery.get();
                
                if (!snapshot.empty) {
                    snapshot.forEach(doc => {
                        const message = doc.data();
                        const messageTime = message.createdAt?.toDate ? message.createdAt.toDate() : new Date(message.createdAt || 0);
                        const time = messageTime.getTime();
                        // Only update if newer than what we have (preserve order)
                        const currentTime = lastMessageTimes[friend.id] || 0;
                        if (time > currentTime) {
                            lastMessageTimes[friend.id] = time;
                        }
                    });
                }
                
                // Count unread messages (messages not read) - always check from Firestore
                // But preserve existing count if chat is currently open
                if (currentChatFriendId !== friend.id) {
                    // Count messages that haven't been marked as read
                    try {
                        const unreadQuery = window.firebaseDb.collection('messages')
                            .where('senderId', '==', friend.id)
                            .where('receiverId', '==', currentUser.uid)
                            .where('read', '==', false);
                        
                        const unreadSnapshot = await unreadQuery.get();
                        // Always update from Firestore - this is the source of truth
                        unreadMessageCounts[friend.id] = unreadSnapshot.size;
                    } catch (error) {
                        // If query fails (e.g., no index), check if we have a persisted count
                        if (unreadMessageCounts[friend.id] === undefined) {
                            // Check if there are any messages at all
                            if (!snapshot.empty) {
                                unreadMessageCounts[friend.id] = 1;
                            } else {
                                unreadMessageCounts[friend.id] = 0;
                            }
                        }
                        // Otherwise keep the persisted count
                    }
                } else {
                    // Chat is open, no unread messages
                    unreadMessageCounts[friend.id] = 0;
                }
            } catch (error) {
                console.error(`Error loading unread count for friend ${friend.id}:`, error);
            }
        }
        
        // Save updated counts
        saveUnreadCounts();
        
        // Update UI
        renderMessagesFriendsList();
        updateMessagesNotificationBadge();
    } catch (error) {
        console.error('Error loading unread message counts:', error);
    }
}

// Make openChatWithFriend globally available
window.openChatWithFriend = openChatWithFriend;


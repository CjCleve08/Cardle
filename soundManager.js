// Sound Manager - Generates sounds using Web Audio API
class SoundManager {
    constructor() {
        this.audioContext = null;
        // Load saved volumes from localStorage or use defaults
        const savedMasterVolume = localStorage.getItem('soundEffectsVolume');
        const savedMusicVolume = localStorage.getItem('musicVolume');
        this.masterVolume = savedMasterVolume !== null ? parseInt(savedMasterVolume) / 100 : 0.3; // Overall volume (0.0 to 1.0)
        this.musicVolume = savedMusicVolume !== null ? parseInt(savedMusicVolume) / 100 : 0.4; // Music volume (0.0 to 1.0)
        this.enabled = true;
        this.backgroundMusic = null;
        this.musicEnabled = true;
        this.initAudioContext();
    }

    initAudioContext() {
        try {
            // Create audio context (works in most modern browsers)
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('Web Audio API not supported:', e);
            this.enabled = false;
        }
    }

    // Ensure audio context is running (required for Chrome autoplay policy)
    ensureAudioContext() {
        if (!this.enabled || !this.audioContext) return;
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    // Play a tone with specified parameters
    playTone(frequency, duration, type = 'sine', volume = 1, fadeOut = true) {
        if (!this.enabled || !this.audioContext) return;
        
        // Don't play if master volume is 0
        if (this.masterVolume <= 0) return;

        this.ensureAudioContext();

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);

        // Volume envelope
        const vol = volume * this.masterVolume;
        // Ensure volume is truly 0 if master volume is 0
        if (vol <= 0) {
            gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        } else {
            if (fadeOut) {
                gainNode.gain.setValueAtTime(vol, this.audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
            } else {
                gainNode.gain.setValueAtTime(vol, this.audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration * 0.1);
            }
        }

        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + duration);
    }

    // Play a chord (multiple frequencies)
    playChord(frequencies, duration, type = 'sine', volume = 0.6) {
        if (!this.enabled || !this.audioContext || this.masterVolume <= 0) return;
        frequencies.forEach(freq => {
            this.playTone(freq, duration, type, volume / frequencies.length, true);
        });
    }

    // UI Sounds
    playHoverSound() {
        this.playTone(400, 0.08, 'sine', 0.4, false);
    }

    playClickSound() {
        this.playTone(600, 0.1, 'square', 0.5, false);
    }

    playButtonClick() {
        // Short, snappy click
        this.playTone(800, 0.05, 'square', 0.6, false);
    }

    // Card Sounds
    playCardSelect() {
        // Ascending melody
        this.playTone(523.25, 0.1, 'sine', 0.6, false); // C5
        setTimeout(() => this.playTone(659.25, 0.1, 'sine', 0.5, false), 50); // E5
    }

    playCardHover() {
        this.playTone(440, 0.06, 'sine', 0.3, false); // A4
    }

    // Letter/Input Sounds
    playLetterType() {
        // Quick, soft tone
        this.playTone(700, 0.03, 'sine', 0.3, false);
    }

    playLetterDelete() {
        // Lower, shorter tone
        this.playTone(400, 0.04, 'square', 0.3, false);
    }

    playWordSubmit() {
        // Brief ascending notes
        this.playTone(523.25, 0.08, 'sine', 0.5, false); // C5
        setTimeout(() => this.playTone(659.25, 0.08, 'sine', 0.5, false), 60); // E5
        setTimeout(() => this.playTone(783.99, 0.08, 'sine', 0.5, false), 120); // G5
    }

    // Feedback Sounds
    playCorrectLetter() {
        // Pleasant chime
        this.playTone(783.99, 0.15, 'sine', 0.6, true); // G5
        setTimeout(() => this.playTone(987.77, 0.15, 'sine', 0.5, true), 80); // B5
    }

    playWrongLetter() {
        // Lower, duller tone
        this.playTone(350, 0.2, 'square', 0.5, true);
    }

    playPresentLetter() {
        // Medium tone (yellow feedback)
        this.playTone(554.37, 0.15, 'sine', 0.5, true); // C#5
    }

    playCorrectWord() {
        // Victory chord
        this.playChord([523.25, 659.25, 783.99], 0.4, 'sine', 0.7); // C major chord
    }

    playWrongWord() {
        // Descending, sad tone
        this.playTone(440, 0.2, 'sine', 0.5, true); // A4
        setTimeout(() => this.playTone(349.23, 0.2, 'sine', 0.4, true), 150); // F4
    }

    // Game Event Sounds
    playMatchFound() {
        // Exciting ascending melody
        this.playTone(523.25, 0.15, 'sine', 0.6, false); // C5
        setTimeout(() => this.playTone(659.25, 0.15, 'sine', 0.6, false), 120); // E5
        setTimeout(() => this.playTone(783.99, 0.15, 'sine', 0.6, false), 240); // G5
        setTimeout(() => this.playTone(987.77, 0.2, 'sine', 0.7, true), 360); // B5
    }

    playGameStart() {
        // Fanfare
        this.playChord([523.25, 659.25, 783.99, 987.77], 0.5, 'sine', 0.8);
    }

    playGameWin() {
        // Victory fanfare
        const notes = [523.25, 659.25, 783.99, 1046.50, 783.99, 1046.50]; // C-E-G-C-G-C
        notes.forEach((note, index) => {
            setTimeout(() => {
                this.playTone(note, 0.2, 'sine', 0.7, index === notes.length - 1);
            }, index * 150);
        });
    }

    playGameLose() {
        // Descending, sad melody
        const notes = [659.25, 587.33, 523.25, 493.88]; // E-D-C-B
        notes.forEach((note, index) => {
            setTimeout(() => {
                this.playTone(note, 0.25, 'sine', 0.6, index === notes.length - 1);
            }, index * 200);
        });
    }

    playTurnChange() {
        // Quick, alerting sound
        this.playTone(880, 0.1, 'sine', 0.5, false); // A5
    }

    playTimerWarning() {
        // Urgent, repetitive sound
        this.playTone(600, 0.1, 'square', 0.6, false);
    }

    // Card Effect Sounds
    playCardEffect(type) {
        switch(type) {
            case 'help':
                // Positive, uplifting
                this.playChord([523.25, 659.25], 0.2, 'sine', 0.6);
                break;
            case 'hurt':
                // Negative, lower tone
                this.playTone(350, 0.2, 'square', 0.5, true);
                break;
            case 'special':
                // Sparkly, magical
                this.playTone(1046.50, 0.15, 'sine', 0.5, true); // C6
                setTimeout(() => this.playTone(1318.51, 0.15, 'sine', 0.4, true), 80); // E6
                break;
            default:
                this.playTone(600, 0.1, 'sine', 0.4, false);
        }
    }

    // Chat Sounds
    playChatMessage() {
        this.playTone(600, 0.05, 'sine', 0.3, false);
    }

    playChatSend() {
        this.playTone(700, 0.06, 'sine', 0.4, false);
    }

    // Notification Sounds
    playNotification() {
        this.playTone(880, 0.15, 'sine', 0.5, false); // A5
        setTimeout(() => this.playTone(1046.50, 0.15, 'sine', 0.5, false), 100); // C6
    }

    playError() {
        // Low, warning tone
        this.playTone(300, 0.3, 'square', 0.6, true);
    }

    playSuccess() {
        // Pleasant confirmation
        this.playTone(659.25, 0.2, 'sine', 0.6, true); // E5
    }

    // Background Music
    playBackgroundMusic(filename = 'GameSoundTrack.mp4') {
        if (!this.musicEnabled) return;
        
        // Stop any existing music
        this.stopBackgroundMusic();
        
        // Create audio element for background music
        this.backgroundMusic = new Audio(`Sounds/Music/${filename}`);
        this.backgroundMusic.loop = true;
        this.backgroundMusic.volume = 0; // Start at 0 for fade in
        this.backgroundMusic.preload = 'auto';
        
        // Add error handling for debugging
        this.backgroundMusic.addEventListener('error', (e) => {
            console.error('Error loading background music:', filename, e);
            console.error('Audio error details:', {
                code: this.backgroundMusic.error?.code,
                message: this.backgroundMusic.error?.message,
                path: `Sounds/Music/${filename}`
            });
        });
        
        // Fade durations (in seconds)
        const fadeInDuration = 2;
        const fadeOutDuration = 3;
        
        // Get track duration and set up fade logic when metadata loads
        this.backgroundMusic.addEventListener('loadedmetadata', () => {
            const musicDuration = this.backgroundMusic.duration;
            
            // Handle fade in/out and looping
            const updateVolume = () => {
                if (!this.backgroundMusic || !this.musicEnabled || musicDuration === 0 || isNaN(musicDuration)) return;
                
                const currentTime = this.backgroundMusic.currentTime;
                const timeRemaining = musicDuration - currentTime;
                
                // Fade out before the end (last fadeOutDuration seconds)
                if (timeRemaining <= fadeOutDuration && timeRemaining > 0) {
                    const fadeOutProgress = timeRemaining / fadeOutDuration;
                    this.backgroundMusic.volume = Math.max(0, fadeOutProgress * this.musicVolume);
                }
                // Fade in at the start or after loop (first fadeInDuration seconds)
                else if (currentTime < fadeInDuration) {
                    const fadeInProgress = currentTime / fadeInDuration;
                    this.backgroundMusic.volume = Math.min(this.musicVolume, fadeInProgress * this.musicVolume);
                }
                // Maintain full volume in the middle
                else {
                    this.backgroundMusic.volume = this.musicVolume;
                }
            };
            
            // Update volume on timeupdate for smooth fades
            this.backgroundMusic.addEventListener('timeupdate', updateVolume);
        });
        
        // Handle autoplay policy - try to play, but don't fail if blocked
        const playPromise = this.backgroundMusic.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.log('Background music autoplay prevented (will play on user interaction):', error);
                // Music will play on first user interaction via initSoundOnInteraction
            });
        }
        
        // Also ensure audio context is ready
        this.ensureAudioContext();
    }
    
    // Play lobby music
    playLobbyMusic(filename = 'LobbySoundTrack.mp4') {
        this.playBackgroundMusic(filename);
    }

    // Play intro music (non-looping)
    playIntroMusic(filename = 'IntroSoundTrack.mp4') {
        if (!this.musicEnabled) return;
        
        // Stop any existing music
        this.stopBackgroundMusic();
        
        // Create audio element for intro music
        this.backgroundMusic = new Audio(`Sounds/Music/${filename}`);
        this.backgroundMusic.loop = false; // Don't loop intro music
        this.backgroundMusic.volume = 0; // Start at 0 for fade in
        this.backgroundMusic.preload = 'auto';
        
        // Add error handling for debugging
        this.backgroundMusic.addEventListener('error', (e) => {
            console.error('Error loading intro music:', filename, e);
            console.error('Audio error details:', {
                code: this.backgroundMusic.error?.code,
                message: this.backgroundMusic.error?.message,
                path: `Sounds/Music/${filename}`
            });
        });
        
        // Fade in duration (in seconds)
        const fadeInDuration = 1;
        
        // Fade in when metadata loads
        this.backgroundMusic.addEventListener('loadedmetadata', () => {
            const updateVolume = () => {
                if (!this.backgroundMusic || !this.musicEnabled) return;
                
                const currentTime = this.backgroundMusic.currentTime;
                
                // Fade in at the start (first fadeInDuration seconds)
                if (currentTime < fadeInDuration) {
                    const fadeInProgress = currentTime / fadeInDuration;
                    this.backgroundMusic.volume = Math.min(this.musicVolume, fadeInProgress * this.musicVolume);
                } else {
                    // Maintain full volume after fade in
                    this.backgroundMusic.volume = this.musicVolume;
                }
            };
            
            // Update volume on timeupdate for smooth fade
            this.backgroundMusic.addEventListener('timeupdate', updateVolume);
        });
        
        // Handle autoplay policy - try to play, but don't fail if blocked
        const playPromise = this.backgroundMusic.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.log('Intro music autoplay prevented (will play on user interaction):', error);
                // Music will play on first user interaction via initSoundOnInteraction
            });
        }
        
        // Also ensure audio context is ready
        this.ensureAudioContext();
    }

    stopBackgroundMusic() {
        if (this.backgroundMusic) {
            this.backgroundMusic.pause();
            this.backgroundMusic.currentTime = 0;
            this.backgroundMusic = null;
        }
    }

    setMusicVolume(volume) {
        this.musicVolume = Math.max(0, Math.min(1, volume));
        // Note: Volume is managed by the fade logic, but we update the base volume
        // The fade logic will use this.musicVolume when calculating fades
    }

    toggleMusic() {
        this.musicEnabled = !this.musicEnabled;
        if (!this.musicEnabled) {
            this.stopBackgroundMusic();
        } else if (this.backgroundMusic) {
            // Resume if music was playing
            this.backgroundMusic.play().catch(error => {
                console.log('Could not resume music:', error);
            });
        }
        return this.musicEnabled;
    }

    // Settings
    setVolume(volume) {
        this.masterVolume = Math.max(0, Math.min(1, volume));
    }

    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }
}

// Create global sound manager instance
const soundManager = new SoundManager();


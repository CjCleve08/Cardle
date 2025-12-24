const socket = io();

let currentPlayer = null;
let gameState = null;
let selectedCard = null;
let currentRow = 0;
let currentGuess = '';

// DOM Elements
const screens = {
    lobby: document.getElementById('lobby'),
    waiting: document.getElementById('waiting'),
    game: document.getElementById('game'),
    gameOver: document.getElementById('gameOver')
};

// Socket Events
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('gameCreated', (data) => {
    currentPlayer = data.playerId;
    // Show game ID in both lobby and waiting screens
    document.getElementById('gameId').textContent = data.gameId;
    document.getElementById('gameIdDisplay').style.display = 'block';
    document.getElementById('gameIdWaiting').textContent = data.gameId;
    document.getElementById('gameIdDisplayWaiting').style.display = 'block';
    showScreen('waiting');
});

socket.on('playerJoined', (data) => {
    updatePlayersList(data.players);
    if (data.players.length === 2) {
        document.getElementById('waitingMessage').textContent = 'Starting game...';
    }
});

socket.on('gameStarted', (data) => {
    gameState = data;
    showScreen('game');
    initializeGame(data);
});

socket.on('cardSelected', (data) => {
    if (data.playerId === currentPlayer) {
        selectedCard = data.card;
        hideCardSelection();
        showGameBoard();
    }
});

socket.on('turnChanged', (data) => {
    gameState = data;
    updateTurnIndicator();
    updatePlayerStatus();
    if (data.currentTurn === currentPlayer) {
        // It's my turn - show card selection and enable input
        showCardSelection();
        showGameBoard();
        document.getElementById('wordInput').disabled = false;
        document.getElementById('wordInput').value = '';
        selectedCard = null; // Reset selected card for new turn
    } else {
        // It's opponent's turn - hide card selection, disable input
        hideCardSelection();
        showGameBoard();
        document.getElementById('wordInput').disabled = true;
        document.getElementById('wordInput').value = '';
    }
});

socket.on('guessSubmitted', (data) => {
    if (data.playerId === currentPlayer) {
        // This is my guess - always show real feedback
        displayGuess(data.guess, data.feedback, data.row);
        updateKeyboard({ guess: data.guess, feedback: data.feedback });
    } else {
        // This is opponent's guess
        if (data.hidden || !data.guess) {
            // Guess is hidden
            displayOpponentGuessHidden(data.row);
        } else if (!data.feedback) {
            // Feedback is hidden but guess is visible
            displayOpponentGuess(data.guess, null, data.row);
        } else {
            // Both guess and feedback are visible
            displayOpponentGuess(data.guess, data.feedback, data.row);
            updateKeyboard({ guess: data.guess, feedback: data.feedback });
        }
    }
    // Don't increment currentRow here - it's managed by the server via data.row
});

socket.on('gameOver', (data) => {
    showScreen('gameOver');
    if (data.winner === currentPlayer) {
        document.getElementById('gameOverTitle').textContent = 'You Win!';
        document.getElementById('gameOverMessage').textContent = `Congratulations! You guessed the word "${data.word}"!`;
    } else {
        document.getElementById('gameOverTitle').textContent = 'You Lost!';
        document.getElementById('gameOverMessage').textContent = `The word was "${data.word}". Better luck next time!`;
    }
});

socket.on('error', (data) => {
    alert(data.message);
});

socket.on('cardPlayed', (data) => {
    // Show splash for both players when a card is played
    console.log('Card played event received:', data);
    if (data && data.card) {
        showCardSplash(data.card, data.playerName);
    }
});

// UI Functions
function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    screens[screenName].classList.add('active');
}

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
    createBoard();
    createKeyboard();
    updateTurnIndicator();
    updatePlayerStatus();
    
    if (data.currentTurn === currentPlayer) {
        // It's my turn - show card selection and enable input
        showCardSelection();
        showGameBoard();
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
    
    for (let i = 0; i < 6; i++) {
        const row = document.createElement('div');
        row.className = 'board-row';
        row.id = `row-${i}`;
        
        for (let j = 0; j < 5; j++) {
            const cell = document.createElement('div');
            cell.className = 'board-cell';
            cell.id = `cell-${i}-${j}`;
            row.appendChild(cell);
        }
        
        container.appendChild(row);
    }
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
    document.getElementById('cardSelection').style.display = 'flex';
    generateCards();
}

function hideCardSelection() {
    document.getElementById('cardSelection').style.display = 'none';
}

function showGameBoard() {
    document.getElementById('gameBoard').style.display = 'block';
}

function generateCards() {
    const container = document.getElementById('cardsContainer');
    container.innerHTML = '';
    
    const allCards = [
        {
            id: 'falseFeedback',
            title: 'False Feedback',
            description: 'Next word your opponent guesses will show incorrect feedback',
            type: 'hurt'
        },
        {
            id: 'hiddenFeedback',
            title: 'Hidden Feedback',
            description: 'Next word you guess will only show feedback to you',
            type: 'help'
        },
        {
            id: 'hiddenGuess',
            title: 'Hidden Guess',
            description: 'Your next guess will be hidden from your opponent',
            type: 'help'
        }
    ];
    
    // Shuffle and pick 3 random cards (all 3 will be shown since we only have 3)
    const shuffled = allCards.sort(() => Math.random() - 0.5);
    const selectedCards = shuffled;
    
    selectedCards.forEach((card, index) => {
        const cardElement = document.createElement('div');
        cardElement.className = 'card';
        cardElement.innerHTML = `
            <div class="card-title">${card.title}</div>
            <div class="card-description">${card.description}</div>
        `;
        cardElement.onclick = () => selectCard(card, cardElement);
        container.appendChild(cardElement);
    });
}

function selectCard(card, cardElement) {
    selectedCard = card;
    document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
    cardElement.classList.add('selected');
    
    console.log('Selecting card:', card);
    
    socket.emit('selectCard', {
        gameId: gameState.gameId,
        playerId: currentPlayer,
        card: card
    });
    
    // Show splash immediately for the player who selected
    showCardSplash(card, 'You');
    
    // Enable input after card selection
    setTimeout(() => {
        document.getElementById('wordInput').disabled = false;
        document.getElementById('wordInput').focus();
    }, 100);
}

function updateTurnIndicator() {
    const indicator = document.getElementById('turnIndicator');
    if (gameState.currentTurn === currentPlayer) {
        indicator.textContent = 'Your Turn - Choose a card, then guess!';
        indicator.classList.add('active-turn');
    } else {
        indicator.textContent = "Opponent's Turn - Waiting...";
        indicator.classList.remove('active-turn');
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
    } else if (key.length === 1 && /[A-Z]/.test(key)) {
        if (input.value.length < 5) {
            input.value += key;
            currentGuess = input.value.toUpperCase();
        }
    }
}

function displayGuess(guess, feedback, row) {
    // First, fill in the letters
    for (let i = 0; i < 5; i++) {
        const cell = document.getElementById(`cell-${row}-${i}`);
        cell.textContent = guess[i];
        cell.classList.add('filled');
    }
    
    // Then animate the feedback with a delay (like Wordle)
    setTimeout(() => {
        for (let i = 0; i < 5; i++) {
            const cell = document.getElementById(`cell-${row}-${i}`);
            setTimeout(() => {
                if (feedback[i] === 'correct') {
                    cell.classList.add('correct');
                } else if (feedback[i] === 'present') {
                    cell.classList.add('present');
                } else {
                    cell.classList.add('absent');
                }
            }, i * 150); // Stagger the animations
        }
    }, 200);
}

function displayOpponentGuess(guess, feedback, row) {
    if (!guess) {
        displayOpponentGuessHidden(row);
        return;
    }
    
    // First, fill in the letters
    for (let i = 0; i < 5; i++) {
        const cell = document.getElementById(`cell-${row}-${i}`);
        cell.textContent = guess[i];
        cell.classList.add('filled');
    }
    
    // Then animate the feedback with a delay
    setTimeout(() => {
        for (let i = 0; i < 5; i++) {
            const cell = document.getElementById(`cell-${row}-${i}`);
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
    }, 200);
}

function displayOpponentGuessHidden(row) {
    for (let i = 0; i < 5; i++) {
        const cell = document.getElementById(`cell-${row}-${i}`);
        cell.textContent = '?';
        cell.classList.add('filled', 'absent');
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
document.getElementById('createGameBtn').addEventListener('click', () => {
    const name = document.getElementById('playerName').value.trim();
    if (name) {
        socket.emit('createGame', { playerName: name });
    } else {
        alert('Please enter your name');
    }
});

document.getElementById('joinGameBtn').addEventListener('click', () => {
    document.getElementById('joinGroup').style.display = 'block';
});

document.getElementById('joinWithIdBtn').addEventListener('click', () => {
    const name = document.getElementById('playerName').value.trim();
    const gameId = document.getElementById('gameIdInput').value.trim();
    if (name && gameId) {
        socket.emit('joinGame', { playerName: name, gameId: gameId });
    } else {
        alert('Please enter your name and game ID');
    }
});

document.getElementById('submitBtn').addEventListener('click', submitGuess);

document.getElementById('wordInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        submitGuess();
    }
});

document.getElementById('wordInput').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
    currentGuess = e.target.value;
});

document.getElementById('playAgainBtn').addEventListener('click', () => {
    location.reload();
});

// Keyboard input handling
document.addEventListener('keydown', (e) => {
    if (screens.game.classList.contains('active')) {
        const input = document.getElementById('wordInput');
        if (e.key === 'Backspace') {
            handleKeyPress('BACKSPACE');
        } else if (e.key.length === 1 && /[A-Za-z]/.test(e.key)) {
            handleKeyPress(e.key.toUpperCase());
        }
    }
});

function submitGuess() {
    if (gameState.currentTurn !== currentPlayer) {
        alert("It's not your turn!");
        return;
    }
    
    if (!selectedCard) {
        alert('Please select a card first!');
        return;
    }
    
    const guess = document.getElementById('wordInput').value.toUpperCase();
    
    if (guess.length !== 5) {
        alert('Please enter a 5-letter word');
        return;
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
}


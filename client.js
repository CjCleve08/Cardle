const socket = io();

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
let hideCardActive = false; // Track if hideCard was just used
let currentRow = 0;
let currentGuess = '';

// All available cards in the deck
const ALL_CARDS = [
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
    },
    {
        id: 'extraGuess',
        title: 'Extra Turn',
        description: 'Get an additional turn immediately after this one',
        type: 'help'
    },
    {
        id: 'hideCard',
        title: 'Hide Card',
        description: 'Play another card secretly - your opponent won\'t know which one',
        type: 'help'
    }
];

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

socket.on('gameStarted', (data) => {
    console.log('Game started event received:', data);
    
    // Set currentPlayer from the event if not already set
    if (data.yourPlayerId) {
        currentPlayer = data.yourPlayerId;
        console.log('Set currentPlayer from gameStarted:', currentPlayer);
    }
    
    console.log('My player ID:', currentPlayer);
    
    // Remove yourPlayerId from data before storing in gameState
    const { yourPlayerId, ...gameStateData } = data;
    gameState = gameStateData;
    showScreen('game');
    initializeGame(gameState);
});

socket.on('cardSelected', (data) => {
    if (data.playerId === currentPlayer) {
        selectedCard = data.card;
        
        // If hideCard was used, allow second card selection
        if (data.allowSecondCard) {
            hideCardActive = true; // Set flag that hideCard is active
            // Don't hide card selection - show it again for second card
            setTimeout(() => {
                showCardSelection();
            }, 100);
        } else {
            // Normal card selection - hide selection and show board
            hideCardActive = false; // Clear flag
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
    
    updateTurnIndicator();
    updatePlayerStatus();
    
    // Convert both to strings for comparison to avoid type issues
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
    
    // Always show game board so players can see previous guesses
    showGameBoard();
    
    if (myTurn) {
        // It's my turn - show card selection and enable input
        console.log('✓ Showing card selection for my turn');
        showCardSelection();
        document.getElementById('wordInput').disabled = false;
        document.getElementById('wordInput').value = '';
        selectedCard = null; // Reset selected card for new turn
        hideCardActive = false; // Reset hideCard flag
        // Focus input after a short delay to ensure card selection is visible
        setTimeout(() => {
            document.getElementById('wordInput').focus();
        }, 100);
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
        // This is my guess - always show real feedback
        displayGuess(data.guess, data.feedback, data.row);
        updateKeyboard({ guess: data.guess, feedback: data.feedback });
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

socket.on('gameOver', (data) => {
    showScreen('gameOver');
    const titleEl = document.getElementById('gameOverTitle');
    const messageEl = document.getElementById('gameOverMessage');
    const iconEl = document.getElementById('gameOverIcon');
    const wordEl = document.getElementById('gameOverWord');
    
    if (data.winner === currentPlayer) {
        titleEl.textContent = 'You Win!';
        titleEl.classList.add('win');
        titleEl.classList.remove('lose');
        messageEl.textContent = 'Congratulations! You guessed the word!';
        iconEl.textContent = '🎉';
        wordEl.textContent = data.word;
    } else {
        titleEl.textContent = 'You Lost!';
        titleEl.classList.add('lose');
        titleEl.classList.remove('win');
        messageEl.textContent = 'Better luck next time! The word was:';
        iconEl.textContent = '😔';
        wordEl.textContent = data.word;
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
    // Reset card hand for new game
    window.playerCardHand = [];
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
        generateCards();
        console.log('Card selection shown');
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

function generateCards() {
    const container = document.getElementById('cardsContainer');
    container.innerHTML = '';
    
    // Get or initialize player's card hand
    if (!window.playerCardHand) {
        window.playerCardHand = [];
    }
    
    // If hand is empty or has less than 3 cards, refill from deck
    if (window.playerCardHand.length < 3) {
        // Shuffle all cards and add to hand
        const shuffled = [...ALL_CARDS].sort(() => Math.random() - 0.5);
        window.playerCardHand = shuffled.slice(0, 3);
    }
    
    // If hideCard is active, filter out hideCard from available cards
    let availableCards = window.playerCardHand.slice(0, 3);
    if (hideCardActive) {
        availableCards = availableCards.filter(c => c.id !== 'hideCard');
        // If we filtered out a card and have less than 3, add a replacement
        if (availableCards.length < 3) {
            const allNonHideCards = ALL_CARDS.filter(c => 
                c.id !== 'hideCard' && 
                !window.playerCardHand.some(handCard => handCard.id === c.id)
            );
            if (allNonHideCards.length > 0) {
                const replacementCard = allNonHideCards[Math.floor(Math.random() * allNonHideCards.length)];
                availableCards.push(replacementCard);
            }
        }
    }
    
    // Show available cards (up to 3)
    const selectedCards = availableCards.slice(0, 3);
    
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
    
    // Check if this is the second card after hideCard was used
    const isSecondCardAfterHide = hideCardActive;
    
    socket.emit('selectCard', {
        gameId: gameState.gameId,
        playerId: currentPlayer,
        card: card,
        hidden: isSecondCardAfterHide // Mark as hidden if this is the second card after hideCard
    });
    
    // Remove the selected card from hand and add a new random card
    // (Do this for both hideCard and the second card)
    if (window.playerCardHand) {
        const cardIndex = window.playerCardHand.findIndex(c => c.id === card.id);
        if (cardIndex !== -1) {
            window.playerCardHand.splice(cardIndex, 1);
            
            // Get a random card that's not already in hand
            // If hideCard is active, exclude hideCard from replacements
            let availableCards = ALL_CARDS.filter(c => 
                !window.playerCardHand.some(handCard => handCard.id === c.id)
            );
            
            // If hideCard is active, don't allow hideCard as replacement
            if (hideCardActive) {
                availableCards = availableCards.filter(c => c.id !== 'hideCard');
            }
            
            if (availableCards.length > 0) {
                const newCard = availableCards[Math.floor(Math.random() * availableCards.length)];
                window.playerCardHand.push(newCard);
            } else {
                // Fallback: pick from all cards (excluding hideCard if active)
                const fallbackCards = hideCardActive 
                    ? ALL_CARDS.filter(c => c.id !== 'hideCard')
                    : ALL_CARDS;
                if (fallbackCards.length > 0) {
                    const newCard = fallbackCards[Math.floor(Math.random() * fallbackCards.length)];
                    window.playerCardHand.push(newCard);
                }
            }
        }
    }
    
    // Show splash for hideCard or if it's not a hidden selection
    if (card.id === 'hideCard' || !isSecondCardAfterHide) {
        showCardSplash(card, 'You');
    }
    
    // If hideCard was selected, wait for server to allow second card selection
    // Otherwise, hide card selection and show game board
    if (card.id === 'hideCard') {
        // hideCardActive will be set by the cardSelected event handler
        // Don't hide selection yet - wait for second card
    } else {
        // Clear hideCard flag if it was active
        hideCardActive = false;
        setTimeout(() => {
            hideCardSelection();
            showGameBoard();
            document.getElementById('wordInput').disabled = false;
            document.getElementById('wordInput').focus();
        }, 100);
    }
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
    
    // Then animate the feedback with a delay (like Wordle)
    setTimeout(() => {
        for (let i = 0; i < 5; i++) {
            const cell = document.getElementById(`cell-${row}-${i}`);
            if (cell) {
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
    
    // Can't submit if hideCard is selected (need to select second card)
    if (selectedCard && selectedCard.id === 'hideCard') {
        alert('Please select a second card after using Hide Card!');
        return;
    }
    
    // Can't submit if hideCard is active but no second card selected yet
    if (hideCardActive && (!selectedCard || selectedCard.id === 'hideCard')) {
        alert('Please select a second card after using Hide Card!');
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
    hideCardActive = false; // Reset hideCard flag after submitting
}


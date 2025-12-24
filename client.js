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
        cardChainActive = false; // Reset card chain flag
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
        const shuffled = [...getAllCards()].sort(() => Math.random() - 0.5);
        window.playerCardHand = shuffled.slice(0, 3);
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
        
        // If we filtered out cards and have less than 3, add replacements
        if (availableCards.length < 3) {
            const allNonChainCards = getAllCards().filter(c => 
                !cardsInChain.includes(c.id) && 
                !window.playerCardHand.some(handCard => handCard.id === c.id)
            );
            while (availableCards.length < 3 && allNonChainCards.length > 0) {
                const replacementCard = allNonChainCards.splice(
                    Math.floor(Math.random() * allNonChainCards.length), 
                    1
                )[0];
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
    
    // Remove the selected card from hand and add a new random card
    // (Do this for both hideCard and the second card)
    if (window.playerCardHand) {
        const cardIndex = window.playerCardHand.findIndex(c => c.id === card.id);
        if (cardIndex !== -1) {
            window.playerCardHand.splice(cardIndex, 1);
            
            // Get a random card that's not already in hand
            // If we're in a card chain, exclude modifier cards already in chain
            let availableCards = getAllCards().filter(c => 
                !window.playerCardHand.some(handCard => handCard.id === c.id)
            );
            
            // If in a chain, don't allow modifier cards that are already in the chain
            if (cardChainActive && selectedCard) {
                const cardsInChain = [];
                if (isModifierCard(selectedCard.id)) {
                    cardsInChain.push(selectedCard.id);
                }
                availableCards = availableCards.filter(c => 
                    !isModifierCard(c.id) || !cardsInChain.includes(c.id)
                );
            }
            
            if (availableCards.length > 0) {
                const newCard = availableCards[Math.floor(Math.random() * availableCards.length)];
                window.playerCardHand.push(newCard);
            } else {
                // Fallback: pick from all cards (excluding modifier cards in chain if active)
                let fallbackCards = getAllCards();
                if (cardChainActive && selectedCard) {
                    if (isModifierCard(selectedCard.id)) {
                        fallbackCards = fallbackCards.filter(c => c.id !== selectedCard.id);
                    }
                }
                if (fallbackCards.length > 0) {
                    const newCard = fallbackCards[Math.floor(Math.random() * fallbackCards.length)];
                    window.playerCardHand.push(newCard);
                }
            }
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
    
    // Can't submit if we're in a card chain (modifier card selected but no final card)
    if (cardChainActive && selectedCard && isModifierCard(selectedCard.id)) {
        alert('Please select a final card to complete the chain!');
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
    cardChainActive = false; // Reset card chain flag after submitting
}


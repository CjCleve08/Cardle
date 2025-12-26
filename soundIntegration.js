// Sound Integration - Adds sound effects to all game interactions

// Initialize sounds on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Add hover sounds to all buttons
    document.querySelectorAll('.btn, button').forEach(button => {
        button.addEventListener('mouseenter', () => {
            if (typeof soundManager !== 'undefined') {
                soundManager.playHoverSound();
            }
        });
    });

    // Add click sounds to all buttons (generic)
    document.querySelectorAll('.btn, button').forEach(button => {
        button.addEventListener('click', (e) => {
            if (typeof soundManager !== 'undefined' && !button.disabled) {
                soundManager.playButtonClick();
            }
        });
    });
});

// Helper function to add sound to specific button
function addSoundToButton(buttonId, soundFunction) {
    const button = document.getElementById(buttonId);
    if (button && typeof soundManager !== 'undefined') {
        button.addEventListener('click', () => {
            soundFunction();
        });
    }
}

// Helper function to add hover sound to specific element
function addHoverSound(element, soundFunction) {
    if (element && typeof soundManager !== 'undefined') {
        element.addEventListener('mouseenter', () => {
            soundFunction();
        });
    }
}


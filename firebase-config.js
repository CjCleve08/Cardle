// Firebase Configuration
// TODO: Replace these values with your Firebase project configuration
// Get these from: https://console.firebase.google.com/ > Project Settings > General > Your apps
// See FIREBASE_SETUP.md for detailed instructions

const firebaseConfig = {
    apiKey: "AIzaSyDivACma1IDTFlg56obV-OpdzTHbW_CDqc",
    authDomain: "cardle-8cb0d.firebaseapp.com",
    projectId: "cardle-8cb0d",
    storageBucket: "cardle-8cb0d.firebasestorage.app",
    messagingSenderId: "154238063050",
    appId: "1:154238063050:web:aaf7b303818f0bd311ff33",
    measurementId: "G-8V1JR764S1"
  };

// Check if Firebase is loaded before initializing
if (typeof firebase !== 'undefined') {
    try {
        // Initialize Firebase
        firebase.initializeApp(firebaseConfig);
        
        // Initialize Firebase services
        const auth = firebase.auth();
        const db = firebase.firestore();
        
        // Make Firebase services available globally
        window.firebaseAuth = auth;
        window.firebaseDb = db;
        
        console.log('Firebase initialized successfully');
    } catch (error) {
        console.error('Error initializing Firebase:', error);
    }
} else {
    console.error('Firebase SDK not loaded. Make sure Firebase scripts are included in index.html');
}


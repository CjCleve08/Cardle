# Firebase Setup Instructions

To use Firebase authentication and database in Cardle, you need to:

## 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" or select an existing project
3. Follow the setup wizard to create your project

## 2. Enable Authentication

1. In your Firebase project, go to **Authentication** in the left sidebar
2. Click **Get started**
3. Go to the **Sign-in method** tab
4. Enable **Email/Password** authentication:
   - Click on "Email/Password"
   - Toggle "Enable" to ON
   - Click "Save"
5. Enable **Google** authentication:
   - Click on "Google"
   - Toggle "Enable" to ON
   - Enter a project support email (your email address)
   - Click "Save"

## 3. Enable Firestore Database

1. In your Firebase project, go to **Firestore Database** in the left sidebar
2. Click **Create database**
3. Choose **Start in test mode** (for development) or configure security rules as needed
4. Select a location for your database
5. Click **Enable**

## 4. Get Your Firebase Configuration

1. In your Firebase project, click the gear icon ⚙️ next to "Project Overview"
2. Select **Project settings**
3. Scroll down to the "Your apps" section
4. If you don't have a web app yet, click the web icon `</>` to add one
5. Register your app with a nickname (e.g., "Cardle Web")
6. Copy the `firebaseConfig` object that looks like this:

```javascript
const firebaseConfig = {
    apiKey: "AIza...",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef"
};
```

## 5. Update firebase-config.js

1. Open `firebase-config.js` in your project
2. Replace the placeholder values with your actual Firebase configuration:

```javascript
const firebaseConfig = {
    apiKey: "YOUR_ACTUAL_API_KEY",
    authDomain: "YOUR_ACTUAL_AUTH_DOMAIN",
    projectId: "YOUR_ACTUAL_PROJECT_ID",
    storageBucket: "YOUR_ACTUAL_STORAGE_BUCKET",
    messagingSenderId: "YOUR_ACTUAL_MESSAGING_SENDER_ID",
    appId: "YOUR_ACTUAL_APP_ID"
};
```

## 6. Configure Security Rules

You need to set up Firestore security rules so users can read/write their own data. Here's how:

### Steps to Add Security Rules:

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project (Cardle)
3. In the left sidebar, click on **Firestore Database**
4. Click on the **Rules** tab at the top
5. Replace the default rules with the following:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read/write their own user document
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Users can read/write their own stats document
    match /stats/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

6. Click **Publish** to save the rules

### What These Rules Do:

- **`/users/{userId}`**: Users can only read and write their own user profile data
- **`/stats/{userId}`**: Users can only read and write their own game statistics
- Both rules require authentication (`request.auth != null`) and verify the user ID matches (`request.auth.uid == userId`)

### Switching from Test Mode to Production Mode:

If you created your Firestore database in **test mode**, you need to switch to production mode:

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project (Cardle)
3. In the left sidebar, click on **Firestore Database**
4. Click on the **Rules** tab
5. You should see a banner at the top saying "Your Cloud Firestore database is in test mode"
6. Click on the **"Upgrade"** or **"Publish"** button in the banner
7. Make sure the security rules above are in place (they should already be there)
8. Click **Publish** to activate production mode

**Important**: Test mode allows anyone to read/write your database for 30 days. Production mode uses your security rules to protect your data.

### Testing Your Rules:

After publishing, you can test the rules using the Rules Playground in the Firebase Console, or by testing in your application.

## 7. Test Your Setup

1. Start your server: `npm start`
2. Open your application in a browser
3. You should see the login screen
4. Try creating an account and signing in
5. After signing in, you should see the lobby screen

## Troubleshooting

- **"Firebase Auth not initialized"**: Make sure `firebase-config.js` is loaded before `client.js` in `index.html`
- **Authentication errors**: Verify that Email/Password authentication is enabled in Firebase Console
- **Firestore errors**: Make sure Firestore Database is created and security rules allow authenticated users

For more information, visit the [Firebase Documentation](https://firebase.google.com/docs).


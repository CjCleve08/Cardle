# Firebase Setup Guide

This guide will walk you through setting up Firebase for the Cardle game.

## 1. Create Firebase Project

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

## 3. Create Firestore Database

1. In your Firebase project, go to **Firestore Database** in the left sidebar
2. Click **Create database**
3. Choose **Start in production mode** (we'll add security rules in step 6)
4. Select a location for your database (choose the closest to your users)
5. Click **Enable**

## 4. Get Firebase Configuration

1. In your Firebase project, click the gear icon ⚙️ next to "Project Overview"
2. Select **Project settings**
3. Scroll down to the **Your apps** section
4. If you don't have a web app yet, click the **</>** (web) icon to add one
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
    // Helper function to check if user is an admin
    function isAdmin() {
      return request.auth != null && 
             request.auth.token.email != null &&
             request.auth.token.email in ['cjcleve2008@gmail.com', 'perkerewiczgus@gmail.com'];
    }
    
    // Users can read any user document (for friend search), but only write their own
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Users can read any stats document (for displaying opponent stats), but only write their own
    match /stats/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Friends collection - users can read/write their own friend relationships
    match /friends/{friendDocId} {
      allow read, write: if request.auth != null && 
        (request.auth.uid in resource.data.users || 
         request.auth.uid == resource.data.senderId || 
         request.auth.uid == resource.data.recipientId);
      allow create: if request.auth != null && 
        request.auth.uid == request.resource.data.senderId;
    }
    
    // Decks collection - users can only read/write their own decks
    match /decks/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Community Posts collection - users can read all posts, but only create/update/delete their own
    match /communityPosts/{postId} {
      // Anyone authenticated can read posts
      allow read: if request.auth != null;
      
      // Anyone authenticated can create posts
      allow create: if request.auth != null && 
        request.auth.uid == request.resource.data.authorId;
      
      // Only the author can update their own post (for likes, comment count, etc.)
      allow update: if request.auth != null && 
        (request.auth.uid == resource.data.authorId || 
         // Allow updates to likes and likedBy fields (anyone can like)
         (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['likes', 'likedBy', 'commentCount', 'updatedAt'])));
      
      // Only the author or admins can delete posts
      allow delete: if request.auth != null && 
        (request.auth.uid == resource.data.authorId || isAdmin());
      
      // Comments subcollection - nested under each post
      match /comments/{commentId} {
        // Anyone authenticated can read comments
        allow read: if request.auth != null;
        
        // Anyone authenticated can create comments
        allow create: if request.auth != null && 
          request.auth.uid == request.resource.data.authorId;
        
        // Only the comment author or admins can delete comments
        allow delete: if request.auth != null && 
          (request.auth.uid == resource.data.authorId || isAdmin());
        
        // Comments cannot be updated (only created or deleted)
        allow update: if false;
      }
    }
    
    // Messages collection - users can only read/write messages in conversations they're part of
    match /messages/{messageId} {
      // Users can read messages where they are the sender or receiver
      // This rule works for both individual document reads and queries
      allow read: if request.auth != null && 
                   (resource.data.senderId == request.auth.uid || 
                    resource.data.receiverId == request.auth.uid);
      
      // Users can create messages where they are the sender
      allow create: if request.auth != null && 
                     request.resource.data.senderId == request.auth.uid &&
                     request.resource.data.receiverId != request.auth.uid;
      
      // Users can update messages (only to mark as read, not change content)
      allow update: if request.auth != null && 
                     (resource.data.senderId == request.auth.uid || 
                      resource.data.receiverId == request.auth.uid) &&
                     // Ensure text and IDs don't change
                     request.resource.data.text == resource.data.text &&
                     request.resource.data.senderId == resource.data.senderId &&
                     request.resource.data.receiverId == resource.data.receiverId;
      
      // Users can delete messages they sent
      allow delete: if request.auth != null && 
                     resource.data.senderId == request.auth.uid;
    }
  }
}
```

6. Click **Publish** to save the rules

### What These Rules Do:

- **`/users/{userId}`**: Users can only read and write their own user profile data
- **`/stats/{userId}`**: Users can only read and write their own game statistics
- **`/friends/{friendDocId}`**: Users can read/write friend relationships they're part of
- **`/decks/{userId}`**: Users can only read/write their own decks
- **`/communityPosts/{postId}`**: Users can read all posts, create their own, update likes/comment counts, and delete their own posts (admins can delete any post)
- **`/communityPosts/{postId}/comments/{commentId}`**: Users can read all comments, create their own, and delete their own comments
- **`/messages/{messageId}`**: Users can read messages where they're the sender or receiver, create messages where they're the sender, update read status, and delete messages they sent

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

## 7. Create Firestore Indexes (if needed)

Firestore may require composite indexes for certain queries. If you see an error message about needing an index:

1. Click the link in the error message, or
2. Go to [Firebase Console](https://console.firebase.google.com/) → Firestore Database → Indexes tab
3. Click **Create Index**
4. Follow the prompts to create the required index

**Note**: The messages collection may need an index for `conversationId` + `createdAt` queries. If you see an index error, create it with:
- Collection: `messages`
- Fields: `conversationId` (Ascending), `createdAt` (Ascending)

## 8. Test Your Setup

1. Open your game in a browser
2. Try signing up/signing in with email/password or Google
3. Check the browser console for any errors
4. Verify that user data is being saved to Firestore

## Troubleshooting

### Common Issues:

1. **"Missing or insufficient permissions"**: 
   - Make sure you've published the security rules
   - Verify the user is authenticated (`request.auth != null`)
   - Check that the user ID matches (`request.auth.uid == userId`)

2. **"Index required"**: 
   - Create the composite index as shown in the error message
   - Wait a few minutes for the index to build

3. **"User not authenticated"**: 
   - Make sure Authentication is enabled in Firebase
   - Check that the user is signed in before trying to access Firestore

4. **Messages query failing**:
   - Ensure the security rules for messages are published
   - Check that `senderId` and `receiverId` fields are set correctly in message documents
   - Create a composite index for `conversationId` + `createdAt` if needed

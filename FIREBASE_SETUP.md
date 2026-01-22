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
    function isPermanentAdmin() {
      return request.auth != null && 
             request.auth.token.email != null &&
             request.auth.token.email in ['cjcleve2008@gmail.com'];
    }
    
    // Dynamic admin support via /admins/{uid} doc
    function isAdmin() {
      return isPermanentAdmin() ||
             (request.auth != null && exists(/databases/$(database)/documents/admins/$(request.auth.uid)));
    }
    
    // Admins collection - allows admin panel to grant/revoke admin
    match /admins/{userId} {
      // Anyone authenticated can read admin docs (so the UI can show admin glow for all admins)
      // IMPORTANT: Keep /admins docs non-sensitive (no emails) since this is readable.
      allow read: if request.auth != null;
      
      // Admins can create/update admin docs
      allow create, update: if isAdmin();
      
      // Admins can delete admin docs EXCEPT the creator admin
      allow delete: if isAdmin() &&
        get(/databases/$(database)/documents/users/$(userId)).data.email != 'cjcleve2008@gmail.com';
    }
    
    // Admin Activity Logs - tracks all admin actions (only creator can read)
    match /adminActivityLogs/{logId} {
      // Only creator can read activity logs
      allow read: if isPermanentAdmin();
      
      // Admins can create logs (when they make changes)
      allow create: if isAdmin();
      
      // No updates or deletes allowed (immutable audit trail)
      allow update, delete: if false;
    }
    
    // Users can read any user document (for friend search), but only write their own
    // Creator can update banned status for any user
    match /users/{userId} {
      allow read: if request.auth != null;
      // Users can write their own document
      allow create, update: if request.auth != null && request.auth.uid == userId;
      // Creator can update banned status for any user
      allow update: if isPermanentAdmin() && 
                     request.resource.data.diff(resource.data).affectedKeys().hasOnly(['banned', 'bannedAt', 'bannedBy']);
    }
    
    // Users can read any stats document (for displaying opponent stats), but only write their own
    // Admins can write to any user's stats (for admin panel)
    match /stats/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && (request.auth.uid == userId || isAdmin());
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
      
      // Anyone authenticated can create posts (bulletin posts require admin)
      allow create: if request.auth != null &&
        request.auth.uid == request.resource.data.authorId &&
        (
          request.resource.data.isBulletin != true ||
          (isAdmin() && request.resource.data.category == 'bulletin')
        );
      
      // Only the author can update their own post (for likes, comment count, etc.)
      allow update: if request.auth != null && 
        ((
          request.auth.uid == resource.data.authorId &&
          // Don't allow non-admins to change bulletin status/category after creation
          (
            request.resource.data.isBulletin == resource.data.isBulletin ||
            isAdmin()
          ) &&
          (
            request.resource.data.isBulletin != true ||
            request.resource.data.category == 'bulletin'
          )
        ) || 
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
    
    // Gifted Packs collection - users can read packs they received, create packs they're sending, and update packs they received
    match /giftedPacks/{packId} {
      // Users can read packs where they are the receiver (for queries and individual reads)
      allow read: if request.auth != null && 
                   resource.data.receiverId == request.auth.uid;
      
      // Users can create packs where they are the sender (gifting to friends)
      allow create: if request.auth != null && 
                     request.resource.data.senderId == request.auth.uid &&
                     request.resource.data.receiverId != request.auth.uid;
      
      // Users can update packs they received (to mark as opened)
      allow update: if request.auth != null && 
                     resource.data.receiverId == request.auth.uid &&
                     // Only allow updating the 'opened' field
                     request.resource.data.diff(resource.data).affectedKeys().hasOnly(['opened']) &&
                     request.resource.data.receiverId == resource.data.receiverId &&
                     request.resource.data.senderId == resource.data.senderId;
      
      // Users cannot delete packs (only mark as opened)
      allow delete: if false;
    }
    
    // Card Camos collection - users can only read/write their own card camo preferences
    match /cardCamos/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Owned Camos collection - users can only read/write their own owned camos
    match /ownedCamos/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Email Verification Codes collection - users can only read/write their own verification codes
    match /emailVerificationCodes/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Pending Signups collection - stores signup data before account creation (no auth required for writes)
    // Anyone can create (for signup), but only the server/admin should be able to read
    match /pendingSignups/{email} {
      // Allow anyone to create/update (for signup flow)
      allow create, update: if true;
      // Only allow reads by authenticated users (for verification)
      allow read: if request.auth != null;
      // Allow delete after account creation
      allow delete: if request.auth != null;
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
- **`/giftedPacks/{packId}`**: Users can read packs they received, create packs they're sending (gifting), and update packs they received (to mark as opened)
- **`/cardCamos/{userId}`**: Users can only read and write their own card camo preferences
- **`/ownedCamos/{userId}`**: Users can only read and write their own owned camos list

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

**Note**: The following collections may need composite indexes:
- **Messages**: `conversationId` (Ascending), `createdAt` (Ascending)
- **Gifted Packs**: `receiverId` (Ascending), `opened` (Ascending), `timestamp` (Descending)

## 8. Configure Email Sending (Optional but Recommended)

The game now includes email verification and password reset functionality. To enable email sending:

### For Local Development

Create `email-config.js` file (already in `.gitignore` for security) with your SMTP settings:

```javascript
module.exports = {
    host: 'smtp.gmail.com',
    port: 587,
    user: 'your-email@gmail.com',
    pass: 'your-app-password',
    from: 'your-email@gmail.com'
};
```

### For Production/Server Deployment

**IMPORTANT:** The `email-config.js` file is gitignored and won't be on your server. You **must** use environment variables.

Set these environment variables on your server before starting:

```bash
export SMTP_HOST=smtp.gmail.com
export SMTP_PORT=587
export SMTP_USER=your-email@gmail.com
export SMTP_PASS=your-app-password
export SMTP_FROM=your-email@gmail.com
```

**For different hosting platforms:**

**Render.com (Recommended: Use SendGrid):**
1. Sign up for free at [SendGrid](https://sendgrid.com) (100 emails/day free)
2. Get your API key from SendGrid dashboard → Settings → API Keys
3. In Render dashboard → Your Service → Environment tab:
   - Add: `SENDGRID_API_KEY` = `your-sendgrid-api-key`
   - (Optional) Add: `SMTP_FROM` = `your-verified-sender-email@yourdomain.com`
4. **Redeploy your service**
5. Check logs: `✅ SendGrid email service configured`

**Render.com (Alternative: SMTP - may have connection issues):**
1. Go to your Render dashboard
2. Select your service (e.g., "cardle")
3. Go to **Environment** tab
4. Click **Add Environment Variable** for each:
   - `SMTP_HOST` = `smtp.gmail.com`
   - `SMTP_PORT` = `587` (or `465` if 587 is blocked)
   - `SMTP_USER` = `your-email@gmail.com`
   - `SMTP_PASS` = `your-app-password` (Gmail App Password, no spaces)
   - `SMTP_FROM` = `your-email@gmail.com`
5. After adding all variables, **redeploy your service** for changes to take effect
6. Check your service logs to verify: `✅ Email transporter initialized and verified successfully`

**Heroku:**
```bash
heroku config:set SMTP_HOST=smtp.gmail.com
heroku config:set SMTP_PORT=587
heroku config:set SMTP_USER=your-email@gmail.com
heroku config:set SMTP_PASS=your-app-password
heroku config:set SMTP_FROM=your-email@gmail.com
```

**DigitalOcean/VPS:**
Add to your `.env` file or export in your startup script:
```bash
export SMTP_HOST=smtp.gmail.com
export SMTP_PORT=587
export SMTP_USER=your-email@gmail.com
export SMTP_PASS=your-app-password
export SMTP_FROM=your-email@gmail.com
```

**For Gmail:**
1. Enable 2-Step Verification on your Google account
2. Generate an App Password: [Google App Passwords](https://myaccount.google.com/apppasswords)
3. Use the generated app password (not your regular password) for `SMTP_PASS`
4. Remove any spaces from the app password

**For other email providers:**
- Check your email provider's SMTP settings
- Common ports: 587 (TLS), 465 (SSL), 25 (not recommended)

### Testing Email

1. Start your server: `npm start`
2. Check the console for: `✅ Email transporter initialized and verified successfully`
3. Try signing up with a new account
4. Check your email (and spam folder) for the verification code
5. If email is not configured, the code will be logged to the server console

**Note:** Without email configuration, verification codes will be logged to the server console. This is fine for development but not recommended for production.

### Troubleshooting Email on Production

If emails work locally but not on your server:

1. **Check environment variables are set:**
   - Visit `https://your-server.onrender.com/api/test-email-config` to see configuration status
   - This will show which environment variables are set and if the transporter is initialized
   - Look for `"hasTransporter": false` - this means SMTP verification failed

2. **Verify environment variables on Render:**
   - Go to Render dashboard → Your Service → Environment tab
   - Make sure ALL variables are set (no typos in variable names):
     - `SMTP_HOST` (not `SMTP_HOSTS` or `SMTPHOST`)
     - `SMTP_PORT` (not `SMTP_PORTS`)
     - `SMTP_USER` (not `SMTP_USERS`)
     - `SMTP_PASS` (not `SMTP_PASSWORD` or `SMTP_PASSWD`)
     - `SMTP_FROM` (optional, defaults to SMTP_USER)
   - **IMPORTANT:** After adding/changing variables, you MUST redeploy the service

3. **Check server logs on Render:**
   - Go to Render dashboard → Your Service → Logs tab
   - Look for these messages:
     - `✅ Email transporter initialized and verified successfully` = Working!
     - `❌ SMTP connection verification failed` = Check password/credentials
     - `⚠️ Email transporter not configured` = Environment variables not set
   - Look for `📧 Attempting to send verification email` when someone signs up
   - Check for detailed error messages

4. **Test email sending:**
   - You can test by sending a POST request to `/api/test-send-email`:
   ```bash
   curl -X POST https://your-server.onrender.com/api/test-send-email \
     -H "Content-Type: application/json" \
     -d '{"testEmail": "your-email@gmail.com"}'
   ```

5. **Common issues:**
   - **Environment variables not set:** Check Render dashboard → Environment tab
   - **Service not redeployed:** After adding env vars, service must be redeployed
   - **Wrong app password:** Generate a new Gmail App Password
   - **Spaces in password:** Server automatically removes spaces, but double-check
   - **Firewall blocking:** Some providers block SMTP - try port 465 (SSL) instead of 587
   - **Gmail blocking:** Gmail may block connections from new IPs - wait a few minutes

6. **Network/Firewall issues:**
   - Ensure your server can make outbound connections on port 587
   - Some hosting providers (like Render) may block SMTP ports
   - **If you get "Connection timeout" errors:**
     - Try port 465 (SSL) instead of 587 (TLS) - change `SMTP_PORT=465` in Render
     - The code will automatically retry on timeout errors
     - Consider using an email API service instead (see below)

7. **Alternative: Use Email API Service (Recommended for Render)**
   
   If SMTP continues to fail on Render, consider using an email API service:
   
   **Option A: SendGrid (Free tier: 100 emails/day)**
   ```bash
   # Install: npm install @sendgrid/mail
   # Set in Render: SENDGRID_API_KEY=your-api-key
   ```
   
   **Option B: Mailgun (Free tier: 5,000 emails/month)**
   ```bash
   # Install: npm install mailgun.js
   # Set in Render: MAILGUN_API_KEY=your-api-key, MAILGUN_DOMAIN=your-domain
   ```
   
   These services are more reliable on hosting platforms that block SMTP.

## 9. Test Your Setup

1. Open your game in a browser
2. Try signing up/signing in with email/password or Google
3. Check the browser console for any errors
4. Verify that user data is being saved to Firestore
5. Test the "Forgot Password" functionality
6. Test email verification during signup

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

5. **Email verification not working**:
   - Check that SMTP credentials are configured correctly
   - Verify the email is not in spam folder
   - Check server console for email sending errors
   - If email is not configured, verification codes will be logged to the server console

6. **Password reset email not sending**:
   - Ensure SMTP is configured (see section 8)
   - Check Firebase Authentication settings - password reset emails are sent by Firebase
   - Verify the email address exists in your Firebase Authentication users

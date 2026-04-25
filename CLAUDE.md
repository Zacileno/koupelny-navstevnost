# koupelny-navstevnost

Firebase project for tracking bathroom/showroom visitor traffic.

## Stack
- **Firebase Hosting** – static web app served from `public/`
- **Firebase Functions** – backend logic in `functions/index.js`
- **Firebase Admin SDK** – used for data access in scripts
- **Frontend** – vanilla JS/CSS (`public/dashboard.html`, `public/app.js`, etc.)

## Project structure
- `public/` – frontend (dashboard, styles, app logic, Firebase web config)
- `functions/` – Firebase Cloud Functions
- `historical_data.json` – raw historical visit data
- `import_do_firebase.js` – one-off import script for historical data
- `firebase-import/` – Firebase import utilities

## Common commands
```bash
# Deploy hosting
firebase deploy --only hosting

# Deploy functions
firebase deploy --only functions

# Deploy everything
firebase deploy

# Run functions locally
firebase emulators:start

# Import historical data
node import_do_firebase.js
```

## Notes
- Firebase project config: `.firebaserc`
- Root `package.json` has `firebase-admin` and `heic-convert` as dependencies (for scripts)
- Functions have their own `package.json` in `functions/`

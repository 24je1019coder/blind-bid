# Blind Bid

A simple mobile-first multiplayer bidding game. One Node.js service serves the frontend and Socket.IO backend.

## Run locally

1. Install Node.js 18 or newer.
2. Open a terminal in this folder.
3. Run `npm install`
4. Run `npm start`
5. Open `http://localhost:3000` in your browser.

For testing multiple players, open separate browser profiles or devices and use the room code.

## Deploy as one service on Render

ChatGPT's built-in Sites preview is a self-contained website preview; it cannot host a persistent Node.js process or real Socket.IO rooms. Use a single Node web service instead.

1. Create/sign in to GitHub at https://github.com and create a repository named `blind-bid`.
2. Upload the contents of this project folder to the repository (the `package.json`, `server.js`, and `public/index.html` must be at the repository root / correct paths).
3. Create/sign in to Render at https://render.com.
4. In Render, choose **New + → Web Service**, connect GitHub, and select `blind-bid`.
5. Set **Runtime: Node**, **Build Command: `npm install`**, **Start Command: `npm start`**.
6. Choose a region near your players and create the service. The free instance may sleep when idle; the Home screen displays “Connecting to server…” and Socket.IO retries while it wakes.
7. After deployment, open the `onrender.com` URL Render assigns and test with two separate devices.
8. In the Render service settings, confirm the environment has `NODE_ENV=production` if desired. No API keys or database are required for this first version.

## Important first-version limitations

- Room/player state is held in server memory. A browser refresh reconnects to the existing player while the service process remains alive, but a server restart/deploy/sleep cycle that resets the process can erase rooms and game progress.
- This is a prototype for casual play, not a hardened competitive service. Add durable storage and rate limiting before relying on long-lived matches.
- Rooms are process-local; keep a single service instance for this version.
- When the host disconnects, the next connected player becomes host. A disconnected player keeps their seat during the room's lifetime and can reconnect with the saved browser session.

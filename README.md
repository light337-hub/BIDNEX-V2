# BIDNEX

Real-time technical bidding competition platform for college events.

## Rules implemented
- Starting score: 100 points
- Bidding range: 0–20 points per question
- 25 continuous competition questions
- Correct answer: bid is added
- Wrong answer: bid is deducted
- Live timers and Socket.IO updates
- Session reconnect using localStorage

## Requirements
- Node.js 20+ recommended

## Development
Open two terminals in the project folder.

Terminal 1:
```bash
npm install
npm run dev
```

Terminal 2:
```bash
npm run server
```

Open the Vite URL shown in Terminal 1 (normally `http://localhost:5173`).
The participant client connects automatically to the Socket.IO server on port 5000.

## Production
```bash
npm install
npm run build
npm start
```

Then open:
`http://localhost:5000`

## Health check
`http://localhost:5000/api/health`

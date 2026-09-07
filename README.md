# BusiMovie — Telegram Movie Vault & AI Concierge

An advanced Telegram bot and modern web dashboard for movie/TV media management, streaming discovery, and AI-powered recommendations.

## Features

- **Telegram Bot Integration**:
  - Outbound **Long Polling** mode for local and development environments.
  - Inbound **24/7 Webhook** mode for production deployments (e.g., Google Cloud Run).
  - Search movies and TV series with real-time OMDb metadata.
  - Forward media files and videos directly in Telegram to sync with your cloud library.
  - AI Cinema Concierge powered by Gemini (with multi-model fallback cascade).
  - Interactive inline buttons, streaming links, and trailer previews.
- **Web Dashboard**:
  - Live vault monitoring, library statistics, and user interactions.
  - Telegram connection management (toggle between Long Polling and 24/7 Webhook).
  - Built with React, Vite, and Tailwind CSS.
- **Backend**:
  - Express.js server on Node.js.
  - Firebase Firestore persistence for user profiles, media library, and interaction logs.

## Environment Variables

Copy `.env.example` to `.env` and fill in your keys:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GEMINI_API_KEY=your_gemini_api_key
OMDB_API_KEY=your_omdb_api_key
APP_URL=https://your-deployed-service.run.app # optional, for production webhooks
```

## Running Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Visit `http://localhost:3000` to access the dashboard.

## Production Build & Deployment

```bash
# Build frontend and compile backend
npm run build

# Start production server
npm start
```

### Deploying to Google Cloud Run

1. Deploy the service with port `3000` exposed.
2. Provide your environment variables (`TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, etc.) in Cloud Run settings.
3. Open your deployed Cloud Run URL, navigate to the **Telegram Connection** card, enter your public URL, and click **Enable Webhook** for 24/7 bot response.

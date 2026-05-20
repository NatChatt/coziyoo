# Coziyoo Mobile (Standalone)

Run the mobile app fully from inside `apps/mobile` without root workspace commands.

## Setup

```bash
cd /Users/drascom/Work/coziyoo-v2/apps/mobile
cp .env.example .env
npm install
```

## Run

```bash
npm run ios
# or
npm run android
```

## Environment

Only one runtime variable is required:

- `EXPO_PUBLIC_API_URL` (current live API: `https://api.coziyoo.com`)

STT/TTS/LLM server details are loaded from API profile settings, not mobile env.

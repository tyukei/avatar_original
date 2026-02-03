#!/bin/bash
set -e

# 1. Load Secrets
echo "🔑 Loading secrets from .env.secrets..."
if [ -f .env.secrets ]; then
  set -a # Automatically export all variables
  source .env.secrets
  set +a
else
  echo "❌ Error: .env.secrets not found."
  exit 1
fi

# Verify required variables
if [ -z "$VITE_WS_URL" ] || [ -z "$FIREBASE_PROJECT_ID" ]; then
  echo "❌ Error: VITE_WS_URL or FIREBASE_PROJECT_ID is missing in .env.secrets."
  exit 1
fi

echo "✅ Secrets loaded. Project ID: $FIREBASE_PROJECT_ID"

# 2. Deploy Frontend
echo "🚀 Deploying Frontend..."
cd frontend
echo "📦 Installing dependencies..."
npm ci
echo "🏗️  Building frontend (VITE_WS_URL=$VITE_WS_URL)..."
npm run build
echo "fw  Deploying to Firebase Hosting..."
firebase deploy --only hosting
cd ..

# 3. Deploy Backend
echo "🚀 Deploying Backend to Cloud Run..."

# Prepare Service Account for Env Var (Base64 encoded)
# Using 'tr -d' to ensure no newlines from base64 output
FIREBASE_SA_BASE64=$(echo -n "$FIREBASE_SERVICE_ACCOUNT" | base64 | tr -d '\n')

gcloud run deploy avatar-backend \
  --source backend \
  --platform managed \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY="$GEMINI_API_KEY" \
  --set-env-vars FIREBASE_SERVICE_ACCOUNT="$FIREBASE_SA_BASE64" \
  --project "$FIREBASE_PROJECT_ID"

echo "✨ Deployment Complete!"

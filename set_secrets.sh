#!/bin/bash
set -e

echo "🔑 Reading secrets from local files..."

# Load frontend config (public but treated as secrets in CI)
if [ -f frontend/.env.local ]; then
  echo "   Loading frontend/.env.local..."
  set -a
  source frontend/.env.local
  set +a
else
  echo "⚠️  frontend/.env.local not found"
fi

# Load backend secrets (sensitive)
if [ -f .env.secrets ]; then
  echo "   Loading .env.secrets..."
  set -a
  source .env.secrets
  set +a
else
  echo "⚠️  .env.secrets not found"
fi

# Define the list of secrets to upload
# Key format: SECRET_NAME
SECRETS=(
  "VITE_FIREBASE_API_KEY"
  "VITE_FIREBASE_AUTH_DOMAIN"
  "VITE_FIREBASE_PROJECT_ID"
  "VITE_FIREBASE_STORAGE_BUCKET"
  "VITE_FIREBASE_MESSAGING_SENDER_ID"
  "VITE_FIREBASE_APP_ID"
  "VITE_WS_URL"
  "FIREBASE_PROJECT_ID"
  "GEMINI_API_KEY"
  "FIREBASE_SERVICE_ACCOUNT"
  "GCP_SA_KEY"
)

echo "🚀 Uploading secrets to GitHub..."

for SECRET_NAME in "${SECRETS[@]}"; do
  VALUE="${!SECRET_NAME}"
  
  if [ -z "$VALUE" ]; then
    echo "⚠️  Skipping $SECRET_NAME (Value is empty or not loaded)"
    continue
  fi

  echo "   Setting $SECRET_NAME..."
  gh secret set "$SECRET_NAME" --body "$VALUE"
done

echo "✅ All secrets processed!"

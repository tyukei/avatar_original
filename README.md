# Web音声アバターアプリ

![alt text](docs/img/image.png)

Gemini Live API を使用した音声会話アバターアプリケーションです。


## 構成

```
avatar_original/
├── backend/         # Python FastAPI Server (Cloud Run)
│   ├── Dockerfile
│   ├── main.py
│   ├── pyproject.toml
│   └── .env.example
├── frontend/        # React (Vite) Application (Firebase Hosting)
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   └── public/
│       ├── audio-processor.js
│       ├── avatar-closed.png
│       └── avatar-open.png
├── firebase.json    # Firebase Hosting & Rewrite Config
└── .firebaserc      # Firebase Project Alias
```

## セットアップ (ローカル開発)

### 1. 環境変数の設定

詳細な設定項目については [docs/environment_variables.md](docs/environment_variables.md) を参照してください。

#### バックエンド (`backend/`)

```bash
cd backend
cp .env.example .env
```
`.env` ファイルを編集して `GEMINI_API_KEY` と `FIREBASE_SERVICE_ACCOUNT` を設定してください。

#### フロントエンド (`frontend/`)

```bash
cd frontend
cp .env.example .env.local
```
`.env.local` ファイルを編集して Firebase の設定値 (`VITE_FIREBASE_*`) を入力してください。
また、ローカル開発用に `VITE_WS_URL=ws://localhost:8080/ws` が設定されていることを確認してください。



### 2. バックエンドの起動

Python環境管理ツール `uv` を使用します。

```bash
cd backend
uv run uvicorn main:app --reload --port 8080
```

※ 初回実行時に自動的に依存関係がインストールされます。

### 3. フロントエンドの起動

```bash
cd frontend
npm install
npm run dev
```

### 4. アバター画像の配置

`frontend/public/` に以下の2枚の画像を配置してください：
- `avatar-closed.png` - 口を閉じた状態
- `avatar-open.png` - 口を開いた状態

## デプロイ (Firebase + Cloud Run)

本番環境は Firebase Hosting (Frontend) と Cloud Run (Backend) で構成されます。

### 1. 事前準備

デプロイには `gcloud` コマンドと `firebase` コマンドの認証が必要です。

```bash
# Google Cloud SDK (gcloud) のログインとプロジェクト設定
gcloud auth login
gcloud config set project [PROJECT_ID]

# Firebase CLI のインストールとログイン
npm install -g firebase-tools
firebase login
```

- Google Cloud プロジェクトの作成
- Firebase プロジェクトの紐付け
- `.firebaserc` のプロジェクトID設定

### 2. バックエンドのデプロイ (Cloud Run)

```bash
# Cloud Build でコンテナをビルド
gcloud builds submit backend --tag gcr.io/[PROJECT_ID]/avatar-backend

# Cloud Run にデプロイ
gcloud run deploy avatar-backend \
  --image gcr.io/[PROJECT_ID]/avatar-backend \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=[YOUR_API_KEY]
```

### 3. フロントエンドのデプロイ (Firebase Hosting)

```bash
# ビルド
cd frontend
npm run build
cd ..

# デプロイ
firebase deploy --only hosting
```

アクセス: `https://[PROJECT_ID].web.app`


### 4. トラブルシューティング

#### デプロイ権限エラー (run.services.get denied)

`firebase deploy` 時に `Permission 'run.services.get' denied` エラーが出る場合、Firebase のサービスアカウントに Cloud Run の参照権限が不足しています。以下のコマンドで権限を付与してください。

```bash
gcloud projects add-iam-policy-binding [PROJECT_ID] \
  --member="serviceAccount:firebase-adminsdk-fbsvc@[PROJECT_ID].iam.gserviceaccount.com" \
  --role="roles/run.viewer"
```

※ `[PROJECT_ID]` は実際のプロジェクトIDに置き換えてください。

### 5. アクセス

ブラウザで http://localhost:3000 を開く

## 使い方

1. 「開始する」ボタンをクリック
2. マイクへのアクセスを許可
3. 話しかけるとアバターが応答します

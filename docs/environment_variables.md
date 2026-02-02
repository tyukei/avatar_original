# 環境変数マニュアル

このプロジェクトで使用する環境変数の一覧とその設定方法です。

## 概要

| 変数名 | 必須 | 場所 (ローカル) | 説明 |
| :--- | :---: | :--- | :--- |
| `GEMINI_API_KEY` | ✅ | `backend/.env` | Google AI Studio の API キー |
| `FIREBASE_SERVICE_ACCOUNT` | ✅ | `backend/.env` | Firebase Admin SDK 初期化用 (JSON) |
| `PORT` | - | `backend/.env` | バックエンドのポート (デフォルト: 8080) |
| `VITE_FIREBASE_API_KEY` | ✅ | `frontend/.env.local` | Firebase Project API Key |
| `VITE_FIREBASE_AUTH_DOMAIN` | ✅ | `frontend/.env.local` | Firebase Auth Domain |
| `VITE_FIREBASE_PROJECT_ID` | ✅ | `frontend/.env.local` | Firebase Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET`| ✅ | `frontend/.env.local` | Firebase Storage Bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID`| ✅ | `frontend/.env.local` | Firebase Sender ID |
| `VITE_FIREBASE_APP_ID` | ✅ | `frontend/.env.local` | Firebase App ID |
| `VITE_WS_URL` | ✅ | `frontend/.env.local` | バックエンドの WebSocket 接続先 URL |

## バックエンドの設定

`backend/.env` ファイルを作成し、以下の内容を設定します。

```bash
GEMINI_API_KEY="AIzaSy..."
FIREBASE_SERVICE_ACCOUNT='{"type": "service_account", ...}'
PORT=8080
```

- **GEMINI_API_KEY**: [Google AI Studio](https://aistudio.google.com/) で取得してください。
- **FIREBASE_SERVICE_ACCOUNT**: Firebase Console > Project settings > Service accounts から「新しい秘密鍵の生成」でJSONをダウンロードし、その内容を1行の文字列にしたものを貼り付けます。

## フロントエンドの設定

`frontend/.env.local` ファイルを作成し、以下の内容を設定します。

```bash
# Firebase設定 (Firebase Console > Project settings > My apps > Config からコピー)
VITE_FIREBASE_API_KEY="AIzaSy..."
VITE_FIREBASE_AUTH_DOMAIN="your-project.firebaseapp.com"
VITE_FIREBASE_PROJECT_ID="your-project"
VITE_FIREBASE_STORAGE_BUCKET="your-project.appspot.com"
VITE_FIREBASE_MESSAGING_SENDER_ID="123456789"
VITE_FIREBASE_APP_ID="1:123456789:web:abcdef"

# 接続先バックエンド (開発時は localhost)
VITE_WS_URL="ws://localhost:8080/ws"
```

### 注意点
- `.env.local` は Git にコミットされません。
- 本番環境 (Firebase Hosting) では、これらの変数はビルド時または GitHub Actions の Secrets 経由で設定されます。

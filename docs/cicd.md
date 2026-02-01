# CI/CD設定について

このプロジェクトのバックエンド（Python）用CI/CDパイプラインについて説明します。

## 概要

GitHub Actionsを使用して、コードがプッシュされるたびに自動的なチェックを行っています。
現在は以下のワークフローが設定されています。

### Python Syntax Check

- **ファイル**: `.github/workflows/test.yml`
- **トリガー**: `main` ブランチへの Push または Pull Request
- **対象ディレクトリ**: `backend_python/`

#### 実行内容

1. **Python環境のセットアップ**: `backend_python/.python-version` で指定されたバージョン（現在は 3.13）を使用します。
2. **依存関係のインストール**: `uv` を使用して高速に依存関係をインストールします。
3. **構文チェック**: `compileall` モジュールを使用して、Pythonファイルに構文エラーがないかを確認します。

```bash
# ローカルでの実行コマンド例（backend_pythonディレクトリ内で）
uv run python -m compileall . -q
```

このチェックにより、基本的な記述ミス（インデントエラーや閉じていない括弧など）を早期に発見します。

### Frontend Build

- **ファイル**: `.github/workflows/test.yml`（`frontend-build` job）
- **トリガー**: `main` ブランチへの Push または Pull Request
- **対象ディレクトリ**: `frontend/`

#### 実行内容

1. **環境セットアップ**: Node.js 20を使用。
2. **依存関係インストール**: `npm ci` で `package-lock.json` に基づきインストール。
3. **ビルド**: `npm run build` (Vite build) を実行。

ビルドが成功すれば、基本的な構文エラーがないことが保証されます。

```bash
# ローカルでの実行コマンド例（frontendディレクトリ内で）
npm install
npm run build
```


## github設定

forkまたはcloneしたリポジトリで、以下の手順で設定する。

### シークレットキーの設定 (GitHub Secrets)



GitHub CLI (`gh`) を使用して、必要なシークレットを一括で設定することをお勧めします。

#### 1. 設定用ファイルの作成

プロジェクトルートに `.env.secrets` というファイルを作成し、以下のシークレットを記述します。
（**注意**: `.env.secrets` は `.gitignore` に追加されており、リポジトリにはコミットされません）

```bash
# .env.secrets
FIREBASE_PROJECT_ID=ここにプロジェクトID (gen-lang-client-02446999-262c1)
GEMINI_API_KEY=ここにGeminiのAPIキー (AIza...)
```

#### 2. シークレットの一括アップロード

ターミナルで以下のコマンドを実行し、`.env.secrets` の内容を一括で登録します。

```bash
gh secret set -f .env.secrets
```

#### 3. サービスアカウントキー (JSON) の登録

`FIREBASE_SERVICE_ACCOUNT` はJSON形式であるため、ファイルから直接登録します。

```bash
# JSONファイル (例: sa-key.json) から読み込んで登録
gh secret set FIREBASE_SERVICE_ACCOUNT < sa-key.json

# 登録後にローカルのキーファイルは削除推奨
rm sa-key.json
```

これにより、手動でのコピー＆ペーストによるミスを防ぐことができます。
Web画面 (Settings > Secrets and variables > Actions) で確認すると、登録されたシークレットが表示されます。


### github actionによるpr作成権限の追加

Settings > Actions > General > Workflow permissions > Read and write permissions を有効にする

saveをクリックする

![alt text](img/github_action_permission.png)
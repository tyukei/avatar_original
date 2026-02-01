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

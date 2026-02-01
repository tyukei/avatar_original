import os
import json
import http.client

def generate_summary():
    api_key = os.getenv("GEMINI_API_KEY")
    content = os.getenv("CONTENT_LIST", "").strip()

    if not api_key:
        print("- AI Summary unavailable (API Key missing)")
        return

    prompt = f"""
あなたはリリースノート編集者です。以下の変更一覧（Pull Request / Commit）から、日本語で「What's New」を作成してください。

出力ルール（厳守）:
- 出力は箇条書きのみ（- で始まる行）。見出し/前置き/理由/注釈は禁止。
- 最大5項目。各項目は1文で簡潔に。
- 根拠のない推測は禁止（例: 「安定性向上」「パフォーマンス改善」など確実に言えないことは書かない）。
- 変更内容が不明瞭な場合は「内部改善（詳細なし）」と正直に書く。
- 「承知しました」などの前置きは不要。

変更一覧:
{content}
""".strip()

    conn = http.client.HTTPSConnection("generativelanguage.googleapis.com")
    payload = {"contents": [{"parts": [{"text": prompt}]}]}
    headers = {"Content-Type": "application/json"}

    try:
        conn.request(
            "POST",
            f"/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}",
            json.dumps(payload),
            headers,
        )
        res = conn.getresponse()
        body = res.read().decode("utf-8")

        if res.status != 200:
            print("- 内部改善（詳細なし）")
            return

        data = json.loads(body)
        text = data["candidates"][0]["content"]["parts"][0]["text"].strip()

        if not text:
            print("- 内部改善（詳細なし）")
            return

        if not text.lstrip().startswith("-"):
            text = "- " + text.replace("\n", " ").strip()
        print(text)

    except Exception:
        print("- 内部改善（詳細なし）")

if __name__ == "__main__":
    generate_summary()

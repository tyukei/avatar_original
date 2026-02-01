#!/usr/bin/env python3
"""
Generate fix suggestions using Gemini API
"""

import os
import sys
import json
import google.generativeai as genai

def load_error_reports():
    """Load all error reports"""
    errors = {
        'html': {},
        'accessibility': {}
    }
    
    # Load HTML errors
    if os.path.exists('html_errors.json'):
        with open('html_errors.json', 'r') as f:
            errors['html'] = json.load(f)
    
    # Load accessibility errors
    if os.path.exists('accessibility_errors.json'):
        with open('accessibility_errors.json', 'r') as f:
            errors['accessibility'] = json.load(f)
    
    return errors

def load_file_content(filepath='index.html'):
    """Load the file that needs fixing"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        return f"Error loading file: {e}"

def generate_fix_prompt(errors, file_content):
    """Generate prompt for Gemini API"""
    
    prompt = """あなたはHTML、CSS、アクセシビリティの専門家です。
以下のテストエラーを分析し、具体的な修正案を提案してください。

## テストエラー情報

"""
    
    # Add HTML validation errors
    if errors['html'].get('errors'):
        prompt += "### HTMLバリデーションエラー\n\n"
        for i, error in enumerate(errors['html']['errors'][:5], 1):  # Limit to 5 errors
            prompt += f"{i}. **{error['severity'].upper()}** (行 {error.get('line', '?')})\n"
            prompt += f"   - {error['message']}\n\n"
    
    # Add accessibility errors
    if errors['accessibility'].get('errors'):
        prompt += "### アクセシビリティエラー\n\n"
        for i, error in enumerate(errors['accessibility']['errors'][:5], 1):  # Limit to 5 errors
            prompt += f"{i}. **{error['impact'].upper()}** - {error['id']}\n"
            prompt += f"   - {error['description']}\n"
            prompt += f"   - 該当要素: `{error['html'][:100]}...`\n"
            prompt += f"   - 詳細: {error['helpUrl']}\n\n"
    
    prompt += """
## 現在のファイル（抜粋）

```html
"""
    
    # Add relevant file sections (first 100 lines for context)
    lines = file_content.split('\n')[:100]
    prompt += '\n'.join(lines)
    prompt += """
```

## 回答形式

以下の形式で、具体的な修正案を提案してください:

### 🔧 修正が必要な箇所

1. **エラー1の説明**
   - 問題: [問題の説明]
   - 修正方法: [具体的な修正手順]
   - 修正例:
   ```html
   [修正後のコード]
   ```

2. **エラー2の説明**
   ...

### ✅ 修正のポイント

- [重要なポイント1]
- [重要なポイント2]

### 📚 参考リンク

- [関連ドキュメントへのリンク]

**注意**: 
- 具体的なコード例を必ず含めてください
- 行番号がある場合は、その行を中心に修正案を提示してください
- 複数の修正方法がある場合は、最もシンプルな方法を推奨してください
"""
    
    return prompt

def generate_fixes(api_key, errors, file_content):
    """Generate fix suggestions using Gemini API"""
    
    # Configure Gemini
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-2.5-flash')
    
    # Generate prompt
    prompt = generate_fix_prompt(errors, file_content)
    
    # Generate response
    try:
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        return f"Error generating fixes: {e}"

def main():
    # Get API key
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        print("Error: GEMINI_API_KEY not set", file=sys.stderr)
        sys.exit(1)
    
    # Load errors
    errors = load_error_reports()
    
    # Check if there are any errors
    has_errors = (
        (errors['html'].get('errors') and len(errors['html']['errors']) > 0) or
        (errors['accessibility'].get('errors') and len(errors['accessibility']['errors']) > 0)
    )
    
    if not has_errors:
        print("No errors found. Skipping fix generation.")
        result = {
            'has_fixes': False,
            'message': 'All tests passed!'
        }
        print(json.dumps(result))
        return
    
    # Load file content
    file_content = load_file_content()
    
    # Generate fixes
    fix_suggestions = generate_fixes(api_key, errors, file_content)
    
    # Output result
    result = {
        'has_fixes': True,
        'suggestions': fix_suggestions,
        'error_summary': {
            'html_errors': len(errors['html'].get('errors', [])),
            'accessibility_errors': len(errors['accessibility'].get('errors', []))
        }
    }
    
    # Save to file
    with open('fix_suggestions.json', 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()

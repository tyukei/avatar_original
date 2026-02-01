#!/usr/bin/env python3
"""
Apply AI-generated fixes to the codebase
"""

import os
import sys
import json
import re
import google.generativeai as genai

def load_fix_suggestions():
    """Load fix suggestions from file"""
    try:
        with open('fix_suggestions.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading fix suggestions: {e}", file=sys.stderr)
        sys.exit(1)

def load_file_content(filepath='index.html'):
    """Load the file to be fixed"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        print(f"Error loading file: {e}", file=sys.stderr)
        sys.exit(1)

def apply_fixes_with_ai(api_key, suggestions, file_content):
    """Use Gemini to apply fixes to the actual file"""
    
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-2.5-flash')
    
    prompt = f"""以下の修正提案を、実際のHTMLファイルに適用してください。

## 修正提案

{suggestions}

## 現在のファイル内容

```html
{file_content}
```

## 指示

上記の修正提案を適用した、完全なHTMLファイルを出力してください。
- 修正箇所以外は変更しないでください
- 出力は```html```のコードブロックで囲んでください
- コードブロック以外の説明は不要です
"""
    
    try:
        response = model.generate_content(prompt)
        
        # Extract HTML from code block
        text = response.text
        match = re.search(r'```html\n(.*?)\n```', text, re.DOTALL)
        
        if match:
            return match.group(1)
        else:
            # If no code block, try to use the whole response
            print("Warning: No code block found in response, using full text", file=sys.stderr)
            return text
            
    except Exception as e:
        print(f"Error applying fixes: {e}", file=sys.stderr)
        return None

def save_file(filepath, content):
    """Save fixed content to file"""
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Successfully saved fixes to {filepath}")
        return True
    except Exception as e:
        print(f"Error saving file: {e}", file=sys.stderr)
        return False

def main():
    # Get API key
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        print("Error: GEMINI_API_KEY not set", file=sys.stderr)
        sys.exit(1)
    
    # Load fix suggestions
    fix_data = load_fix_suggestions()
    
    if not fix_data.get('has_fixes'):
        print("No fixes to apply")
        return
    
    suggestions = fix_data.get('suggestions', '')
    
    # Load current file
    file_content = load_file_content()
    
    # Apply fixes using AI
    print("Applying fixes with AI...")
    fixed_content = apply_fixes_with_ai(api_key, suggestions, file_content)
    
    if fixed_content:
        # Save fixed file
        if save_file('index.html', fixed_content):
            print("✅ Fixes applied successfully!")
        else:
            print("❌ Failed to save fixes", file=sys.stderr)
            sys.exit(1)
    else:
        print("❌ Failed to generate fixes", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()

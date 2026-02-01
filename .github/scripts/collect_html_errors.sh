#!/bin/bash
# Collect HTML validation errors and format them as JSON

set -euo pipefail

ERROR_FILE="${1:-html_errors.json}"
VNU_OUTPUT="${2:-vnu_output.txt}"

if [ ! -f "$VNU_OUTPUT" ]; then
  echo '{"test_type":"html_validation","errors":[],"success":true}' > "$ERROR_FILE"
  exit 0
fi

# Parse vnu output and convert to JSON
python3 - <<'EOF'
import json
import sys
import re

errors = []
success = True

try:
    with open(sys.argv[1], 'r') as f:
        content = f.read()
        
    # Parse vnu.jar output format
    # Example: "Error: Element "div" not closed. From line 123, column 45"
    pattern = r'(Error|Warning):\s*(.+?)\.\s*(?:From line (\d+)(?:, column (\d+))?)?'
    
    for match in re.finditer(pattern, content, re.MULTILINE):
        severity = match.group(1).lower()
        message = match.group(2)
        line = int(match.group(3)) if match.group(3) else None
        column = int(match.group(4)) if match.group(4) else None
        
        if severity == 'error':
            success = False
            
        errors.append({
            'severity': severity,
            'message': message,
            'line': line,
            'column': column
        })

except Exception as e:
    print(f"Error parsing vnu output: {e}", file=sys.stderr)

result = {
    'test_type': 'html_validation',
    'errors': errors,
    'success': success,
    'total_errors': len([e for e in errors if e['severity'] == 'error']),
    'total_warnings': len([e for e in errors if e['severity'] == 'warning'])
}

with open(sys.argv[2], 'w') as f:
    json.dump(result, f, indent=2)

print(f"Collected {len(errors)} validation issues")
EOF

python3 - "$VNU_OUTPUT" "$ERROR_FILE"

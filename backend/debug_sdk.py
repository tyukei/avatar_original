from google import genai
from google.genai import types
import inspect

print("Inspecting types.Part")
try:
    print("types.Part members:", dir(types.Part))
    if hasattr(types.Part, 'from_text'):
        print("types.Part.from_text signature:", inspect.signature(types.Part.from_text))
    else:
        print("types.Part.from_text does not exist")
        
    print("Try creating Part from text:")
    try:
        p = types.Part.from_text("hello")
        print("Success:", p)
    except Exception as e:
        print("Failed with from_text:", e)

    print("Try creating Part with constructor:")
    try:
        p = types.Part(text="hello")
        print("Success:", p)
    except Exception as e:
        print("Failed with constructor:", e)

except Exception as e:
    print("General error:", e)

import google.generativeai as genai
import os
from dotenv import load_dotenv


load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=api_key)

model_name = "models/gemini-2.5-flash-preview-tts"
print(f"Testing {model_name}...")

try:
    print("inspecting GenerationConfig...")
    import inspect

    print(inspect.signature(genai.types.GenerationConfig))

    model = genai.GenerativeModel(model_name)  # Restore model init

    # Try passing raw dict to bypass GenerationConfig __init__ restriction if possible
    # or rely on internal proto handling
    config_dict = {"response_modalities": ["AUDIO"]}

    print(f"Testing with config: {config_dict}")
    # Try a longer, more conversational prompt like the avatar would generate
    test_text = "こんにちは！今日はいい天気ですね。何かお手伝いしましょうか？"
    prompt = f"Please read the following text: {test_text}"
    print(f"Input prompt: {prompt}")

    response = model.generate_content(prompt, generation_config=config_dict)

    print("Response parts:", response.parts)
    for part in response.parts:
        if part.inline_data:
            print("Found inline data!")
            print("Mime type:", part.inline_data.mime_type)
            # print("Data len:", len(part.inline_data.data))

except Exception as e:
    print(f"Error: {e}")

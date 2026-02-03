from google import genai
from google.genai import types
import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=api_key)

model_name = "models/gemini-2.5-flash-preview-tts"
print(f"Testing {model_name}...")

try:
    test_text = "こんにちは！今日はいい天気ですね。何かお手伝いしましょうか？"
    prompt = f"Please read the following text: {test_text}"
    print(f"Input prompt: {prompt}")

    response = client.models.generate_content(
        model=model_name,
        contents=prompt,
        config=types.GenerateContentConfig(response_modalities=["AUDIO"]),
    )

    print("Response candidates:", response.candidates)
    if response.candidates and response.candidates[0].content:
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                print("Found inline data!")
                print("Mime type:", part.inline_data.mime_type)
                # print("Data len:", len(part.inline_data.data))

except Exception as e:
    print(f"Error: {e}")

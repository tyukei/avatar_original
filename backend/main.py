import os
import json
import tomllib

import asyncio
import logging
import websockets
import firebase_admin
from firebase_admin import auth
from firebase_admin import auth
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
import google.generativeai as genai
from google.cloud import texttospeech
import base64
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize firebase app
try:
    firebase_admin.get_app()
except ValueError:
    firebase_admin.initialize_app()

# Logger setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment variables
API_KEY = os.getenv("GEMINI_API_KEY")
PORT = int(os.getenv("PORT", 8080))

if not API_KEY:
    logger.fatal("GEMINI_API_KEY environment variable is required")
    exit(1)

app = FastAPI()

# CORS middleware (Go equivalent: CheckOrigin returns true)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_URL = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={API_KEY}"

# Configure GenAI
genai.configure(api_key=API_KEY)

# Initialize TTS Client
# Note: This requires Application Default Credentials (ADC) to be set up.
try:
    tts_client = texttospeech.TextToSpeechClient()
except Exception as e:
    logger.warning(f"Failed to initialize TextToSpeechClient: {e}")
    tts_client = None

class ChatMessage(BaseModel):
    role: str
    text: str

class TextToAudioRequest(BaseModel):
    text: str
    history: List[ChatMessage] = []
    user_name: Optional[str] = "User"
    personality: Optional[str] = "フレンドリーで親しみやすい口調を心がけてください"

def synthesize_speech(text: str) -> str:
    """Synthesizes speech using Gemini 2.5 Flash TTS model via Generative AI API."""
    try:
        # Use the specific TTS model
        model = genai.GenerativeModel("models/gemini-2.5-flash-preview-tts")
        
        # Request AUDIO modality explicitly
        resp = model.generate_content(
            text,
            generation_config={"response_modalities": ["AUDIO"]}
        )
        
        # Extract audio data from the first part
        for part in resp.parts:
            if part.inline_data:
                # Return base64 encoded string directly from the blob
                # inline_data.data is bytes
                return base64.b64encode(part.inline_data.data).decode("utf-8")
        
        raise ValueError("No audio content generated")

    except Exception as e:
        logger.error(f"TTS Error: {e}")
        # Identify if fallback is needed or just re-raise
        raise e

@app.post("/chat/text_to_audio")
async def chat_text_to_audio(request: TextToAudioRequest):
    try:
        # 1. Generate text with Gemini
        model = genai.GenerativeModel("gemini-2.5-flash")
        
        system_instruction = f"""あなたは音声アバターです。以下のルールに従ってください：
- 日本語で会話してください
- 返答は短く、話し言葉を使ってください
- 不必要に長い説明は避けてください
- 会話の相手の名前は「{request.user_name}」です。名前で呼びかけてください。
- 性格・口調の設定: {request.personality}
- 会話の相手として自然に振る舞ってください"""

        chat = model.start_chat(history=[
            {"role": "user" if m.role == "user" else "model", "parts": [m.text]}
            for m in request.history
        ])
        
        # Add system instruction effect by prepending or using system_instruction argument if supported by start_chat in this SDK version
        # For simple compatibility, we can prepend it to the history or strictly set it.
        # gemini-1.5-flash supports system_instruction on init.
        model_with_instruction = genai.GenerativeModel(
            "gemini-2.5-flash",
            system_instruction=system_instruction
        )
        chat = model_with_instruction.start_chat(history=[
            {"role": "user" if m.role == "user" else "model", "parts": [m.text]}
            for m in request.history
        ])

        response = chat.send_message(request.text)
        response_text = response.text

        # 2. Synthesize Audio
        audio_base64 = synthesize_speech(response_text)

        # 3. Return
        return JSONResponse({
            "text": response_text,
            "audio": audio_base64, # base64 mp3
            "transcript": response_text
        })

    except Exception as e:
        logger.error(f"Error in text_to_audio: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/version")
async def get_version():
    try:
        with open("pyproject.toml", "rb") as f:
            data = tomllib.load(f)
            version = data.get("project", {}).get("version", "unknown")
            return {"version": version}
    except Exception as e:
        logger.error(f"Failed to read version: {e}")
        return {"version": "unknown"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    # 1. Wait for initial configuration message
    user_name = "ユーザー"
    personality = "フレンドリーで親しみやすい口調を心がけてください"
    user_id = None

    try:
        # Wait for the first message which should be the config
        # Set a timeout to avoid hanging if client is old version
        init_data = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
        init_msg = json.loads(init_data)

        if init_msg.get("type") == "config":
            user_name = init_msg.get("userName") or user_name
            personality = init_msg.get("personality") or personality
            token = init_msg.get("token")
            
            if token:
                try:
                    decoded_token = auth.verify_id_token(token)
                    user_id = decoded_token['uid']
                    # Use name from token if not provided (or overwrite?)
                    # For now just log it
                    logger.info(f"User authenticated: {user_id}, Name in token: {decoded_token.get('name')}")
                    # You could verify email_verified etc. here
                except Exception as e:
                    logger.warning(f"Token verification failed: {e}")

            logger.info(f"Config received: Name={user_name}, Personality={personality}, UID={user_id}")
        else:
            # If not config (e.g. audio), we might have lost the first chunk or it's an old client.
            # In this case, we proceed with defaults, but we need to handle this message later.
            # For simplicity, we assume the frontend is updated to send config first.
            logger.warning("First message was not config. Using defaults.")
    except Exception as e:
        logger.warning(
            f"Failed to receive config (timeout or error): {e}. Using defaults."
        )

    # Construct System Instruction
    system_instruction_text = f"""あなたは音声アバターです。以下のルールに従ってください：
- 日本語で会話してください
- 返答は短く、話し言葉を使ってください
- 不必要に長い説明は避けてください
- 会話の相手の名前は「{user_name}」です。名前で呼びかけてください。
- 性格・口調の設定: {personality}
- 会話の相手として自然に振る舞ってください"""

    try:
        async with websockets.connect(GEMINI_URL) as gemini_ws:
            # Send setup message
            setup_msg = {
                "setup": {
                    "model": "models/gemini-2.5-flash-native-audio-preview-12-2025",
                    "generationConfig": {
                        "responseModalities": ["AUDIO"],
                        "speechConfig": {
                            "voiceConfig": {
                                "prebuiltVoiceConfig": {"voiceName": "Aoede"}
                            }
                        },
                    },
                    "systemInstruction": {"parts": [{"text": system_instruction_text}]},
                    "outputAudioTranscription": {},
                    "inputAudioTranscription": {},
                }
            }

            await gemini_ws.send(json.dumps(setup_msg))

            # Wait for setup response
            setup_response = await gemini_ws.recv()
            logger.info(f"Setup response: {setup_response}")

            async def client_to_gemini():
                try:
                    while True:
                        data = await websocket.receive_text()
                        client_msg = json.loads(data)

                        if client_msg.get("type") == "audio":
                            gemini_input = {
                                "realtimeInput": {
                                    "mediaChunks": [
                                        {
                                            "mimeType": "audio/pcm;rate=16000",
                                            "data": client_msg["audio"],
                                        }
                                    ]
                                }
                            }
                            await gemini_ws.send(json.dumps(gemini_input))
                except WebSocketDisconnect:
                    logger.info("Client disconnected")
                except Exception as e:
                    logger.error(f"Error in client_to_gemini: {e}")

            async def gemini_to_client():
                try:
                    while True:
                        message = await gemini_ws.recv()
                        response = json.loads(message)

                        server_content = response.get("serverContent", {})

                        # Interruption
                        if server_content.get("interrupted"):
                            await websocket.send_json({"type": "interrupted"})
                            continue

                        # Model Tune (Audio/Text)
                        model_turn = server_content.get("modelTurn", {})
                        parts = model_turn.get("parts", [])
                        for part in parts:
                            inline_data = part.get("inlineData", {})
                            if "data" in inline_data:
                                await websocket.send_json(
                                    {"type": "audio", "audio": inline_data["data"]}
                                )

                            text_data = part.get("text")
                            if text_data:
                                await websocket.send_json(
                                    {"type": "text", "text": text_data}
                                )

                        # Output Transcription
                        output_transcription = server_content.get(
                            "outputTranscription", {}
                        )
                        if "text" in output_transcription:
                            await websocket.send_json(
                                {
                                    "type": "transcript",
                                    "text": output_transcription["text"],
                                }
                            )

                        # Input Transcription
                        input_transcription = server_content.get(
                            "inputTranscription", {}
                        )
                        if "text" in input_transcription:
                            await websocket.send_json(
                                {
                                    "type": "user_transcript",
                                    "text": input_transcription["text"],
                                }
                            )

                        # Turn Complete
                        if server_content.get("turnComplete"):
                            await websocket.send_json({"type": "turn_complete"})

                except Exception as e:
                    logger.error(f"Error in gemini_to_client: {e}")

            # Run both tasks
            await asyncio.gather(client_to_gemini(), gemini_to_client())

    except Exception as e:
        logger.error(f"Connection error: {e}")
        await websocket.close()

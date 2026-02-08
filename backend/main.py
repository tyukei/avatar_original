import os
import json
import tomllib
import io
import wave
import asyncio
import logging


import websockets
import firebase_admin
from firebase_admin import auth, credentials
from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    HTTPException,
    File,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
from google import genai
from google.genai import types

# from google.cloud import texttospeech (Removed)
import base64
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize firebase app
try:
    firebase_admin.get_app()
except ValueError:
    service_account_json = os.getenv("FIREBASE_SERVICE_ACCOUNT")
    if service_account_json:
        try:
            try:
                # Try parsing as JSON first
                cred = credentials.Certificate(json.loads(service_account_json))
            except json.JSONDecodeError:
                # Try Base64 decoding if not valid JSON
                import base64

                decoded_json = base64.b64decode(service_account_json).decode("utf-8")
                cred = credentials.Certificate(json.loads(decoded_json))

            firebase_admin.initialize_app(cred)
            logging.info("Initialized Firebase with service account from env")
        except Exception as e:
            logging.error(f"Failed to load FIREBASE_SERVICE_ACCOUNT: {e}")
            firebase_admin.initialize_app()
    else:
        firebase_admin.initialize_app()

# Logger setup
# ログレベルを環境変数で制御（デフォルトはINFO）
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, log_level, logging.INFO))
logger = logging.getLogger(__name__)

# Environment variables
API_KEY = os.getenv("GEMINI_API_KEY")
PORT = int(os.getenv("PORT", 8080))
MAX_RESPONSE_LENGTH = int(os.getenv("MAX_RESPONSE_LENGTH", 50))

if not API_KEY:
    logger.fatal("GEMINI_API_KEY environment variable is required")
    exit(1)

# システムプロンプトテンプレート（速度最適化版）
def build_system_instruction(user_name: str = "ユーザー", personality: str = "") -> str:
    """
    統一されたシステムプロンプトを生成（速度最適化版）

    Args:
        user_name: ユーザーの名前
        personality: 性格・口調の設定

    Returns:
        システムインストラクション文字列
    """
    max_len = MAX_RESPONSE_LENGTH
    base_instruction = f"""あなたは音声アバターです。以下のルールを厳密に守ってください：

【重要】応答は必ず{max_len}文字以内にしてください。
【重要】一文で簡潔に答えてください。

- 日本語で会話
- 話し言葉を使用
- 相手の名前: {user_name}
- 不要な説明は一切省略
- 質問には直接的に回答"""

    if personality:
        base_instruction += f"\n- 性格・口調: {personality}"

    base_instruction += f"\n\n【再確認】{max_len}文字以内、一文で簡潔に。"

    return base_instruction

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
# Configure GenAI Client
client = genai.Client(api_key=API_KEY)

# tts_client removal
tts_client = None


class ChatMessage(BaseModel):
    role: str
    text: str


class TextToAudioRequest(BaseModel):
    text: str
    history: List[ChatMessage] = []
    user_name: Optional[str] = "User"
    personality: Optional[str] = "フレンドリーで親しみやすい口調を心がけてください"


def pcm_to_wav(pcm_data: bytes, sample_rate: int = 24000) -> bytes:
    """Converts raw PCM data to WAV format."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data)
    return buffer.getvalue()


def synthesize_speech(text: str, personality: str = "") -> str:
    """Synthesizes speech using Gemini 2.5 Flash TTS model via Generative AI API."""
    logger.debug(f"[TTS] Starting synthesis for text: '{text}', personality: '{personality}'")
    try:
        # Use the specific TTS model
        logger.debug(f"[TTS] Calling Gemini TTS model")

        # Request AUDIO modality explicitly
        if personality:
             prompt = f"Please read the following text acting as: {personality}. Text: {text}"
        else:
             prompt = f"Please read the following text: {text}"

        resp = client.models.generate_content(
            model="models/gemini-2.5-flash-preview-tts",
            contents=prompt,
            config=types.GenerateContentConfig(response_modalities=["AUDIO"]),
        )

        # Extract audio data from the first part
        # In new SDK, response structure might differ slightly but usually compatible parts
        if resp.candidates and resp.candidates[0].content:
            for part in resp.candidates[0].content.parts:
                if part.inline_data:
                    # Log the mime_type to verify format
                    mime_type = part.inline_data.mime_type
                    logger.info(f"TTS MimeType received: {mime_type}")

                    audio_data = part.inline_data.data

                    if "audio/L16" in mime_type:
                        # Extract sample rate if possible, default to 24000
                        sample_rate = 24000
                        if "rate=" in mime_type:
                            try:
                                rate_str = mime_type.split("rate=")[1].split(";")[0]
                                sample_rate = int(rate_str)
                            except (ValueError, IndexError):
                                pass
                        logger.info(f"Converting PCM to WAV (rate={sample_rate})")
                        audio_data = pcm_to_wav(audio_data, sample_rate)

                    # Return base64 encoded string directly from the blob
                    # inline_data.data is bytes
                    logger.debug(f"[TTS] Audio data size: {len(audio_data)} bytes")
                    b64_str = base64.b64encode(audio_data).decode("utf-8")
                    # Remove any whitespace/newlines just in case
                    b64_str = b64_str.strip().replace('\n', '').replace('\r', '').replace(' ', '')
                    logger.debug(f"[TTS] Base64 encoded, length: {len(b64_str)} chars")
                    logger.debug(f"[TTS] Base64 preview: {b64_str[:50]}...")
                    return b64_str
        else:
            logger.error(f"TTS Generation failed or blocked. Response: {resp}")

        raise ValueError("No audio content generated")

    except Exception as e:
        logger.error(f"TTS Error: {e}")
        # Identify if fallback is needed or just re-raise
        raise e


@app.post("/chat/text_to_audio")
async def chat_text_to_audio(request: TextToAudioRequest):
    try:
        # 1. Generate text with Gemini
        system_instruction = build_system_instruction(request.user_name, request.personality)

        # Convert history format
        # Old: [{"role": "user", "parts": ["text"]}]
        # New: [types.Content(role="user", parts=[types.Part.from_text("text")])] or dict

        gemini_history = []
        for m in request.history:
            role = "user" if m.role == "user" else "model"
            gemini_history.append(
                types.Content(role=role, parts=[types.Part.from_text(text=m.text)])
            )

        chat = client.chats.create(
            model="gemini-2.5-flash",
            history=gemini_history,
            config=types.GenerateContentConfig(system_instruction=system_instruction),
        )

        response = chat.send_message(request.text)
        response_text = response.text

        # 2. Synthesize Audio
        audio_base64 = synthesize_speech(response_text, request.personality)

        # 3. Return
        return JSONResponse(
            {
                "text": response_text,
                "audio": audio_base64,  # base64 mp3
                "transcript": response_text,
            }
        )

    except Exception as e:
        logger.error(f"Error in text_to_audio: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/speech-to-speech")
async def speech_to_speech(
    audio: UploadFile = File(...),
    user_name: str = "ユーザー",
    personality: str = "",
):
    logger.debug(f"Received speech-to-speech request. Filename: {audio.filename}, User: {user_name}")
    try:
        # Read uploaded audio
        audio_bytes = await audio.read()
        logger.debug(f"Audio bytes read: {len(audio_bytes)} bytes")
        mime_type = audio.content_type

        if not mime_type or mime_type == "application/octet-stream":
            if audio.filename.endswith(".wav"):
                mime_type = "audio/wav"
            elif audio.filename.endswith(".mp3"):
                mime_type = "audio/mp3"
            else:
                mime_type = "audio/wav"  # Default fallback

        # 1. Generate text with Gemini
        system_instruction = build_system_instruction(user_name, personality)

        prompt_parts = [
            types.Part.from_bytes(data=audio_bytes, mime_type=mime_type),
            types.Part.from_text(text="ユーザーの音声を聴いて、返答してください。"),
        ]

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[types.Content(role="user", parts=prompt_parts)],
            config=types.GenerateContentConfig(system_instruction=system_instruction),
        )
        response_text = response.text
        logger.info(f"Generated text: '{response_text}'")

        if not response_text:
            logger.warning("Empty text generated from Gemini. Skipping TTS.")
            # Return empty response or error?
            # Let's return a JSON with no audio but transcript (empty)
            return JSONResponse(
                {
                    "audio": "",
                    "transcript": "(No response generated)",
                    "mime_type": "audio/mp3",
                }
            )

        # 2. Synthesize Audio
        # synthesize_speech returns base64 str (MP3 default)
        audio_b64 = synthesize_speech(response_text, personality)
        logger.debug(f"Audio base64 generated, length: {len(audio_b64)} chars")
        logger.debug(f"Audio base64 preview: {audio_b64[:50]}...")

        # 3. Return as JSON
        # LFM 2.5 server logic also generates text ("text_out").
        # So we align our mock response to return both.
        response_data = {
            "audio": audio_b64,
            "transcript": response_text,
            "mime_type": "audio/mp3",  # synthesize_speech returns MP3 (or WAV wrapped) base64
        }
        logger.debug(f"Returning JSON response with keys: {list(response_data.keys())}")
        return JSONResponse(response_data)

    except Exception as e:
        logger.error(f"Error in speech_to_speech: {e}")
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
                    user_id = decoded_token["uid"]
                    # Use name from token if not provided (or overwrite?)
                    # For now just log it
                    logger.info(
                        f"User authenticated: {user_id}, Name in token: {decoded_token.get('name')}"
                    )
                    # You could verify email_verified etc. here
                except Exception as e:
                    logger.warning(f"Token verification failed: {e}")

            logger.info(
                f"Config received: Name={user_name}, Personality={personality}, UID={user_id}"
            )
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
    system_instruction_text = build_system_instruction(user_name, personality)

    try:
        async with websockets.connect(GEMINI_URL) as gemini_ws:
            # Send setup message
            setup_msg = {
                "setup": {
                    "model": "models/gemini-2.0-flash-exp",
                    "generationConfig": {
                        "responseModalities": ["AUDIO"],
                        "speechConfig": {
                            "voiceConfig": {
                                "prebuiltVoiceConfig": {"voiceName": "Aoede"}
                            }
                        },
                    },
                    "systemInstruction": {"parts": [{"text": system_instruction_text}]},
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

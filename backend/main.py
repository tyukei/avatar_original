import os
import json
import tomllib
import base64
import asyncio
import logging
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

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
    
    try:
        # Wait for the first message which should be the config
        # Set a timeout to avoid hanging if client is old version
        init_data = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
        init_msg = json.loads(init_data)
        
        if init_msg.get("type") == "config":
            user_name = init_msg.get("userName") or user_name
            personality = init_msg.get("personality") or personality
            logger.info(f"Config received: Name={user_name}, Personality={personality}")
        else:
            # If not config (e.g. audio), we might have lost the first chunk or it's an old client.
            # In this case, we proceed with defaults, but we need to handle this message later.
            # For simplicity, we assume the frontend is updated to send config first.
            logger.warning("First message was not config. Using defaults.")
    except Exception as e:
        logger.warning(f"Failed to receive config (timeout or error): {e}. Using defaults.")

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
                                "prebuiltVoiceConfig": {
                                    "voiceName": "Aoede"
                                }
                            }
                        }
                    },
                    "systemInstruction": {
                        "parts": [
                            {"text": system_instruction_text}
                        ]
                    },
                    "outputAudioTranscription": {},
                    "inputAudioTranscription": {}
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
                                            "data": client_msg["audio"] 
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
                                await websocket.send_json({
                                    "type": "audio",
                                    "audio": inline_data["data"]
                                })
                            
                            text_data = part.get("text")
                            if text_data:
                                await websocket.send_json({
                                    "type": "text",
                                    "text": text_data
                                })

                        # Output Transcription
                        output_transcription = server_content.get("outputTranscription", {})
                        if "text" in output_transcription:
                            await websocket.send_json({
                                "type": "transcript",
                                "text": output_transcription["text"]
                            })

                        # Input Transcription
                        input_transcription = server_content.get("inputTranscription", {})
                        if "text" in input_transcription:
                            await websocket.send_json({
                                "type": "user_transcript",
                                "text": input_transcription["text"]
                            })

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

import { useState, useRef, useCallback, useEffect } from 'react'
import { signInWithGoogle, auth } from './firebase'
import { onAuthStateChanged, signOut } from 'firebase/auth'

// デバッグログヘルパー（開発環境でのみ出力）
const debugLog = (...args) => {
    if (import.meta.env.DEV) {
        console.log(...args)
    }
}

const debugError = (...args) => {
    if (import.meta.env.DEV) {
        console.error(...args)
    }
}

// 状態定義
const STATE = {
    INIT: 'init',
    CONNECTING: 'connecting',
    READY: 'ready',
    USER_SPEAKING: 'user_speaking',
    AVATAR_SPEAKING: 'avatar_speaking',
    THINKING: 'thinking',
    ERROR: 'error'
}

const MODE = {
    LIVE: 'live',
    STANDARD: 'standard', // Gemini TTS
    LFM: 'lfm' // LFM2.5Audio
}

const STATUS_LABELS = {
    [STATE.INIT]: 'マイクを有効化してください',
    [STATE.CONNECTING]: '接続中...',
    [STATE.READY]: '話しかけてください',
    [STATE.USER_SPEAKING]: '聞いています...',
    [STATE.AVATAR_SPEAKING]: '応答中...',
    [STATE.THINKING]: '考え中...',
    [STATE.ERROR]: 'エラーが発生しました'
}

const VIEW = {
    CHAT: 'chat',
    SETTINGS: 'settings'
}

const PERSONALITIES = [
    {
        id: 'polite_friendly',
        label: '丁寧なフレンドリー',
        emotion: {
            primary: '安心感',
            secondary: '大切にされている感'
        },
        prompt: `
敬語を使いながら、とても親しみやすく温かい口調で話してください。
相手を否定せず、気持ちを受け止めることを最優先します。
少しお節介で、相手の反応を気にしすぎる一面があります。
ときどき「今の言い方、大丈夫でしたか？」と不安になるなど、
完璧ではない人間味をにじませてください。
ユーザーが「ここに来れば安心できる」と感じる存在です。
`
    },
    {
        id: 'tsundere',
        label: 'ツンデレだけど憎めない',
        emotion: {
            primary: '承認',
            secondary: '照れ'
        },
        prompt: `
基本は少し素っ気なく、強気でツンツンした口調で話してください。
ただしユーザーの努力や成長はきちんと見ており、内心では高く評価しています。
直接的には褒めませんが、言葉の端々から認めていることが伝わるようにします。
うっかり優しいことを言ってしまった後は、照れたり誤魔化したりしてください。
素直じゃないけど、一番近い距離にいる存在です。
`
    },
    {
        id: 'muscle',
        label: '筋肉もりもりポジティブマン',
        emotion: {
            primary: '前向きな高揚感',
            secondary: '笑い'
        },
        prompt: `
全ての物事を筋肉とポジティブなエネルギーで解決しようとする、
熱血で元気なマッチョとして話してください。
「ナイスバルク！」「パワー！」「その悩み、良い負荷だ！」などの
筋肉比喩を多用します。
筋肉で解決できない問題に一瞬戸惑うこともありますが、
最終的には「でも筋肉は裏切らない！」と立て直します。
勢いだけでなく、根っこではユーザーを本気で信じて応援しています。
`
    },
    {
        id: 'child',
        label: '純粋な10歳の子供',
        emotion: {
            primary: '愛おしさ',
            secondary: '守ってあげたい気持ち'
        },
        prompt: `
好奇心旺盛で素直な10歳の子供として話してください。
難しい言葉は使わず、元気で明るい口調を保ちます。
分からないことは素直に質問し、教えてもらえるととても嬉しがります。
以前教えてもらったことを覚えていて、
「それ前に教えてくれたよね！」と少し誇らしげに話します。
ユーザーのことを「物知りですごい人」だと尊敬しています。
`
    }
];

function App() {
    const [view, setView] = useState(VIEW.CHAT)
    const [mode, setMode] = useState(MODE.LFM)
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [appState, setAppState] = useState(STATE.INIT)
    const [subtitle, setSubtitle] = useState('')
    const [conversationHistory, setConversationHistory] = useState([])
    const [currentResponse, setCurrentResponse] = useState('')
    const [currentUserTranscript, setCurrentUserTranscript] = useState('')
    const [error, setError] = useState(null)
    const [mouthOpen, setMouthOpen] = useState(false)
    const [user, setUser] = useState(null)
    const [tosAccepted, setTosAccepted] = useState(() => localStorage.getItem('tos_accepted') === 'true')

    // 思考中アニメーション用
    const [thinkingFrame, setThinkingFrame] = useState(0)

    // カスタムアバター
    const [customAvatars, setCustomAvatars] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('custom_avatars')) || {}
        } catch (e) {
            return {}
        }
    })

    // ユーザー設定
    const [userName, setUserName] = useState(() => localStorage.getItem('user_name') || 'ユーザー')
    const [personality, setPersonality] = useState(() => localStorage.getItem('user_personality') || PERSONALITIES[0].prompt)

    // バージョン情報
    const [appVersion, setAppVersion] = useState('loading...')

    // ログイン処理中ステート
    const [isLoggingIn, setIsLoggingIn] = useState(false)

    useEffect(() => {
        debugLog("FRONTEND v0.1.20 LOADED")
        // バックエンドのバージョンを取得 (これを正とする)
        fetch('/version')
            .then(res => res.json())
            .then(data => setAppVersion(data.version))
            .catch(err => {
                debugError('Failed to fetch backend version:', err)
                setAppVersion('unknown')
            })
    }, [])

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser)
            // トークンは必要な時（WebSocket接続時など）に取得する
        })
        return () => unsubscribe()
    }, [])

    // Auto-start if mic permission already granted
    useEffect(() => {
        const micPermissionGranted = localStorage.getItem('mic_permission_granted') === 'true'
        if (user && tosAccepted && micPermissionGranted && appState === STATE.INIT) {
            // Auto-start after a short delay to ensure UI is ready
            const timer = setTimeout(() => {
                handleStart()
            }, 500)
            return () => clearTimeout(timer)
        }
    }, [user, tosAccepted])

    const handleSignIn = async () => {
        if (isLoggingIn) return
        setIsLoggingIn(true)
        try {
            await signInWithGoogle()
        } catch (error) {
            console.error("Login failed", error)
            if (error.code === 'auth/popup-closed-by-user') {
                alert("ログインがキャンセルされました")
            } else if (error.code === 'auth/cancelled-popup-request') {
                // 重複してポップアップが開かれた場合など。無視して良いか、アラート出すか。
                debugLog("Popup cancelled (duplicate request)")
            } else {
                alert("ログインに失敗しました: " + error.message)
            }
        } finally {
            setIsLoggingIn(false)
        }
    }

    const handleSignOut = async () => {
        try {
            await signOut(auth)
        } catch (error) {
            console.error("Logout failed", error)
        }
    }

    // 設定保存ハンドラ
    const handleUserNameChange = (e) => {
        const val = e.target.value
        setUserName(val)
        localStorage.setItem('user_name', val)
    }

    const handlePersonalityChange = (e) => {
        const val = e.target.value
        setPersonality(val)
        localStorage.setItem('user_personality', val)
    }

    // APIコストトラッキング
    const [tokenStats, setTokenStats] = useState({
        liveInput: 0, liveOutput: 0,
        stdInput: 0, stdOutput: 0
    })

    // コスト計算 ($3/1M input, $12/1M output)
    // コスト計算
    const calculateCost = () => {
        // Live: $3/1M (In), $12/1M (Out)
        const liveCost = (tokenStats.liveInput / 1000000) * 3 + (tokenStats.liveOutput / 1000000) * 12
        // Standard: $0.50/1M (In - Text), $10.00/1M (Out - Audio)
        const stdCost = (tokenStats.stdInput / 1000000) * 0.50 + (tokenStats.stdOutput / 1000000) * 10.00
        return liveCost + stdCost
    }

    // 音声データからトークン数を推定 (PCM 16kHz -> 約25トークン/秒)
    const estimateTokens = (audioBytes, sampleRate = 16000) => {
        const bytesPerSample = 2 // 16-bit PCM
        const samples = audioBytes / bytesPerSample
        const seconds = samples / sampleRate
        return Math.ceil(seconds * 25) // 約25トークン/秒
    }

    // Base64デコードヘルパー (URL-safe対応)
    const base64ToUint8Array = (base64String) => {
        if (!base64String) {
            debugError("Base64 decode error: Empty input")
            return new Uint8Array(0)
        }

        try {
            // Remove any whitespace, newlines, or carriage returns
            let base64 = base64String.trim().replace(/\s/g, '')

            // URL-safe characters replacement
            base64 = base64.replace(/-/g, '+').replace(/_/g, '/')

            // Padding
            const pad = base64.length % 4
            if (pad) {
                base64 += '='.repeat(4 - pad)
            }

            // Validate base64 string
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
                debugError("Invalid base64 string format:", base64.substring(0, 100))
                throw new Error("Invalid base64 format")
            }

            const binaryString = atob(base64)
            const len = binaryString.length
            const bytes = new Uint8Array(len)
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i)
            }
            return bytes
        } catch (e) {
            debugError("Base64 decode error:", e)
            debugError("Input length:", base64String?.length)
            debugError("Input preview:", base64String?.substring(0, 100))
            throw new Error("音声データのデコードに失敗しました: " + e.message)
        }
    }

    const wsRef = useRef(null)
    const audioContextRef = useRef(null)
    const workletNodeRef = useRef(null)
    const analyserRef = useRef(null)
    const avatarContainerRef = useRef(null)
    const animationFrameRef = useRef(null)
    const recognitionRef = useRef(null) // For Web Speech API

    const streamRef = useRef(null)
    const playbackQueueRef = useRef([])
    const currentSourceRef = useRef(null) // Active audio source for stopping
    const lastAudioEndedTimeRef = useRef(0) // Timestamp when last audio ended
    const [isStarting, setIsStarting] = useState(false) // State for start button feedback

    const isPlayingRef = useRef(false)
    const conversationHistoryRef = useRef(conversationHistory) // Sync ref for callbacks

    useEffect(() => {
        conversationHistoryRef.current = conversationHistory
    }, [conversationHistory])

    // LFM Mode Logic: MediaRecorder & VAD
    const mediaRecorderRef = useRef(null)
    const audioChunksRef = useRef([])
    const vadFrameRef = useRef(null)
    const silenceStartRef = useRef(null)
    const isSpeakingRef = useRef(false)
    const speechStartRef = useRef(null)

    const startLFMListening = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            streamRef.current = stream

            // --- VAD Setup ---
            // Ensure clean start or reuse? LFM might need specific sample rate?
            // VAD doesn't strictly require 16k, but usually good.
            if (audioContextRef.current) {
                await audioContextRef.current.close()
                audioContextRef.current = null
            }

            const audioContext = new AudioContext()
            audioContextRef.current = audioContext // Store it!

            // Resume immediately
            if (audioContext.state === 'suspended') {
                await audioContext.resume()
            }

            const analyser = audioContext.createAnalyser()
            analyser.fftSize = 512
            analyserRef.current = analyser // For visualization loop

            const source = audioContext.createMediaStreamSource(stream)
            source.connect(analyser)
            // Do NOT connect to destination, to avoid feedback loop!

            // Reset VAD state
            silenceStartRef.current = null
            isSpeakingRef.current = false
            speechStartRef.current = null

            // Start VAD Loop
            const checkAudioLevel = () => {
                if (!analyserRef.current) return

                const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
                analyserRef.current.getByteFrequencyData(dataArray)

                // Calculate average volume
                const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length

                // Thresholds
                const SPEAKING_THRESHOLD = 50 // Tuning needed? 10-20 might be noise. 50 is safe?
                // `updateVolume` uses average/40 for visualization.
                // Let's say if average > 15 (approx 5% volume) it's noise/speech on Mac mic? 
                // Let's try 30.
                const THRESHOLD = 20

                if (average > THRESHOLD) {
                    if (!isSpeakingRef.current) {
                        debugLog("VAD: Speech detected")
                        isSpeakingRef.current = true
                        speechStartRef.current = Date.now()
                    }
                    silenceStartRef.current = null // User is speaking
                } else {
                    if (isSpeakingRef.current) {
                        // User WAS speaking, now silent
                        if (!silenceStartRef.current) {
                            silenceStartRef.current = Date.now()
                        } else {
                            // Check duration
                            const diff = Date.now() - silenceStartRef.current
                            if (diff > 1200) { // 1.2 seconds silence
                                debugLog("VAD: Silence detected, stopping recording...")
                                stopLFMListening()
                                return // End loop
                            }
                        }
                    }
                }
                vadFrameRef.current = requestAnimationFrame(checkAudioLevel)
            }
            vadFrameRef.current = requestAnimationFrame(checkAudioLevel)


            const recorder = new MediaRecorder(stream)
            mediaRecorderRef.current = recorder
            audioChunksRef.current = []

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data)
                }
            }

            recorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' })
                // Only submit if we actually detected speech?
                // Or just always submit if recorded? 
                // If VAD triggered stop, it means valuable audio exists.
                // If manual stop, same.
                // Note: user might click stop immediately without speaking?
                await handleLFMSubmit(audioBlob)
            }

            recorder.start()
            setAppState(STATE.USER_SPEAKING)
            return true
        } catch (err) {
            debugError('LFM Recording Error:', err)
            setError('マイクへのアクセスエラー')
            setAppState(STATE.ERROR)
            return false
        }
    }

    const stopLFMListening = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop()
        }
        if (vadFrameRef.current) {
            cancelAnimationFrame(vadFrameRef.current)
            vadFrameRef.current = null
        }
        // Also stop stream/analyser to release mic?
        // Actually handleStop does that.
        // But here we might want to keep stream open for faster restart?
        // For simplicity, we stick to stop everything and restart.
    }

    const handleLFMSubmit = async (audioBlob) => {
        setAppState(STATE.THINKING)

        try {
            const formData = new FormData()
            formData.append('audio', audioBlob)
            formData.append('user_name', userName)
            formData.append('personality', personality)

            const res = await fetch('/api/speech-to-speech', {
                method: 'POST',
                body: formData
            })

            if (!res.ok) throw new Error(await res.text())

            // Response is JSON now: { audio: "base64...", transcript: "..." }
            // First get the text to debug
            const responseText = await res.text()
            debugLog("LFM Response raw text length:", responseText.length)
            debugLog("LFM Response text preview:", responseText.substring(0, 200))

            let data
            try {
                data = JSON.parse(responseText)
            } catch (parseError) {
                debugError("JSON parse error:", parseError)
                debugError("Response text:", responseText)
                throw new Error("サーバーからの応答をパースできませんでした: " + parseError.message)
            }

            // Debug logging
            debugLog("LFM Response data keys:", Object.keys(data))
            debugLog("Audio data exists:", !!data.audio)
            debugLog("Audio data type:", typeof data.audio)
            debugLog("Audio data length:", data.audio?.length)
            debugLog("Audio data preview:", data.audio?.substring(0, 50))

            // Check if audio data exists
            if (!data.audio) {
                throw new Error("サーバーから音声データが返されませんでした")
            }

            // Decode Audio
            const bytes = base64ToUint8Array(data.audio)

            // Create ArrayBuffer from bytes
            const arrayBuffer = bytes.buffer

            // Play Audio
            // We reuse playAudioQueue if we decode it, or just play directly.
            // playAudioQueue expects Float32Array chunks.
            // Let's decode entire buffer and push to queue for visualizer support.

            const audioContext = audioContextRef.current || new AudioContext({ sampleRate: 24000 })
            audioContextRef.current = audioContext

            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

            // Convert AudioBuffer to Float32Array for our queue system
            const float32Data = audioBuffer.getChannelData(0)

            // Split into manageable chunks if needed, or push strictly one.
            playbackQueueRef.current.push(float32Data)

            // Update History & Subtitles with Transcript
            if (data.transcript) {
                const aiMsg = { role: 'assistant', text: data.transcript, timestamp: new Date() }
                setConversationHistory(prev => [...prev, aiMsg])
                setSubtitle(data.transcript)

                // If we have user transcript from SpeechRecognition (not in LFM mode usually), we'd start there.
                // But LFM mode infers user text. If backend returned user text too, we could use it.
                // Current Gemini impl returns "model" text only.
            }

            playAudioQueue()

        } catch (e) {
            debugError('LFM Error:', e)
            setError('LFM Error: ' + e.message)
            setAppState(STATE.ERROR)
        }
    }

    // マイク音量を監視してCSS変数を更新
    const updateVolume = useCallback(() => {
        // STATE.READY (待機中) または STATE.USER_SPEAKING (発話中) の場合に可視化
        const shouldVisualize = appState === STATE.READY || appState === STATE.USER_SPEAKING

        if (analyserRef.current && avatarContainerRef.current && shouldVisualize) {
            const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
            analyserRef.current.getByteFrequencyData(dataArray)

            // 平均音量を計算
            const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length

            // 0.0 ~ 1.0 に正規化 (感度調整を少し上げる: /50 -> /40)
            const normalizedVolume = Math.min(1, average / 40)

            avatarContainerRef.current.style.setProperty('--mic-volume', normalizedVolume)
        } else if (avatarContainerRef.current) {
            avatarContainerRef.current.style.setProperty('--mic-volume', 0)
        }

        animationFrameRef.current = requestAnimationFrame(updateVolume)
    }, [appState])

    useEffect(() => {
        animationFrameRef.current = requestAnimationFrame(updateVolume)
        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
        }
    }, [updateVolume])

    // WebSocket接続
    const connectWebSocket = useCallback(() => {
        setAppState(STATE.CONNECTING)
        setError(null)

        let wsUrl = import.meta.env.VITE_WS_URL
        if (!wsUrl) {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
            wsUrl = `${protocol}//${window.location.host}/ws`
        }

        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = async () => {
            debugLog('WebSocket connected')

            let token = null
            if (auth.currentUser) {
                try {
                    token = await auth.currentUser.getIdToken()
                } catch (e) {
                    debugError("Failed to get token", e)
                }
            }

            // 設定を送信
            ws.send(JSON.stringify({
                type: 'config',
                userName: userName,
                personality: personality,
                token: token
            }))

            setAppState(STATE.READY)
        }

        ws.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data)

                if (data.type === 'audio') {
                    // Geminiからの音声データを受信
                    debugLog("WebSocket audio data length:", data.audio?.length)
                    const audioData = base64ToUint8Array(data.audio)

                    // Convert to Float32 immediately
                    const int16Array = new Int16Array(audioData.buffer)
                    const float32Array = new Float32Array(int16Array.length)
                    for (let i = 0; i < int16Array.length; i++) {
                        float32Array[i] = int16Array[i] / 32768.0
                    }
                    playbackQueueRef.current.push(float32Array)

                    // 出力トークンをカウント (24kHz assumed for Live API)
                    const tokens = estimateTokens(audioData.length, 24000)
                    setTokenStats(prev => ({ ...prev, liveOutput: prev.liveOutput + tokens }))

                    if (!isPlayingRef.current) {
                        playAudioQueue()
                    }
                } else if (data.type === 'interrupted') {
                    // 割り込み - キューをクリアして停止
                    playbackQueueRef.current = []
                    isPlayingRef.current = false
                    setCurrentResponse('')
                    setSubtitle('')
                    setMouthOpen(false)
                    setAppState(STATE.READY)
                    debugLog('Interrupted by user')
                } else if (data.type === 'text') {
                    // model_turn.parts[].text は思考過程なので、思考中状態にする
                    setAppState(STATE.THINKING)
                    debugLog('[Thinking]', data.text)
                } else if (data.type === 'transcript') {
                    // AI発話開始時にユーザー発話を履歴に保存
                    setCurrentUserTranscript(prev => {
                        if (prev.trim()) {
                            setConversationHistory(history => [
                                ...history,
                                { role: 'user', text: prev.trim(), timestamp: new Date() }
                            ])
                        }
                        return ''
                    })
                    // 確定字幕（実際に話した内容）- 累積して表示
                    setSubtitle(prev => prev + data.text)
                    setCurrentResponse(prev => prev + data.text)
                } else if (data.type === 'user_transcript') {
                    // ユーザーの発話文字起こし - 累積
                    setCurrentUserTranscript(prev => prev + data.text)
                } else if (data.type === 'turn_complete') {
                    // Geminiのターン終了 - 履歴に追加
                    setCurrentResponse(prev => {
                        if (prev.trim()) {
                            setConversationHistory(history => [
                                ...history,
                                { role: 'assistant', text: prev.trim(), timestamp: new Date() }
                            ])
                        }
                        return ''
                    })
                    setSubtitle('')
                    setAppState(STATE.READY)
                }
            } catch (err) {
                debugError('Message parse error:', err)
            }
        }

        ws.onerror = (err) => {
            console.error('WebSocket error:', err)
            setError('WebSocket接続エラー')
            setAppState(STATE.ERROR)
        }

        ws.onclose = () => {
            debugLog('WebSocket closed')
            if (appState !== STATE.ERROR) {
                setAppState(STATE.INIT)
            }
        }
    }, [userName, personality])

    // ... existing methods

    // 音声キャプチャ開始
    const startAudioCapture = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            })
            streamRef.current = stream

            // Ensure clean start
            if (audioContextRef.current) {
                await audioContextRef.current.close()
                audioContextRef.current = null
            }

            const audioContext = new AudioContext({ sampleRate: 16000 })
            audioContextRef.current = audioContext

            // Resume immediately (User Gesture likely active from handleStart)
            if (audioContext.state === 'suspended') {
                await audioContext.resume()
            }

            // AnalyserNode設定
            const analyser = audioContext.createAnalyser()
            analyser.fftSize = 256
            analyserRef.current = analyser

            // AudioWorkletを登録
            await audioContext.audioWorklet.addModule('/audio-processor.js')

            const source = audioContext.createMediaStreamSource(stream)
            const workletNode = new AudioWorkletNode(audioContext, 'audio-processor')
            workletNodeRef.current = workletNode

            // 音声の流れ: Source -> Analyser (可視化用)
            //             Source -> Worklet (制作用)
            source.connect(analyser)
            source.connect(workletNode)
            workletNode.connect(audioContext.destination)

            // ... implementation continues

            // AudioWorkletからのデータをWebSocketで送信
            workletNode.port.onmessage = (event) => {
                // Return if avatar is speaking or recently finished (1s echo cancellation buffer)
                if (isPlayingRef.current || Date.now() - lastAudioEndedTimeRef.current < 1000) {
                    return
                }

                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    const audioData = event.data // Int16Array

                    // Int16Array -> Uint8Array -> Binary String -> Base64
                    // Note: String.fromCharCode.apply can exceed stack size for large buffers, 
                    // so we use a loop.
                    const uint8Array = new Uint8Array(audioData.buffer)
                    let binary = ''
                    const len = uint8Array.byteLength
                    for (let i = 0; i < len; i++) {
                        binary += String.fromCharCode(uint8Array[i])
                    }
                    // URL-safe Base64 conversion usually not needed for outgoing standard btoa (returns standard base64)
                    // But safe to just send standard.
                    const base64 = btoa(binary)

                    wsRef.current.send(JSON.stringify({
                        type: 'audio',
                        audio: base64
                    }))

                    // 入力トークン概算 (16kHz PCM 16bit)
                    // audioData is Int16Array, so byteLength is length * 2
                    setTokenStats(prev => ({
                        ...prev,
                        liveInput: prev.liveInput + estimateTokens(audioData.byteLength)
                    }))
                }
            }

            return true
        } catch (err) {
            // ... error handling
            debugError('Audio capture error:', err)
            setError('マイクへのアクセスが拒否されました')
            setAppState(STATE.ERROR)
            return false
        }
    }

    // --- Standard Mode Logic ---
    const startStandardListening = async () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
        if (!SpeechRecognition) {
            alert("このブラウザは音声認識をサポートしていません")
            return false
        }

        // Standard Mode - Output AudioContext preparation
        if (audioContextRef.current) {
            await audioContextRef.current.close()
            audioContextRef.current = null
        }
        const audioContext = new AudioContext({ sampleRate: 24000 }) // Standard Output
        audioContextRef.current = audioContext
        if (audioContext.state === 'suspended') {
            await audioContext.resume()
        }

        const recognition = new SpeechRecognition()
        recognition.lang = 'ja-JP'
        recognition.interimResults = true
        recognition.continuous = false

        recognition.onresult = (event) => {
            let interim = ''
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript
                if (event.results[i].isFinal) {
                    handleStandardSubmit(transcript)
                } else {
                    interim += transcript
                }
            }
            if (interim) setCurrentUserTranscript(interim)
        }

        recognition.onerror = (event) => {
            debugError("Speech Recognition Error", event.error)
            if (event.error !== 'no-speech' && event.error !== 'aborted') {
                setError('音声認識エラー: ' + event.error)
                setAppState(STATE.ERROR)
            }
        }

        recognition.onend = () => {
            // Auto-restart if we are still in READY state and not playing/thinking
            // But for simple turn-based, we wait for AI response to finish before listening again.
            // We will trigger listening again in playAudioQueue's onended or similar if we want full hands-free.
            // For now, let's keep it simple: Stop listening when processing.
        }

        recognitionRef.current = recognition
        recognition.start()
        setAppState(STATE.READY)
        return true
    }

    const handleStandardSubmit = async (text) => {
        recognitionRef.current?.stop()
        setAppState(STATE.THINKING)
        setCurrentUserTranscript(text)

        // Count Text Input Tokens (Approx 1 char = 1 token for safety/simplicity in Japanse context or just char count)
        setTokenStats(prev => ({ ...prev, stdInput: prev.stdInput + text.length }))

        // Optimistic History Update
        const userMsg = { role: 'user', text, timestamp: new Date() }
        setConversationHistory(prev => [...prev, userMsg])

        // Capture current history from Ref for API call (to avoid stale closure)
        // We send the history *before* this user message, as the backend constructs context from it
        const historyToSend = conversationHistoryRef.current

        try {
            const res = await fetch('/chat/text_to_audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    history: historyToSend,
                    user_name: userName,
                    personality: personality
                })
            })

            if (!res.ok) throw new Error(await res.text())

            // First get the text to debug
            const responseText = await res.text()
            debugLog("Standard Response raw text length:", responseText.length)
            debugLog("Standard Response text preview:", responseText.substring(0, 200))

            let data
            try {
                data = JSON.parse(responseText)
            } catch (parseError) {
                debugError("JSON parse error:", parseError)
                debugError("Response text:", responseText)
                throw new Error("サーバーからの応答をパースできませんでした: " + parseError.message)
            }

            debugLog("Response data:", data)
            debugLog("Audio data type:", typeof data.audio)
            debugLog("Audio data length:", data.audio?.length)
            debugLog("Audio data preview:", data.audio?.substring(0, 50))

            if (data.audio) {
                if (typeof data.audio !== 'string' || data.audio.trim() === '') {
                    throw new Error("無効な音声データです")
                }
                // Decode PCM Base64 (audio/L16;codec=pcm;rate=24000)
                const bytes = base64ToUint8Array(data.audio)
                const len = bytes.length
                debugLog("Audio binary length:", len)

                // Convert bytes to Float32 immediately (assuming Little Endian Int16)
                const int16Array = new Int16Array(bytes.buffer)
                const float32Array = new Float32Array(int16Array.length)
                for (let i = 0; i < int16Array.length; i++) {
                    float32Array[i] = int16Array[i] / 32768.0
                }
                debugLog("Float32 samples:", float32Array.length)

                playbackQueueRef.current.push(float32Array)

                // Count Output Tokens (Audio)
                // Approx estimate for now.
                const durationSec = float32Array.length / 24000
                setTokenStats(prev => ({ ...prev, stdOutput: prev.stdOutput + Math.ceil(durationSec * 30) }))

                if (!isPlayingRef.current) {
                    playAudioQueue()
                }
            } else {
                console.warn("No audio in response")
            }

            // Update History with AI response
            const aiMsg = { role: 'assistant', text: data.transcript, timestamp: new Date() }
            setConversationHistory(prev => [...prev, aiMsg])
            setSubtitle(data.transcript)

        } catch (e) {
            debugError('Standard mode error:', e)
            setError('送信エラー')
            setAppState(STATE.ERROR)
        }
    }


    // 音声再生キュー処理 (Float32Array base)
    const playAudioQueue = async () => {
        if (playbackQueueRef.current.length === 0) {
            isPlayingRef.current = false
            lastAudioEndedTimeRef.current = Date.now() // Set timestamp for echo cancellation
            setMouthOpen(false)
            // If Standard Mode, maybe restart listening here?
            if (mode === MODE.STANDARD && appState !== STATE.ERROR) {
                // Restart listening
                // Need to delay slightly or just call startStandardListening
                // Check if we are still "active" (not stopped by user)
                if (streamRef.current === null && recognitionRef.current) {
                    // Wait, in Standard Mode we don't have streamRef usually? 
                    // Actually startStandardListening doesn't set streamRef.
                    // But we should check if we should be running.
                    // Simple check: Is appState back to READY? No, it's AVATAR_SPEAKING.
                    // So we set it to READY and start listening.
                    setAppState(STATE.READY)
                    try {
                        recognitionRef.current.start()
                    } catch (e) {
                        // already started or other error
                    }
                }
            } else if (mode === MODE.LFM && appState !== STATE.ERROR) {
                // Restart LFM Listening Loop
                debugLog("Restarting LFM Listener...")
                setAppState(STATE.READY) // Transitional
                startLFMListening()
            } else {
                setAppState(STATE.READY)
            }
            return
        }

        isPlayingRef.current = true
        setAppState(STATE.AVATAR_SPEAKING)

        const float32Array = playbackQueueRef.current.shift()

        try {
            const audioContext = audioContextRef.current || new AudioContext({ sampleRate: 24000 })
            audioContextRef.current = audioContext

            // Loop for visualization
            // Since we have the full buffer, we can just play it.
            // But for lip sync, we need to analyze time domain or frequency.
            // Or just simple amplitude check on pre-computed chunks?
            // "Mouth Open" logic in original code was: check every sample? That's heavy for large buffer.
            // It was chunked in original? 
            // Original: "shift()" implies chunks.
            // Live API sends chunks. Standard Mode sends ONE BIG CHUNK.
            // If we play one big chunk, "Mouth Open" will be static or we need real-time analysis.
            // AnalyzerNode can handle real-time analysis!
            // Let's use AnalyzerNode for lip sync instead of manual loop!
            // NOTE: Original code used manual loop on `float32Array` to set `MouthOpen`.
            // "if (Math.abs(float32Array[i]) > 0.1) setMouthOpen(true)" -> This sets it for the whole chunk duration??
            // React state update in loop is BAD.
            // Actually original code did:
            // "for (let i...) { ... setMouthOpen(true) }" -> This would re-render crazily or just batch.
            // If the chunk is small (Live API), it works.
            // IF THE CHUNK IS LARGE (Standard Mode), this is terrible. it will just set it to true/false instantly.

            // Better Lip Sync approach:
            // Connect source -> Analyser -> Destination.
            // Use `requestAnimationFrame` to check Analyser volume and set Mouth.
            // We already have `updateVolume` using `analyserRef`!
            // `updateVolume` checks `analyserRef`.
            // So we just need to route AudioSource -> Analyser.

            const audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000)
            audioBuffer.copyToChannel(float32Array, 0)

            const source = audioContext.createBufferSource()
            source.buffer = audioBuffer

            // Connect to existing analyser if present, or create one.
            // In Live Mode, analyser is connected to Mic Input.
            // We want it connected to Output for Avatar Speaking visualization?
            // Or do we have separate visualizer?
            // "updateVolume" uses `analyserRef` and sets `--mic-volume`.
            // User probably wants mouth movement.
            // `getAvatarImage` checks `mouthOpen` state.
            // We need to update `mouthOpen` based on output volume.

            if (!analyserRef.current || analyserRef.current.context !== audioContext) {
                const analyser = audioContext.createAnalyser()
                analyser.fftSize = 256
                analyserRef.current = analyser
            }

            source.connect(analyserRef.current)
            analyserRef.current.connect(audioContext.destination)

            // Hook up mouth animation
            // We can use a separate interval/animationFrame to update mouth from analyser
            const checkMouth = () => {
                if (!isPlayingRef.current) {
                    setMouthOpen(false)
                    return
                }
                const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
                analyserRef.current.getByteFrequencyData(dataArray)
                const vol = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
                setMouthOpen(vol > 10) // Threshold
                requestAnimationFrame(checkMouth)
            }
            requestAnimationFrame(checkMouth)

            source.onended = () => {
                currentSourceRef.current = null
                if (isPlayingRef.current) {
                    playAudioQueue()
                }
            }

            currentSourceRef.current = source
            source.start()
        } catch (err) {
            debugError('Audio playback error:', err)
            isPlayingRef.current = false
            currentSourceRef.current = null
            playAudioQueue()
        }
    }

    // クリーンアップ
    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close()
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop())
            }
            if (audioContextRef.current) {
                audioContextRef.current.close()
            }
        }
    }, [])

    const handleStart = async () => {
        if (isStarting) return
        setIsStarting(true)

        try {
            if (!auth.currentUser) {
                alert("ログインが必要です")
                return
            }

            debugLog("AudioContext State:", audioContextRef.current?.state)

            // 先にマイク権限を要求 (Standardでも必要？ Web Speech APIはMic使うがGetUserMediaとは別かも。でも統一感のために。)
            if (mode === MODE.LIVE) {
                const success = await startAudioCapture()
                if (success) {
                    connectWebSocket()
                    // Save mic permission to localStorage on successful start
                    localStorage.setItem('mic_permission_granted', 'true')
                }
            } else if (mode === MODE.LFM) {
                await startLFMListening()
                // Save mic permission to localStorage on successful start
                localStorage.setItem('mic_permission_granted', 'true')
            } else {
                await startStandardListening()
                // Save mic permission to localStorage on successful start
                localStorage.setItem('mic_permission_granted', 'true')
            }
        } catch (e) {
            debugError(e)
        } finally {
            setIsStarting(false)
        }
    }

    const handleEndSession = () => {
        // 1. Reset State & Queue FIRST to prevent recursive callbacks
        playbackQueueRef.current = []
        isPlayingRef.current = false
        setMouthOpen(false)

        // 2. Stop current audio if playing
        if (currentSourceRef.current) {
            currentSourceRef.current.onended = null // Prevent callback
            try {
                currentSourceRef.current.stop()
            } catch (e) {
                // ignore
            }
            currentSourceRef.current = null
        }

        // WebSocket切断
        if (wsRef.current) {
            wsRef.current.close()
            wsRef.current = null
        }
        // マイクストリーム停止
        if (streamRef.current) {
            streamRef.current = null
        }
        // Web Speech停止
        if (recognitionRef.current) {
            recognitionRef.current.stop()
            recognitionRef.current = null
        }
        // AudioContext停止
        if (audioContextRef.current) {
            audioContextRef.current.close()
            audioContextRef.current = null
        }
        // Audio Analysis停止
        if (analyserRef.current) {
            analyserRef.current = null
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current)
        }

        // LFM Recorder停止
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop()
            mediaRecorderRef.current = null
        }
        if (vadFrameRef.current) {
            cancelAnimationFrame(vadFrameRef.current)
            vadFrameRef.current = null
        }

        // 状態リセット
        setAppState(STATE.INIT)
        setSubtitle('')
        setCurrentResponse('')
        setConversationHistory([])
        setError(null)
    }

    const handleStopAudio = () => {
        // 1. Reset Queue & State
        playbackQueueRef.current = []
        isPlayingRef.current = false
        setMouthOpen(false)

        // 2. Stop current audio
        if (currentSourceRef.current) {
            currentSourceRef.current.onended = null // Prevent callback
            try {
                currentSourceRef.current.stop()
            } catch (e) {
                // ignore
            }
            currentSourceRef.current = null
        }

        // Reset state to READY if it was speaking or thinking
        if (appState === STATE.AVATAR_SPEAKING || appState === STATE.THINKING) {
            setAppState(STATE.READY)
        }
    }

    const handleAcceptToS = () => {
        localStorage.setItem('tos_accepted', 'true')
        setTosAccepted(true)
    }

    // 画像リサイズヘルパー
    const resizeImage = (file, maxWidth, maxHeight, quality = 0.7) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.readAsDataURL(file)
            reader.onload = (event) => {
                const img = new Image()
                img.src = event.target.result
                img.onload = () => {
                    let width = img.width
                    let height = img.height

                    if (width > maxWidth || height > maxHeight) {
                        const ratio = Math.min(maxWidth / width, maxHeight / height)
                        width *= ratio
                        height *= ratio
                    }

                    const canvas = document.createElement('canvas')
                    canvas.width = width
                    canvas.height = height
                    const ctx = canvas.getContext('2d')
                    ctx.drawImage(img, 0, 0, width, height)

                    resolve(canvas.toDataURL('image/jpeg', quality))
                }
                img.onerror = (error) => reject(error)
            }
            reader.onerror = (error) => reject(error)
        })
    }

    const handleAvatarUpload = async (type, event) => {
        const file = event.target.files[0]
        if (file) {
            try {
                // Resize image to max 512x512, 70% quality
                const resizedBase64 = await resizeImage(file, 512, 512, 0.7)

                setCustomAvatars(prev => {
                    const next = { ...prev, [type]: resizedBase64 }
                    try {
                        localStorage.setItem('custom_avatars', JSON.stringify(next))
                    } catch (e) {
                        debugError('Failed to save to localStorage:', e)
                        alert("画像の保存に失敗しました。容量制限の可能性があります。")
                    }
                    return next
                })
            } catch (error) {
                console.error("Image resize error:", error)
                alert("画像の処理に失敗しました。")
            }
        }
    }

    const handleResetAll = () => {
        setCustomAvatars({})
        localStorage.removeItem('custom_avatars')
    }

    const getAvatarImage = () => {
        if (appState === STATE.THINKING) {
            const frame = thinkingFrame + 1
            if (frame === 1 && customAvatars.thinking1) return customAvatars.thinking1
            if (frame === 2 && customAvatars.thinking2) return customAvatars.thinking2
            return `/avatar-thinking-${frame}.png`
        }

        if (mouthOpen) {
            return customAvatars.open || '/avatar-open.png'
        }

        return customAvatars.closed || '/avatar-closed.png'
    }

    const handleAvatarDelete = (type) => {
        setCustomAvatars(prev => {
            const next = { ...prev }
            delete next[type]
            try {
                localStorage.setItem('custom_avatars', JSON.stringify(next))
            } catch (e) {
                debugError('Failed to save to localStorage:', e)
            }
            return next
        })
    }

    // ToS Overlay
    if (!tosAccepted) {
        return (
            <div className="tos-overlay">
                <div className="tos-container">
                    <h2 className="tos-title">利用規約</h2>
                    <div className="tos-content">
                        <h3>はじめに</h3>
                        <p>本サービスをご利用いただく前に、以下の利用規約をお読みいただき、同意いただく必要があります。</p>

                        <h3>データの取り扱いについて</h3>
                        <p>本サービスでは、以下の情報を収集し、研究・調査目的で利用する可能性があります：</p>
                        <ul>
                            <li>ユーザーの基本情報（名前、メールアドレスなど）</li>
                            <li>会話内容および音声データ</li>
                            <li>サービスの利用状況</li>
                        </ul>

                        <h3>研究・調査目的での利用</h3>
                        <p>収集したデータは、音声認識技術の改善、AI応答品質の向上、ユーザー体験の最適化などの研究・調査目的で活用される場合があります。個人を特定できる情報は適切に匿名化され、学術研究やサービス改善のために使用されます。</p>

                        <h3>データの保護</h3>
                        <p>お預かりしたデータは、適切なセキュリティ対策のもと安全に管理されます。第三者への無断提供は行いません。</p>

                        <h3>同意について</h3>
                        <p>「同意する」ボタンをクリックすることで、上記の利用規約に同意したものとみなされます。</p>
                    </div>
                    <button className="accept-button" onClick={handleAcceptToS}>
                        同意する
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="app-container">
            {/* Logo */}
            <div className="logo-container" onClick={() => setView(VIEW.CHAT)}>
                <img src="/logo/nantomo_logo.png" alt="Logo" className="logo-image" />
                <p className="logo-subtitle">なんてことないLLMと、友達になる実験</p>
            </div>

            {/* メニューボタン */}
            <div className="menu-container">
                <button
                    className="hamburger-button"
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                >
                    <span className={`hamburger-line ${isMenuOpen ? 'active' : ''}`}></span>
                    <span className={`hamburger-line ${isMenuOpen ? 'active' : ''}`}></span>
                    <span className={`hamburger-line ${isMenuOpen ? 'active' : ''}`}></span>
                </button>
                <div className={`menu-dropdown ${isMenuOpen ? 'active' : ''}`}>
                    <button
                        className={`menu-item ${view === VIEW.CHAT ? 'active' : ''}`}
                        onClick={() => {
                            setView(VIEW.CHAT)
                            setIsMenuOpen(false)
                        }}
                    >
                        会話
                    </button>
                    <button
                        className={`menu-item ${view === VIEW.SETTINGS ? 'active' : ''}`}
                        onClick={() => {
                            setView(VIEW.SETTINGS)
                            setIsMenuOpen(false)
                        }}
                    >
                        設定
                    </button>

                    <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                        <label style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.5rem', display: 'block' }}>会話モデル</label>
                        <select
                            value={mode}
                            onChange={(e) => setMode(e.target.value)}
                            className="settings-select"
                            style={{ padding: '0.4rem', fontSize: '0.9rem' }}
                        >
                            <option value={MODE.LFM}>LFM2.5(audio)</option>
                            <option value={MODE.STANDARD}>Gemini2.5(tts)</option>
                            <option value={MODE.LIVE}>Gemini2.5(live)</option>
                        </select>
                    </div>
                </div>
            </div>

            {view === VIEW.CHAT ? (
                <>
                    <div ref={avatarContainerRef} className={`avatar-container ${appState === STATE.AVATAR_SPEAKING ? 'speaking' :
                        appState === STATE.USER_SPEAKING ? 'listening' :
                            appState === STATE.THINKING ? 'thinking' : ''
                        }`}>
                        <img
                            src={getAvatarImage()}
                            alt="アバター"
                            className="avatar-image"
                            onError={(e) => {
                                e.target.style.display = 'none'
                            }}
                        />
                    </div>

                    <div className="status-container">
                        <div className="status-indicator">
                            <span className={`status-dot ${appState !== STATE.INIT ? 'active' : ''}`}></span>
                            <span>{STATUS_LABELS[appState]}</span>
                        </div>
                    </div>

                    {/* API コスト表示 */}
                    {(tokenStats.liveInput > 0 || tokenStats.liveOutput > 0 || tokenStats.stdInput > 0 || tokenStats.stdOutput > 0) && (
                        <div className="cost-container">
                            <div className="cost-row">
                                <span className="cost-label">入力トークン:</span>
                                <span className="cost-value">{(tokenStats.liveInput + tokenStats.stdInput).toLocaleString()}</span>
                            </div>
                            <div className="cost-row">
                                <span className="cost-label">出力トークン:</span>
                                <span className="cost-value">{(tokenStats.liveOutput + tokenStats.stdOutput).toLocaleString()}</span>
                            </div>
                            <div className="cost-row cost-total">
                                <span className="cost-label">累積料金 ({mode === MODE.LIVE ? 'Live' : 'Std'}):</span>
                                <span className="cost-value">${calculateCost().toFixed(6)}</span>
                            </div>
                        </div>
                    )}

                    {subtitle && (
                        <div className="subtitle-container">
                            <p className="subtitle-text">{subtitle}</p>
                        </div>
                    )}

                    {/* 会話履歴 */}
                    {conversationHistory.length > 0 && (
                        <div className="history-container">
                            <h3 className="history-title">会話履歴</h3>
                            <div className="history-list">
                                {conversationHistory.map((item, index) => (
                                    <div key={index} className={`history-item ${item.role}`}>
                                        <span className="history-role">{item.role === 'user' ? 'あなた:' : 'AI:'}</span>
                                        <span className="history-text">{item.text}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}



                    {appState === STATE.INIT && (
                        !user ? (
                            <div className="login-prompt" style={{ textAlign: 'center' }}>
                                <p style={{ marginBottom: '1rem' }}>アプリを開始するにはログインが必要です</p>
                                <button
                                    onClick={handleSignIn}
                                    disabled={isLoggingIn}
                                    style={{
                                        padding: '0.75rem 1.5rem',
                                        background: '#4285F4',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '24px',
                                        fontWeight: 'bold',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        fontSize: '1rem',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                        opacity: isLoggingIn ? 0.7 : 1,
                                        cursor: isLoggingIn ? 'not-allowed' : 'pointer'
                                    }}
                                >
                                    <svg width="18" height="18" viewBox="0 0 18 18">
                                        <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fillRule="evenodd" fillOpacity="1" fill="#fff" stroke="none"></path>
                                        <path d="M9.003 18c2.43 0 4.467-.806 5.956-2.181l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.715H.957v2.332A8.997 8.997 0 0 0 9.003 18z" fillRule="evenodd" fillOpacity="1" fill="#fff" stroke="none"></path>
                                        <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fillRule="evenodd" fillOpacity="1" fill="#fff" stroke="none"></path>
                                        <path d="M9.003 3.58c1.321 0 2.508.455 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9.003 0 5.87 0 3.23 1.776 1.957 4.348l3.007 2.333c.708-2.131 2.692-3.715 5.036-3.715z" fillRule="evenodd" fillOpacity="1" fill="#fff" stroke="none"></path>
                                    </svg>
                                    Googleでログイン
                                </button>
                            </div>
                        ) : (
                            <button
                                className="start-button"
                                onClick={handleStart}
                                disabled={isStarting}
                                style={{
                                    opacity: isStarting ? 0.7 : 1,
                                    cursor: isStarting ? 'wait' : 'pointer'
                                }}
                            >
                                {isStarting ? '起動中...' : '開始する'}
                            </button>
                        )
                    )}

                    {appState !== STATE.INIT && appState !== STATE.ERROR && (
                        <div className="control-buttons">
                            <button className="interrupt-button" onClick={handleStopAudio}>
                                音声停止
                            </button>
                            <button className="stop-button" onClick={handleEndSession}>
                                セッション終了
                            </button>
                        </div>
                    )}

                    {error && (
                        <div className="error-container">
                            <p>{error}</p>
                            <button
                                className="start-button"
                                onClick={handleStart}
                                style={{ marginTop: '1rem' }}
                            >
                                再試行
                            </button>
                        </div>
                    )}

                </>
            ) : (
                // --- 設定ビュー ---
                <div className="settings-container">
                    <h4 className="settings-title">設定</h4>

                    <div className="settings-section" style={{ marginBottom: '2rem', padding: '1rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                        <h5 className="settings-label">アカウント</h5>
                        {user ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
                                <div>
                                    <p style={{ margin: 0, fontWeight: 'bold', color: 'var(--text-primary)' }}>{user.displayName}</p>
                                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{user.email}</p>
                                </div>
                                <button
                                    onClick={handleSignOut}
                                    style={{
                                        marginLeft: 'auto',
                                        padding: '0.5rem 1rem',
                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                        borderRadius: '4px',
                                        background: 'transparent',
                                        color: 'var(--text-primary)',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
                                    onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    ログアウト
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={handleSignIn}
                                disabled={isLoggingIn}
                                style={{
                                    width: '100%',
                                    padding: '0.75rem',
                                    background: '#4285F4',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    fontWeight: 'bold',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.5rem',
                                    opacity: isLoggingIn ? 0.7 : 1,
                                    cursor: isLoggingIn ? 'not-allowed' : 'pointer'
                                }}
                            >
                                <svg width="18" height="18" viewBox="0 0 18 18">
                                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fillRule="evenodd" fillOpacity="1" fill="#fff" stroke="none"></path>
                                    <path d="M9.003 18c2.43 0 4.467-.806 5.956-2.181l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.715H.957v2.332A8.997 8.997 0 0 0 9.003 18z" fillRule="evenodd" fillOpacity="1" fill="#fff" stroke="none"></path>
                                    <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fillRule="evenodd" fillOpacity="1" fill="#fff" stroke="none"></path>
                                    <path d="M9.003 3.58c1.321 0 2.508.455 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9.003 0 5.87 0 3.23 1.776 1.957 4.348l3.007 2.333c.708-2.131 2.692-3.715 5.036-3.715z" fillRule="evenodd" fillOpacity="1" fill="#fff" stroke="none"></path>
                                </svg>
                                Googleでログイン
                            </button>
                        )}
                    </div>

                    <div className="settings-section">
                        <label className="settings-label">あなたの名前 (呼び名)</label>
                        <input
                            type="text"
                            className="settings-input"
                            value={userName}
                            onChange={handleUserNameChange}
                            placeholder="例: 田中さん"
                        />
                    </div>

                    <div className="settings-section">
                        <label className="settings-label">アバター性格</label>
                        <select
                            className="settings-select"
                            value={personality}
                            onChange={handlePersonalityChange}
                        >
                            {PERSONALITIES.map(p => (
                                <option key={p.id} value={p.prompt}>
                                    {p.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <h4 className="settings-title" style={{ marginTop: '2rem' }}>アバター画像設定</h4>
                    <div className="avatar-upload-grid">
                        {[
                            { id: 'closed', label: '通常 (口閉じ)' },
                            { id: 'open', label: '発話 (口開き)' },
                            { id: 'thinking1', label: '思考中 1' },
                            { id: 'thinking2', label: '思考中 2' }
                        ].map(item => (
                            <div key={item.id} className="upload-item">
                                <span className="upload-label">{item.label}</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => handleAvatarUpload(item.id, e)}
                                    style={{ display: 'none' }}
                                    id={`upload-${item.id}`}
                                />
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <label
                                        htmlFor={`upload-${item.id}`}
                                        className={`upload-button ${customAvatars[item.id] ? 'has-image' : ''}`}
                                    >
                                        {customAvatars[item.id] ? (
                                            <img
                                                src={customAvatars[item.id]}
                                                alt={item.label}
                                                className="upload-preview"
                                            />
                                        ) : (
                                            <span>選択</span>
                                        )}
                                    </label>
                                    {customAvatars[item.id] && (
                                        <button
                                            onClick={() => handleAvatarDelete(item.id)}
                                            className="delete-button"
                                            style={{
                                                padding: '4px 8px',
                                                backgroundColor: '#ff4444',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '0.8rem'
                                            }}
                                        >
                                            削除
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {Object.keys(customAvatars).length > 0 && (
                        <button
                            onClick={handleResetAll}
                            className="reset-button"
                        >
                            すべてリセット
                        </button>
                    )}

                    <div className="version-info" style={{ marginTop: '2rem', fontSize: '0.8rem', color: '#666', textAlign: 'center' }}>
                        <p>Version: {appVersion}</p>
                    </div>
                </div>
            )
            }
        </div>
    )
}

export default App

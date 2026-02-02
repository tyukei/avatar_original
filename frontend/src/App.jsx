import { useState, useRef, useCallback, useEffect } from 'react'
import { signInWithGoogle, auth } from './firebase'
import { onAuthStateChanged, signOut } from 'firebase/auth'

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
    { id: 'friendly', label: '親しみやすい (フレンドリー)', prompt: 'フレンドリーで親しみやすい口調を心がけてください' },
    { id: 'cool', label: '冷静・知的', prompt: '冷静で知的な口調で話してください' },
    { id: 'energetic', label: '元気・活発', prompt: '元気で活発な口調で話してください' },
    { id: 'polite', label: '丁寧 (執事/メイド)', prompt: '執事やメイドのように丁寧で落ち着いた口調で話してください' }
]

function App() {
    const [view, setView] = useState(VIEW.CHAT)
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [appState, setAppState] = useState(STATE.INIT)
    const [subtitle, setSubtitle] = useState('')
    const [conversationHistory, setConversationHistory] = useState([])
    const [currentResponse, setCurrentResponse] = useState('')
    const [currentUserTranscript, setCurrentUserTranscript] = useState('')
    const [error, setError] = useState(null)
    const [mouthOpen, setMouthOpen] = useState(false)
    const [user, setUser] = useState(null)

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

    useEffect(() => {
        // バックエンドのバージョンを取得 (これを正とする)
        fetch('/version')
            .then(res => res.json())
            .then(data => setAppVersion(data.version))
            .catch(err => {
                console.error('Failed to fetch backend version:', err)
                setAppVersion('unknown')
            })
    }, [])

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser)
            if (currentUser) {
                // ログインしたらトークンを取得してバックエンドに送るなどの処理が可能
                currentUser.getIdToken().then(token => {
                    console.log("ID Token:", token)
                    // 必要に応じてlocalStorageやContextに保存
                })
            }
        })
        return () => unsubscribe()
    }, [])

    const handleSignIn = async () => {
        try {
            await signInWithGoogle()
        } catch (error) {
            console.error("Login failed", error)
            alert("ログインに失敗しました")
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
    const [tokenStats, setTokenStats] = useState({ inputTokens: 0, outputTokens: 0 })

    // コスト計算 ($3/1M input, $12/1M output)
    const calculateCost = (input, output) => {
        const inputCost = (input / 1000000) * 3
        const outputCost = (output / 1000000) * 12
        return inputCost + outputCost
    }

    // 音声データからトークン数を推定 (PCM 16kHz -> 約25トークン/秒)
    const estimateTokens = (audioBytes, sampleRate = 16000) => {
        const bytesPerSample = 2 // 16-bit PCM
        const samples = audioBytes / bytesPerSample
        const seconds = samples / sampleRate
        return Math.ceil(seconds * 25) // 約25トークン/秒
    }

    const wsRef = useRef(null)
    const audioContextRef = useRef(null)
    const workletNodeRef = useRef(null)
    const streamRef = useRef(null)
    const playbackQueueRef = useRef([])
    const isPlayingRef = useRef(false)

    // 思考中アニメーションループ
    useEffect(() => {
        let intervalId = null
        if (appState === STATE.THINKING) {
            intervalId = setInterval(() => {
                setThinkingFrame(prev => (prev + 1) % 2)
            }, 250) // 250msごとにフレーム切り替え
        } else {
            setThinkingFrame(0)
        }
        return () => {
            if (intervalId) clearInterval(intervalId)
        }
    }, [appState])

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
            console.log('WebSocket connected')

            let token = null
            if (auth.currentUser) {
                try {
                    token = await auth.currentUser.getIdToken()
                } catch (e) {
                    console.error("Failed to get token", e)
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
                    const audioData = Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))
                    playbackQueueRef.current.push(audioData)

                    // 出力トークンをカウント (24kHz)
                    const tokens = estimateTokens(audioData.length, 24000)
                    setTokenStats(prev => ({ ...prev, outputTokens: prev.outputTokens + tokens }))

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
                    console.log('Interrupted by user')
                } else if (data.type === 'text') {
                    // model_turn.parts[].text は思考過程なので、思考中状態にする
                    setAppState(STATE.THINKING)
                    console.log('[Thinking]', data.text)
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
                console.error('Message parse error:', err)
            }
        }

        ws.onerror = (err) => {
            console.error('WebSocket error:', err)
            setError('WebSocket接続エラー')
            setAppState(STATE.ERROR)
        }

        ws.onclose = () => {
            console.log('WebSocket closed')
            if (appState !== STATE.ERROR) {
                setAppState(STATE.INIT)
            }
        }
    }, [userName, personality])

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

            const audioContext = new AudioContext({ sampleRate: 16000 })
            audioContextRef.current = audioContext

            // AudioWorkletを登録
            await audioContext.audioWorklet.addModule('/audio-processor.js')

            const source = audioContext.createMediaStreamSource(stream)
            const workletNode = new AudioWorkletNode(audioContext, 'audio-processor')
            workletNodeRef.current = workletNode

            // AudioWorkletからのデータをWebSocketで送信
            workletNode.port.onmessage = (event) => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    const pcmData = event.data
                    const base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(pcmData.buffer)))
                    wsRef.current.send(JSON.stringify({
                        type: 'audio',
                        audio: base64
                    }))

                    // 入力トークンをカウント (16kHz)
                    const tokens = estimateTokens(pcmData.byteLength, 16000)
                    setTokenStats(prev => ({ ...prev, inputTokens: prev.inputTokens + tokens }))
                }
            }

            source.connect(workletNode)
            workletNode.connect(audioContext.destination)
            return true

        } catch (err) {
            console.error('Audio capture error:', err)
            setError('マイクへのアクセスが拒否されました')
            setAppState(STATE.ERROR)
            return false
        }
    }

    // 音声再生キュー処理
    const playAudioQueue = async () => {
        if (playbackQueueRef.current.length === 0) {
            isPlayingRef.current = false
            setMouthOpen(false)
            return
        }

        isPlayingRef.current = true
        setAppState(STATE.AVATAR_SPEAKING)

        const audioData = playbackQueueRef.current.shift()

        // PCM to WAV変換して再生
        try {
            const audioContext = audioContextRef.current || new AudioContext({ sampleRate: 24000 })
            const int16Array = new Int16Array(audioData.buffer)
            const float32Array = new Float32Array(int16Array.length)

            for (let i = 0; i < int16Array.length; i++) {
                float32Array[i] = int16Array[i] / 32768.0
                // 音量に基づいて口パク
                if (Math.abs(float32Array[i]) > 0.1) {
                    setMouthOpen(true)
                }
            }

            const audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000)
            audioBuffer.copyToChannel(float32Array, 0)

            const source = audioContext.createBufferSource()
            source.buffer = audioBuffer
            source.connect(audioContext.destination)

            source.onended = () => {
                setMouthOpen(false)
                playAudioQueue()
            }

            source.start()
        } catch (err) {
            console.error('Audio playback error:', err)
            isPlayingRef.current = false
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
        if (!auth.currentUser) {
            alert("ログインが必要です")
            return
        }
        // 先にマイク権限を要求
        const success = await startAudioCapture()
        if (success) {
            connectWebSocket()
        }
    }

    const handleStop = () => {
        // WebSocket切断
        if (wsRef.current) {
            wsRef.current.close()
            wsRef.current = null
        }
        // マイクストリーム停止
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop())
            streamRef.current = null
        }
        // AudioContext停止
        if (audioContextRef.current) {
            audioContextRef.current.close()
            audioContextRef.current = null
        }
        // 再生キュークリア
        playbackQueueRef.current = []
        isPlayingRef.current = false

        // 状態リセット
        setAppState(STATE.INIT)
        setSubtitle('')
        setCurrentResponse('')
        setConversationHistory([])
        setMouthOpen(false)
        setError(null)
    }

    const handleAvatarUpload = (type, event) => {
        const file = event.target.files[0]
        if (file) {
            const reader = new FileReader()
            reader.onloadend = () => {
                const base64 = reader.result
                setCustomAvatars(prev => {
                    const next = { ...prev, [type]: base64 }
                    try {
                        localStorage.setItem('custom_avatars', JSON.stringify(next))
                    } catch (e) {
                        console.error('Failed to save to localStorage:', e)
                    }
                    return next
                })
            }
            reader.readAsDataURL(file)
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
                console.error('Failed to save to localStorage:', e)
            }
            return next
        })
    }

    return (
        <div className="app-container">
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
                        アバター設定
                    </button>
                </div>
            </div>

            {view === VIEW.CHAT ? (
                <>
                    <div className={`avatar-container ${appState === STATE.AVATAR_SPEAKING ? 'speaking' : ''}`}>
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
                    {(tokenStats.inputTokens > 0 || tokenStats.outputTokens > 0) && (
                        <div className="cost-container">
                            <div className="cost-row">
                                <span className="cost-label">入力トークン:</span>
                                <span className="cost-value">{tokenStats.inputTokens.toLocaleString()}</span>
                            </div>
                            <div className="cost-row">
                                <span className="cost-label">出力トークン:</span>
                                <span className="cost-value">{tokenStats.outputTokens.toLocaleString()}</span>
                            </div>
                            <div className="cost-row cost-total">
                                <span className="cost-label">累積料金:</span>
                                <span className="cost-value">${calculateCost(tokenStats.inputTokens, tokenStats.outputTokens).toFixed(6)}</span>
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
                                    style={{
                                        padding: '0.75rem 1.5rem',
                                        background: '#4285F4',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '24px',
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        fontSize: '1rem',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
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
                            <button className="start-button" onClick={handleStart}>
                                開始する
                            </button>
                        )
                    )}

                    {appState !== STATE.INIT && appState !== STATE.ERROR && (
                        <button className="stop-button" onClick={handleStop}>
                            終了する
                        </button>
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

                    <div className="settings-section" style={{ marginBottom: '2rem', padding: '1rem', background: '#f5f5f5', borderRadius: '8px' }}>
                        <h5 className="settings-label">アカウント</h5>
                        {user ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
                                {user.photoURL && <img src={user.photoURL} alt="Profile" style={{ width: '40px', height: '40px', borderRadius: '50%' }} />}
                                <div>
                                    <p style={{ margin: 0, fontWeight: 'bold' }}>{user.displayName}</p>
                                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>{user.email}</p>
                                </div>
                                <button
                                    onClick={handleSignOut}
                                    style={{
                                        marginLeft: 'auto',
                                        padding: '0.5rem 1rem',
                                        border: '1px solid #ccc',
                                        borderRadius: '4px',
                                        background: 'white',
                                        cursor: 'pointer'
                                    }}
                                >
                                    ログアウト
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={handleSignIn}
                                style={{
                                    width: '100%',
                                    padding: '0.75rem',
                                    background: '#4285F4',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.5rem'
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
                        <label className="settings-label">アバターの性格・口調</label>
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
            )}
        </div>
    )
}

export default App

// AudioWorklet Processor for capturing PCM audio
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super()
        this.bufferSize = 4096
        this.buffer = new Int16Array(this.bufferSize)
        this.bufferIndex = 0
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0]
        if (!input || !input[0]) return true

        const inputChannel = input[0]

        for (let i = 0; i < inputChannel.length; i++) {
            // Float32 to Int16 変換
            const sample = Math.max(-1, Math.min(1, inputChannel[i]))
            this.buffer[this.bufferIndex++] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF

            if (this.bufferIndex >= this.bufferSize) {
                // バッファが満杯になったらメインスレッドに送信
                this.port.postMessage(this.buffer.slice())
                this.bufferIndex = 0
            }
        }

        return true
    }
}

registerProcessor('audio-processor', AudioProcessor)

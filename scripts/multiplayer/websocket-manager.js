class WebSocketManager {
    constructor() {
        this.socket = null;
        this.sessionId = null;
        this.isConnected = false;
        this.messageHandlers = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
    }

    async connect(serverUrl = null) {
        let configuredUrl = (typeof window !== 'undefined' && window.ELDERS_WS_URL)
            ? String(window.ELDERS_WS_URL)
            : null;

        if (typeof window !== 'undefined') {
            try {
                const fromStorage = window.localStorage ? window.localStorage.getItem('ELDERS_WS_URL') : null;
                if (fromStorage) configuredUrl = String(fromStorage);
            } catch (e) {}

            try {
                const fromQuery = new URLSearchParams(window.location.search).get('ws');
                if (fromQuery) configuredUrl = String(fromQuery);
            } catch (e) {}
        }

        let resolvedUrl = serverUrl || configuredUrl || 'ws://localhost:8080';

        // Allow providing an https/http URL and convert it to wss/ws.
        if (resolvedUrl.startsWith('https://')) {
            resolvedUrl = 'wss://' + resolvedUrl.slice('https://'.length);
        } else if (resolvedUrl.startsWith('http://')) {
            resolvedUrl = 'ws://' + resolvedUrl.slice('http://'.length);
        }

        return new Promise((resolve, reject) => {
            try {
                this.socket = new WebSocket(resolvedUrl);
                
                this.socket.onopen = () => {
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    console.log('WebSocket connected');
                    resolve();
                };

                this.socket.onmessage = (event) => {
                    this.handleMessage(event.data);
                };

                this.socket.onclose = () => {
                    this.isConnected = false;
                    console.log('WebSocket disconnected');
                    this.attemptReconnect();
                };

                this.socket.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    if (!this.isConnected) {
                        reject(error);
                    }
                };

            } catch (error) {
                reject(error);
            }
        });
    }

    async attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        setTimeout(() => {
            this.connect().catch(error => {
                console.error('Reconnection failed:', error);
            });
        }, this.reconnectDelay * this.reconnectAttempts);
    }

    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'session_id') {
                this.sessionId = message.sessionId;
                return;
            }

            const handler = this.messageHandlers.get(message.type);
            if (handler) {
                handler(message);
            } else {
                console.warn('No handler for message type:', message.type);
            }
        } catch (error) {
            console.error('Failed to handle message:', error);
        }
    }

    onMessage(type, handler) {
        this.messageHandlers.set(type, handler);
    }

    offMessage(type) {
        this.messageHandlers.delete(type);
    }

    async send(type, data = {}) {
        if (!this.isConnected || !this.socket) {
            throw new Error('WebSocket not connected');
        }

        const message = {
            type,
            sessionId: this.sessionId,
            timestamp: Date.now(),
            ...data
        };

        this.socket.send(JSON.stringify(message));
    }

    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
            this.isConnected = false;
            this.sessionId = null;
        }
    }

    getSessionId() {
        return this.sessionId;
    }

    isSocketConnected() {
        return this.isConnected && this.socket && this.socket.readyState === WebSocket.OPEN;
    }
}

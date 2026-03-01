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

        const isLocalHost = (() => {
            try {
                const h = window && window.location ? String(window.location.hostname || '') : '';
                return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
            } catch (e) {
                return false;
            }
        })();

        const defaultUrl = (() => {
            if (isLocalHost) return 'ws://localhost:8080';

            // GitHub Pages is static hosting and will not provide a WS endpoint.
            // Require explicit configuration there.
            try {
                const host = window && window.location ? String(window.location.hostname || '') : '';
                if (host.endsWith('github.io')) return null;
            } catch (e) {
                return null;
            }

            // For deployments where the frontend is served from the same origin as the WS endpoint
            // (ex: Cloudflare Worker serving both HTTP and WebSocket on /ws), default to same-host /ws.
            try {
                const isHttps = window && window.location && window.location.protocol === 'https:';
                const host = window && window.location ? String(window.location.host || window.location.hostname || '') : '';
                if (!host) return null;
                return `${isHttps ? 'wss' : 'ws'}://${host}/ws`;
            } catch (e) {
                return null;
            }
        })();

        let resolvedUrl = serverUrl || configuredUrl || defaultUrl;
        if (!resolvedUrl) {
            throw new Error(
                'No WebSocket server configured. Set ?ws=wss://<host>/ws or localStorage.setItem(\'ELDERS_WS_URL\', \'wss://<host>/ws\').'
            );
        }

        // If the user provided a bare host (no scheme), assume ws/wss based on page protocol.
        if (!resolvedUrl.includes('://')) {
            const isHttps = (() => {
                try {
                    return window && window.location && window.location.protocol === 'https:';
                } catch (e) {
                    return false;
                }
            })();
            resolvedUrl = (isHttps ? 'wss://' : 'ws://') + resolvedUrl;
        }

        // Allow providing an https/http URL and convert it to wss/ws.
        if (resolvedUrl.startsWith('https://')) {
            resolvedUrl = 'wss://' + resolvedUrl.slice('https://'.length);
        } else if (resolvedUrl.startsWith('http://')) {
            resolvedUrl = 'ws://' + resolvedUrl.slice('http://'.length);
        }

        // Hard guard: an HTTPS page generally cannot connect to ws:// (mixed content).
        // We keep this as a clear error instead of a noisy reconnect loop.
        try {
            if (window && window.location && window.location.protocol === 'https:' && resolvedUrl.startsWith('ws://')) {
                throw new Error('This page is HTTPS, so you must use wss:// for the WebSocket server URL.');
            }
        } catch (e) {
            throw e;
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

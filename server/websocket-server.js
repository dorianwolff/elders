const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

class GameServer {
    constructor() {
        this.wss = null;
        this.clients = new Map();
        this.waitingPlayers = [];
        this.activeGames = new Map();
    }

    start(port = 8080) {
        this.wss = new WebSocket.Server({ port });
        
        this.wss.on('connection', (ws) => {
            const sessionId = uuidv4();
            this.clients.set(sessionId, {
                ws,
                sessionId,
                isSearching: false,
                character: null
            });

            // Send session ID to client
            ws.send(JSON.stringify({
                type: 'session_id',
                sessionId
            }));

            ws.on('message', (data) => {
                this.handleMessage(sessionId, data);
            });

            ws.on('close', () => {
                this.handleDisconnect(sessionId);
            });

            console.log(`Client connected: ${sessionId}`);
        });

        console.log(`WebSocket server started on port ${port}`);
    }

    handleMessage(sessionId, data) {
        try {
            const message = JSON.parse(data);
            const client = this.clients.get(sessionId);
            
            if (!client) return;

            switch (message.type) {
                case 'search_match':
                    this.handleSearchMatch(sessionId, message);
                    break;
                case 'cancel_search':
                    this.handleCancelSearch(sessionId);
                    break;
                case 'player_action':
                    this.handlePlayerAction(sessionId, message);
                    break;
                default:
                    console.log('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    }

    handleSearchMatch(sessionId, message) {
        const client = this.clients.get(sessionId);
        if (!client || client.isSearching) return;

        client.isSearching = true;
        client.character = message.character;
        
        // Add to waiting players
        this.waitingPlayers.push(sessionId);
        
        console.log(`Player ${sessionId} searching for match`);
        
        // Try to find a match
        this.tryMatchPlayers();
    }

    handleCancelSearch(sessionId) {
        const client = this.clients.get(sessionId);
        if (!client) return;

        client.isSearching = false;
        client.character = null;
        
        // Remove from waiting players
        const index = this.waitingPlayers.indexOf(sessionId);
        if (index > -1) {
            this.waitingPlayers.splice(index, 1);
        }
        
        console.log(`Player ${sessionId} cancelled search`);
    }

    tryMatchPlayers() {
        if (this.waitingPlayers.length < 2) return;

        // Take first two players
        const player1Id = this.waitingPlayers.shift();
        const player2Id = this.waitingPlayers.shift();
        
        const player1 = this.clients.get(player1Id);
        const player2 = this.clients.get(player2Id);
        
        if (!player1 || !player2) return;

        // Create game
        const gameId = uuidv4();
        const game = {
            gameId,
            player1: player1Id,
            player2: player2Id,
            currentTurn: this.determineFirstPlayer(player1.character, player2.character, gameId),
            turnCount: 0,
            gameState: 'active'
        };
        
        this.activeGames.set(gameId, game);
        
        // Update client states
        player1.isSearching = false;
        player2.isSearching = false;
        
        // Notify players about pairing
        this.sendToClient(player1Id, {
            type: 'pairing_found',
            gameId,
            playerRole: 'player1',
            opponent: {
                sessionId: player2Id,
                character: player2.character
            }
        });
        
        this.sendToClient(player2Id, {
            type: 'pairing_found',
            gameId,
            playerRole: 'player2',
            opponent: {
                sessionId: player1Id,
                character: player1.character
            }
        });
        
        // Start the game
        setTimeout(() => {
            this.startGame(gameId);
        }, 1000);
        
        console.log(`Match created: ${gameId} (${player1Id} vs ${player2Id})`);
    }

    determineFirstPlayer(char1, char2, gameId) {
        const p1Meta = Number(char1 && char1.metaPoints) || 0;
        const p2Meta = Number(char2 && char2.metaPoints) || 0;

        if (p1Meta > p2Meta) {
            return 'player1';
        } else if (p2Meta > p1Meta) {
            return 'player2';
        }

        const str = String(gameId || '');
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return (Math.abs(hash) % 2 === 0) ? 'player1' : 'player2';
    }

    startGame(gameId) {
        const game = this.activeGames.get(gameId);
        if (!game) return;

        const player1 = this.clients.get(game.player1);
        const player2 = this.clients.get(game.player2);
        
        if (!player1 || !player2) return;

        const gameStartData = {
            type: 'game_started',
            gameId,
            player1: {
                sessionId: game.player1,
                character: player1.character
            },
            player2: {
                sessionId: game.player2,
                character: player2.character
            },
            currentTurn: game.currentTurn
        };

        this.sendToClient(game.player1, gameStartData);
        this.sendToClient(game.player2, gameStartData);
        
        console.log(`Game started: ${gameId}`);
    }

    handlePlayerAction(sessionId, message) {
        const { gameId, playerId, actionType, actionData } = message;
        const game = this.activeGames.get(gameId);
        
        if (!game) return;

        const startAt = (typeof message.startAt === 'number' && message.startAt > 0)
            ? message.startAt
            : (Date.now() + 120);
        const actionId = (typeof message.clientActionId === 'string' && message.clientActionId)
            ? message.clientActionId
            : uuidv4();

        const payload = {
            type: 'sync_action',
            gameId,
            actionId,
            clientActionId: actionId,
            startAt,
            playerId,
            actionType,
            actionData
        };

        this.sendToClient(game.player1, payload);
        this.sendToClient(game.player2, payload);
        
        // Check if game ended
        if (actionData.result && actionData.result.gameEnded) {
            this.endGame(gameId, actionData.result.winner);
        }
        
        console.log(`Player action in game ${gameId}: ${actionType}`);
    }

    endGame(gameId, winner) {
        const game = this.activeGames.get(gameId);
        if (!game) return;

        this.sendToClient(game.player1, {
            type: 'game_ended',
            gameId,
            winner
        });
        
        this.sendToClient(game.player2, {
            type: 'game_ended',
            gameId,
            winner
        });
        
        this.activeGames.delete(gameId);
        console.log(`Game ended: ${gameId}, winner: ${winner}`);
    }

    handleDisconnect(sessionId) {
        const client = this.clients.get(sessionId);
        if (!client) return;

        // Remove from waiting players
        const waitingIndex = this.waitingPlayers.indexOf(sessionId);
        if (waitingIndex > -1) {
            this.waitingPlayers.splice(waitingIndex, 1);
        }

        // Handle active games
        for (const [gameId, game] of this.activeGames.entries()) {
            if (game.player1 === sessionId || game.player2 === sessionId) {
                const opponentId = game.player1 === sessionId ? game.player2 : game.player1;
                
                this.sendToClient(opponentId, {
                    type: 'opponent_disconnected',
                    gameId
                });
                
                this.activeGames.delete(gameId);
                console.log(`Game ${gameId} ended due to disconnection`);
            }
        }

        this.clients.delete(sessionId);
        console.log(`Client disconnected: ${sessionId}`);
    }

    sendToClient(sessionId, message) {
        const client = this.clients.get(sessionId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify(message));
        }
    }
}

// Start server if this file is run directly
if (require.main === module) {
    const server = new GameServer();
    server.start(8080);
}

module.exports = GameServer;

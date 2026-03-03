export class Lobby {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.clients = new Map();
    this.waitingPlayers = [];
    this.activeGames = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 400 });
    }

    const pair = new WebSocketPair();
    const clientSocket = pair[0];
    const serverSocket = pair[1];

    const sessionId = crypto.randomUUID();

    serverSocket.accept();

    this.clients.set(sessionId, {
      ws: serverSocket,
      sessionId,
      isSearching: false,
      character: null,
      pingIntervalId: null
    });

    {
      const entry = this.clients.get(sessionId);
      if (entry) {
        entry.pingIntervalId = setInterval(() => {
          try {
            serverSocket.send(JSON.stringify({ type: 'ping', t: Date.now() }));
          } catch (e) {}
        }, 25000);
      }
    }

    serverSocket.addEventListener('message', (event) => {
      this.handleMessage(sessionId, event.data);
    });

    serverSocket.addEventListener('close', () => {
      this.handleDisconnect(sessionId);
    });

    serverSocket.addEventListener('error', () => {
      this.handleDisconnect(sessionId);
    });

    this.sendToClient(sessionId, { type: 'session_id', sessionId });

    return new Response(null, {
      status: 101,
      webSocket: clientSocket
    });
  }

  handleMessage(sessionId, data) {
    try {
      const message = typeof data === 'string' ? JSON.parse(data) : JSON.parse(new TextDecoder().decode(data));
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
          break;
      }
    } catch (e) {
      // ignore malformed messages
    }
  }

  handleSearchMatch(sessionId, message) {
    const client = this.clients.get(sessionId);
    if (!client || client.isSearching) return;

    client.isSearching = true;
    client.character = message.character;

    this.waitingPlayers.push(sessionId);

    this.tryMatchPlayers();
  }

  handleCancelSearch(sessionId) {
    const client = this.clients.get(sessionId);
    if (!client) return;

    client.isSearching = false;
    client.character = null;

    const idx = this.waitingPlayers.indexOf(sessionId);
    if (idx > -1) this.waitingPlayers.splice(idx, 1);
  }

  tryMatchPlayers() {
    if (this.waitingPlayers.length < 2) return;

    const player1Id = this.waitingPlayers.shift();
    const player2Id = this.waitingPlayers.shift();

    const player1 = this.clients.get(player1Id);
    const player2 = this.clients.get(player2Id);

    if (!player1 || !player2) return;

    const gameId = crypto.randomUUID();
    const currentTurn = this.determineFirstPlayer(player1.character, player2.character, gameId);

    const game = {
      gameId,
      player1: player1Id,
      player2: player2Id,
      currentTurn,
      turnCount: 0,
      gameState: 'active'
    };

    this.activeGames.set(gameId, game);

    player1.isSearching = false;
    player2.isSearching = false;

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

    const gameStartData = {
      type: 'game_started',
      gameId,
      player1: {
        sessionId: player1Id,
        character: player1.character
      },
      player2: {
        sessionId: player2Id,
        character: player2.character
      },
      currentTurn
    };

    this.sendToClient(player1Id, gameStartData);
    this.sendToClient(player2Id, gameStartData);
  }

  determineFirstPlayer(char1, char2, gameId) {
    const p1Meta = Number(char1 && char1.metaPoints) || 0;
    const p2Meta = Number(char2 && char2.metaPoints) || 0;

    if (p1Meta > p2Meta) return 'player1';
    if (p2Meta > p1Meta) return 'player2';

    const str = String(gameId || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return (Math.abs(hash) % 2 === 0) ? 'player1' : 'player2';
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
      : crypto.randomUUID();

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

    if (actionData && actionData.result && actionData.result.gameEnded) {
      this.endGame(gameId, actionData.result.winner);
    }
  }

  endGame(gameId, winner) {
    const game = this.activeGames.get(gameId);
    if (!game) return;

    this.sendToClient(game.player1, { type: 'game_ended', gameId, winner });
    this.sendToClient(game.player2, { type: 'game_ended', gameId, winner });

    this.activeGames.delete(gameId);
  }

  handleDisconnect(sessionId) {
    const client = this.clients.get(sessionId);

    if (client && client.pingIntervalId) {
      try {
        clearInterval(client.pingIntervalId);
      } catch (e) {}
      client.pingIntervalId = null;
    }

    const waitingIndex = this.waitingPlayers.indexOf(sessionId);
    if (waitingIndex > -1) {
      this.waitingPlayers.splice(waitingIndex, 1);
    }

    for (const [gameId, game] of this.activeGames.entries()) {
      if (game.player1 === sessionId || game.player2 === sessionId) {
        const opponentSessionId = game.player1 === sessionId ? game.player2 : game.player1;
        this.sendToClient(opponentSessionId, { type: 'opponent_disconnected', gameId });
        this.activeGames.delete(gameId);
      }
    }

    if (client && client.ws) {
      try {
        client.ws.close();
      } catch (e) {}
    }

    this.clients.delete(sessionId);
  }

  sendToClient(sessionId, message) {
    const client = this.clients.get(sessionId);
    if (!client || !client.ws) return;

    try {
      client.ws.send(JSON.stringify(message));
    } catch (e) {}
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const id = env.LOBBY.idFromName('global');
      const stub = env.LOBBY.get(id);
      return stub.fetch(request);
    }

    return new Response('OK', { status: 200 });
  }
};

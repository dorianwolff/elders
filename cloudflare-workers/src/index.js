export class Lobby {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.clients = new Map();
    this.waitingPlayers = [];
    this.waitingRanked = [];
    this.activeGames = new Map();

    this._rankedTickIntervalId = null;
  }

  ensureRankedTick() {
    if (this._rankedTickIntervalId) return;
    this._rankedTickIntervalId = setInterval(() => {
      try {
        this.tryMatchRanked();
        if (!Array.isArray(this.waitingRanked) || this.waitingRanked.length === 0) {
          clearInterval(this._rankedTickIntervalId);
          this._rankedTickIntervalId = null;
        }
      } catch (e) {}
    }, 1000);
  }

  getSupabaseConfig() {
    return {
      url: 'https://hsbqnpzrauguuejsbqhn.supabase.co',
      anonKey: 'sb_publishable_GgEMsZN2q0MWgW7j7NPT9g_Ssh1NEeq'
    };
  }

  async supabaseRest(accessToken, path, init = null) {
    const cfg = this.getSupabaseConfig();
    const url = `${cfg.url}${path}`;
    const headers = new Headers((init && init.headers) ? init.headers : undefined);
    headers.set('apikey', cfg.anonKey);
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const res = await fetch(url, {
      ...(init || {}),
      headers
    });

    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      json = null;
    }

    return { ok: res.ok, status: res.status, data: json };
  }

  clampElo(v) {
    const n = Math.floor(Number(v) || 0);
    return Math.max(0, n);
  }

  rankedWindowMsToDelta(ms) {
    const t = Math.max(0, Math.floor(Number(ms) || 0));
    if (t >= 30000) return 300;
    if (t >= 10000) return 200;
    return 100;
  }

  async getOrCreateUserProfile(accessToken) {
    if (!accessToken) return null;

    const getRes = await this.supabaseRest(
      accessToken,
      '/rest/v1/user_profiles?select=user_id,elo',
      { method: 'GET' }
    );

    if (getRes.ok && Array.isArray(getRes.data) && getRes.data.length > 0) {
      const row = getRes.data[0];
      return {
        userId: row && row.user_id ? String(row.user_id) : null,
        elo: this.clampElo(row && row.elo)
      };
    }

    const upRes = await this.supabaseRest(
      accessToken,
      '/rest/v1/user_profiles?on_conflict=user_id',
      {
        method: 'POST',
        headers: {
          Prefer: 'return=representation'
        },
        body: JSON.stringify({ elo: 1000, updated_at: new Date().toISOString() })
      }
    );

    if (upRes.ok && Array.isArray(upRes.data) && upRes.data.length > 0) {
      const row = upRes.data[0];
      return {
        userId: row && row.user_id ? String(row.user_id) : null,
        elo: this.clampElo(row && row.elo)
      };
    }

    return null;
  }

  async updateOwnElo(accessToken, userId, nextElo) {
    if (!accessToken || !userId) return false;
    const elo = this.clampElo(nextElo);

    const res = await this.supabaseRest(
      accessToken,
      `/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(String(userId))}`,
      {
        method: 'PATCH',
        headers: {
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({ elo, updated_at: new Date().toISOString() })
      }
    );

    return Boolean(res.ok);
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

    const mode = message && message.mode ? String(message.mode).trim().toLowerCase() : 'casual';
    if (mode === 'ranked') {
      this.handleSearchMatchRanked(sessionId, message).catch(() => {});
      return;
    }

    client.isSearching = true;
    client.character = message.character;

    this.waitingPlayers.push(sessionId);

    this.tryMatchPlayers();
  }

  async handleSearchMatchRanked(sessionId, message) {
    const client = this.clients.get(sessionId);
    if (!client || client.isSearching) return;

    const accessToken = message && message.accessToken ? String(message.accessToken) : null;
    const profile = await this.getOrCreateUserProfile(accessToken);
    if (!profile || !profile.userId) {
      this.sendToClient(sessionId, { type: 'pairing_failed', reason: 'Ranked requires sign-in.' });
      return;
    }

    client.isSearching = true;
    client.character = message.character;
    client.matchMode = 'ranked';
    client.accessToken = accessToken;
    client.userId = profile.userId;
    client.elo = this.clampElo(profile.elo);

    const now = Date.now();
    this.waitingRanked.push({ sessionId, joinedAt: now });

    this.ensureRankedTick();
    this.tryMatchRanked();
  }

  handleCancelSearch(sessionId) {
    const client = this.clients.get(sessionId);
    if (!client) return;

    client.isSearching = false;
    client.character = null;
    client.matchMode = null;
    client.accessToken = null;
    client.userId = null;
    client.elo = null;

    const idx = this.waitingPlayers.indexOf(sessionId);
    if (idx > -1) this.waitingPlayers.splice(idx, 1);

    const ridx = this.waitingRanked.findIndex(x => x && x.sessionId === sessionId);
    if (ridx > -1) this.waitingRanked.splice(ridx, 1);

    if (this._rankedTickIntervalId && (!Array.isArray(this.waitingRanked) || this.waitingRanked.length === 0)) {
      try {
        clearInterval(this._rankedTickIntervalId);
      } catch (e) {}
      this._rankedTickIntervalId = null;
    }
  }

  tryMatchRanked() {
    if (!Array.isArray(this.waitingRanked) || this.waitingRanked.length < 2) return;

    const now = Date.now();
    for (let i = 0; i < this.waitingRanked.length; i++) {
      const aEntry = this.waitingRanked[i];
      if (!aEntry || !aEntry.sessionId) continue;
      const aClient = this.clients.get(aEntry.sessionId);
      if (!aClient || !aClient.isSearching) continue;
      const aElo = this.clampElo(aClient.elo);
      const aDelta = this.rankedWindowMsToDelta(now - (aEntry.joinedAt || now));

      let matchIdx = -1;
      for (let j = 0; j < this.waitingRanked.length; j++) {
        if (j === i) continue;
        const bEntry = this.waitingRanked[j];
        if (!bEntry || !bEntry.sessionId) continue;
        const bClient = this.clients.get(bEntry.sessionId);
        if (!bClient || !bClient.isSearching) continue;
        const bElo = this.clampElo(bClient.elo);
        const bDelta = this.rankedWindowMsToDelta(now - (bEntry.joinedAt || now));

        const diff = Math.abs(aElo - bElo);
        if (diff <= aDelta && diff <= bDelta) {
          matchIdx = j;
          break;
        }
      }

      if (matchIdx >= 0) {
        const bEntry = this.waitingRanked[matchIdx];
        const aId = aEntry.sessionId;
        const bId = bEntry.sessionId;
        const first = Math.max(i, matchIdx);
        const second = Math.min(i, matchIdx);
        this.waitingRanked.splice(first, 1);
        this.waitingRanked.splice(second, 1);
        this.createGame(aId, bId, 'ranked');
        return;
      }
    }
  }

  tryMatchPlayers() {
    if (this.waitingPlayers.length < 2) return;

    const player1Id = this.waitingPlayers.shift();
    const player2Id = this.waitingPlayers.shift();

    const player1 = this.clients.get(player1Id);
    const player2 = this.clients.get(player2Id);

    if (!player1 || !player2) return;

    this.createGame(player1Id, player2Id, 'casual');
  }

  createGame(player1Id, player2Id, mode) {
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
      gameState: 'active',
      matchMode: mode || 'casual',
      endProposals: null,
      player1UserId: player1.userId || null,
      player2UserId: player2.userId || null,
      player1AccessToken: player1.accessToken || null,
      player2AccessToken: player2.accessToken || null,
      player1EloStart: this.clampElo(player1.elo),
      player2EloStart: this.clampElo(player2.elo)
    };

    if ((mode || 'casual') === 'ranked') {
      game.endProposals = {
        player1: null,
        player2: null
      };
    }

    this.activeGames.set(gameId, game);

    player1.isSearching = false;
    player2.isSearching = false;

    this.sendToClient(player1Id, {
      type: 'pairing_found',
      gameId,
      playerRole: 'player1',
      opponent: {
        sessionId: player2Id,
        character: player2.character,
        elo: (mode === 'ranked') ? this.clampElo(player2.elo) : undefined
      }
    });

    this.sendToClient(player2Id, {
      type: 'pairing_found',
      gameId,
      playerRole: 'player2',
      opponent: {
        sessionId: player1Id,
        character: player1.character,
        elo: (mode === 'ranked') ? this.clampElo(player1.elo) : undefined
      }
    });

    const gameStartData = {
      type: 'game_started',
      gameId,
      matchMode: mode || 'casual',
      player1: {
        sessionId: player1Id,
        character: player1.character,
        elo: (mode === 'ranked') ? this.clampElo(player1.elo) : undefined
      },
      player2: {
        sessionId: player2Id,
        character: player2.character,
        elo: (mode === 'ranked') ? this.clampElo(player2.elo) : undefined
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
    const { gameId, actionType, actionData } = message;
    if (!gameId || typeof gameId !== 'string') return;
    const game = this.activeGames.get(gameId);
    if (!game) return;

    // Validate that the sender belongs to this game and derive their role.
    // This avoids cross-match interference when many games run concurrently.
    let playerId = null;
    if (game.player1 === sessionId) playerId = 'player1';
    else if (game.player2 === sessionId) playerId = 'player2';
    else return;

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
      if (game.matchMode === 'ranked') {
        this.proposeRankedGameEnd(gameId, playerId, actionData.result.winner);
      } else {
        this.endGame(gameId, actionData.result.winner);
      }
    }
  }

  proposeRankedGameEnd(gameId, proposerRole, winner) {
    const game = this.activeGames.get(gameId);
    if (!game || game.matchMode !== 'ranked') return;

    const role = proposerRole === 'player2' ? 'player2' : 'player1';
    const w = String(winner || '').trim().toLowerCase() === 'player2' ? 'player2' : 'player1';

    if (!game.endProposals) {
      game.endProposals = { player1: null, player2: null };
    }

    game.endProposals[role] = w;

    const p1 = game.endProposals.player1;
    const p2 = game.endProposals.player2;
    if (p1 && p2 && p1 === p2) {
      this.endGame(gameId, p1);
    }
  }

  endGame(gameId, winner) {
    const game = this.activeGames.get(gameId);
    if (!game) return;

    if (game.matchMode === 'ranked') {
      this.applyRankedEloUpdate(game, winner).catch(() => {
        this.sendToClient(game.player1, { type: 'game_ended', gameId, winner });
        this.sendToClient(game.player2, { type: 'game_ended', gameId, winner });
        this.activeGames.delete(gameId);
      });
      return;
    }

    this.sendToClient(game.player1, { type: 'game_ended', gameId, winner });
    this.sendToClient(game.player2, { type: 'game_ended', gameId, winner });

    this.activeGames.delete(gameId);
  }

  async applyRankedEloUpdate(game, winner) {
    const p1Elo = this.clampElo(game.player1EloStart);
    const p2Elo = this.clampElo(game.player2EloStart);

    const winnerRole = (winner === 'player2') ? 'player2' : 'player1';
    const loserRole = (winnerRole === 'player1') ? 'player2' : 'player1';

    const wElo = winnerRole === 'player1' ? p1Elo : p2Elo;
    const lElo = loserRole === 'player1' ? p1Elo : p2Elo;

    const diff = Math.max(0, wElo < lElo ? (lElo - wElo) : 0);
    const bonus = Math.floor(diff / 50);
    const gain = 7 + Math.max(0, bonus);
    const loss = gain;

    const wNext = this.clampElo(wElo + gain);
    const lNext = this.clampElo(lElo - loss);

    const wToken = winnerRole === 'player1' ? game.player1AccessToken : game.player2AccessToken;
    const lToken = loserRole === 'player1' ? game.player1AccessToken : game.player2AccessToken;
    const wUserId = winnerRole === 'player1' ? game.player1UserId : game.player2UserId;
    const lUserId = loserRole === 'player1' ? game.player1UserId : game.player2UserId;

    const wOk = await this.updateOwnElo(wToken, wUserId, wNext);
    const lOk = await this.updateOwnElo(lToken, lUserId, lNext);

    const rankedEloResult = {
      winnerRole,
      gain,
      loserLoss: loss,
      player1: {
        userId: game.player1UserId,
        before: p1Elo,
        after: (winnerRole === 'player1') ? wNext : lNext
      },
      player2: {
        userId: game.player2UserId,
        before: p2Elo,
        after: (winnerRole === 'player2') ? wNext : lNext
      },
      ok: Boolean(wOk && lOk)
    };

    this.sendToClient(game.player1, { type: 'game_ended', gameId: game.gameId, winner, rankedEloResult });
    this.sendToClient(game.player2, { type: 'game_ended', gameId: game.gameId, winner, rankedEloResult });

    this.activeGames.delete(game.gameId);
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

    const ridx = this.waitingRanked.findIndex(x => x && x.sessionId === sessionId);
    if (ridx > -1) {
      this.waitingRanked.splice(ridx, 1);
    }

    if (this._rankedTickIntervalId && (!Array.isArray(this.waitingRanked) || this.waitingRanked.length === 0)) {
      try {
        clearInterval(this._rankedTickIntervalId);
      } catch (e) {}
      this._rankedTickIntervalId = null;
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

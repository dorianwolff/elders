class GameCoordinator {
    constructor() {
        this.wsManager = (typeof WebSocketManager === 'function') ? new WebSocketManager() : null;
        this.pairingManager = null;
        this.playerOne = null;
        this.playerTwo = null;
        this.gameState = null;
        this.isGameActive = false;
        this.characterSystem = new CharacterSystem();
        this.battleStartTime = null;
        this.lastActionResult = null;

        this.matchStats = null;

        this._pendingGameEndWinner = null;
        this._gameEndNavigationStarted = false;

        this._lastSyncActionId = null;

        this._pendingLocalSyncFallbacks = new Map();

        this.battlePageReady = false;
        this.pendingUiUpdates = [];
    }

    resetMatchStats() {
        this.matchStats = {
            skillsUsed: 0,
            damageDealt: 0,
            healingDone: 0,
            ultimateUsed: false
        };
    }

    applyMatchStatsForAction({ isLocalActor, actionType, result }) {
        if (!isLocalActor) return;
        if (!this.matchStats) this.resetMatchStats();

        const dmg = result && typeof result.damage === 'number' ? result.damage : 0;
        const heal = result && typeof result.healing === 'number' ? result.healing : 0;

        if (actionType === 'skill') {
            this.matchStats.skillsUsed += 1;
        }
        if (actionType === 'ultimate') {
            this.matchStats.ultimateUsed = true;
        }

        this.matchStats.damageDealt += Math.max(0, Math.floor(dmg));
        this.matchStats.healingDone += Math.max(0, Math.floor(heal));
    }

    flushPendingUiUpdates() {
        if (!this.battlePageReady) return;
        if (!Array.isArray(this.pendingUiUpdates) || this.pendingUiUpdates.length === 0) return;

        const queued = this.pendingUiUpdates.slice();
        this.pendingUiUpdates.length = 0;
        for (const item of queued) {
            try {
                this._updateGameUIImmediate(item.result);
            } catch (e) {
                console.warn('Failed to flush queued UI update:', e);
            }
        }
    }

    _updateGameUIImmediate(result) {
        if (window.app && window.app.router) {
            const currentPage = window.app.router.getCurrentPage();
            if (currentPage && typeof currentPage.updateGameState === 'function') {
                const gameStateForPlayer = this.gameState.getGameStateForPlayer(this.currentPlayerRole);
                currentPage.updateGameState(gameStateForPlayer, result);
            }
        }
    }

    async init() {
        try {
            if (!this.wsManager && typeof WebSocketManager === 'function') {
                this.wsManager = new WebSocketManager();
            }

            try {
                await this.wsManager.connect();
                console.log('WebSocket connection established');
                
                this.pairingManager = new PairingManager(this.wsManager);
                
                this.setupGameMessageHandlers();
            } catch (wsError) {
                console.warn('WebSocket connection failed, running in offline mode:', wsError.message);
            }
            
            this.playerOne = new PlayerOne(this);
            this.playerTwo = new PlayerTwo(this);
            
            console.log('Game Coordinator initialized');
        } catch (error) {
            console.error('Failed to initialize Game Coordinator:', error);
            throw error;
        }
    }

    setupGameMessageHandlers() {
        this.wsManager.onMessage('game_started', this.handleGameStarted.bind(this));
        this.wsManager.onMessage('sync_action', this.handleSyncAction.bind(this));
        this.wsManager.onMessage('opponent_action', this.handleOpponentAction.bind(this));
        this.wsManager.onMessage('game_ended', this.handleGameEnded.bind(this));
        this.wsManager.onMessage('opponent_disconnected', this.handleOpponentDisconnected.bind(this));
    }

    _sleepUntilStartAt(startAt) {
        const target = Math.max(0, Math.floor(Number(startAt) || 0));
        if (!target) return Promise.resolve();
        const now = Date.now();
        const delta = Math.max(0, target - now);
        if (delta <= 0) return Promise.resolve();
        return new Promise(resolve => setTimeout(resolve, delta));
    }

    async handleSyncAction(message) {
        if (!this.isGameActive || !this.gameState) {
            return;
        }

        try {
            const { actionId, clientActionId, startAt, playerId, actionType, actionData } = message || {};

            try {
                console.log('[sync_action] received', { actionId, clientActionId, startAt, playerId, actionType });
            } catch (e) {}

            if (clientActionId && this._pendingLocalSyncFallbacks && this._pendingLocalSyncFallbacks.has(clientActionId)) {
                try {
                    const t = this._pendingLocalSyncFallbacks.get(clientActionId);
                    if (t) clearTimeout(t);
                } catch (e) {}
                this._pendingLocalSyncFallbacks.delete(clientActionId);
            }

            const dedupeId = clientActionId || actionId;
            if (dedupeId && this._lastSyncActionId === dedupeId) return;
            if (dedupeId) this._lastSyncActionId = dedupeId;

            await this._sleepUntilStartAt(startAt);

            const iAmActor = playerId === this.currentPlayerRole;
            const result = actionData && actionData.result ? actionData.result : null;

            this.applyMatchStatsForAction({
                isLocalActor: iAmActor,
                actionType,
                result
            });

            if (result && result.stateSnapshot && typeof this.gameState.applyStateSnapshot === 'function') {
                await this.gameState.applyStateSnapshot(result.stateSnapshot);
            } else if (!iAmActor) {
                await this.gameState.applyOpponentActionResult(
                    playerId,
                    actionType,
                    actionData ? actionData.skillIndex : undefined,
                    result
                );
            }

            const syncActionKey = clientActionId || actionId || null;
            const resultWithActionInfo = {
                ...(result || {}),
                actionType,
                skillIndex: (actionType === 'skill') ? actionData?.skillIndex : undefined,
                skillId: (actionType === 'skill') ? actionData?.skillId : undefined,
                skillType: (actionType === 'skill') ? actionData?.skillType : undefined,
                skillName: actionData?.skillName,
                ultimateName: actionData?.ultimateName,
                actorCharacterId: actionData?.actorCharacterId,
                _actionSource: iAmActor ? 'local' : 'opponent',
                _syncActionKey: syncActionKey
            };

            this.updateGameUI(resultWithActionInfo);
            this.lastActionResult = resultWithActionInfo;

            if (this._pendingGameEndWinner) {
                this._pendingGameEndWinner = null;
            }

            if (resultWithActionInfo && resultWithActionInfo.gameEnded) {
                await this.handleGameEnd(resultWithActionInfo.winner);
            }
        } catch (error) {
            console.error('Failed to handle sync action:', error);
        }
    }

    async startMatchmaking(character) {
        if (this.isGameActive) {
            throw new Error('Game already active');
        }

        if (!this.pairingManager) {
            throw new Error('Multiplayer not available - WebSocket server not connected');
        }

        return new Promise((resolve, reject) => {
            this.pairingManager.setCallbacks({
                onPairingFound: (pairingData) => {
                    this.handlePairingFound(pairingData);
                    resolve(pairingData);
                },
                onPairingFailed: (reason) => {
                    reject(new Error(`Pairing failed: ${reason}`));
                },
                onPairingCancelled: (reason) => {
                    reject(new Error(`Pairing cancelled: ${reason}`));
                }
            });

            this.pairingManager.startSearching(character).catch(reject);
        });
    }

    async cancelMatchmaking() {
        if (this.pairingManager) {
            await this.pairingManager.cancelSearch();
        }
    }

    handlePairingFound(pairingData) {
        this.gameId = pairingData.gameId;
        this.currentPlayerRole = pairingData.playerRole;
        
        console.log(`Pairing found! Role: ${this.currentPlayerRole}, Game ID: ${this.gameId}`);
    }

    async handleGameStarted(message) {
        try {
            this.isGameActive = true;
            this.battleStartTime = Date.now();
            this._pendingGameEndWinner = null;
            this._gameEndNavigationStarted = false;
            this.lastActionResult = null;
            this._lastSyncActionId = null;
            this.battlePageReady = false;
            if (Array.isArray(this.pendingUiUpdates)) this.pendingUiUpdates.length = 0;

            this.resetMatchStats();
            
            this.gameState = new GameState();
            this.gameState.characterSystem = this.characterSystem;
            this.gameState.skillSystem.characterSystem = this.characterSystem;
            try {
                const selected = this.pairingManager && this.pairingManager.selectedCharacter
                    ? this.pairingManager.selectedCharacter
                    : null;
                if (selected && selected.id) {
                    if (this.currentPlayerRole === 'player1' && message.player1 && message.player1.character) {
                        message.player1.character = JSON.parse(JSON.stringify(selected));
                    }
                    if (this.currentPlayerRole === 'player2' && message.player2 && message.player2.character) {
                        message.player2.character = JSON.parse(JSON.stringify(selected));
                    }
                }
            } catch (e) {
                console.warn('Failed to apply local selected character to game start:', e);
            }

            this.gameState.initializeGame(
                message.player1,
                message.player2,
                message.gameId,
                message.currentTurn
            );

            // Initialize appropriate player based on role
            if (this.currentPlayerRole === 'player1') {
                await this.playerOne.initialize(
                    message.player1.character,
                    this.gameState
                );
            } else {
                await this.playerTwo.initialize(
                    message.player2.character,
                    this.gameState
                );
            }

            console.log('Game started successfully');
            
            this.notifyGameStarted(this.gameState.getGameStateForPlayer(this.currentPlayerRole));
            
        } catch (error) {
            console.error('Failed to start game:', error);
        }
    }

    async handlePlayerAction(playerId, actionType, actionData) {
        if (!this.isGameActive || !this.gameState) {
            return;
        }

        try {
            const hasWs = this.wsManager && typeof this.wsManager.isSocketConnected === 'function'
                ? this.wsManager.isSocketConnected()
                : false;

            if (hasWs) {
                const clientActionId = (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function')
                    ? crypto.randomUUID()
                    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
                const startAt = Date.now() + 120;

                await this.wsManager.send('player_action', {
                    gameId: this.gameId,
                    playerId,
                    actionType,
                    actionData,
                    clientActionId,
                    startAt
                });

                this.lastActionResult = {
                    ...actionData.result,
                    actionType,
                    skillIndex: (actionType === 'skill') ? actionData.skillIndex : undefined,
                    skillId: (actionType === 'skill') ? actionData.skillId : undefined,
                    skillType: (actionType === 'skill') ? actionData.skillType : undefined,
                    actorCharacterId: actionData.actorCharacterId,
                    _actionSource: 'local'
                };

                this.applyMatchStatsForAction({
                    isLocalActor: true,
                    actionType,
                    result: actionData.result
                });

                const fallbackResultWithActionInfo = {
                    ...actionData.result,
                    actionType,
                    skillIndex: (actionType === 'skill') ? actionData.skillIndex : undefined,
                    skillId: (actionType === 'skill') ? actionData.skillId : undefined,
                    skillType: (actionType === 'skill') ? actionData.skillType : undefined,
                    actorCharacterId: actionData.actorCharacterId,
                    skillName: actionData.skillName,
                    ultimateName: actionData.ultimateName,
                    _actionSource: 'local'
                };

                const timeoutId = setTimeout(() => {
                    if (this._pendingLocalSyncFallbacks && this._pendingLocalSyncFallbacks.has(clientActionId)) {
                        this._pendingLocalSyncFallbacks.delete(clientActionId);
                        this.updateGameUI(fallbackResultWithActionInfo);
                    }
                }, Math.max(0, startAt - Date.now()));

                this._pendingLocalSyncFallbacks.set(clientActionId, timeoutId);
            } else {
                const resultWithActionInfo = {
                    ...actionData.result,
                    actionType,
                    skillIndex: (actionType === 'skill') ? actionData.skillIndex : undefined,
                    skillId: (actionType === 'skill') ? actionData.skillId : undefined,
                    skillType: (actionType === 'skill') ? actionData.skillType : undefined,
                    actorCharacterId: actionData.actorCharacterId,
                    skillName: actionData.skillName,
                    ultimateName: actionData.ultimateName,
                    _actionSource: 'local'
                };

                this.applyMatchStatsForAction({
                    isLocalActor: true,
                    actionType,
                    result: actionData.result
                });
                this.updateGameUI(resultWithActionInfo);
                this.lastActionResult = resultWithActionInfo;

                if (actionData.result && actionData.result.gameEnded) {
                    await this.handleGameEnd(actionData.result.winner);
                }
            }

        } catch (error) {
            console.error('Failed to handle player action:', error);
        }
    }

    async handleOpponentAction(message) {
        if (!this.isGameActive || !this.gameState) {
            return;
        }

        try {
            const { actionType, actionData } = message;
            
            const result = actionData.result;
            
            await this.gameState.applyOpponentActionResult(
                message.playerId,
                actionType,
                actionData.skillIndex,
                result
            );

            const resultWithActionInfo = {
                ...result,
                actionType,
                skillIndex: (actionType === 'skill') ? actionData.skillIndex : undefined,
                skillId: (actionType === 'skill') ? actionData.skillId : undefined,
                skillType: (actionType === 'skill') ? actionData.skillType : undefined,
                skillName: actionData.skillName,
                ultimateName: actionData.ultimateName,
                actorCharacterId: actionData.actorCharacterId,
                _actionSource: 'opponent'
            };
            this.updateGameUI(resultWithActionInfo);

            this.lastActionResult = resultWithActionInfo;

            this.playOpponentActionAnimation(actionType, actionData, result); // No await!

            // Check if game ended
            if (result.gameEnded) {
                await this.handleGameEnd(result.winner);
            }

        } catch (error) {
            console.error('Failed to handle opponent action:', error);
        }
    }

    async playOpponentActionAnimation(actionType, actionData, result) {
        const currentPlayer = this.currentPlayerRole === 'player1' ? this.playerOne : this.playerTwo;

        console.log(`Opponent used ${actionType}:`, actionData);

    }

    async useSkill(skillIndex) {
        if (!this.isGameActive || !this.gameState) {
            throw new Error('Game not active');
        }

        if (this.gameState.currentTurn !== this.currentPlayerRole) {
            throw new Error('Not your turn');
        }

        const currentPlayer = this.currentPlayerRole === 'player1' ? this.playerOne : this.playerTwo;
        return await currentPlayer.useSkill(skillIndex);
    }

    async useUltimate() {
        if (!this.isGameActive || !this.gameState) {
            throw new Error('Game not active');
        }

        if (this.gameState.currentTurn !== this.currentPlayerRole) {
            throw new Error('Not your turn');
        }

        const currentPlayer = this.currentPlayerRole === 'player1' ? this.playerOne : this.playerTwo;
        return await currentPlayer.useUltimate();
    }

    async skipTurn() {
        if (!this.isGameActive || !this.gameState) {
            throw new Error('Game not active');
        }

        if (this.gameState.currentTurn !== this.currentPlayerRole) {
            throw new Error('Not your turn');
        }

        const result = await this.gameState.skipTurn(this.currentPlayerRole);

        await this.handlePlayerAction(this.currentPlayerRole, 'skip', {
            result
        });

        return result;
    }

    async surrender() {
        if (!this.isGameActive || !this.gameState) {
            throw new Error('Game not active');
        }

        const result = await this.gameState.surrender(this.currentPlayerRole);

        await this.handlePlayerAction(this.currentPlayerRole, 'surrender', {
            result
        });

        return result;
    }

    updateGameUI(result) {
        // If an action arrives before the battle page is ready, queue it.
        if (!this.battlePageReady) {
            if (Array.isArray(this.pendingUiUpdates)) {
                this.pendingUiUpdates.push({ result });
            }
            return;
        }

        this._updateGameUIImmediate(result);
    }

    notifyGameStarted(gameState) {
        // Navigate to battle page and pass game state
        if (window.app && window.app.router) {
            this.battlePageReady = false;
            window.app.router.navigateTo('battle');
            
            // Wait a bit for the page to load, then update it
            setTimeout(() => {
                const currentPage = window.app.router.getCurrentPage();
                if (currentPage && typeof currentPage.initializeGame === 'function') {
                    Promise.resolve(currentPage.initializeGame(gameState)).finally(() => {
                        this.battlePageReady = true;
                        this.flushPendingUiUpdates();
                    });
                }
            }, 100);
        }
    }

    async handleGameEnd(winner) {
        if (this._gameEndNavigationStarted) {
            return;
        }
        this._gameEndNavigationStarted = true;
        this.isGameActive = false;
        
        console.log('Game ended. Winner:', winner);

        if (window.app && window.app.router) {
            const currentPage = window.app.router.getCurrentPage();
            if (currentPage && typeof currentPage.waitForGameEndPresentation === 'function') {
                try {
                    await currentPage.waitForGameEndPresentation(this.lastActionResult);
                } catch (e) {
                    await new Promise(resolve => setTimeout(resolve, 600));
                }
            } else {
                await new Promise(resolve => setTimeout(resolve, 600));
            }
        } else {
            await new Promise(resolve => setTimeout(resolve, 600));
        }
        
        // Navigate to result page
        if (window.app && window.app.router) {
            const isWinner = winner === this.currentPlayerRole;
            window.app.router.navigateTo('result');
            
            setTimeout(() => {
                const currentPage = window.app.router.getCurrentPage();
                if (currentPage && typeof currentPage.setResult === 'function') {
                    // Get character information from the game state
                    const gameStateForPlayer = this.gameState.getGameStateForPlayer(this.currentPlayerRole);
                    const playerCharacter = gameStateForPlayer.player.character;
                    const opponentCharacter = gameStateForPlayer.opponent.character;
                    
                    // Calculate battle duration
                    const battleDuration = this.battleStartTime ? Date.now() - this.battleStartTime : 0;
                    const minutes = Math.floor(battleDuration / 60000);
                    const seconds = Math.floor((battleDuration % 60000) / 1000);
                    const durationString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                    
                    currentPage.setResult(isWinner, winner, {
                        playerCharacter: playerCharacter,
                        opponentCharacter: opponentCharacter,
                        turnCount: gameStateForPlayer.turnCount,
                        battleDuration: durationString,
                        matchStats: this.matchStats ? { ...this.matchStats } : null
                    });
                }
            }, 100);
        }
    }

    async handleGameEnded(message) {
        const winner = message && message.winner ? message.winner : null;
        if (!winner) return;

        if (this.lastActionResult && this.lastActionResult.gameEnded) {
            let hasPresentationScheduled = false;
            let presentationKeyMatches = false;
            try {
                const currentPage = window.app && window.app.router ? window.app.router.getCurrentPage() : null;
                const expectedKey = this.lastActionResult ? this.lastActionResult._syncActionKey : null;
                const pageKey = currentPage ? currentPage.pendingActionPresentationKey : null;
                presentationKeyMatches = Boolean(expectedKey && pageKey && expectedKey === pageKey);
                hasPresentationScheduled = Boolean(
                    currentPage && (currentPage.pendingActionPresentation || currentPage.pendingCombatTextPresentation)
                );
            } catch (e) {}

            if (hasPresentationScheduled && presentationKeyMatches) {
                await this.handleGameEnd(winner);
                return;
            }
        }

        this._pendingGameEndWinner = winner;

        setTimeout(() => {
            try {
                if (this._gameEndNavigationStarted) return;
                if (!this._pendingGameEndWinner) return;
                this.handleGameEnd(this._pendingGameEndWinner);
                this._pendingGameEndWinner = null;
            } catch (e) {}
        }, 1600);
    }

    async handleOpponentDisconnected(message) {
        console.log('Opponent disconnected');
        
        // Handle opponent disconnection - could auto-win or return to menu
        if (this.isGameActive) {
            await this.handleGameEnd(this.currentPlayerRole);
        }
    }

    getGameState() {
        if (!this.gameState) return null;
        return this.gameState.getGameStateForPlayer(this.currentPlayerRole);
    }

    getCurrentPlayerRole() {
        return this.currentPlayerRole;
    }

    isMyTurn() {
        return this.gameState && this.gameState.currentTurn === this.currentPlayerRole;
    }

    canUseSkill(skillIndex) {
        if (!this.isGameActive || !this.isMyTurn()) return false;
        
        const currentPlayer = this.currentPlayerRole === 'player1' ? this.playerOne : this.playerTwo;
        return currentPlayer.canUseSkill(skillIndex);
    }

    getSkillCooldown(skillIndex) {
        if (!this.isGameActive || !this.gameState) return 0;

        // IMPORTANT: skill palettes can be swapped at runtime (e.g. Kaito weapons).
        // Always resolve skills from the authoritative live gameState, not from PlayerOne/PlayerTwo cached character.
        const liveCharacter = this.gameState.players.get(this.currentPlayerRole)?.character;
        const skills = liveCharacter && Array.isArray(liveCharacter.skills)
            ? liveCharacter.skills
            : [];
        const skill = skills[skillIndex];
        if (!skill || !skill.id) return 0;
        return this.gameState.skillSystem.getSkillCooldown(skill, this.currentPlayerRole);
    }

    canUseUltimate() {
        if (!this.isGameActive || !this.isMyTurn()) return false;
        
        const currentPlayer = this.currentPlayerRole === 'player1' ? this.playerOne : this.playerTwo;
        return currentPlayer.canUseUltimate();
    }

    async cleanup() {
        this.isGameActive = false;
        
        if (this.playerOne) {
            this.playerOne.cleanup();
        }
        
        if (this.playerTwo) {
            this.playerTwo.cleanup();
        }
        
        if (this.pairingManager) {
            await this.pairingManager.cancelSearch();
        }
        
        if (this.wsManager) {
            this.wsManager.disconnect();
        }
        
        this.gameState = null;
        this.gameId = null;
        this.currentPlayerRole = null;
    }
}

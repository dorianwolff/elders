class GameCoordinator {
    constructor() {
        this.wsManager = new WebSocketManager();
        this.pairingManager = null;
        this.playerOne = null;
        this.playerTwo = null;
        this.gameState = null;
        this.currentPlayerRole = null; // 'player1' or 'player2'
        this.gameId = null;
        this.isGameActive = false;
        this.characterSystem = new CharacterSystem();
        this.battleStartTime = null;
        this.lastActionResult = null;
    }

    async init() {
        try {
            // Try to initialize WebSocket connection
            try {
                await this.wsManager.connect();
                console.log('WebSocket connection established');
                
                // Initialize pairing manager
                this.pairingManager = new PairingManager(this.wsManager);
                
                // Set up game-related message handlers
                this.setupGameMessageHandlers();
            } catch (wsError) {
                console.warn('WebSocket connection failed, running in offline mode:', wsError.message);
                // Continue without WebSocket - the game can still work for local testing
            }
            
            // Initialize player instances (these work regardless of WebSocket status)
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
        this.wsManager.onMessage('opponent_action', this.handleOpponentAction.bind(this));
        this.wsManager.onMessage('game_ended', this.handleGameEnded.bind(this));
        this.wsManager.onMessage('opponent_disconnected', this.handleOpponentDisconnected.bind(this));
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
            
            // Initialize game state
            this.gameState = new GameState();
            // Provide access to character templates for runtime transformations
            this.gameState.characterSystem = this.characterSystem;
            this.gameState.skillSystem.characterSystem = this.characterSystem;

            // The local client must be authoritative for its own selected kit (2-of-N skills).
            // Some servers may send a canonical template character; if we accept it verbatim,
            // the battle UI will show the full kit and transforms will preserve the wrong palette.
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
            
            // Notify the UI that the game has started
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
            // Send action to opponent via WebSocket
            await this.wsManager.send('player_action', {
                gameId: this.gameId,
                playerId,
                actionType,
                actionData
            });

            // Update local UI based on action result
            this.updateGameUI({
                ...actionData.result,
                actionType,
                _actionSource: 'local'
            });

            this.lastActionResult = {
                ...actionData.result,
                actionType,
                _actionSource: 'local'
            };

            // Check if game ended
            if (actionData.result.gameEnded) {
                await this.handleGameEnd(actionData.result.winner);
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
            
            // Use the result calculated by the acting player (SINGLE SOURCE OF TRUTH)
            // Don't re-execute the skill - just apply the effects to local state
            const result = actionData.result;
            
            // Apply the pre-calculated effects to our local game state
            await this.gameState.applyOpponentActionResult(
                message.playerId,
                actionType,
                actionData.skillIndex,
                result
            );

            // Update UI IMMEDIATELY with action details
            const resultWithActionInfo = {
                ...result,
                actionType,
                skillName: actionData.skillName,
                ultimateName: actionData.ultimateName,
                actorCharacterId: actionData.actorCharacterId,
                _actionSource: 'opponent'
            };
            this.updateGameUI(resultWithActionInfo);

            this.lastActionResult = resultWithActionInfo;

            // Trigger animations INDEPENDENTLY (non-blocking)
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

        // Log the opponent's action instead of trying to animate it
        // (since we don't have the opponent's character data in our player instances)
        console.log(`Opponent used ${actionType}:`, actionData);

        // NOTE: State changes (HP/shield/counters/effects) are applied from authoritative snapshots.
        // Avoid mutating state again here.
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
        // This will be called by the battle page to update the UI
        if (window.app && window.app.router) {
            const currentPage = window.app.router.getCurrentPage();
            if (currentPage && typeof currentPage.updateGameState === 'function') {
                const gameStateForPlayer = this.gameState.getGameStateForPlayer(this.currentPlayerRole);
                currentPage.updateGameState(gameStateForPlayer, result);
            }
        }
    }

    notifyGameStarted(gameState) {
        // Navigate to battle page and pass game state
        if (window.app && window.app.router) {
            window.app.router.navigateTo('battle');
            
            // Wait a bit for the page to load, then update it
            setTimeout(() => {
                const currentPage = window.app.router.getCurrentPage();
                if (currentPage && typeof currentPage.initializeGame === 'function') {
                    currentPage.initializeGame(gameState);
                }
            }, 100);
        }
    }

    async handleGameEnd(winner) {
        this.isGameActive = false;
        
        console.log('Game ended. Winner:', winner);

        // Per-client presentation timing:
        // - If this client is watching an ultimate (skipAnimations off), wait for video end
        // - Ensure combat text has time to appear before navigating
        // This allows one client to finish early while the other is still in the ultimate.
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
                        battleDuration: durationString
                    });
                }
            }, 100);
        }
    }

    async handleGameEnded(message) {
        await this.handleGameEnd(message.winner);
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
        
        const currentPlayer = this.currentPlayerRole === 'player1' ? this.playerOne : this.playerTwo;
        const skills = currentPlayer && currentPlayer.character && Array.isArray(currentPlayer.character.skills)
            ? currentPlayer.character.skills
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

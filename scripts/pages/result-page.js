class ResultPage extends BasePage {
    constructor() {
        super();
        this.isWinner = false;
        this.winnerRole = null;
        this.dataManager = null;
    }

    getHTML() {
        return `
            <div class="result-page">
                <div class="result-content">
                    <div class="result-versus">
                        <div class="result-avatar-block result-avatar-block--enemy">
                            <div class="result-avatar-row">
                                <div class="result-avatar result-avatar--enemy">
                                    <img id="result-enemy-avatar" alt="Opponent character" />
                                </div>
                                <div class="result-avatar-meta">
                                    <div class="result-avatar-name" id="opponent-character">--</div>
                                    <div class="result-outcome-tag result-outcome-tag--enemy" id="result-enemy-outcome-tag"></div>
                                </div>
                            </div>
                        </div>

                        <div class="result-versus-center">
                            <div class="result-versus-label">VS</div>
                        </div>

                        <div class="result-avatar-block result-avatar-block--you">
                            <div class="result-avatar-row">
                                <div class="result-avatar-meta">
                                    <div class="result-avatar-name" id="your-character">--</div>
                                    <div class="result-outcome-tag result-outcome-tag--you" id="result-your-outcome-tag"></div>
                                </div>
                                <div class="result-avatar result-avatar--you">
                                    <img id="result-your-avatar" alt="Your character" />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="result-outcome">
                        <div class="result-title" id="result-title">Battle Complete</div>
                        <div class="result-subtitle" id="result-subtitle"></div>
                    </div>

                    <div class="result-cards">
                        <div class="result-card">
                            <div class="result-card-title">Battle Summary</div>
                            <div class="result-stat-list">
                                <div class="result-stat">
                                    <div class="result-stat-label">Duration</div>
                                    <div class="result-stat-value" id="battle-duration">--</div>
                                </div>
                                <div class="result-stat">
                                    <div class="result-stat-label">Turns</div>
                                    <div class="result-stat-value" id="total-turns">--</div>
                                </div>
                            </div>
                        </div>

                        <div class="result-card">
                            <div class="result-card-title">Performance</div>
                            <div class="result-stat-list">
                                <div class="result-stat">
                                    <div class="result-stat-label">Skills Used</div>
                                    <div class="result-stat-value" id="skills-used">--</div>
                                </div>
                                <div class="result-stat">
                                    <div class="result-stat-label">Damage Dealt</div>
                                    <div class="result-stat-value" id="damage-dealt">--</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="result-actions">
                    <button class="btn btn-primary btn-large" id="play-again-button">
                        Play Again
                    </button>
                    <button class="btn btn-secondary" id="main-menu-button">
                        Main Menu
                    </button>
                </div>
            </div>
        `;
    }

    async setupEventListeners() {
        this.addEventListener('#play-again-button', 'click', this.handlePlayAgain.bind(this));
        this.addEventListener('#main-menu-button', 'click', this.handleMainMenu.bind(this));
    }

    async onPageLoad() {
        // Wait for data manager to be available
        while (!window.app || !window.app.dataManager) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        this.dataManager = window.app.dataManager;
    }

    async setResult(isWinner, winnerRole, gameData = null) {
        this.isWinner = isWinner;
        this.winnerRole = winnerRole;
        this.gameData = gameData;
        
        this.updateResultDisplay();

        try {
            if (window.EldersAnalytics && typeof window.EldersAnalytics.track === 'function') {
                window.EldersAnalytics.track('match_end', {
                    winnerRole,
                    isWinner,
                    battleDuration: gameData?.battleDuration || null,
                    turnCount: gameData?.turnCount || null,
                    playerCharacterId: gameData?.playerCharacter?.id || null,
                    opponentCharacterId: gameData?.opponentCharacter?.id || null,
                    matchStats: gameData?.matchStats || null
                });
            }
        } catch (e) {}
    }

    updateResultDisplay() {
        const resultTitle = this.querySelector('#result-title');
        const resultSubtitle = this.querySelector('#result-subtitle');
        const yourTag = this.querySelector('#result-your-outcome-tag');
        const enemyTag = this.querySelector('#result-enemy-outcome-tag');

        const isDraw = this.winnerRole === 'draw';

        if (isDraw) {
            resultTitle.textContent = 'Draw';
            resultTitle.className = 'result-title draw';
            resultSubtitle.textContent = "It's a draw.";
        } else if (this.isWinner) {
            resultTitle.textContent = 'Victory!';
            resultTitle.className = 'result-title victory';
            resultSubtitle.textContent = 'Congratulations! You won the battle!';
        } else {
            resultTitle.textContent = 'Defeat';
            resultTitle.className = 'result-title defeat';
            resultSubtitle.textContent = 'Better luck next time!';
        }

        try {
            const mode = this.gameData && this.gameData.matchMode ? String(this.gameData.matchMode) : 'casual';
            const eloRes = this.gameData && this.gameData.rankedEloResult ? this.gameData.rankedEloResult : null;
            const role = this.gameData && this.gameData.playerRole ? String(this.gameData.playerRole) : null;
            if (mode === 'ranked' && eloRes && role && resultSubtitle) {
                const row = role === 'player2' ? eloRes.player2 : eloRes.player1;
                const before = row && typeof row.before !== 'undefined' ? Math.max(0, Math.floor(Number(row.before) || 0)) : null;
                const after = row && typeof row.after !== 'undefined' ? Math.max(0, Math.floor(Number(row.after) || 0)) : null;
                if (before !== null && after !== null) {
                    const delta = after - before;
                    const sign = delta >= 0 ? '+' : '';
                    resultSubtitle.textContent = `${resultSubtitle.textContent}  ELO ${sign}${delta} (${before} → ${after})`;
                }
            }
        } catch (e) {}

        try {
            if (yourTag) {
                if (isDraw) {
                    yourTag.textContent = 'Draw';
                    yourTag.className = 'result-outcome-tag result-outcome-tag--you is-draw';
                } else if (this.isWinner) {
                    yourTag.textContent = 'Victory';
                    yourTag.className = 'result-outcome-tag result-outcome-tag--you is-win';
                } else {
                    yourTag.textContent = 'Defeat';
                    yourTag.className = 'result-outcome-tag result-outcome-tag--you is-lose';
                }
            }
            if (enemyTag) {
                if (isDraw) {
                    enemyTag.textContent = 'Draw';
                    enemyTag.className = 'result-outcome-tag result-outcome-tag--enemy is-draw';
                } else if (this.isWinner) {
                    enemyTag.textContent = 'Defeat';
                    enemyTag.className = 'result-outcome-tag result-outcome-tag--enemy is-lose';
                } else {
                    enemyTag.textContent = 'Victory';
                    enemyTag.className = 'result-outcome-tag result-outcome-tag--enemy is-win';
                }
            }
        } catch (e) {}
        
        // Update battle statistics with actual game data
        if (this.gameData) {
            this.updateElement('#battle-duration', this.gameData.battleDuration || '0:00');
            this.updateElement('#total-turns', this.gameData.turnCount.toString());
            this.updateElement('#your-character', this.gameData.playerCharacter.name);
            this.updateElement('#opponent-character', this.gameData.opponentCharacter.name);
        } else {
            // Fallback values if game data is not available
            this.updateElement('#battle-duration', '0:00');
            this.updateElement('#total-turns', '0');
            this.updateElement('#your-character', 'Unknown');
            this.updateElement('#opponent-character', 'Unknown');
        }

        try {
            const yourAvatar = this.querySelector('#result-your-avatar');
            const enemyAvatar = this.querySelector('#result-enemy-avatar');

            const yourImg = this.gameData?.playerCharacter?.images?.[0]
                ? `assets/final/${this.gameData.playerCharacter.images[0]}`
                : null;
            const enemyImg = this.gameData?.opponentCharacter?.images?.[0]
                ? `assets/final/${this.gameData.opponentCharacter.images[0]}`
                : null;

            if (yourAvatar) {
                yourAvatar.src = yourImg || 'assets/images/characters/placeholder.png';
                yourAvatar.onerror = () => {
                    yourAvatar.onerror = null;
                    yourAvatar.src = 'assets/images/characters/placeholder.png';
                };
            }
            if (enemyAvatar) {
                enemyAvatar.src = enemyImg || 'assets/images/characters/placeholder.png';
                enemyAvatar.onerror = () => {
                    enemyAvatar.onerror = null;
                    enemyAvatar.src = 'assets/images/characters/placeholder.png';
                };
            }
        } catch (e) {}
        
        const stats = this.gameData && this.gameData.matchStats ? this.gameData.matchStats : null;
        const skillsUsed = stats ? (Number(stats.skillsUsed) || 0) : 0;
        const damageDealt = stats ? (Number(stats.damageDealt) || 0) : 0;

        this.updateElement('#skills-used', String(skillsUsed));
        this.updateElement('#damage-dealt', String(damageDealt));
    }

    async handlePlayAgain() {
        try {
            this.disableElement('#play-again-button');
            this.updateElement('#play-again-button', 'Starting...');
            
            // Navigate to pairing page to start a new match
            window.app.router.navigateTo('pairing');
            
        } catch (error) {
            console.error('Failed to start new game:', error);
            this.enableElement('#play-again-button');
            this.updateElement('#play-again-button', 'Play Again');
        }
    }

    handleMainMenu() {
        window.app.router.navigateTo('menu');
    }

    async cleanup() {
        this.isWinner = false;
        this.winnerRole = null;
        await super.cleanup();
    }
}

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
                <div class="result-header">
                    <h1 class="result-title" id="result-title">Battle Complete</h1>
                    <p class="result-subtitle" id="result-subtitle"></p>
                </div>

                <div class="result-content">
                    <div class="battle-summary">
                        <div class="summary-card">
                            <h3>Battle Statistics</h3>
                            <div class="stats-grid">
                                <div class="stat-item">
                                    <span class="stat-label">Battle Duration:</span>
                                    <span class="stat-value" id="battle-duration">--</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Total Turns:</span>
                                    <span class="stat-value" id="total-turns">--</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Your Character:</span>
                                    <span class="stat-value" id="your-character">--</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Opponent Character:</span>
                                    <span class="stat-value" id="opponent-character">--</span>
                                </div>
                            </div>
                        </div>

                        <div class="summary-card">
                            <h3>Your Performance</h3>
                            <div class="performance-stats">
                                <div class="performance-item">
                                    <span class="performance-label">Skills Used:</span>
                                    <span class="performance-value" id="skills-used">--</span>
                                </div>
                                <div class="performance-item">
                                    <span class="performance-label">Damage Dealt:</span>
                                    <span class="performance-value" id="damage-dealt">--</span>
                                </div>
                                <div class="performance-item">
                                    <span class="performance-label">Healing Done:</span>
                                    <span class="performance-value" id="healing-done">--</span>
                                </div>
                                <div class="performance-item">
                                    <span class="performance-label">Ultimate Used:</span>
                                    <span class="performance-value" id="ultimate-used">--</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="player-records">
                        <h3>Your Records</h3>
                        <div class="records-grid">
                            <div class="record-item">
                                <div class="record-number" id="games-played">0</div>
                                <div class="record-label">Games Played</div>
                            </div>
                            <div class="record-item">
                                <div class="record-number" id="games-won">0</div>
                                <div class="record-label">Games Won</div>
                            </div>
                            <div class="record-item">
                                <div class="record-number" id="games-lost">0</div>
                                <div class="record-label">Games Lost</div>
                            </div>
                            <div class="record-item">
                                <div class="record-number" id="win-rate">0%</div>
                                <div class="record-label">Win Rate</div>
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
        await this.loadPlayerStats();
    }

    async setResult(isWinner, winnerRole, gameData = null) {
        this.isWinner = isWinner;
        this.winnerRole = winnerRole;
        this.gameData = gameData;
        
        this.updateResultDisplay();
        await this.updatePlayerStats();
        await this.loadPlayerStats();
    }

    updateResultDisplay() {
        const resultTitle = this.querySelector('#result-title');
        const resultSubtitle = this.querySelector('#result-subtitle');
        
        if (this.isWinner) {
            resultTitle.textContent = 'Victory!';
            resultTitle.className = 'result-title victory';
            resultSubtitle.textContent = 'Congratulations! You won the battle!';
        } else {
            resultTitle.textContent = 'Defeat';
            resultTitle.className = 'result-title defeat';
            resultSubtitle.textContent = 'Better luck next time!';
        }
        
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
        
        // Update performance statistics (placeholder values for now)
        this.updateElement('#skills-used', '8');
        this.updateElement('#damage-dealt', '245');
        this.updateElement('#healing-done', '67');
        this.updateElement('#ultimate-used', this.isWinner ? 'Yes' : 'No');
    }

    async updatePlayerStats() {
        const currentStats = await this.dataManager.loadPlayerStats();
        
        const newStats = {
            gamesPlayed: currentStats.gamesPlayed + 1,
            gamesWon: currentStats.gamesWon + (this.isWinner ? 1 : 0),
            gamesLost: currentStats.gamesLost + (this.isWinner ? 0 : 1)
        };
        
        await this.dataManager.savePlayerStats(newStats);
    }

    async loadPlayerStats() {
        const stats = await this.dataManager.loadPlayerStats();
        
        this.updateElement('#games-played', stats.gamesPlayed);
        this.updateElement('#games-won', stats.gamesWon);
        this.updateElement('#games-lost', stats.gamesLost);
        
        const winRate = stats.gamesPlayed > 0 ? 
            Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0;
        this.updateElement('#win-rate', `${winRate}%`);
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

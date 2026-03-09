class PairingPage extends BasePage {
    constructor() {
        super();
        this.gameCoordinator = null;
        this.selectedCharacter = null;
        this.matchMode = 'casual';
        this.accessToken = null;
        this.ownElo = 1000;
        this.isSearching = false;
        this.searchStartTime = null;
        this.searchTimer = null;
    }

    getHTML() {
        return `
            <div class="pairing-page">
                <div class="pairing-header">
                    <h1 class="page-title">Finding Match</h1>
                </div>

                <div class="pairing-content">
                    <div class="selected-character-display">
                        <div class="character-image">
                            <img id="character-image" src="" alt="Your Character">
                        </div>
                        <div class="character-info">
                            <h2 id="character-name"></h2>
                            <p class="meta-points">Meta Points: <span id="character-meta"></span></p>
                        </div>
                    </div>

                    <div class="search-status">
                        <div class="search-animation">
                            <div class="spinner"></div>
                        </div>
                        <div class="search-text">
                            <p id="search-message">Searching for opponent...</p>
                            <p class="search-time">Time elapsed: <span id="search-timer">0:00</span></p>
                        </div>
                    </div>

                    <div class="pairing-info">
                        <div class="info-item">
                            <h3>Matchmaking</h3>
                            <p>You will be matched with a player of similar skill level based on meta points.</p>
                        </div>
                        <div class="info-item">
                            <h3>Turn Order</h3>
                            <p>The player with lower meta points goes first. If equal, order is random.</p>
                        </div>
                    </div>
                </div>

                <div class="pairing-actions">
                    <button class="btn btn-secondary" id="cancel-button">
                        Cancel Search
                    </button>
                </div>

                <div class="connection-status" id="connection-status">
                    <span class="status-indicator" id="status-indicator"></span>
                    <span class="status-text" id="status-text">Connecting...</span>
                </div>
            </div>
        `;
    }

    async setupEventListeners() {
        this.addEventListener('#cancel-button', 'click', this.handleCancelSearch.bind(this));
    }

    async onPageLoad() {
        // Wait for app components to be available
        while (!window.app || !window.app.gameCoordinator || !window.app.dataManager) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        this.gameCoordinator = window.app.gameCoordinator;

        await this.loadMatchMode();
        await this.loadSelectedCharacter();
        await this.startMatchmaking();
    }

    async loadMatchMode() {
        try {
            try {
                if (window.sessionStorage) {
                    const raw = window.sessionStorage.getItem('elders_match_mode');
                    if (raw) {
                        const m = String(raw);
                        this.matchMode = (m === 'ranked') ? 'ranked' : 'casual';
                        return;
                    }
                }
            } catch (e) {}

            const dataManager = window.app.dataManager;
            const saved = dataManager && typeof dataManager.loadData === 'function'
                ? await dataManager.loadData('match_mode')
                : null;
            const mode = saved && saved.mode ? String(saved.mode) : 'casual';
            this.matchMode = (mode === 'ranked') ? 'ranked' : 'casual';
        } catch (e) {
            this.matchMode = 'casual';
        }
    }

    async loadRankedAuthContext() {
        if (this.matchMode !== 'ranked') return;

        try {
            const client = window.EldersAuth && typeof window.EldersAuth.ensureSupabaseClient === 'function'
                ? window.EldersAuth.ensureSupabaseClient()
                : null;
            if (!client || !client.auth || typeof client.auth.getSession !== 'function') return;

            const sessionRes = await client.auth.getSession();
            const session = sessionRes && sessionRes.data ? sessionRes.data.session : null;
            this.accessToken = session && session.access_token ? String(session.access_token) : null;

            if (!this.accessToken) return;

            const res = await client
                .from('user_profiles')
                .select('elo')
                .maybeSingle();

            if (res && res.data && typeof res.data.elo !== 'undefined') {
                const n = Math.floor(Number(res.data.elo) || 0);
                this.ownElo = Math.max(0, n);
            }
        } catch (e) {}
    }

    async loadSelectedCharacter() {
        const dataManager = window.app.dataManager;
        const savedCharacter = await dataManager.loadSelectedCharacter();
        
        if (!savedCharacter) {
            // No character selected, go back to menu
            window.app.router.navigateTo('menu');
            return;
        }

        this.selectedCharacter = savedCharacter;
        this.displaySelectedCharacter();
    }

    displaySelectedCharacter() {
        if (!this.selectedCharacter) return;

        const image = this.querySelector('#character-image');
        image.src = `assets/final/${this.selectedCharacter.images[0]}`;
        image.onerror = () => image.src = 'assets/images/characters/placeholder.png';

        this.updateElement('#character-name', this.selectedCharacter.name);
        this.updateElement('#character-meta', this.selectedCharacter.metaPoints);
    }

    async startMatchmaking() {
        if (!this.selectedCharacter) return;

        try {
            this.isSearching = true;
            this.searchStartTime = Date.now();

            await this.loadRankedAuthContext();

            this.startSearchTimer();
            
            this.updateConnectionStatus('connecting', 'Connecting to server...');
            
            // Start the matchmaking process
            await this.gameCoordinator.startMatchmaking(this.selectedCharacter, {
                mode: this.matchMode,
                accessToken: this.accessToken,
                elo: this.ownElo
            });
            
            this.updateConnectionStatus('searching', 'Connected - Searching for match...');
            this.updateSearchMessage();
            
        } catch (error) {
            console.error('Matchmaking failed:', error);
            this.handleMatchmakingError(error.message);
        }
    }

    updateSearchMessage() {
        if (!this.isSearching) return;

        if (this.matchMode !== 'ranked') {
            this.updateElement('#search-message', 'Searching for opponent...');
            return;
        }

        const elapsed = this.searchStartTime ? (Date.now() - this.searchStartTime) : 0;
        const delta = elapsed >= 30000 ? 300 : (elapsed >= 10000 ? 200 : 100);
        const low = Math.max(0, Math.floor((Number(this.ownElo) || 0) - delta));
        const high = Math.max(0, Math.floor((Number(this.ownElo) || 0) + delta));
        this.updateElement('#search-message', `Searching for an opponent between ${low} and ${high} ELO...`);
    }

    startSearchTimer() {
        this.searchTimer = setInterval(() => {
            if (!this.isSearching) {
                clearInterval(this.searchTimer);
                return;
            }

            const elapsed = Date.now() - this.searchStartTime;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            this.updateElement('#search-timer', timeString);

            this.updateSearchMessage();
        }, 1000);
    }

    updateConnectionStatus(status, message) {
        const indicator = this.querySelector('#status-indicator');
        const text = this.querySelector('#status-text');
        
        indicator.className = `status-indicator status-${status}`;
        text.textContent = message;
    }

    async handleCancelSearch() {
        if (!this.isSearching) return;

        try {
            this.isSearching = false;
            this.disableElement('#cancel-button');
            this.updateElement('#cancel-button', 'Cancelling...');
            
            await this.gameCoordinator.cancelMatchmaking();
            
            // Navigate back to menu
            window.app.router.navigateTo('menu');
            
        } catch (error) {
            console.error('Failed to cancel search:', error);
            this.enableElement('#cancel-button');
            this.updateElement('#cancel-button', 'Cancel Search');
        }
    }

    handleMatchmakingError(errorMessage) {
        this.isSearching = false;
        this.updateConnectionStatus('error', 'Connection failed');
        this.updateElement('#search-message', `Error: ${errorMessage}`);
        
        // Show retry option
        const actionsContainer = this.querySelector('.pairing-actions');
        actionsContainer.innerHTML = `
            <button class="btn btn-primary" id="retry-button">Retry</button>
            <button class="btn btn-secondary" id="back-button">Back to Menu</button>
        `;
        
        this.addEventListener('#retry-button', 'click', this.handleRetry.bind(this));
        this.addEventListener('#back-button', 'click', this.handleBackToMenu.bind(this));
    }

    async handleRetry() {
        // Reset UI
        const actionsContainer = this.querySelector('.pairing-actions');
        actionsContainer.innerHTML = `
            <button class="btn btn-secondary" id="cancel-button">Cancel Search</button>
        `;
        this.addEventListener('#cancel-button', 'click', this.handleCancelSearch.bind(this));
        
        // Restart matchmaking
        await this.startMatchmaking();
    }

    handleBackToMenu() {
        window.app.router.navigateTo('menu');
    }

    async cleanup() {
        this.isSearching = false;
        
        if (this.searchTimer) {
            clearInterval(this.searchTimer);
            this.searchTimer = null;
        }
        
        if (this.gameCoordinator) {
            try {
                await this.gameCoordinator.cancelMatchmaking();
            } catch (error) {
                console.error('Error cancelling matchmaking during cleanup:', error);
            }
        }
        
        await super.cleanup();
    }
}

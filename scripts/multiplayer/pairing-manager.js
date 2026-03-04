class PairingManager {
    constructor(webSocketManager) {
        this.wsManager = webSocketManager;
        this.isSearching = false;
        this.selectedCharacter = null;
        this.onPairingFound = null;
        this.onPairingFailed = null;
        this.onPairingCancelled = null;

        this._handleWsOpen = () => {
            if (!this.isSearching) return;
            if (!this.selectedCharacter) return;
            this._resumeSearchAfterReconnect().catch(() => {});
        };

        if (this.wsManager && typeof this.wsManager.onOpen === 'function') {
            this.wsManager.onOpen(this._handleWsOpen);
        }
    }

    async _resumeSearchAfterReconnect() {
        if (!this.isSearching) return;
        if (!this.selectedCharacter) return;
        if (!this.wsManager.isSocketConnected()) return;

        await this.wsManager.send('search_match', {
            character: {
                id: this.selectedCharacter.id,
                name: this.selectedCharacter.name,
                metaPoints: this.selectedCharacter.metaPoints,
                stats: this.selectedCharacter.stats,
                skills: this.selectedCharacter.skills,
                ultimate: this.selectedCharacter.ultimate,
                passive: this.selectedCharacter.passive,
                images: this.selectedCharacter.images,
                itemId: this.selectedCharacter.itemId
            }
        });
    }

    async startSearching(character) {
        if (this.isSearching) {
            throw new Error('Already searching for a match');
        }

        if (!this.wsManager.isSocketConnected()) {
            throw new Error('Not connected to server');
        }

        this.selectedCharacter = character;
        this.isSearching = true;

        // Set up message handlers
        this.wsManager.onMessage('pairing_found', this.handlePairingFound.bind(this));
        this.wsManager.onMessage('pairing_failed', this.handlePairingFailed.bind(this));
        this.wsManager.onMessage('pairing_cancelled', this.handlePairingCancelled.bind(this));

        // Send search request
        await this.wsManager.send('search_match', {
            character: {
                id: character.id,
                name: character.name,
                metaPoints: character.metaPoints,
                stats: character.stats,
                skills: character.skills,
                ultimate: character.ultimate,
                passive: character.passive,
                images: character.images,
                itemId: character.itemId
            }
        });

        console.log('Started searching for match with character:', character.name);
    }

    async cancelSearch() {
        if (!this.isSearching) {
            return;
        }

        this.isSearching = false;
        this.selectedCharacter = null;

        if (this.wsManager.isSocketConnected()) {
            await this.wsManager.send('cancel_search');
        }

        // Clean up message handlers
        this.wsManager.offMessage('pairing_found');
        this.wsManager.offMessage('pairing_failed');
        this.wsManager.offMessage('pairing_cancelled');

        console.log('Cancelled match search');
    }

    handlePairingFound(message) {
        this.isSearching = false;
        
        const pairingData = {
            gameId: message.gameId,
            playerRole: message.playerRole,
            opponent: message.opponent,
            yourCharacter: this.selectedCharacter,
            opponentCharacter: message.opponent.character
        };

        console.log('Pairing found:', pairingData);

        if (this.onPairingFound) {
            this.onPairingFound(pairingData);
        }

        // Clean up message handlers
        this.wsManager.offMessage('pairing_found');
        this.wsManager.offMessage('pairing_failed');
        this.wsManager.offMessage('pairing_cancelled');
    }

    handlePairingFailed(message) {
        this.isSearching = false;
        this.selectedCharacter = null;

        console.log('Pairing failed:', message.reason);

        if (this.onPairingFailed) {
            this.onPairingFailed(message.reason);
        }

        // Clean up message handlers
        this.wsManager.offMessage('pairing_found');
        this.wsManager.offMessage('pairing_failed');
        this.wsManager.offMessage('pairing_cancelled');
    }

    handlePairingCancelled(message) {
        this.isSearching = false;
        this.selectedCharacter = null;

        console.log('Pairing cancelled:', message.reason);

        if (this.onPairingCancelled) {
            this.onPairingCancelled(message.reason);
        }

        // Clean up message handlers
        this.wsManager.offMessage('pairing_found');
        this.wsManager.offMessage('pairing_failed');
        this.wsManager.offMessage('pairing_cancelled');
    }

    setCallbacks(callbacks) {
        this.onPairingFound = callbacks.onPairingFound;
        this.onPairingFailed = callbacks.onPairingFailed;
        this.onPairingCancelled = callbacks.onPairingCancelled;
    }

    getSearchStatus() {
        return {
            isSearching: this.isSearching,
            selectedCharacter: this.selectedCharacter
        };
    }
}

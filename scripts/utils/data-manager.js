class DataManager {
    constructor() {
        this.encryptionManager = new EncryptionManager();
        this.encryptionKey = null;
        this.storagePrefix = 'elders_';
    }

    async init() {
        this.encryptionKey = await this.encryptionManager.getOrCreateKey();
    }

    async saveData(key, data) {
        try {
            const encrypted = await this.encryptionManager.encrypt(data, this.encryptionKey);
            localStorage.setItem(this.storagePrefix + key, JSON.stringify(encrypted));
            return true;
        } catch (error) {
            console.error('Failed to save data:', error);
            return false;
        }
    }

    async loadData(key) {
        try {
            const stored = localStorage.getItem(this.storagePrefix + key);
            if (!stored) return null;

            const encryptedData = JSON.parse(stored);
            return await this.encryptionManager.decrypt(encryptedData, this.encryptionKey);
        } catch (error) {
            console.error('Failed to load data:', error);
            try {
                localStorage.removeItem(this.storagePrefix + key);
            } catch (e) {}
            return null;
        }
    }

    removeData(key) {
        localStorage.removeItem(this.storagePrefix + key);
    }

    clearAllData() {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith(this.storagePrefix)) {
                localStorage.removeItem(key);
            }
        });
    }

    async saveSelectedCharacter(character) {
        return await this.saveData('selected_character', character);
    }

    async loadSelectedCharacter() {
        return await this.loadData('selected_character');
    }

    async saveSelectedItemForCharacter(characterId, itemId) {
        if (!characterId) return false;
        const map = (await this.loadData('selected_items')) || {};
        map[String(characterId)] = itemId || null;
        return await this.saveData('selected_items', map);
    }

    async loadSelectedItemForCharacter(characterId) {
        if (!characterId) return null;
        const map = (await this.loadData('selected_items')) || {};
        return map[String(characterId)] || null;
    }

    async saveGameSettings(settings) {
        return await this.saveData('game_settings', settings);
    }

    async loadGameSettings() {
        const defaultSettings = {
            soundEnabled: true,
            animationsEnabled: true
        };
        
        const saved = await this.loadData('game_settings');
        return saved || defaultSettings;
    }

    async savePlayerStats(stats) {
        return await this.saveData('player_stats', stats);
    }

    async loadPlayerStats() {
        const defaultStats = {
            gamesPlayed: 0,
            gamesWon: 0,
            gamesLost: 0
        };
        
        const saved = await this.loadData('player_stats');
        return saved || defaultStats;
    }
}

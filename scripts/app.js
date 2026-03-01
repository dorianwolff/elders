class App {
    constructor() {
        this.router = null;
        this.dataManager = null;
        this.gameCoordinator = null;
    }

    async init() {
        try {
            this.dataManager = new DataManager();
            await this.dataManager.init();

            this.gameCoordinator = new GameCoordinator();
            await this.gameCoordinator.init();

            this.router = new Router();
            await this.router.init();

            this.router.navigateTo('menu');
        } catch (error) {
            console.error('Failed to initialize app:', error);
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const app = new App();
    window.app = app; // Set window.app before initialization
    await app.init();
});

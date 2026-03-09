class Router {
    constructor() {
        this.routes = new Map();
        this.currentPage = null;
        this.container = null;
    }

    async init() {
        this.container = document.getElementById('page-container');
        
        this.routes.set('menu', MenuPage);
        this.routes.set('profile', ProfilePage);
        this.routes.set('pairing', PairingPage);
        this.routes.set('battle', BattlePage);
        this.routes.set('result', ResultPage);

        window.addEventListener('popstate', (event) => {
            if (event.state && event.state.page) {
                this.navigateTo(event.state.page, false);
            }
        });
    }

    async navigateTo(pageName, pushState = true) {
        try {
            const PageClass = this.routes.get(pageName);
            if (!PageClass) {
                throw new Error(`Page '${pageName}' not found`);
            }

            if (this.currentPage && typeof this.currentPage.cleanup === 'function') {
                await this.currentPage.cleanup();
            }

            this.container.innerHTML = '';

            this.currentPage = new PageClass();
            await this.currentPage.render(this.container);

            if (pushState) {
                history.pushState({ page: pageName }, '', `#${pageName}`);
            }

        } catch (error) {
            console.error(`Failed to navigate to ${pageName}:`, error);
        }
    }

    getCurrentPage() {
        return this.currentPage;
    }
}

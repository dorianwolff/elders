class BasePage {
    constructor() {
        this.container = null;
        this.isRendered = false;
    }

    async render(container) {
        this.container = container;
        this.container.innerHTML = this.getHTML();
        await this.setupEventListeners();
        await this.onPageLoad();
        this.isRendered = true;
    }

    getHTML() {
        return '<div>Base Page - Override this method</div>';
    }

    async setupEventListeners() {
        // Override in child classes
    }

    async onPageLoad() {
        // Override in child classes
    }

    async cleanup() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        this.isRendered = false;
    }

    querySelector(selector) {
        if (!this.container) return null;
        return this.container.querySelector(selector);
    }

    querySelectorAll(selector) {
        if (!this.container) return [];
        return this.container.querySelectorAll(selector);
    }

    addEventListener(selector, event, handler) {
        const element = this.querySelector(selector);
        if (element) {
            element.addEventListener(event, handler);
        }
    }

    removeEventListener(selector, event, handler) {
        const element = this.querySelector(selector);
        if (element) {
            element.removeEventListener(event, handler);
        }
    }

    updateElement(selector, content) {
        const element = this.querySelector(selector);
        if (element) {
            if (typeof content === 'string') {
                element.innerHTML = content;
            } else {
                element.textContent = content;
            }
        }
    }

    setElementAttribute(selector, attribute, value) {
        const element = this.querySelector(selector);
        if (element) {
            element.setAttribute(attribute, value);
        }
    }

    toggleElementClass(selector, className, force = null) {
        const element = this.querySelector(selector);
        if (element) {
            if (force !== null) {
                element.classList.toggle(className, force);
            } else {
                element.classList.toggle(className);
            }
        }
    }

    showElement(selector) {
        this.toggleElementClass(selector, 'hidden', false);
    }

    hideElement(selector) {
        this.toggleElementClass(selector, 'hidden', true);
    }

    enableElement(selector) {
        const element = this.querySelector(selector);
        if (element) {
            element.disabled = false;
        }
    }

    disableElement(selector) {
        const element = this.querySelector(selector);
        if (element) {
            element.disabled = true;
        }
    }
}

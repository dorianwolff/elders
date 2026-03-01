class FloatingCombatText {
    constructor(stageElement) {
        this.stageElement = stageElement;
        this.layer = null;
        this.ensureLayer();
    }

    ensureLayer() {
        if (!this.stageElement) return;
        if (this.layer && this.layer.isConnected) return;

        this.layer = document.createElement('div');
        this.layer.className = 'floating-combat-text-layer';
        this.stageElement.appendChild(this.layer);
    }

    clear() {
        if (!this.layer) return;
        this.layer.innerHTML = '';
    }

    getDamageTier(amount) {
        const n = Math.max(0, Math.floor(Number(amount) || 0));
        if (n <= 5) return 't1';
        if (n <= 15) return 't2';
        if (n <= 50) return 't3';
        if (n <= 150) return 't4';
        return 't5';
    }

    getImpact(amount) {
        const n = Math.max(0, Math.floor(Number(amount) || 0));
        if (n <= 5) return 1.05;
        if (n <= 15) return 1.15;
        if (n <= 50) return 1.25;
        if (n <= 150) return 1.38;
        return 1.55;
    }

    getFontSize(amount, kind) {
        const n = Math.max(0, Math.floor(Number(amount) || 0));
        const base = kind === 'heal' ? 24 : 26;
        if (n <= 5) return base;
        if (n <= 15) return base + 2;
        if (n <= 50) return base + 6;
        if (n <= 150) return base + 10;
        return base + 14;
    }

    spawn({ targetSide, kind, amount }) {
        if (!this.stageElement) return;
        this.ensureLayer();
        if (!this.layer) return;

        const sprite = this.stageElement.querySelector(targetSide === 'player' ? '#player-sprite' : '#opponent-sprite');
        if (!sprite) return;

        const stageRect = this.stageElement.getBoundingClientRect();
        const spriteRect = sprite.getBoundingClientRect();

        const cx = (spriteRect.left + spriteRect.right) / 2 - stageRect.left;
        const cy = (spriteRect.top + spriteRect.bottom) / 2 - stageRect.top;

        const el = document.createElement('div');
        el.className = 'fct';

        const n = Math.max(0, Math.floor(Number(amount) || 0));
        const isHeal = kind === 'heal';

        if (isHeal) {
            el.classList.add('is-heal');
        } else {
            el.classList.add('is-dmg');
            el.classList.add(`is-${this.getDamageTier(n)}`);
        }

        const sign = isHeal ? '+' : '-';
        const text = `${sign}${n}`;
        el.textContent = text;
        el.setAttribute('data-text', text);

        const sideJitter = (Math.random() * 2 - 1) * 22;
        const upJitter = -20 - Math.random() * 10;
        const drift = sideJitter * 0.7;
        const rot = (Math.random() * 2 - 1) * 12;

        el.style.left = `${cx}px`;
        el.style.top = `${cy}px`;
        el.style.fontSize = `${this.getFontSize(n, kind)}px`;

        el.style.setProperty('--fct-x', `${sideJitter}px`);
        el.style.setProperty('--fct-y', `${upJitter}px`);
        el.style.setProperty('--fct-dx', `${drift}px`);
        el.style.setProperty('--fct-rot', `${rot}deg`);
        el.style.setProperty('--fct-impact', `${this.getImpact(n)}`);

        const stagger = Math.floor(Math.random() * 50);
        el.style.setProperty('--fct-rise-delay-ms', `${80 + stagger}ms`);
        el.style.setProperty('--fct-fade-delay-ms', `${140 + stagger}ms`);

        this.layer.appendChild(el);

        const totalMs = 1200;
        window.setTimeout(() => {
            if (el && el.parentNode) {
                el.parentNode.removeChild(el);
            }
        }, totalMs);
    }
}

class CharacterTooltip {
    constructor(skillSystem) {
        this.skillSystem = skillSystem;
        this.tooltip = null;
        this.isVisible = false;
    }

    createTooltip() {
        if (this.tooltip) return;

        this.tooltip = document.createElement('div');
        this.tooltip.className = 'character-tooltip';
        this.tooltip.style.display = 'none';
        document.body.appendChild(this.tooltip);

        // Close tooltip when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.tooltip.contains(e.target) && !e.target.closest('.character-image')) {
                this.hideTooltip();
            }
        });
    }

    showTooltip(character, playerId, event) {
        if (!this.skillSystem) return;

        this.createTooltip();
        
        const baseStats = {
            attack: character.baseStats?.attack || character.stats.attack,
            defense: character.baseStats?.defense || character.stats.defense,
            health: character.stats.health,
            maxHealth: character.stats.maxHealth
        };

        const currentStats = {
            attack: character.stats.attack,
            defense: character.stats.defense,
            health: character.stats.health,
            maxHealth: character.stats.maxHealth
        };

        const statModifications = this.calculateStatModifications(playerId, baseStats, currentStats);
        
        this.tooltip.innerHTML = this.generateTooltipHTML(character, baseStats, currentStats, statModifications);
        
        // Position tooltip
        const rect = event.target.getBoundingClientRect();
        this.tooltip.style.left = `${rect.right + 10}px`;
        this.tooltip.style.top = `${rect.top}px`;
        this.tooltip.style.display = 'block';
        this.isVisible = true;

        // Adjust position if tooltip goes off screen
        setTimeout(() => {
            const tooltipRect = this.tooltip.getBoundingClientRect();
            if (tooltipRect.right > window.innerWidth) {
                this.tooltip.style.left = `${rect.left - tooltipRect.width - 10}px`;
            }
            if (tooltipRect.bottom > window.innerHeight) {
                this.tooltip.style.top = `${rect.bottom - tooltipRect.height}px`;
            }
        }, 10);
    }

    hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
            this.isVisible = false;
        }
    }

    calculateStatModifications(playerId, baseStats, currentStats) {
        const modifications = {};
        
        for (const stat of ['attack', 'defense']) {
            const baseStat = baseStats[stat] || 0;
            const currentStat = currentStats[stat] || 0;
            const difference = currentStat - baseStat;
            
            modifications[stat] = {
                base: baseStat,
                current: currentStat,
                difference: difference,
                percentage: baseStat > 0 ? (difference / baseStat) * 100 : 0
            };
        }

        return modifications;
    }

    generateTooltipHTML(character, baseStats, currentStats, modifications) {
        let html = `
            <div class="tooltip-header">
                <h3>${character.name}</h3>
                <div class="character-class">${character.class || 'Warrior'}</div>
            </div>
            <div class="tooltip-content">
                <div class="health-section">
                    <div class="stat-row">
                        <span class="stat-label">Health:</span>
                        <span class="stat-value">${currentStats.health}/${currentStats.maxHealth}</span>
                    </div>
                </div>
                <div class="stats-section">
                    <h4>Combat Stats</h4>
        `;

        const statLabels = {
            attack: 'Attack',
            defense: 'Defense'
        };

        for (const [stat, label] of Object.entries(statLabels)) {
            const mod = modifications[stat];
            const displayValue = Math.round(mod.current);
            
            let modifierHTML = '';
            if (Math.abs(mod.difference) > 0.01) {
                const sign = mod.difference > 0 ? '+' : '';
                const color = mod.difference > 0 ? 'stat-positive' : 'stat-negative';
                const displayDiff = Math.round(mod.difference);
                modifierHTML = `<span class="${color}"> (${sign}${displayDiff})</span>`;
            }

            html += `
                <div class="stat-row">
                    <span class="stat-label">${label}:</span>
                    <span class="stat-value">
                        ${displayValue}${modifierHTML}
                    </span>
                </div>
            `;
        }

        html += `
                </div>
                <div class="effects-section">
                    <h4>Active Effects</h4>
                    ${this.generateActiveEffectsHTML(character.id)}
                </div>
            </div>
        `;

        return html;
    }

    generateActiveEffectsHTML(playerId) {
        if (!this.skillSystem || !this.skillSystem.activeEffects) {
            return '<div class="no-effects">No active effects</div>';
        }

        const playerEffects = [];
        for (const [effectId, effect] of this.skillSystem.activeEffects.entries()) {
            if (effect.target === playerId) {
                playerEffects.push(effect);
            }
        }

        if (playerEffects.length === 0) {
            return '<div class="no-effects">No active effects</div>';
        }

        let html = '<div class="effects-list">';
        for (const effect of playerEffects) {
            const effectClass = this.getEffectClass(effect.type);
            const icon = this.getEffectIcon(effect.type);
            
            html += `
                <div class="effect-item ${effectClass}">
                    <span class="effect-icon">${icon}</span>
                    <div class="effect-details">
                        <div class="effect-name">${effect.name || effect.type}</div>
                        <div class="effect-description">${effect.description || ''}</div>
                        <div class="effect-duration">${effect.turnsLeft} turns left</div>
                    </div>
                </div>
            `;
        }
        html += '</div>';

        return html;
    }

    getEffectClass(effectType) {
        const classes = {
            buff: 'effect-buff',
            debuff: 'effect-debuff',
            poison: 'effect-poison',
            conceal: 'effect-conceal',
            stun: 'effect-stun',
            mark: 'effect-mark',
            revive: 'effect-revive'
        };
        return classes[effectType] || 'effect-neutral';
    }

    getEffectIcon(effectType) {
        const icons = {
            buff: '🔵',
            debuff: '🟣',
            poison: '☠️',
            conceal: '🛡️',
            stun: '😵',
            mark: '🎯',
            revive: '✨'
        };
        return icons[effectType] || '⚪';
    }

    destroy() {
        if (this.tooltip) {
            document.body.removeChild(this.tooltip);
            this.tooltip = null;
        }
    }
}

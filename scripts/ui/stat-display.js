class StatDisplay {
    constructor(skillSystem) {
        this.skillSystem = skillSystem;
    }

    updatePlayerStats(playerId, character, containerElement) {
        if (!containerElement) return;

        if (!character || !character.stats) {
            containerElement.innerHTML = '';
            return;
        }

        const baseline = character.initialStats || character.baseStats || character.stats;

        const baseStats = {
            health: Number(character.stats.health) || 0,
            maxHealth: Number(character.stats.maxHealth) || 0,
            attack: Number(baseline.attack) || 0,
            defense: Number(baseline.defense) || 0
        };

        const modifiedStats = this.calculateModifiedStats(playerId, baseStats);
        
        containerElement.innerHTML = this.generateStatsHTML(baseStats, modifiedStats);
    }

    calculateModifiedStats(playerId, baseStats) {
        // We want the main displayed value to always be the CURRENT stat (white),
        // while the +/- modifier is computed relative to the ORIGINAL character stats.
        // Current stats are already derived in SkillSystem (baseStats + permanent changes + active effects),
        // so we should not re-apply buff math here (would double-count).
        const modifiedStats = { ...baseStats };

        if (!this.skillSystem || typeof this.skillSystem.getPlayerById !== 'function') {
            return modifiedStats;
        }

        const current = this.skillSystem.getPlayerById(playerId)?.stats;
        if (!current) return modifiedStats;

        modifiedStats.attack = Number(current.attack) || modifiedStats.attack;
        modifiedStats.defense = Number(current.defense) || modifiedStats.defense;

        return modifiedStats;
    }

    generateStatsHTML(baseStats, modifiedStats) {
        const statsToShow = ['attack', 'defense'];
        
        let html = '<div class="stats-container">';

        for (const stat of statsToShow) {
            const baseStat = Number(baseStats[stat]) || 0;
            const modifiedStat = Number(modifiedStats[stat]) || 0;
            const difference = modifiedStat - baseStat;
            
            let displayValue = Math.round(modifiedStat);
            let modifierHTML = '';
            
            if (difference > 0) {
                modifierHTML = `<span class="stat-increase">+${Math.round(difference)}</span>`;
            } else if (difference < 0) {
                modifierHTML = `<span class="stat-decrease">${Math.round(difference)}</span>`;
            }

            const statLabel = this.getStatLabel(stat);
            html += `<div class="stat-item">
                <span class="stat-label">${statLabel}:</span>
                <span class="stat-value">${displayValue}</span>
                ${modifierHTML}
            </div>`;
        }

        html += '</div>';
        return html;
    }

    getStatLabel(stat) {
        const labels = {
            attack: 'ATK',
            defense: 'DEF'
        };
        return labels[stat] || stat.toUpperCase();
    }

    updateActiveEffects(playerId, containerElement) {
        if (!containerElement || !this.skillSystem || !this.skillSystem.activeEffects) return;

        const playerEffects = [];
        for (const [effectId, effect] of this.skillSystem.activeEffects.entries()) {
            if (effect.target === playerId) {
                playerEffects.push(effect);
            }
        }

        let html = '<div class="effects-container">';
        if (playerEffects.length === 0) {
            html += '<div class="no-effects">No active effects</div>';
        } else {
            for (const effect of playerEffects) {
                const effectClass = this.getEffectClass(effect.type);
                html += `<div class="effect-item ${effectClass}">
                    <span class="effect-name">${effect.name}</span>
                    <span class="effect-duration">${effect.turnsLeft}</span>
                </div>`;
            }
        }
        html += '</div>';

        containerElement.innerHTML = html;
    }

    getEffectClass(effectType) {
        const classes = {
            buff: 'effect-buff',
            debuff: 'effect-debuff',
            poison: 'effect-poison',
            conceal: 'effect-conceal',
            stun: 'effect-stun',
            mark: 'effect-mark'
        };
        return classes[effectType] || 'effect-neutral';
    }
}

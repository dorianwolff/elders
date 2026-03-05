(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function ensureCombState(character) {
        if (!character || !character.passiveState) return null;
        if (!character.passiveState._comb) {
            character.passiveState._comb = {
                damagedSinceLastTurn: false
            };
        }
        return character.passiveState._comb;
    }

    function isSaitama(character) {
        return Boolean(character && (character.id === 'saitama' || character.id === 'saitama_serious'));
    }

    window.BattleHooks.register('passive_system:event', async (ctx) => {
        try {
            const passiveSystem = ctx && ctx.passiveSystem;
            const skillSystem = ctx && ctx.skillSystem;
            const playerId = ctx && ctx.playerId;
            const character = ctx && ctx.character;
            const eventType = ctx && ctx.eventType;
            const payload = ctx && ctx.payload;

            if (!passiveSystem || !skillSystem) return;
            if (!character || character.itemId !== 'comb') return;
            if (!isSaitama(character)) return;

            const state = ensureCombState(character);
            if (!state) return;

            if (eventType === 'damage_taken') {
                const amount = payload && payload.amount !== undefined ? Number(payload.amount) : 0;
                if (amount > 0) {
                    state.damagedSinceLastTurn = true;
                }
            }

            if (eventType === 'turn_start') {
                // Reset happens on your own turn start.
                const wasDamaged = Boolean(state.damagedSinceLastTurn);
                state.damagedSinceLastTurn = false;

                if (!wasDamaged) return;

                const hp = Number(character?.stats?.health) || 0;
                const maxHp = Number(character?.stats?.maxHealth) || 0;
                if (maxHp <= 0) return;

                const ratio = hp / maxHp;

                // Included thresholds: <= 66% and <= 33%
                let heal = 1;
                if (ratio <= (2 / 3)) heal = 2;
                if (ratio <= (1 / 3)) heal = 3;

                const amount = Math.max(1, Math.floor(heal));
                await skillSystem.applyHealing(character, amount, playerId);
            }
        } catch (e) {}
    }, { id: 'item:comb', order: 0 });
})();

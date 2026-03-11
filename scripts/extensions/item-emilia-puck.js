(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function getOpponentId(playerId) {
        return playerId === 'player1' ? 'player2' : (playerId === 'player2' ? 'player1' : null);
    }

    function getFrozenQueenStacks(skillSystem, ownerId) {
        try {
            if (window.EmiliaCharacter && typeof window.EmiliaCharacter.getFrozenQueenStacks === 'function') {
                return Math.max(0, Math.floor(Number(window.EmiliaCharacter.getFrozenQueenStacks(skillSystem, ownerId)) || 0));
            }
            let n = 0;
            for (const [, eff] of skillSystem.activeEffects.entries()) {
                if (!eff) continue;
                if (eff.type !== 'restriction') continue;
                if (eff.key !== 'frozen_queen') continue;
                if (eff.target !== ownerId) continue;
                n += 1;
            }
            return n;
        } catch (e) {}
        return 0;
    }

    window.BattleHooks.register('passive_system:event', async (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const gameState = ctx && ctx.gameState;
            const playerId = ctx && ctx.playerId;
            const character = ctx && ctx.character;
            const eventType = ctx && ctx.eventType;

            if (!skillSystem || !gameState) return;
            if (!character || character.id !== 'emilia') return;
            if (character.itemId !== 'emilia_puck') return;
            if (eventType !== 'turn_start') return;

            const active = typeof gameState.currentTurn === 'string' ? gameState.currentTurn : null;
            if (active !== playerId) return;

            const state = character.passiveState || (character.passiveState = { counters: {}, totalHealingDone: 0, ultimateReady: false });
            const curStacks = getFrozenQueenStacks(skillSystem, playerId);
            const prevStacks = Math.max(0, Math.floor(Number(state._puckFrozenQueenStacks) || 0));

            if (curStacks > prevStacks) {
                state._puckFrozenQueenStacks = curStacks;

                await skillSystem.applyHealingNoDomain(character, 5, playerId);

                const oppId = getOpponentId(playerId);
                if (oppId && window.EmiliaCharacter && typeof window.EmiliaCharacter.getPermafrostStacks === 'function' && typeof window.EmiliaCharacter.setPermafrostStacks === 'function') {
                    const cur = window.EmiliaCharacter.getPermafrostStacks(skillSystem, oppId);
                    window.EmiliaCharacter.setPermafrostStacks(skillSystem, oppId, playerId, cur + 1);
                }
            } else if (curStacks < prevStacks) {
                state._puckFrozenQueenStacks = curStacks;
            }
        } catch (e) {}
    }, { id: 'item:emilia_puck', order: 0 });
})();

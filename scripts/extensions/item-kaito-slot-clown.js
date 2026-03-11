(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function getOpponentId(playerId) {
        return playerId === 'player1' ? 'player2' : (playerId === 'player2' ? 'player1' : null);
    }

    function getRestrictionCount(skillSystem, playerId) {
        try {
            if (window.KaitoCharacter && typeof window.KaitoCharacter.getActiveKaitoRestrictions === 'function') {
                return window.KaitoCharacter.getActiveKaitoRestrictions(skillSystem, playerId).size;
            }
        } catch (e) {}
        return 0;
    }

    function rollStun(skillSystem, gameState, playerId, restrictions) {
        const baseChance = 0.10;
        const per = 0.10;
        const chance = Math.max(0, Math.min(1, baseChance + (per * Math.max(0, restrictions))));
        const seed = `${gameState?.gameId || 'game'}:${gameState?.turnCount || 0}:${playerId}:item:kaito_slot_clown:${restrictions}`;
        const r = skillSystem && typeof skillSystem.deterministicRandom === 'function'
            ? skillSystem.deterministicRandom(seed)
            : Math.random();
        return r < chance;
    }

    window.BattleHooks.register('skill_system:apply_skill_effect', async (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const effect = ctx && ctx.effect;
            const caster = ctx && ctx.caster;
            const gameState = ctx && ctx.gameState;
            const playerId = ctx && ctx.playerId;

            if (!skillSystem || !gameState || !effect || !effect.type) return;
            if (!caster || caster.id !== 'kaito') return;
            if (caster.itemId !== 'kaito_slot_clown') return;

            if (effect.type !== 'kaito_crazy_slots') return;

            const oppId = getOpponentId(playerId);
            if (!oppId) return;

            const restrictions = getRestrictionCount(skillSystem, playerId);
            const stun = rollStun(skillSystem, gameState, playerId, restrictions);

            if (stun) {
                const target = skillSystem.getPlayerById(oppId);
                if (target) {
                    await skillSystem.applyStun(target, 1, oppId);
                    ctx.result.effects.push('Stunned');
                }
            } else {
                const shield = Math.max(0, 5 + Math.max(0, restrictions));
                await skillSystem.applyShield(caster, shield, playerId);
                ctx.result.effects.push('Shield');
            }
        } catch (e) {}
    }, { id: 'item:kaito_slot_clown', order: 0 });
})();

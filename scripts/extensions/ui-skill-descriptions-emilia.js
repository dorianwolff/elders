(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function getOpponentId(playerId) {
        return playerId === 'player1' ? 'player2' : (playerId === 'player2' ? 'player1' : null);
    }

    function getFrozenQueenStacks(skillSystem, playerId) {
        try {
            if (window.EmiliaCharacter && typeof window.EmiliaCharacter.getFrozenQueenStacks === 'function') {
                return Math.max(0, Math.floor(Number(window.EmiliaCharacter.getFrozenQueenStacks(skillSystem, playerId)) || 0));
            }

            let n = 0;
            for (const [, eff] of skillSystem.activeEffects.entries()) {
                if (!eff) continue;
                if (eff.type !== 'restriction') continue;
                if (eff.key !== 'frozen_queen') continue;
                if (eff.target !== playerId) continue;
                n += 1;
            }
            return n;
        } catch (e) {}
        return 0;
    }

    function isFrozen(skillSystem, targetId) {
        try {
            for (const [, eff] of skillSystem.activeEffects.entries()) {
                if (!eff) continue;
                if (eff.target !== targetId) continue;
                if (eff.type !== 'red_debuff') continue;
                if (eff.key !== 'freeze') continue;
                if ((Number(eff.turnsLeft) || 0) <= 0) continue;
                return true;
            }
        } catch (e) {}
        return false;
    }

    function scalePct(basePct, stacks, targetFrozen) {
        const base = Number(basePct) || 0;
        const s = Math.max(0, Math.floor(Number(stacks) || 0));
        if (!targetFrozen || s <= 0) return base;
        return Math.max(0, base + (0.4 * s));
    }

    function pctText(pct) {
        return `${Math.round((Number(pct) || 0) * 100)}%`;
    }

    window.BattleHooks.register('ui:skills:description', (ctx) => {
        try {
            const characterId = ctx && ctx.characterId;
            const skill = ctx && ctx.skill;
            const gameState = ctx && ctx.gameState;
            const skillSystem = ctx && ctx.skillSystem;
            if (characterId !== 'emilia') return;
            if (!skill || !skill.id) return;

            const playerId = gameState?.playerId;
            const oppId = getOpponentId(playerId);
            const frozenTarget = oppId ? isFrozen(skillSystem, oppId) : false;
            const fq = getFrozenQueenStacks(skillSystem, playerId);

            if (skill.id === 'emilia_silver_blizzard') {
                const pct = scalePct(0.65, fq, frozenTarget);
                return `Deal ${pctText(pct)} of attack as damage and inflict 1 Permafrost.`;
            }

            if (skill.id === 'emilia_glacial_prison') {
                return 'Freeze the opponent for 2 turns.';
            }

            if (skill.id === 'emilia_frost_petal') {
                return 'Double the number of Permafrost stacks on the opponent.';
            }
        } catch (e) {}
    }, { id: 'ui:skills:description:emilia', order: 0 });

    window.BattleHooks.register('ui:ultimate:description', (ctx) => {
        try {
            const characterId = ctx && ctx.characterId;
            const ultimate = ctx && ctx.ultimate;
            const gameState = ctx && ctx.gameState;
            const skillSystem = ctx && ctx.skillSystem;
            if (characterId !== 'emilia') return;
            if (!ultimate || ultimate.id !== 'emilia_absolute_zero') return;

            const playerId = gameState?.playerId;
            const oppId = getOpponentId(playerId);
            const frozenTarget = oppId ? isFrozen(skillSystem, oppId) : false;
            const fq = getFrozenQueenStacks(skillSystem, playerId);
            const pct = scalePct(0.9, fq, frozenTarget);
            return `Deal ${pctText(pct)} of attack as damage and inflict 7 Permafrost on opponent.`;
        } catch (e) {}
    }, { id: 'ui:ultimate:description:emilia', order: 0 });
})();

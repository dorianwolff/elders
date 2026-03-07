(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function isEmilia(caster) {
        return Boolean(caster && caster.id === 'emilia');
    }

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

    function getAttackPctWithFrozenQueen(basePct, fqStacks, targetFrozen) {
        const base = Number(basePct) || 0;
        const stacks = Math.max(0, Math.floor(Number(fqStacks) || 0));
        if (!targetFrozen || stacks <= 0) return base;
        return Math.max(0, base + (0.4 * stacks));
    }

    async function dealAttackPctDamage(skillSystem, caster, target, targetId, playerId, pct) {
        const intended = skillSystem.calculateDamage({ scaling: 'attack', value: Number(pct) || 0 }, caster, target);
        if (intended > 0) {
            return await skillSystem.applyDamage(target, intended, targetId, playerId);
        }
        return 0;
    }

    window.BattleHooks.register('skill_system:apply_skill_effect', async (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const effect = ctx && ctx.effect;
            const caster = ctx && ctx.caster;
            const target = ctx && ctx.target;
            const gameState = ctx && ctx.gameState;
            const playerId = ctx && ctx.playerId;
            const opponentPlayerId = ctx && ctx.opponentPlayerId;
            const targetId = ctx && ctx.targetId;

            if (!skillSystem || !effect || !effect.type) return;
            if (!isEmilia(caster)) return;

            const enemyId = target === caster ? playerId : opponentPlayerId;
            const frozenTarget = isFrozen(skillSystem, enemyId);
            const fqStacks = getFrozenQueenStacks(skillSystem, playerId);

            if (effect.type === 'emilia_silver_blizzard') {
                const pct = getAttackPctWithFrozenQueen(effect.attackPct ?? 0.65, fqStacks, frozenTarget);
                const dealt = await dealAttackPctDamage(skillSystem, caster, target, enemyId, playerId, pct);
                ctx.result.damage = (Number(ctx.result.damage) || 0) + dealt;

                try {
                    if (window.EmiliaCharacter && typeof window.EmiliaCharacter.getPermafrostStacks === 'function' && typeof window.EmiliaCharacter.setPermafrostStacks === 'function') {
                        const cur = window.EmiliaCharacter.getPermafrostStacks(skillSystem, enemyId);
                        window.EmiliaCharacter.setPermafrostStacks(skillSystem, enemyId, playerId, cur + 1);
                        ctx.result.effects.push('Permafrost');
                    }
                } catch (e) {}
                return { handled: true };
            }

            if (effect.type === 'emilia_frost_petal') {
                try {
                    if (window.EmiliaCharacter && typeof window.EmiliaCharacter.getPermafrostStacks === 'function' && typeof window.EmiliaCharacter.setPermafrostStacks === 'function') {
                        const cur = window.EmiliaCharacter.getPermafrostStacks(skillSystem, enemyId);
                        if (cur > 0) {
                            window.EmiliaCharacter.setPermafrostStacks(skillSystem, enemyId, playerId, cur * 2);
                        }
                        ctx.result.effects.push('Permafrost');
                    }
                } catch (e) {}
                return { handled: true };
            }

            if (effect.type === 'emilia_glacial_prison') {
                try {
                    if (window.EmiliaCharacter && typeof window.EmiliaCharacter.applyFreeze === 'function') {
                        window.EmiliaCharacter.applyFreeze(skillSystem, enemyId, playerId, 2);
                        ctx.result.effects.push('Frozen');

                        // Guarantee: whenever this skill applies Freeze, grant 1 Frozen Empress.
                        try {
                            const targetIsFrozen = (window.EmiliaCharacter && typeof window.EmiliaCharacter.isFrozen === 'function')
                                ? window.EmiliaCharacter.isFrozen(skillSystem, enemyId)
                                : isFrozen(skillSystem, enemyId);
                            if (targetIsFrozen && window.EmiliaCharacter && typeof window.EmiliaCharacter.grantFrozenEmpressStack === 'function') {
                                window.EmiliaCharacter.grantFrozenEmpressStack(skillSystem, playerId);
                            }
                        } catch (e) {}

                    }
                } catch (e) {}
                return { handled: true };
            }

            if (effect.type === 'emilia_absolute_zero') {
                const pct = getAttackPctWithFrozenQueen(effect.attackPct ?? 0.9, fqStacks, frozenTarget);
                const dealt = await dealAttackPctDamage(skillSystem, caster, target, enemyId, playerId, pct);
                ctx.result.damage = (Number(ctx.result.damage) || 0) + dealt;

                try {
                    if (window.EmiliaCharacter && typeof window.EmiliaCharacter.getPermafrostStacks === 'function' && typeof window.EmiliaCharacter.setPermafrostStacks === 'function') {
                        const cur = window.EmiliaCharacter.getPermafrostStacks(skillSystem, enemyId);
                        window.EmiliaCharacter.setPermafrostStacks(skillSystem, enemyId, playerId, cur + 7);
                        ctx.result.effects.push('Permafrost');
                    }
                } catch (e) {}

                return { handled: true };
            }
        } catch (e) {}
    }, { id: 'skill_effects:emilia', order: 0 });
})();

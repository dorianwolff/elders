(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function isNarutoLike(character) {
        const id = character && character.id;
        return id === 'naruto' || id === 'naruto_sage';
    }

    function balanceAtkBuffId(playerId) {
        return `balance_plus3_attack_${playerId}`;
    }

    window.BattleHooks.register('passive_system:balance_changed', (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const playerId = ctx && ctx.playerId;
            const character = ctx && ctx.character;
            const after = Number(ctx && ctx.after);
            const before = Number(ctx && ctx.before);

            if (!skillSystem || !playerId || !character) return;
            if (!isNarutoLike(character)) return;

            // Balance -3 shield should only persist while you remain at -3.
            if (before === -3 && after !== -3) {
                if (character && character.stats) {
                    character.stats.shield = 0;
                    character.stats.maxShield = 0;
                }
            }

            // While at Balance +3, grant a +10 ATK buff (blue). Remove when leaving +3.
            if (skillSystem && skillSystem.activeEffects) {
                const id = balanceAtkBuffId(playerId);
                if (after === 3) {
                    const existing = skillSystem.activeEffects.get(id);
                    if (!existing) {
                        skillSystem.activeEffects.set(id, {
                            type: 'buff',
                            target: playerId,
                            characterId: character.id,
                            stat: 'attack',
                            value: 10,
                            mode: 'flat',
                            duration: 9999,
                            turnsLeft: 9999,
                            name: 'Balance',
                            description: 'Attack increased by 10 while at Balance +3'
                        });
                        if (typeof skillSystem.recalculateStats === 'function') {
                            skillSystem.recalculateStats(playerId);
                        }
                    }
                } else {
                    if (skillSystem.activeEffects.has(id)) {
                        skillSystem.activeEffects.delete(id);
                        if (typeof skillSystem.recalculateStats === 'function') {
                            skillSystem.recalculateStats(playerId);
                        }
                    }
                }
            }
        } catch (e) {}
    }, { id: 'character:naruto:balance_side_effects', order: 0 });

    window.BattleHooks.register('skill_system:transform_self', (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const playerId = ctx && ctx.playerId;
            const character = ctx && ctx.character;
            const transformToId = ctx && ctx.transformToId;

            if (!skillSystem || !playerId || !character) return;
            if (transformToId !== 'naruto_sage') return;

            // entering Sage Mode resets Balance back to 0.
            if (character.passiveState && character.passiveState.counters) {
                character.passiveState.counters.balance = 0;
            }

            // if we were at Balance +3 before transforming, remove the +10 ATK buff.
            if (skillSystem.activeEffects) {
                const id = balanceAtkBuffId(playerId);
                if (skillSystem.activeEffects.has(id)) {
                    skillSystem.activeEffects.delete(id);
                }
            }

            if (typeof skillSystem.recalculateStats === 'function') {
                skillSystem.recalculateStats(playerId);
            }
        } catch (e) {}
    }, { id: 'character:naruto:transform_to_sage', order: 0 });
})();

(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    window.BattleHooks.register('passive_system:event', async (ctx) => {
        try {
            const passiveSystem = ctx && ctx.passiveSystem;
            const skillSystem = ctx && ctx.skillSystem;
            const gameState = ctx && ctx.gameState;
            const playerId = ctx && ctx.playerId;
            const character = ctx && ctx.character;
            const eventType = ctx && ctx.eventType;
            const payload = ctx && ctx.payload;

            if (!passiveSystem || !skillSystem || !gameState) return;
            if (!character || character.itemId !== 'mace') return;

            const state = passiveSystem.ensureState(character);

            const hasBloodlustBuff = () => {
                const effects = skillSystem && skillSystem.activeEffects;
                if (!effects || typeof effects.entries !== 'function') return false;
                for (const [, eff] of effects.entries()) {
                    if (!eff) continue;
                    if (eff.type !== 'buff') continue;
                    if (eff.target !== playerId) continue;
                    if (eff._itemPassiveId !== 'mace_bloodlust') continue;
                    if (eff.stat !== 'attack') continue;
                    if ((Number(eff.turnsLeft) || 0) <= 0) continue;
                    return true;
                }
                return false;
            };

            const removeBloodlustBuff = () => {
                const effects = skillSystem && skillSystem.activeEffects;
                if (!effects || typeof effects.entries !== 'function') return;
                const toRemove = [];
                for (const [id, eff] of effects.entries()) {
                    if (!eff) continue;
                    if (eff.type !== 'buff') continue;
                    if (eff.target !== playerId) continue;
                    if (eff._itemPassiveId !== 'mace_bloodlust') continue;
                    toRemove.push(id);
                }
                for (const id of toRemove) {
                    effects.delete(id);
                }
                if (toRemove.length > 0 && skillSystem && typeof skillSystem.recalculateStats === 'function') {
                    skillSystem.recalculateStats(playerId);
                }
            };

            const ensureBloodlustState = async () => {
                const hp = Number(character?.stats?.health) || 0;
                const maxHp = Number(character?.stats?.maxHealth) || 0;
                if (maxHp <= 0) return;
                const below = hp / maxHp < 0.5;

                if (below) {
                    if (!hasBloodlustBuff() && skillSystem && typeof skillSystem.applyBuff === 'function') {
                        await skillSystem.applyBuff(character, {
                            stat: 'attack',
                            mode: 'flat',
                            value: 2,
                            duration: 999
                        }, playerId);

                        try {
                            const effects = skillSystem.activeEffects;
                            const ids = [];
                            for (const [id, eff] of effects.entries()) {
                                if (!eff) continue;
                                if (eff.type !== 'buff') continue;
                                if (eff.target !== playerId) continue;
                                if (eff.stat !== 'attack') continue;
                                if (eff.value !== 2) continue;
                                if ((Number(eff.turnsLeft) || 0) !== 999) continue;
                                if (eff._itemPassiveId) continue;
                                ids.push(id);
                            }
                            if (ids.length > 0) {
                                const last = ids[ids.length - 1];
                                const eff = effects.get(last);
                                if (eff) {
                                    eff._itemPassiveId = 'mace_bloodlust';
                                    eff.name = 'Bloodlust';
                                    eff.description = 'Gain +2 ATK while below 50% HP';
                                }
                            }
                        } catch (e) {}
                    }
                } else {
                    removeBloodlustBuff();
                }
            };

            if (eventType === 'turn_start' || eventType === 'damage_taken') {
                await ensureBloodlustState();
            }

            if (eventType === 'skill_used') {
                await ensureBloodlustState();

                const hpBefore = (payload && payload.hpBefore !== undefined) ? Number(payload.hpBefore) : (Number(character?.stats?.health) || 0);
                const maxHpBefore = (payload && payload.maxHpBefore !== undefined) ? Number(payload.maxHpBefore) : (Number(character?.stats?.maxHealth) || 0);
                const below = maxHpBefore > 0 ? (hpBefore / maxHpBefore < 0.5) : false;
                const isUltimate = payload && payload.skillType === 'ultimate';
                const isAttackSkill = payload && payload.skillType === 'attack';

                if (below && !isUltimate && isAttackSkill && skillSystem && typeof skillSystem.applyHealing === 'function') {
                    const curMax = Number(character?.stats?.maxHealth) || 0;
                    const amount = Math.max(1, Math.floor(curMax * 0.05));
                    await skillSystem.applyHealing(character, amount, playerId);
                }
            }
        } catch (e) {}
    }, { id: 'item:mace', order: 0 });
})();

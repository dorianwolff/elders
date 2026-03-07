(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function isYato(caster) {
        return Boolean(caster && caster.id === 'yato');
    }

    function formatTimesWord(n) {
        if (window.YatoCharacter && typeof window.YatoCharacter.formatTimesWord === 'function') {
            return window.YatoCharacter.formatTimesWord(n);
        }
        const x = Math.max(1, Math.floor(Number(n) || 1));
        if (x === 1) return 'once';
        if (x === 2) return 'twice';
        if (x === 3) return 'thrice';
        return `${x} times`;
    }

    function ensureState(skillSystem, playerId, caster) {
        try {
            const passiveSystem = skillSystem?.passiveSystem;
            if (passiveSystem && typeof passiveSystem.ensureState === 'function') {
                return passiveSystem.ensureState(caster);
            }
        } catch (e) {}

        if (!caster.passiveState) {
            caster.passiveState = { counters: {}, totalHealingDone: 0, ultimateReady: false };
        }
        if (!caster.passiveState.counters) caster.passiveState.counters = {};
        if (!Number.isFinite(caster.passiveState.counters.yatoUltCharge)) {
            caster.passiveState.counters.yatoUltCharge = 0;
        }
        return caster.passiveState;
    }

    function loseImmortality(skillSystem, playerId, caster) {
        const ps = skillSystem?.passiveSystem;
        if (window.YatoCharacter && typeof window.YatoCharacter.loseImmortalityStack === 'function' && ps) {
            return window.YatoCharacter.loseImmortalityStack(ps, playerId, caster, 1);
        }

        const state = ensureState(skillSystem, playerId, caster);
        const before = Math.max(0, Math.floor(Number(state.counters.immortalityStacks) || 0));
        const next = Math.max(0, before - 1);
        state.counters.immortalityStacks = next;
        state.yatoImmortalityLost = Math.max(0, Math.floor(Number(state.yatoImmortalityLost) || 0)) + 1;
        state.counters.yatoUltCharge = (Number(state.counters.yatoUltCharge) || 0) + 1;
        try {
            if (ps && typeof ps.updateUltimateReady === 'function') {
                ps.updateUltimateReady(playerId);
            }
        } catch (e) {}
        return { before, next };
    }

    async function syncDivinePossessionTransform(skillSystem, gameState, playerId, caster) {
        try {
            if (window.YatoCharacter && typeof window.YatoCharacter.ensureYatoState === 'function') {
                // Ensure state exists.
                window.YatoCharacter.ensureYatoState(skillSystem.passiveSystem, caster);
            }
        } catch (e) {}

        // Use the same transform helper defined in character-yato.js by emitting a passive turn_start.
        try {
            if (skillSystem?.passiveSystem && typeof skillSystem.passiveSystem.handleEvent === 'function') {
                skillSystem.passiveSystem.handleEvent(playerId, 'turn_start', {});
            }
        } catch (e) {}
    }

    function getAttackExtraTriggers(caster) {
        const n = Math.max(0, Math.floor(Number(caster?.passiveState?.yatoAttackExtraTriggers) || 0));
        return n;
    }

    async function dealRepeatedDamage(skillSystem, caster, target, targetId, playerId, percent, isTrue) {
        const extra = getAttackExtraTriggers(caster);
        const totalHits = 1 + extra;
        let dealtTotal = 0;
        for (let i = 0; i < totalHits; i++) {
            if (isTrue) {
                const base = Math.max(0, (Number(caster?.stats?.attack) || 0) * (Number(percent) || 0));
                if (base <= 0) continue;
                dealtTotal += await skillSystem.applyTrueDamage(target, Math.floor(base), targetId, playerId);
            } else {
                const intended = skillSystem.calculateDamage({ scaling: 'attack', value: Number(percent) || 0 }, caster, target);
                if (intended > 0) {
                    dealtTotal += await skillSystem.applyDamage(target, intended, targetId, playerId);
                }
            }
        }
        return { dealtTotal, totalHits };
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
            if (!isYato(caster)) return;

            const enemyId = target === caster ? playerId : opponentPlayerId;

            if (effect.type === 'yato_teleportation') {
                const dur = Math.max(1, Math.floor(Number(effect.true_damage_immunity_duration) || 3));

                // Nullify next enemy attack skill damage (one-time).
                skillSystem.activeEffects.set(`yato_tp_null_${playerId}_${Date.now()}`, {
                    type: 'buff',
                    key: 'yato_teleportation_nullify',
                    target: playerId,
                    ownerId: playerId,
                    duration: 999,
                    turnsLeft: 999,
                    name: 'Teleportation',
                    description: 'Reduce the next attack skill damage to 0.'
                });

                // True damage immunity (3 turns).
                skillSystem.activeEffects.set(`yato_tp_true_${playerId}_${Date.now()}`, {
                    type: 'buff',
                    key: 'yato_true_damage_immunity',
                    target: playerId,
                    ownerId: playerId,
                    duration: dur,
                    turnsLeft: dur,
                    name: 'True Damage Immunity',
                    description: `Prevent true damage for ${dur} turns.`
                });

                ctx.result.effects.push('Teleportation');
                return { handled: true };
            }

            if (effect.type === 'yato_divine_possession') {
                const { next } = loseImmortality(skillSystem, playerId, caster);

                // Visual indicator (grey stack-counter, unremovable).
                try {
                    skillSystem.activeEffects.set(`yato_immortality_spend_${playerId}_${Date.now()}`, {
                        type: 'stack-counter',
                        target: playerId,
                        characterId: 'yato',
                        turnsLeft: 1,
                        name: 'Immortality',
                        description: `${Math.max(0, next)} stacks remaining`
                    });
                } catch (e) {}

                await syncDivinePossessionTransform(skillSystem, gameState, playerId, caster);
                ctx.result.effects.push('Immortality');
                return { handled: true };
            }

            if (effect.type === 'yato_normal_strike') {
                const r = await dealRepeatedDamage(skillSystem, caster, target, enemyId, playerId, effect.value, false);
                ctx.result.damage = (Number(ctx.result.damage) || 0) + r.dealtTotal;
                return { handled: true };
            }

            if (effect.type === 'yato_last_strike') {
                const r = await dealRepeatedDamage(skillSystem, caster, target, enemyId, playerId, effect.value, true);
                ctx.result.damage = (Number(ctx.result.damage) || 0) + r.dealtTotal;
                return { handled: true };
            }

            if (effect.type === 'yato_twin_strike') {
                const state = ensureState(skillSystem, playerId, caster);
                if (!Number.isFinite(state.yatoAttackExtraTriggers)) state.yatoAttackExtraTriggers = 0;
                if (!Number.isFinite(state.yatoTwinStrikeHits)) state.yatoTwinStrikeHits = 2;

                const hits = Math.max(2, Math.floor(Number(state.yatoTwinStrikeHits) || 2));
                const pct = Number(effect.value) || 1.25;

                let total = 0;
                for (let i = 0; i < hits; i++) {
                    const intended = skillSystem.calculateDamage({ scaling: 'attack', value: pct }, caster, target);
                    if (intended > 0) {
                        total += await skillSystem.applyDamage(target, intended, enemyId, playerId);
                    }
                }
                ctx.result.damage = (Number(ctx.result.damage) || 0) + total;

                // Permanently increase extra attack triggers.
                state.yatoAttackExtraTriggers = Math.max(0, Math.floor(Number(state.yatoAttackExtraTriggers) || 0)) + 1;
                state.yatoTwinStrikeHits = hits + 1;

                // Keep ultimate description synced.
                if (caster.ultimate && caster.ultimate.id === 'yato_twin_strike') {
                    const nextWord = formatTimesWord(state.yatoTwinStrikeHits);
                    caster.ultimate.description = `Deal 125% of attack as damage, ${nextWord}. For the rest of the game, all of Yato's attack skills trigger an additional time.`;
                }

                ctx.result.effects.push('Twin Strike');
                return { handled: true };
            }
        } catch (e) {}
    }, { id: 'skill_effects:yato', order: 0 });

    window.BattleHooks.register('skill_system:sync_skill_effects', async (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const effect = ctx && ctx.effect;
            const caster = ctx && ctx.caster;
            const playerId = ctx && ctx.playerId;

            if (!skillSystem || !effect || !effect.type) return;
            if (!isYato(caster)) return;

            // Mirror only state mutations that affect future actions.
            if (effect.type === 'yato_teleportation') {
                const dur = Math.max(1, Math.floor(Number(effect.true_damage_immunity_duration) || 3));
                skillSystem.activeEffects.set(`yato_tp_null_${playerId}_${Date.now()}`, {
                    type: 'buff',
                    key: 'yato_teleportation_nullify',
                    target: playerId,
                    ownerId: playerId,
                    duration: 999,
                    turnsLeft: 999,
                    name: 'Teleportation',
                    description: 'Reduce the next attack skill damage to 0.'
                });
                skillSystem.activeEffects.set(`yato_tp_true_${playerId}_${Date.now()}`, {
                    type: 'buff',
                    key: 'yato_true_damage_immunity',
                    target: playerId,
                    ownerId: playerId,
                    duration: dur,
                    turnsLeft: dur,
                    name: 'True Damage Immunity',
                    description: `Prevent true damage for ${dur} turns.`
                });
                return { handled: true };
            }

            if (effect.type === 'yato_divine_possession') {
                loseImmortality(skillSystem, playerId, caster);
                await syncDivinePossessionTransform(skillSystem, skillSystem.gameState, playerId, caster);
                return { handled: true };
            }

            if (effect.type === 'yato_twin_strike') {
                const state = ensureState(skillSystem, playerId, caster);
                if (!Number.isFinite(state.yatoAttackExtraTriggers)) state.yatoAttackExtraTriggers = 0;
                if (!Number.isFinite(state.yatoTwinStrikeHits)) state.yatoTwinStrikeHits = 2;
                const hits = Math.max(2, Math.floor(Number(state.yatoTwinStrikeHits) || 2));
                state.yatoAttackExtraTriggers = Math.max(0, Math.floor(Number(state.yatoAttackExtraTriggers) || 0)) + 1;
                state.yatoTwinStrikeHits = hits + 1;
                if (caster.ultimate && caster.ultimate.id === 'yato_twin_strike') {
                    const nextWord = formatTimesWord(state.yatoTwinStrikeHits);
                    caster.ultimate.description = `Deal 125% of attack as damage, ${nextWord}. For the rest of the game, all of Yato's attack skills trigger an additional time.`;
                }
                return { handled: true };
            }
        } catch (e) {}
    }, { id: 'skill_effects:yato:sync', order: 0 });
})();

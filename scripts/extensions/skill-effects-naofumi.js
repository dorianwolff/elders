(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function isNaofumi(caster) {
        return Boolean(caster && caster.id === 'naofumi_iwatani');
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
            if (!isNaofumi(caster)) return;

            if (effect.type === 'naofumi_shield_bash') {
                const basePct = Number(effect.base_percent) || 0;
                const transformPct = Number(effect.transform_percent) || basePct;
                const transformActive = Boolean(caster && caster.passiveState && caster.passiveState.naofumiTransformActive);
                const pct = transformActive ? transformPct : basePct;

                const baseDamage = Math.max(0, (Number(caster?.stats?.defense) || 0) * pct);
                const actionCtx = skillSystem.getActiveActionContext();
                const ignoreDefense = Boolean(actionCtx && actionCtx.ignoreDefense);
                const defense = ignoreDefense ? 0 : (Number(target?.stats?.defense) || 0);
                const damageReduction = (Number(target?.stats?.damageReduction) || 0) / 100;
                const reduced = Math.max(1, baseDamage - defense);
                const finalDamage = Math.max(1, Math.ceil(reduced * (1 - damageReduction)));

                ctx.result.damage = await skillSystem.applyDamage(target, finalDamage, targetId, playerId);
                return { handled: true };
            }

            if (effect.type === 'naofumi_defensive_stance') {
                const turnsLeft = Math.max(1, Math.floor(Number(effect.enemy_turn_duration) || 1));
                const dr = Math.max(0, Math.floor(Number(effect.damage_reduction) || 0));
                const id = `stance_${playerId}_${Date.now()}`;
                skillSystem.activeEffects.set(id, {
                    type: 'stance',
                    key: 'naofumi_defensive_stance',
                    stanceKey: 'naofumi_defensive_stance',
                    target: playerId,
                    damageReduction: dr,
                    duration: turnsLeft,
                    turnsLeft,
                    transformCounterRatioDefense: Number(effect.transform_counter_ratio_defense) || 0,
                    name: 'Defensive Stance',
                    description: 'Reduces damage taken by 30%'
                });
                skillSystem.recalculateStats(playerId);
                return { handled: true };
            }

            if (effect.type === 'naofumi_ultimate') {
                const duration = Math.max(1, Math.floor(Number(effect.heal_block_duration) || 2));
                const enemyId = target === caster ? playerId : opponentPlayerId;
                await skillSystem.applyHealBlock(enemyId, duration);

                const def = Math.floor(Number(effect.self_defense_buff) || 0);
                const defDur = Math.max(1, Math.floor(Number(effect.self_defense_duration) || 5));
                if (def !== 0) {
                    await skillSystem.applyBuff(caster, { stat: 'defense', value: def, mode: 'flat', duration: defDur }, playerId);
                }
                return { handled: true };
            }

            if (effect.type === 'naofumi_soul_eat') {
                const enemyId = target === caster ? playerId : opponentPlayerId;

                // Remove enemy stance
                for (const [id, eff] of skillSystem.activeEffects.entries()) {
                    if (eff && eff.type === 'stance' && eff.target === enemyId) {
                        skillSystem.activeEffects.delete(id);
                    }
                }

                const ratio = Math.max(0, Number(effect.max_health_ratio) || 0);
                const intended = Math.max(0, Math.floor((Number(target?.stats?.maxHealth) || 0) * ratio));
                if (intended > 0) {
                    ctx.result.damage = await skillSystem.applyTrueDamageNoDomain(target, intended, enemyId, playerId);
                }
                return { handled: true };
            }

            if (effect.type === 'naofumi_undead_control') {
                const turnsLeft = Math.max(1, Math.floor(Number(effect.enemy_turn_duration) || 1));
                const ratio = Math.max(0, Number(effect.rebound_ratio) || 0);
                const id = `stance_${playerId}_${Date.now()}`;
                skillSystem.activeEffects.set(id, {
                    type: 'stance',
                    key: 'naofumi_undead_control',
                    stanceKey: 'naofumi_undead_control',
                    target: playerId,
                    reboundRatio: ratio,
                    duration: turnsLeft,
                    turnsLeft,
                    name: 'Undead Control',
                    description: 'Recover 40% of damage taken and reflect it as true damage'
                });
                return { handled: true };
            }
        } catch (e) {}
    }, { id: 'skill_effects:naofumi', order: 0 });

    window.BattleHooks.register('skill_system:sync_skill_effects', async (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const effect = ctx && ctx.effect;
            const caster = ctx && ctx.caster;
            const target = ctx && ctx.target;
            const gameState = ctx && ctx.gameState;
            const playerId = ctx && ctx.playerId;

            if (!skillSystem || !effect || !effect.type) return;
            if (!isNaofumi(caster)) return;

            // Mirror only non-damage state. Damage numbers are authoritative.
            if (effect.type === 'naofumi_defensive_stance') {
                const turnsLeft = Math.max(1, Math.floor(Number(effect.enemy_turn_duration) || 1));
                const dr = Math.max(0, Math.floor(Number(effect.damage_reduction) || 0));
                const id = `stance_${playerId}_${Date.now()}`;
                skillSystem.activeEffects.set(id, {
                    type: 'stance',
                    key: 'naofumi_defensive_stance',
                    stanceKey: 'naofumi_defensive_stance',
                    target: playerId,
                    damageReduction: dr,
                    duration: turnsLeft,
                    turnsLeft,
                    transformCounterRatioDefense: Number(effect.transform_counter_ratio_defense) || 0,
                    name: 'Defensive Stance',
                    description: 'Reduces damage taken by 30%'
                });
                skillSystem.recalculateStats(playerId);
                return { handled: true };
            }

            if (effect.type === 'naofumi_ultimate') {
                const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                const targetId = target === caster ? playerId : opponentId;
                const enemyId = targetId === playerId ? opponentId : playerId;

                const duration = Math.max(1, Math.floor(Number(effect.heal_block_duration) || 2));
                await skillSystem.applyHealBlock(enemyId, duration);

                const def = Math.floor(Number(effect.self_defense_buff) || 0);
                const defDur = Math.max(1, Math.floor(Number(effect.self_defense_duration) || 5));
                if (def !== 0) {
                    await skillSystem.applyBuff(caster, { stat: 'defense', value: def, mode: 'flat', duration: defDur }, playerId);
                }
                return { handled: true };
            }

            if (effect.type === 'naofumi_soul_eat') {
                const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                const targetId = target === caster ? playerId : opponentId;
                const enemyId = targetId === playerId ? opponentId : playerId;

                for (const [id, eff] of skillSystem.activeEffects.entries()) {
                    if (eff && eff.type === 'stance' && eff.target === enemyId) {
                        skillSystem.activeEffects.delete(id);
                    }
                }
                return { handled: true };
            }

            if (effect.type === 'naofumi_undead_control') {
                const turnsLeft = Math.max(1, Math.floor(Number(effect.enemy_turn_duration) || 1));
                const ratio = Math.max(0, Number(effect.rebound_ratio) || 0);
                const id = `stance_${playerId}_${Date.now()}`;
                skillSystem.activeEffects.set(id, {
                    type: 'stance',
                    key: 'naofumi_undead_control',
                    stanceKey: 'naofumi_undead_control',
                    target: playerId,
                    reboundRatio: ratio,
                    duration: turnsLeft,
                    turnsLeft,
                    name: 'Undead Control',
                    description: 'Recover 40% of damage taken and reflect it as true damage'
                });
                return { handled: true };
            }
        } catch (e) {}
    }, { id: 'skill_effects:naofumi:sync', order: 0 });
})();

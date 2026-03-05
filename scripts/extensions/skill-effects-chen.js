(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function isChen(caster) {
        return Boolean(caster && caster.id === 'chen');
    }

    window.BattleHooks.register('skill_system:apply_skill_effect', async (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const effect = ctx && ctx.effect;
            const caster = ctx && ctx.caster;
            const target = ctx && ctx.target;
            const gameState = ctx && ctx.gameState;
            const playerId = ctx && ctx.playerId;
            const override = ctx && ctx.override;

            if (!skillSystem || !effect || !effect.type) return;
            if (!isChen(caster)) return;

            if (effect.type === 'damage_with_cdr_stacks') {
                const stackSkillId = typeof effect.stack_skill_id === 'string' && effect.stack_skill_id
                    ? effect.stack_skill_id
                    : (typeof override?.skillId === 'string' ? override.skillId : null);
                const stacks = stackSkillId ? skillSystem.getCooldownReductionStacksForSkill(playerId, stackSkillId) : 0;

                const permDefAt = Math.max(0, Math.floor(Number(effect.permanent_defense_if_stacks_at_least) || 0));
                const permDef = Math.floor(Number(effect.permanent_defense_amount) || 0);
                if (permDefAt > 0 && permDef !== 0 && stacks >= permDefAt) {
                    if (!caster.baseStats) caster.baseStats = { ...caster.stats };
                    caster.baseStats.defense = (Number(caster.baseStats.defense) || 0) + permDef;
                    skillSystem.recalculateStats(playerId);
                    if (ctx.result && Array.isArray(ctx.result.effects)) {
                        ctx.result.effects.push(`Permanently gained +${permDef} defense`);
                    }
                }
                return;
            }

            if (effect.type === 'chen_piercing_assault') {
                const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                const targetId = target === caster ? playerId : opponentId;

                const preSkillCdrStacks = (override && override.preSkillCdrStacks && typeof override.preSkillCdrStacks === 'object')
                    ? override.preSkillCdrStacks
                    : ((() => {
                        const actionCtx = skillSystem.getActiveActionContext();
                        return (actionCtx && actionCtx.preSkillCdrStacks && typeof actionCtx.preSkillCdrStacks === 'object')
                            ? actionCtx.preSkillCdrStacks
                            : null;
                    })());

                const threshold = Math.max(0, Math.floor(Number(effect.shield_break_if_other_skill_stacks_at_least) || 0));
                const stackIds = Array.isArray(effect.stack_skill_ids) ? effect.stack_skill_ids : [];
                let shouldBreakShield = false;
                if (threshold > 0 && stackIds.length > 0) {
                    for (const sid of stackIds) {
                        if (!sid) continue;
                        const stacks = (preSkillCdrStacks && preSkillCdrStacks[sid] !== undefined)
                            ? Math.max(0, Math.floor(Number(preSkillCdrStacks[sid]) || 0))
                            : skillSystem.getCooldownReductionStacksForSkill(playerId, sid);
                        if (stacks >= threshold) {
                            shouldBreakShield = true;
                            break;
                        }
                    }
                }

                if (shouldBreakShield && target && target.stats && (Number(target.stats.shield) || 0) > 0) {
                    target.stats.shield = 0;
                    target.stats.maxShield = 0;
                    if (ctx.result && Array.isArray(ctx.result.effects)) {
                        ctx.result.effects.push('Shield Broken');
                    }
                }

                const ratio = Math.max(0, Number(effect.damage_percent) || 0);
                const intended = skillSystem.calculateDamage({ scaling: 'attack', value: ratio }, caster, target);
                if (intended > 0) {
                    ctx.result.damage = await skillSystem.applyDamage(target, intended, targetId, playerId);
                }

                return { handled: true };
            }

            if (effect.type === 'chen_ultimate_barrage') {
                const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                const targetId = target === caster ? playerId : opponentId;

                const stackSkillId = typeof effect.stack_skill_id === 'string' && effect.stack_skill_id
                    ? effect.stack_skill_id
                    : null;
                const stacks = stackSkillId ? skillSystem.getCooldownReductionStacksForSkill(playerId, stackSkillId) : 0;
                const base = Number(effect.base_percent) || 0;
                const hits = Math.max(1, 1 + Math.max(0, Math.floor(stacks)));

                for (let i = 0; i < hits; i++) {
                    const intended = skillSystem.calculateDamage({ scaling: 'attack', value: base }, caster, target);
                    if (intended > 0) {
                        const dealt = await skillSystem.applyDamage(target, intended, targetId, playerId);
                        ctx.result.damage = (Number(ctx.result.damage) || 0) + dealt;
                    }
                }

                const cdrAt = Math.max(0, Math.floor(Number(effect.reduce_other_skill_cooldowns_if_stacks_at_least) || 0));
                const cdrAmt = Math.max(0, Math.floor(Number(effect.reduce_other_skill_cooldowns_amount) || 0));
                if (cdrAt > 0 && cdrAmt > 0 && stacks >= cdrAt) {
                    const skills = Array.isArray(caster?.skills) ? caster.skills : [];
                    let reducedAny = false;
                    for (const s of skills) {
                        if (!s || !s.id) continue;
                        if (s.id === stackSkillId) continue;
                        const remaining = Math.max(0, Math.floor(skillSystem.getSkillCooldown({ id: s.id }, playerId)));
                        if (remaining > 0) {
                            skillSystem.setSkillCooldown(s.id, playerId, Math.max(0, remaining - cdrAmt));
                            reducedAny = true;
                        }

                        const buffCfg = s.cooldownReductionBuff && typeof s.cooldownReductionBuff === 'object'
                            ? s.cooldownReductionBuff
                            : null;
                        if (buffCfg) {
                            const maxStacks = (typeof buffCfg.maxStacks === 'number')
                                ? Math.max(0, Math.floor(buffCfg.maxStacks))
                                : null;
                            const cur = skillSystem.getCooldownReductionStacksForSkill(playerId, s.id);
                            const next = maxStacks === null ? (cur + cdrAmt) : Math.min(maxStacks, cur + cdrAmt);
                            skillSystem.setCooldownReductionStacksForSkill(playerId, s.id, next);
                        }
                    }

                    if (reducedAny) {
                        if (ctx.result && Array.isArray(ctx.result.effects)) {
                            ctx.result.effects.push(`Reduced cooldown of other skills by ${cdrAmt}`);
                        }

                        try {
                            if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                                window.BattleHooks.emit('skill_system:cooldown_reduced', {
                                    skillSystem,
                                    gameState,
                                    playerId,
                                    character: caster,
                                    reducedSkillId: null,
                                    amount: cdrAmt
                                });
                            }
                        } catch (e) {}
                    }
                }

                if (stackSkillId && effect.reset_stacks_on_use) {
                    skillSystem.setCooldownReductionStacksForSkill(playerId, stackSkillId, 0);
                }

                return { handled: true };
            }
        } catch (e) {}
    }, { id: 'skill_effects:chen', order: 0 });

    window.BattleHooks.register('skill_system:sync_skill_effects', async (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const effect = ctx && ctx.effect;
            const skill = ctx && ctx.skill;
            const caster = ctx && ctx.caster;
            const target = ctx && ctx.target;
            const gameState = ctx && ctx.gameState;
            const playerId = ctx && ctx.playerId;
            const preSkillCdrStacks = ctx && ctx.preSkillCdrStacks;

            if (!skillSystem || !effect || !effect.type) return;
            if (!isChen(caster)) return;

            if (effect.type === 'chen_piercing_assault') {
                const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                const targetId = target === caster ? playerId : opponentId;
                if (targetId === playerId) return { handled: true };

                const threshold = Math.max(0, Math.floor(Number(effect.shield_break_if_other_skill_stacks_at_least) || 0));
                const stackIds = Array.isArray(effect.stack_skill_ids) ? effect.stack_skill_ids : [];
                let shouldBreakShield = false;
                if (threshold > 0 && stackIds.length > 0) {
                    for (const sid of stackIds) {
                        if (!sid) continue;
                        const stacks = (preSkillCdrStacks && preSkillCdrStacks[sid] !== undefined)
                            ? Math.max(0, Math.floor(Number(preSkillCdrStacks[sid]) || 0))
                            : skillSystem.getCooldownReductionStacksForSkill(playerId, sid);
                        if (stacks >= threshold) {
                            shouldBreakShield = true;
                            break;
                        }
                    }
                }

                if (shouldBreakShield && target && target.stats && (Number(target.stats.shield) || 0) > 0) {
                    target.stats.shield = 0;
                    target.stats.maxShield = 0;
                }

                return { handled: true };
            }

            if (effect.type === 'damage_with_cdr_stacks') {
                const stackSkillId = typeof effect.stack_skill_id === 'string' && effect.stack_skill_id
                    ? effect.stack_skill_id
                    : null;

                const stacks = stackSkillId ? skillSystem.getCooldownReductionStacksForSkill(playerId, stackSkillId) : 0;

                const permDefAt = Math.max(0, Math.floor(Number(effect.permanent_defense_if_stacks_at_least) || 0));
                const permDef = Math.floor(Number(effect.permanent_defense_amount) || 0);
                if (permDefAt > 0 && permDef !== 0 && stacks >= permDefAt) {
                    if (!caster.baseStats) caster.baseStats = { ...caster.stats };
                    caster.baseStats.defense = (Number(caster.baseStats.defense) || 0) + permDef;
                    skillSystem.recalculateStats(playerId);
                }

                return;
            }

            if (effect.type === 'chen_ultimate_barrage') {
                const stackSkillId = typeof effect.stack_skill_id === 'string' && effect.stack_skill_id
                    ? effect.stack_skill_id
                    : null;
                const stacks = stackSkillId ? skillSystem.getCooldownReductionStacksForSkill(playerId, stackSkillId) : 0;

                const cdrAt = Math.max(0, Math.floor(Number(effect.reduce_other_skill_cooldowns_if_stacks_at_least) || 0));
                const cdrAmt = Math.max(0, Math.floor(Number(effect.reduce_other_skill_cooldowns_amount) || 0));
                if (cdrAt > 0 && cdrAmt > 0 && stacks >= cdrAt) {
                    const skills = Array.isArray(caster?.skills) ? caster.skills : [];
                    for (const s of skills) {
                        if (!s || !s.id) continue;
                        if (s.id === stackSkillId) continue;
                        const remaining = Math.max(0, Math.floor(skillSystem.getSkillCooldown({ id: s.id }, playerId)));
                        if (remaining > 0) {
                            skillSystem.setSkillCooldown(s.id, playerId, Math.max(0, remaining - cdrAmt));
                        }

                        const buffCfg = s.cooldownReductionBuff && typeof s.cooldownReductionBuff === 'object'
                            ? s.cooldownReductionBuff
                            : null;
                        if (buffCfg) {
                            const maxStacks = (typeof buffCfg.maxStacks === 'number')
                                ? Math.max(0, Math.floor(buffCfg.maxStacks))
                                : null;
                            const cur = skillSystem.getCooldownReductionStacksForSkill(playerId, s.id);
                            const next = maxStacks === null ? (cur + cdrAmt) : Math.min(maxStacks, cur + cdrAmt);
                            skillSystem.setCooldownReductionStacksForSkill(playerId, s.id, next);
                        }
                    }
                }

                if (stackSkillId && effect.reset_stacks_on_use) {
                    skillSystem.setCooldownReductionStacksForSkill(playerId, stackSkillId, 0);
                }

                return { handled: true };
            }
        } catch (e) {}
    }, { id: 'skill_effects:chen:sync', order: 0 });
})();

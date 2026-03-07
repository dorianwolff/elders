(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function isKaito(caster) {
        return Boolean(caster && caster.id === 'kaito');
    }

    function getRestrictionCount(skillSystem, playerId) {
        try {
            if (window.KaitoCharacter && typeof window.KaitoCharacter.getActiveKaitoRestrictions === 'function') {
                return window.KaitoCharacter.getActiveKaitoRestrictions(skillSystem, playerId).size;
            }
        } catch (e) {}
        return 0;
    }

    function hasRestriction(skillSystem, playerId, key) {
        try {
            if (window.KaitoCharacter && typeof window.KaitoCharacter.getActiveKaitoRestrictions === 'function') {
                return window.KaitoCharacter.getActiveKaitoRestrictions(skillSystem, playerId).has(key);
            }
        } catch (e) {}
        return false;
    }

    function getCasterSkillByEffectType(caster, effectType) {
        try {
            const skills = Array.isArray(caster?.skills) ? caster.skills : [];
            for (const s of skills) {
                if (s && s.effect && s.effect.type === effectType) return s;
            }
        } catch (e) {}
        return null;
    }

    function applyMightPenaltyIfNeeded(skillSystem, playerId, caster, effectType, multiplier) {
        try {
            if (!hasRestriction(skillSystem, playerId, 'restriction_might')) return multiplier;
            const s = getCasterSkillByEffectType(caster, effectType);
            if (!s || s.type !== 'attack') return multiplier;
            return Math.max(0, (Number(multiplier) || 0) - 0.30);
        } catch (e) {}
        return multiplier;
    }

    function getAttackMultiplierWithRestrictions(base, perRestriction, restrictionCount) {
        const b = Number(base) || 0;
        const per = Number(perRestriction) || 0;
        const n = Math.max(0, Math.floor(Number(restrictionCount) || 0));
        return Math.max(0, b + (per * n));
    }

    function getScaledValue(effect, baseKey, perKey, restrictionCount, fallbackBase, fallbackPer) {
        const base = (effect && Object.prototype.hasOwnProperty.call(effect, baseKey)) ? Number(effect[baseKey]) : Number(fallbackBase);
        const per = (effect && Object.prototype.hasOwnProperty.call(effect, perKey)) ? Number(effect[perKey]) : Number(fallbackPer);
        return getAttackMultiplierWithRestrictions(base, per, restrictionCount);
    }

    async function applyDamagePct(skillSystem, caster, target, targetId, playerId, pct) {
        const intended = skillSystem.calculateDamage({ scaling: 'attack', value: Number(pct) || 0 }, caster, target);
        if (intended > 0) {
            return await skillSystem.applyDamage(target, intended, targetId, playerId);
        }
        return 0;
    }

    async function applyTrueDamagePct(skillSystem, caster, target, targetId, playerId, pct) {
        const atk = Math.max(0, Math.floor(Number(caster?.stats?.attack) || 0));
        const raw = Math.max(0, Math.floor(atk * (Number(pct) || 0)));
        if (raw > 0) {
            return await skillSystem.applyTrueDamage(target, raw, targetId, playerId);
        }
        return 0;
    }

    function removeAllShieldsAndStances(skillSystem, targetId) {
        try {
            const t = skillSystem.getPlayerById(targetId);
            if (t && t.stats) {
                t.stats.shield = 0;
                t.stats.maxShield = 0;
            }
        } catch (e) {}
        try {
            if (typeof skillSystem.removeStanceEffects === 'function') {
                skillSystem.removeStanceEffects(targetId);
            }
        } catch (e) {}
    }

    async function applyMinorCurse(skillSystem, target, playerId, ownerId, durationTurns) {
        const turns = Math.max(1, Math.floor(Number(durationTurns) || 1));
        const maxHp = Math.max(1, Math.floor(Number(target?.stats?.maxHealth) || 1));
        const dmg = Math.max(1, Math.floor(maxHp * 0.05));
        const id = `kaito_minor_curse_${playerId}_${Date.now()}`;
        skillSystem.activeEffects.set(id, {
            type: 'debuff',
            key: 'kaito_minor_curse',
            target: playerId,
            ownerId,
            characterId: target.id,
            damage: dmg,
            duration: turns,
            turnsLeft: turns,
            _dotDamage: true,
            _kaitoMinorCurse: true,
            name: 'Minor Curse',
            description: `Loses ${dmg} health at end of turn (bypasses defense) for ${turns} turns.`
        });
    }

    async function applyUltimateSeal(skillSystem, targetId, ownerId, durationTurns) {
        const turns = Math.max(1, Math.floor(Number(durationTurns) || 1));
        const id = `kaito_seal_ultimate_${targetId}_${Date.now()}`;
        skillSystem.activeEffects.set(id, {
            type: 'debuff',
            key: 'seal_ultimate',
            target: targetId,
            ownerId,
            duration: turns,
            turnsLeft: turns,
            name: 'Seal Ultimate',
            description: `Cannot use Ultimate for ${turns} turns.`
        });
    }

    async function applyDamageBasedShieldDamageBleed(skillSystem, caster, target, targetId, playerId, pct) {
        const beforeShield = Math.max(0, Math.floor(Number(target?.stats?.shield) || 0));
        const dealt = await applyDamagePct(skillSystem, caster, target, targetId, playerId, pct);
        const afterShield = Math.max(0, Math.floor(Number(target?.stats?.shield) || 0));
        const throughShield = Math.max(0, beforeShield - afterShield);

        if (throughShield > 0) {
            const id = `kaito_bleed_${targetId}_${Date.now()}`;
            skillSystem.activeEffects.set(id, {
                type: 'bleed',
                key: 'kaito_bleed',
                target: targetId,
                ownerId: playerId,
                characterId: target.id,
                damage: 0,
                duration: 99999,
                turnsLeft: 1,
                _kaitoStoredBleed: true,
                _kaitoBleedStoredDamage: throughShield,
                name: 'Bleed',
                description: `End of turn take ${throughShield} damage which bypasses defense.`
            });
        }

        return { dealt, throughShield };
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
            if (!isKaito(caster)) return;

            const enemyId = target === caster ? playerId : opponentPlayerId;
            const restrictionCount = getRestrictionCount(skillSystem, playerId);

            if (effect.type === 'kaito_crazy_slots') {
                const state = caster?.passiveState;
                if (!state) return { handled: true };

                if (state.kaitoWeaponKey) {
                    ctx.result.effects.push('Weapon already active');
                    return { handled: true };
                }

                const key = window.KaitoCharacter && typeof window.KaitoCharacter.rollWeaponKey === 'function'
                    ? window.KaitoCharacter.rollWeaponKey(skillSystem, gameState, playerId, caster)
                    : null;
                if (!key) return { handled: true };

                state.kaitoWeaponKey = key;
                state.kaitoWeaponUses = 0;
                if (!Array.isArray(state.kaitoWeaponHistory)) state.kaitoWeaponHistory = [];
                state.kaitoWeaponHistory.push(key);
                while (state.kaitoWeaponHistory.length > 3) state.kaitoWeaponHistory.shift();

                const ids = window.KaitoCharacter && typeof window.KaitoCharacter.getWeaponSkillIds === 'function'
                    ? window.KaitoCharacter.getWeaponSkillIds(key)
                    : null;
                if (ids && window.KaitoCharacter && typeof window.KaitoCharacter.swapSkillPalette === 'function') {
                    await window.KaitoCharacter.swapSkillPalette(skillSystem, playerId, caster, ids);
                }

                try {
                    if (window.KaitoCharacter && typeof window.KaitoCharacter.upsertWeaponIndicator === 'function') {
                        window.KaitoCharacter.upsertWeaponIndicator(skillSystem, playerId, key);
                    }
                } catch (e) {}
                
                const w = window.KaitoCharacter && typeof window.KaitoCharacter.getWeaponByKey === 'function'
                    ? window.KaitoCharacter.getWeaponByKey(key)
                    : null;
                ctx.result.effects.push(w ? w.name : 'Weapon');
                return { handled: true };
            }

            if (effect.type === 'kaito_price_of_power') {
                const state = caster?.passiveState;
                if (!state) return { handled: true };

                const keys = window.KaitoCharacter && typeof window.KaitoCharacter.getActiveKaitoRestrictions === 'function'
                    ? window.KaitoCharacter.getActiveKaitoRestrictions(skillSystem, playerId)
                    : new Set();

                const missing = (window.KaitoCharacter && Array.isArray(window.KaitoCharacter.RESTRICTIONS)
                    ? window.KaitoCharacter.RESTRICTIONS
                    : [])
                    .map(r => r && r.key)
                    .filter(Boolean)
                    .filter(k => !keys.has(k));

                const lastApplied = (state && typeof state.kaitoLastRestrictionKey === 'string') ? state.kaitoLastRestrictionKey : null;
                const missingNoRepeat = lastApplied ? missing.filter(k => k !== lastApplied) : missing;
                const pool = (missingNoRepeat.length > 0) ? missingNoRepeat : missing;

                if (pool.length === 0) {
                    ctx.result.effects.push('All restrictions');
                    return { handled: true };
                }

                let salt = null;
                try {
                    salt = gameState?.players?.get(playerId)?.sessionId || null;
                } catch (e) {}
                if (!salt) salt = playerId;

                const seed = `${gameState?.gameId || 'game'}:${gameState?.turnCount || 0}:${playerId}:${salt}:kaito:price_of_power`;
                const rand = skillSystem && typeof skillSystem.deterministicRandom === 'function'
                    ? skillSystem.deterministicRandom(seed)
                    : Math.random();
                const idx = Math.floor(rand * pool.length);
                const pickedKey = pool[Math.min(pool.length - 1, Math.max(0, idx))];

                const maxHp = Math.max(1, Math.floor(Number(caster?.stats?.maxHealth) || 1));
                const healBase = Number(effect.healMaxHpBase);
                const healPerAfterFirst = Number(effect.healMaxHpPerRestrictionAfterFirst);
                const baseHeal = Math.floor(maxHp * (Number.isFinite(healBase) ? healBase : 0.05));
                const extraHeal = Math.floor(maxHp * ((Number.isFinite(healPerAfterFirst) ? healPerAfterFirst : 0.02) * Math.max(0, restrictionCount - 1)));
                const healAmount = Math.max(1, baseHeal + extraHeal);

                await skillSystem.applyHealing(caster, healAmount, playerId);

                // Gain a shield: 5 + 2*x where x is the number of active restrictions.
                try {
                    const x = Math.max(0, Math.floor(Number(restrictionCount) || 0));
                    const shieldAmount = Math.max(0, Math.floor(5 + (2 * x)));
                    if (shieldAmount > 0 && typeof skillSystem.applyShield === 'function') {
                        await skillSystem.applyShield(caster, shieldAmount, playerId);
                        ctx.result.effects.push('Shield');
                    }
                } catch (e) {}

                if (window.KaitoCharacter && typeof window.KaitoCharacter.applyKaitoRestriction === 'function') {
                    await window.KaitoCharacter.applyKaitoRestriction(skillSystem, playerId, caster, pickedKey);
                }

                ctx.result.healing = (Number(ctx.result.healing) || 0) + healAmount;
                ctx.result.effects.push('Restriction');
                return { handled: true };
            }

            if (effect.type === 'kaito_scythe_minor_curse') {
                let pct = getScaledValue(effect, 'attackPctBase', 'attackPctPerRestriction', restrictionCount, 1.2, 0.2);
                pct = applyMightPenaltyIfNeeded(skillSystem, playerId, caster, effect.type, pct);
                const dealt = await applyDamagePct(skillSystem, caster, target, enemyId, playerId, pct);
                ctx.result.damage = (Number(ctx.result.damage) || 0) + dealt;
                const curseTurns = Number.isFinite(Number(effect.curseTurns)) ? Number(effect.curseTurns) : 3;
                // curseMaxHpPct currently used only for tooltip consistency; actual DoT dmg is computed in applyMinorCurse.
                await applyMinorCurse(skillSystem, target, enemyId, playerId, curseTurns);
                ctx.result.effects.push('Minor Curse');
                return { handled: true };
            }

            if (effect.type === 'kaito_scythe_purge') {
                removeAllShieldsAndStances(skillSystem, enemyId);
                let pct = getScaledValue(effect, 'attackPctBase', 'attackPctPerRestriction', restrictionCount, 1.3, 0.2);
                pct = applyMightPenaltyIfNeeded(skillSystem, playerId, caster, effect.type, pct);
                const dealt = await applyDamagePct(skillSystem, caster, target, enemyId, playerId, pct);
                ctx.result.damage = (Number(ctx.result.damage) || 0) + dealt;
                ctx.result.effects.push('Purged');
                return { handled: true };
            }

            if (effect.type === 'kaito_baton_snap_strike') {
                const pct = getScaledValue(effect, 'trueAttackPctBase', 'trueAttackPctPerRestriction', restrictionCount, 0.5, 0.05);
                const dealt = await applyTrueDamagePct(skillSystem, caster, target, enemyId, playerId, pct);
                ctx.result.damage = (Number(ctx.result.damage) || 0) + dealt;
                return { handled: true };
            }

            if (effect.type === 'kaito_baton_reversal_stance') {
                const turnsLeft = Number.isFinite(Number(effect.reversalTurns)) ? Math.max(1, Math.floor(Number(effect.reversalTurns))) : 1;
                const id = `stance_${playerId}_${Date.now()}`;
                const pct = getScaledValue(effect, 'reversalTrueAttackPctBase', 'reversalTrueAttackPctPerRestriction', restrictionCount, 0.6, 0.1);
                const ratioHeal = Number.isFinite(Number(effect.reversalHealRatio)) ? Number(effect.reversalHealRatio) : 1;
                skillSystem.activeEffects.set(id, {
                    type: 'stance',
                    key: 'kaito_baton_reversal',
                    stanceKey: 'kaito_baton_reversal',
                    target: playerId,
                    duration: turnsLeft,
                    turnsLeft,
                    name: 'Reversal Stance',
                    description: 'Recover 100% of damage taken from attack and debuff skills and counter for true damage.' ,
                    kaitoReversal: {
                        ratioHeal,
                        trueDamageAttackPct: pct
                    }
                });
                return { handled: true };
            }

            if (effect.type === 'kaito_rifle_headshot') {
                const basePct = getScaledValue(effect, 'maxHpPctBase', 'maxHpPctPerRestriction', restrictionCount, 0.10, 0.01);
                const executePct = getScaledValue(effect, 'executeTrueMaxHpPctBase', 'executeTrueMaxHpPctPerRestriction', restrictionCount, 0.10, 0.01);

                const maxHp = Math.max(1, Math.floor(Number(target?.stats?.maxHealth) || 1));
                const hp = Math.max(0, Math.floor(Number(target?.stats?.health) || 0));
                const thresholdPct = Number.isFinite(Number(effect.executeThresholdMaxHpPct)) ? Number(effect.executeThresholdMaxHpPct) : 0.10;
                const threshold = Math.floor(maxHp * thresholdPct);
                const dmgBase = Math.max(1, Math.floor(maxHp * basePct));

                if (hp > 0 && hp <= threshold) {
                    const dmg = Math.max(1, Math.floor(maxHp * executePct));
                    const dealt = await skillSystem.applyTrueDamage(target, dmg, enemyId, playerId);
                    ctx.result.damage = (Number(ctx.result.damage) || 0) + dealt;
                } else {
                    const dealt = await skillSystem.applyDamage(target, dmgBase, enemyId, playerId);
                    ctx.result.damage = (Number(ctx.result.damage) || 0) + dealt;
                }
                return { handled: true };
            }

            if (effect.type === 'kaito_rifle_multistrike') {
                let pct = getScaledValue(effect, 'attackPctBase', 'attackPctPerRestriction', restrictionCount, 0.75, 0.08);
                pct = applyMightPenaltyIfNeeded(skillSystem, playerId, caster, effect.type, pct);
                const hits = Number.isFinite(Number(effect.hits)) ? Math.max(1, Math.floor(Number(effect.hits))) : 4;
                let total = 0;
                for (let i = 0; i < hits; i++) {
                    total += await applyDamagePct(skillSystem, caster, target, enemyId, playerId, pct);
                }
                ctx.result.damage = (Number(ctx.result.damage) || 0) + total;
                return { handled: true };
            }

            if (effect.type === 'kaito_staff_first_aid') {
                const pct = getScaledValue(effect, 'healMissingHpBase', 'healMissingHpPerRestriction', restrictionCount, 0.5, 0.04);
                // Remove 1 random debuff from self (not restrictions).
                try {
                    const list = [];
                    for (const [id, eff] of skillSystem.activeEffects.entries()) {
                        if (!eff) continue;
                        if (eff.target !== playerId) continue;
                        if (eff.type !== 'debuff' && eff.type !== 'poison' && eff.type !== 'curse' && eff.type !== 'stun' && eff.type !== 'bleed' && eff.type !== 'mark') continue;
                        list.push(id);
                    }
                    if (list.length > 0) {
                        const seed = `${gameState?.gameId || 'game'}:${gameState?.turnCount || 0}:${playerId}:kaito:first_aid_cleanse`;
                        const rand = skillSystem && typeof skillSystem.deterministicRandom === 'function'
                            ? skillSystem.deterministicRandom(seed)
                            : Math.random();
                        const idx = Math.floor(rand * list.length);
                        const picked = list[Math.min(list.length - 1, Math.max(0, idx))];
                        skillSystem.activeEffects.delete(picked);
                        skillSystem.recalculateStats(playerId);
                    }
                } catch (e) {}

                const maxHp = Math.max(1, Math.floor(Number(caster?.stats?.maxHealth) || 1));
                const cur = Math.max(0, Math.floor(Number(caster?.stats?.health) || 0));
                const missing = Math.max(0, maxHp - cur);
                const heal = Math.max(1, Math.floor(missing * pct));
                await skillSystem.applyHealing(caster, heal, playerId);
                ctx.result.healing = (Number(ctx.result.healing) || 0) + heal;
                return { handled: true };
            }

            if (effect.type === 'kaito_staff_recovery_zone') {
                const pct = getScaledValue(effect, 'healMaxHpBase', 'healMaxHpPerRestriction', restrictionCount, 0.2, 0.06);
                const turnsLeft = 1;
                const heal = Math.max(1, Math.floor((Number(caster?.stats?.maxHealth) || 0) * pct));
                const id = `kaito_recovery_zone_array_${playerId}_${Date.now()}`;
                skillSystem.activeEffects.set(id, {
                    type: 'kaito_recovery_zone_array',
                    target: 'global',
                    ownerId: playerId,
                    duration: turnsLeft,
                    turnsLeft,
                    name: 'Recovery Zone',
                    description: `Recover ${heal} health at the end of your opponent's turn.`,
                    healOnOpponentTurnEnd: heal
                });
                return { handled: true };
            }

            if (effect.type === 'kaito_trident_ult_seal') {
                const pct = getScaledValue(effect, 'attackPctBase', 'attackPctPerRestriction', restrictionCount, 0.9, 0.2);
                const dealt = await applyDamagePct(skillSystem, caster, target, enemyId, playerId, pct);
                ctx.result.damage = (Number(ctx.result.damage) || 0) + dealt;
                const sealTurns = Number.isFinite(Number(effect.sealTurns)) ? Math.max(1, Math.floor(Number(effect.sealTurns))) : 2;
                await applyUltimateSeal(skillSystem, enemyId, playerId, sealTurns);
                ctx.result.effects.push('Seal Ultimate');
                return { handled: true };
            }

            if (effect.type === 'kaito_trident_triple_thrust') {
                let pct = getScaledValue(effect, 'attackPctBase', 'attackPctPerRestriction', restrictionCount, 0.86, 0.07);
                pct = applyMightPenaltyIfNeeded(skillSystem, playerId, caster, effect.type, pct);
                const hits = Number.isFinite(Number(effect.hits)) ? Math.max(1, Math.floor(Number(effect.hits))) : 3;
                let total = 0;
                for (let i = 0; i < hits; i++) {
                    total += await applyDamagePct(skillSystem, caster, target, enemyId, playerId, pct);
                }
                ctx.result.damage = (Number(ctx.result.damage) || 0) + total;
                return { handled: true };
            }

            if (effect.type === 'kaito_rapier_time_cut') {
                let pct = getScaledValue(effect, 'attackPctBase', 'attackPctPerRestriction', restrictionCount, 1.0, 0.2);
                pct = applyMightPenaltyIfNeeded(skillSystem, playerId, caster, effect.type, pct);
                const dealt = await applyDamagePct(skillSystem, caster, target, enemyId, playerId, pct);
                ctx.result.damage = (Number(ctx.result.damage) || 0) + dealt;

                // Reduce cooldown of all skills by 1 (including ultimate cooldown tracking).
                try {
                    const skills = Array.isArray(caster.skills) ? caster.skills : [];
                    for (const s of skills) {
                        if (!s || !s.id) continue;
                        const cur = skillSystem.getSkillCooldown({ id: s.id }, playerId);
                        const next = Math.max(0, Math.floor(Number(cur) || 0) - 1);
                        skillSystem.setSkillCooldown(s.id, playerId, next);
                    }
                    if (caster.ultimate && caster.ultimate.id) {
                        const cur = skillSystem.getSkillCooldown({ id: caster.ultimate.id }, playerId);
                        const next = Math.max(0, Math.floor(Number(cur) || 0) - 1);
                        skillSystem.setSkillCooldown(caster.ultimate.id, playerId, next);
                    }

                    // If ultimate readiness depends on passive counters/mission, re-evaluate now.
                    if (skillSystem.passiveSystem && typeof skillSystem.passiveSystem.updateUltimateReady === 'function') {
                        skillSystem.passiveSystem.updateUltimateReady(playerId);
                    }
                } catch (e) {}

                ctx.result.effects.push('Cooldown -1');
                return { handled: true };
            }

            if (effect.type === 'kaito_rapier_evasive_lunge') {
                let pct = getScaledValue(effect, 'attackPctBase', 'attackPctPerRestriction', restrictionCount, 0.7, 0.2);
                pct = applyMightPenaltyIfNeeded(skillSystem, playerId, caster, effect.type, pct);
                const dealt = await applyDamagePct(skillSystem, caster, target, enemyId, playerId, pct);
                ctx.result.damage = (Number(ctx.result.damage) || 0) + dealt;
                const evadeTurns = Number.isFinite(Number(effect.evadeTurns)) ? Math.max(1, Math.floor(Number(effect.evadeTurns))) : 1;
                await skillSystem.applyBuff(caster, { stat: 'evade', value: 1, duration: evadeTurns }, playerId);
                ctx.result.effects.push('Evade');
                return { handled: true };
            }

            if (effect.type === 'kaito_shield_bulwark_strike') {
                const pct = getScaledValue(effect, 'defensePctBase', 'defensePctPerRestriction', restrictionCount, 1.0, 0.3);
                const def = Math.max(0, Math.floor(Number(caster?.stats?.defense) || 0));
                const dmg = Math.max(0, Math.floor(def * pct));
                if (dmg > 0) {
                    const dealt = await skillSystem.applyDamage(target, dmg, enemyId, playerId);
                    ctx.result.damage = (Number(ctx.result.damage) || 0) + dealt;
                }
                const drBase = Number.isFinite(Number(effect.drBase)) ? Number(effect.drBase) : 50;
                const drPer = Number.isFinite(Number(effect.drPerRestriction)) ? Number(effect.drPerRestriction) : 5;
                const drMax = Number.isFinite(Number(effect.drMax)) ? Number(effect.drMax) : 95;
                const drTurns = Number.isFinite(Number(effect.drTurns)) ? Math.max(1, Math.floor(Number(effect.drTurns))) : 1;
                const drPct = Math.max(0, Math.min(drMax, drBase + (drPer * restrictionCount)));
                skillSystem.activeEffects.set(`kaito_shield_dr_${playerId}_${Date.now()}`, {
                    type: 'buff',
                    key: 'kaito_shield_dr',
                    target: playerId,
                    ownerId: playerId,
                    duration: drTurns,
                    turnsLeft: drTurns,
                    stat: 'damageReduction',
                    value: drPct,
                    mode: 'flat',
                    name: 'Bulwark',
                    description: `Reduce damage taken by ${drPct}% for ${drTurns} turn.`
                });
                skillSystem.recalculateStats(playerId);
                return { handled: true };
            }

            if (effect.type === 'kaito_shield_fortify') {
                const def = Math.max(0, Math.floor(Number(caster?.stats?.defense) || 0));
                const base = Number.isFinite(Number(effect.shieldDefenseMultBase)) ? Number(effect.shieldDefenseMultBase) : 1;
                const per = Number.isFinite(Number(effect.shieldDefenseMultPerRestriction)) ? Number(effect.shieldDefenseMultPerRestriction) : 0.2;
                const amount = Math.max(0, Math.floor(def * (base + (per * restrictionCount))));
                if (amount > 0) {
                    await skillSystem.applyShield(caster, amount, playerId);
                }
                return { handled: true };
            }

            if (effect.type === 'kaito_axe_gash_bleed') {
                const pct = getScaledValue(effect, 'attackPctBase', 'attackPctPerRestriction', restrictionCount, 0.85, 0.09);
                const dealt = await applyDamagePct(skillSystem, caster, target, enemyId, playerId, pct);
                ctx.result.damage = (Number(ctx.result.damage) || 0) + dealt;

                // Bleed should only apply if damage hit the healthbar (post-shield damage > 0).
                if (dealt > 0) {
                    const id = `bleed_${enemyId}_${Date.now()}`;
                    const ratio = Number.isFinite(Number(effect.bleedTickRatio)) ? Number(effect.bleedTickRatio) : 0.30;
                    const tick = Math.max(1, Math.floor(dealt * ratio));
                    const turns = Number.isFinite(Number(effect.bleedTurns))
                        ? Math.max(1, Math.floor(Number(effect.bleedTurns)))
                        : 3;
                    skillSystem.activeEffects.set(id, {
                        type: 'bleed',
                        target: enemyId,
                        ownerId: playerId,
                        characterId: target.id,
                        damage: tick,
                        duration: turns,
                        turnsLeft: turns,
                        name: 'Bleed',
                        description: `Takes ${tick} true damage per turn for ${turns} turns.`
                    });
                    ctx.result.effects.push('Bleed');
                }
                return { handled: true };
            }

            if (effect.type === 'kaito_axe_double_cleave') {
                let pct = getScaledValue(effect, 'attackPctBase', 'attackPctPerRestriction', restrictionCount, 0.85, 0.25);
                pct = applyMightPenaltyIfNeeded(skillSystem, playerId, caster, effect.type, pct);
                const hits = Number.isFinite(Number(effect.hits)) ? Math.max(1, Math.floor(Number(effect.hits))) : 2;
                let total = 0;
                for (let i = 0; i < hits; i++) {
                    total += await applyDamagePct(skillSystem, caster, target, enemyId, playerId, pct);
                }
                ctx.result.damage = (Number(ctx.result.damage) || 0) + total;
                return { handled: true };
            }

            if (effect.type === 'kaito_tome_paragon_cast') {
                const state = caster?.passiveState;
                if (!state) return { handled: true };

                // Cast 2 random weapon skills (excluding tome skills), ignoring restriction gating.
                const pool = (window.KaitoCharacter?.WEAPONS || [])
                    .filter(w => w && !w.secret && w.key !== 'tome_of_paragons')
                    .map(w => window.KaitoCharacter.getWeaponSkillIds(w.key))
                    .flat()
                    .filter(Boolean);

                const seed = `${gameState?.gameId || 'game'}:${gameState?.turnCount || 0}:${playerId}:kaito:tome_cast2`;
                const rand = skillSystem && typeof skillSystem.deterministicRandom === 'function'
                    ? skillSystem.deterministicRandom(seed)
                    : Math.random();

                const idxA = pool.length > 0 ? Math.floor(rand * pool.length) : 0;
                let idxB = pool.length > 0 ? Math.floor(((rand * 9301 + 49297) % 233280) / 233280 * pool.length) : 0;
                if (pool.length > 1 && idxB === idxA) idxB = (idxB + 1) % pool.length;

                const idA = pool[Math.min(pool.length - 1, Math.max(0, idxA))];
                const idB = pool[Math.min(pool.length - 1, Math.max(0, idxB))];

                const cs = gameState?.characterSystem || skillSystem?.characterSystem;
                if (!cs || typeof cs.getSkill !== 'function') return { handled: true };

                const sA = idA ? await cs.getSkill(idA) : null;
                const sB = idB ? await cs.getSkill(idB) : null;

                if (sA && sA.effect) {
                    await skillSystem.applySkillEffect(sA.effect, caster, target, gameState, playerId, { ignoreKaitoRestrictions: true });
                }
                if (sB && sB.effect) {
                    await skillSystem.applySkillEffect(sB.effect, caster, target, gameState, playerId, { ignoreKaitoRestrictions: true });
                }

                ctx.result.effects.push('Paragon');
                return { handled: true };
            }

            if (effect.type === 'kaito_tome_random_spell') {
                const copied = caster?.passiveState?.kaitoTomeSkillB;
                if (!copied || !copied.effect) {
                    return { handled: true };
                }

                await skillSystem.applySkillEffect(copied.effect, caster, target, gameState, playerId, { ignoreKaitoRestrictions: true });
                ctx.result.effects.push('Copied');
                return { handled: true };
            }

            if (effect.type === 'kaito_ultimate') {
                const pct = getScaledValue(effect, 'attackPctBase', 'attackPctPerRestriction', restrictionCount, 1.4, 0.4);
                const dealt = await applyDamagePct(skillSystem, caster, target, enemyId, playerId, pct);
                ctx.result.damage = (Number(ctx.result.damage) || 0) + dealt;

                // Use current slot 1 skill as a bonus effect, ignoring restriction effects.
                const s1 = Array.isArray(caster.skills) ? caster.skills[0] : null;
                if (s1 && s1.effect) {
                    await skillSystem.applySkillEffect(s1.effect, caster, target, gameState, playerId, { ignoreKaitoRestrictions: true, _fromKaitoUltimate: true });
                }
                return { handled: true };
            }
        } catch (e) {}
    }, { id: 'skill_effects:kaito', order: 0 });

    // Sync: only mirror non-damage state changes.
    window.BattleHooks.register('skill_system:sync_skill_effects', async (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const effect = ctx && ctx.effect;
            const caster = ctx && ctx.caster;
            const gameState = ctx && ctx.gameState;
            const playerId = ctx && ctx.playerId;

            if (!skillSystem || !effect || !effect.type) return;
            if (!isKaito(caster)) return;

            if (effect.type === 'kaito_crazy_slots') {
                // Weapon roll and palette swap must be deterministic; perform locally.
                const state = caster?.passiveState;
                if (!state) return { handled: true };
                if (state.kaitoWeaponKey) return { handled: true };

                const key = window.KaitoCharacter && typeof window.KaitoCharacter.rollWeaponKey === 'function'
                    ? window.KaitoCharacter.rollWeaponKey(skillSystem, gameState, playerId, caster)
                    : null;
                if (!key) return { handled: true };

                state.kaitoWeaponKey = key;
                state.kaitoWeaponUses = 0;
                if (!Array.isArray(state.kaitoWeaponHistory)) state.kaitoWeaponHistory = [];
                state.kaitoWeaponHistory.push(key);
                while (state.kaitoWeaponHistory.length > 3) state.kaitoWeaponHistory.shift();

                const ids = window.KaitoCharacter && typeof window.KaitoCharacter.getWeaponSkillIds === 'function'
                    ? window.KaitoCharacter.getWeaponSkillIds(key)
                    : null;
                if (ids && window.KaitoCharacter && typeof window.KaitoCharacter.swapSkillPalette === 'function') {
                    await window.KaitoCharacter.swapSkillPalette(skillSystem, playerId, caster, ids);
                }
                return { handled: true };
            }

            if (effect.type === 'kaito_price_of_power') {
                // Apply only restriction addition; healing/damage is authoritative.
                const state = caster?.passiveState;
                if (!state) return { handled: true };

                const keys = window.KaitoCharacter && typeof window.KaitoCharacter.getActiveKaitoRestrictions === 'function'
                    ? window.KaitoCharacter.getActiveKaitoRestrictions(skillSystem, playerId)
                    : new Set();

                const missing = (window.KaitoCharacter?.RESTRICTIONS || [])
                    .map(r => r && r.key)
                    .filter(Boolean)
                    .filter(k => !keys.has(k));

                if (missing.length === 0) return { handled: true };

                let salt = null;
                try {
                    salt = gameState?.players?.get(playerId)?.sessionId || null;
                } catch (e) {}
                if (!salt) salt = playerId;

                const seed = `${gameState?.gameId || 'game'}:${gameState?.turnCount || 0}:${playerId}:${salt}:kaito:price_of_power`;
                const rand = skillSystem && typeof skillSystem.deterministicRandom === 'function'
                    ? skillSystem.deterministicRandom(seed)
                    : Math.random();
                const idx = Math.floor(rand * missing.length);
                const pickedKey = missing[Math.min(missing.length - 1, Math.max(0, idx))];

                if (window.KaitoCharacter && typeof window.KaitoCharacter.applyKaitoRestriction === 'function') {
                    await window.KaitoCharacter.applyKaitoRestriction(skillSystem, playerId, caster, pickedKey);
                }
                return { handled: true };
            }

            if (effect.type === 'kaito_trident_ult_seal') {
                const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                const targetId = caster === ctx.target ? playerId : opponentId;
                const enemyId = targetId === playerId ? opponentId : playerId;
                await applyUltimateSeal(skillSystem, enemyId, playerId, 2);
                return { handled: true };
            }

            if (effect.type === 'kaito_rapier_evasive_lunge') {
                await skillSystem.applyBuff(caster, { stat: 'evade', value: 1, duration: 1 }, playerId);
                return { handled: true };
            }

            if (effect.type === 'kaito_shield_bulwark_strike') {
                const restrictionCount = getRestrictionCount(skillSystem, playerId);
                const drPct = Math.max(0, Math.min(95, 50 + (5 * restrictionCount)));
                skillSystem.activeEffects.set(`kaito_shield_dr_${playerId}_${Date.now()}`, {
                    type: 'buff',
                    key: 'kaito_shield_dr',
                    target: playerId,
                    ownerId: playerId,
                    duration: 1,
                    turnsLeft: 1,
                    stat: 'damageReduction',
                    value: drPct,
                    mode: 'flat',
                    name: 'Bulwark',
                    description: `Reduce damage taken by ${drPct}% for 1 turn.`
                });
                skillSystem.recalculateStats(playerId);
                return { handled: true };
            }

            if (effect.type === 'kaito_baton_reversal_stance') {
                const restrictionCount = getRestrictionCount(skillSystem, playerId);
                const pct = getAttackMultiplierWithRestrictions(0.6, 0.1, restrictionCount);
                const turnsLeft = 1;
                const id = `stance_${playerId}_${Date.now()}`;
                skillSystem.activeEffects.set(id, {
                    type: 'stance',
                    key: 'kaito_baton_reversal',
                    stanceKey: 'kaito_baton_reversal',
                    target: playerId,
                    duration: turnsLeft,
                    turnsLeft,
                    name: 'Reversal Stance',
                    description: 'Recover 100% of damage taken from attack and debuff skills and counter for true damage.' ,
                    kaitoReversal: {
                        ratioHeal: 1,
                        trueDamageAttackPct: pct
                    }
                });
                return { handled: true };
            }

            if (effect.type === 'kaito_staff_recovery_zone') {
                const restrictionCount = getRestrictionCount(skillSystem, playerId);
                const pct = getAttackMultiplierWithRestrictions(0.2, 0.06, restrictionCount);
                const turnsLeft = 1;
                const heal = Math.max(1, Math.floor((Number(caster?.stats?.maxHealth) || 0) * pct));
                const id = `stance_${playerId}_${Date.now()}`;
                skillSystem.activeEffects.set(id, {
                    type: 'stance',
                    key: 'kaito_recovery_zone',
                    stanceKey: 'kaito_recovery_zone',
                    target: playerId,
                    duration: turnsLeft,
                    turnsLeft,
                    name: 'Recovery Zone',
                    description: `Recover ${heal} health at the start of your turn.`,
                    healOnTurnStart: heal
                });
                skillSystem.recalculateStats(playerId);
                return { handled: true };
            }
        } catch (e) {}
    }, { id: 'skill_effects:kaito:sync', order: 0 });
})();

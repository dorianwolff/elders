(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

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

    function pct(n) {
        return `${Math.round((Number(n) || 0) * 100)}%`;
    }

    function scaled(effect, baseKey, perKey, r, fallbackBase, fallbackPer) {
        const base = (effect && Object.prototype.hasOwnProperty.call(effect, baseKey)) ? Number(effect[baseKey]) : Number(fallbackBase);
        const per = (effect && Object.prototype.hasOwnProperty.call(effect, perKey)) ? Number(effect[perKey]) : Number(fallbackPer);
        return (Number(base) || 0) + ((Number(per) || 0) * (Number(r) || 0));
    }

    window.BattleHooks.register('ui:skills:description', (ctx) => {
        try {
            const characterId = ctx && ctx.characterId;
            const skill = ctx && ctx.skill;
            const passiveState = ctx && ctx.passiveState;
            const gameState = ctx && ctx.gameState;
            const skillSystem = ctx && ctx.skillSystem;
            if (characterId !== 'kaito' || !skill || !skill.id) return;

            const playerId = gameState?.playerId;
            const r = getRestrictionCount(skillSystem, playerId);

            const restrictionMight = hasRestriction(skillSystem, playerId, 'restriction_might');
            const restrictionLife = hasRestriction(skillSystem, playerId, 'restriction_life');

            const atkScale = (baseKey, perKey, fallbackBase, fallbackPer) => {
                let v = scaled(skill.effect, baseKey, perKey, r, fallbackBase, fallbackPer);
                if (restrictionMight && skill.type === 'attack') {
                    v = Math.max(0, v - 0.30);
                }
                return pct(v);
            };

            if (skill.id === 'kaito_crazy_slots') {
                return 'Get one of 9 weapons. Your skills are replaced by the weapon skills. Weapon 9 can only appear at 20% health or less.';
            }

            if (skill.id === 'kaito_price_of_power') {
                const healBase = scaled(skill.effect, 'healMaxHpBase', null, r, 0.05, 0);
                const healPer = scaled(skill.effect, 'healMaxHpPerRestrictionAfterFirst', null, r, 0.02, 0);
                const base = Math.round(healBase * 100);
                const per = Math.round(healPer * 100);
                const shieldAmount = Math.max(0, Math.floor(5 + (2 * r)));
                return `Recover ${base}% of max health (+${per}% per restriction after the first), gain ${shieldAmount} shield and obtain one new restriction.`;
            }

            if (skill.id === 'kaito_scythe_minor_curse') {
                const turns = Number.isFinite(Number(skill.effect?.curseTurns)) ? Number(skill.effect.curseTurns) : 3;
                return `Inflict Minor Curse for ${turns} turns and deal ${atkScale('attackPctBase', 'attackPctPerRestriction', 1.2, 0.2)} of attack as damage.`;
            }
            if (skill.id === 'kaito_scythe_purge') {
                return `Remove shields and stances and deal ${atkScale('attackPctBase', 'attackPctPerRestriction', 1.3, 0.2)} of attack as damage.`;
            }

            if (skill.id === 'kaito_baton_snap_strike') {
                return `Deal ${atkScale('trueAttackPctBase', 'trueAttackPctPerRestriction', 0.5, 0.05)} of attack as true damage.`;
            }
            if (skill.id === 'kaito_baton_reversal_stance') {
                return `For 1 turn, recover 100% of damage taken from attack and debuff skills and deal ${atkScale('reversalTrueAttackPctBase', 'reversalTrueAttackPctPerRestriction', 0.6, 0.1)} of attack as true damage when opponent uses an attack or debuff skill.`;
            }

            if (skill.id === 'kaito_rifle_headshot') {
                const base = scaled(skill.effect, 'maxHpPctBase', 'maxHpPctPerRestriction', r, 0.10, 0.01);
                const exec = scaled(skill.effect, 'executeTrueMaxHpPctBase', 'executeTrueMaxHpPctPerRestriction', r, 0.10, 0.01);
                return `Deal ${pct(base)} of opponent max health as damage. If opponent has 10% or less health, deal ${pct(exec)} as true damage instead.`;
            }
            if (skill.id === 'kaito_rifle_multistrike') {
                const hits = Number.isFinite(Number(skill.effect?.hits)) ? Math.max(1, Math.floor(Number(skill.effect.hits))) : 4;
                return `Deal ${atkScale('attackPctBase', 'attackPctPerRestriction', 0.75, 0.08)} of attack as damage ${hits} times.`;
            }

            if (skill.id === 'kaito_staff_first_aid') {
                let v = scaled(skill.effect, 'healMissingHpBase', 'healMissingHpPerRestriction', r, 0.5, 0.04);
                return `Remove 1 random debuff and recover ${pct(v)} of missing health.`;
            }
            if (skill.id === 'kaito_staff_recovery_zone') {
                let v = scaled(skill.effect, 'healMaxHpBase', 'healMaxHpPerRestriction', r, 0.2, 0.06);
                return `For 1 turn, recover ${pct(v)} of maximum health at the end of your opponent's turn.`;
            }

            if (skill.id === 'kaito_trident_ult_seal') {
                const turns = Number.isFinite(Number(skill.effect?.sealTurns)) ? Number(skill.effect.sealTurns) : 2;
                return `Deal ${atkScale('attackPctBase', 'attackPctPerRestriction', 0.9, 0.2)} of attack as damage and seal enemy Ultimate for ${turns} turns.`;
            }
            if (skill.id === 'kaito_trident_triple_thrust') {
                const hits = Number.isFinite(Number(skill.effect?.hits)) ? Math.max(1, Math.floor(Number(skill.effect.hits))) : 3;
                return `Deal ${atkScale('attackPctBase', 'attackPctPerRestriction', 0.86, 0.07)} of attack as damage ${hits} times.`;
            }

            if (skill.id === 'kaito_rapier_time_cut') {
                return `Deal ${atkScale('attackPctBase', 'attackPctPerRestriction', 1.0, 0.2)} of attack as damage and reduce all skill cooldowns by 1.`;
            }
            if (skill.id === 'kaito_rapier_evasive_lunge') {
                const turns = Number.isFinite(Number(skill.effect?.evadeTurns)) ? Number(skill.effect.evadeTurns) : 1;
                return `Deal ${atkScale('attackPctBase', 'attackPctPerRestriction', 0.7, 0.2)} of attack as damage and gain Evade for ${turns} turn.`;
            }

            if (skill.id === 'kaito_shield_bulwark_strike') {
                const dmgPct = scaled(skill.effect, 'defensePctBase', 'defensePctPerRestriction', r, 1.0, 0.3);
                const drBase = Number.isFinite(Number(skill.effect?.drBase)) ? Number(skill.effect.drBase) : 50;
                const drPer = Number.isFinite(Number(skill.effect?.drPerRestriction)) ? Number(skill.effect.drPerRestriction) : 5;
                const drMax = Number.isFinite(Number(skill.effect?.drMax)) ? Number(skill.effect.drMax) : 95;
                const dr = Math.min(drMax, drBase + (drPer * r));
                return `Deal ${pct(dmgPct)} of defense as damage and reduce damage taken by ${dr}% for 1 turn.`;
            }
            if (skill.id === 'kaito_shield_fortify') {
                const def = Math.max(0, Math.floor(Number(ctx?.character?.stats?.defense) || 0));
                const base = Number.isFinite(Number(skill.effect?.shieldDefenseMultBase)) ? Number(skill.effect.shieldDefenseMultBase) : 1;
                const per = Number.isFinite(Number(skill.effect?.shieldDefenseMultPerRestriction)) ? Number(skill.effect.shieldDefenseMultPerRestriction) : 0.2;
                const amount = Math.max(0, Math.floor(def * (base + (per * r))));
                return `Gain a shield equal to defense and according to restrictions (${amount}).`;
            }

            if (skill.id === 'kaito_axe_gash_bleed') {
                const turns = Number.isFinite(Number(skill.effect?.bleedTurns)) ? Math.max(1, Math.floor(Number(skill.effect.bleedTurns))) : 3;
                return `Deal ${atkScale('attackPctBase', 'attackPctPerRestriction', 0.85, 0.09)} of attack as damage and inflict Bleed for ${turns} turns.`;
            }
            if (skill.id === 'kaito_axe_double_cleave') {
                const hits = Number.isFinite(Number(skill.effect?.hits)) ? Math.max(1, Math.floor(Number(skill.effect.hits))) : 2;
                return `Deal ${atkScale('attackPctBase', 'attackPctPerRestriction', 0.85, 0.25)} of attack as damage, ${hits} times.`;
            }

            if (skill.id === 'kaito_tome_paragon_cast') {
                return 'Cast 2 random weapon skills ignoring restrictions.';
            }
            if (skill.id === 'kaito_tome_random_spell') {
                const name = skill._copiedName || passiveState?.kaitoTomeSkillB?.name;
                return name
                    ? `This skill becomes ${name}. Changes after each turn.`
                    : 'This skill becomes a random weapon skill. Changes after each turn.';
            }
        } catch (e) {}
    }, { id: 'ui:skills:kaito_descriptions', order: 0 });

    window.BattleHooks.register('ui:skills:disabled', (ctx) => {
        try {
            const characterId = ctx && ctx.characterId;
            const skill = ctx && ctx.skill;
            const gameState = ctx && ctx.gameState;
            const skillSystem = ctx && ctx.skillSystem;
            const passiveState = ctx && ctx.passiveState;
            const canUse = Boolean(ctx && ctx.canUse);
            if (characterId !== 'kaito' || !skill || !skill.id) return;

            const playerId = gameState?.playerId;
            const opponentId = playerId === 'player1' ? 'player2' : 'player1';

            const restrictionPower = hasRestriction(skillSystem, playerId, 'restriction_power');
            const restrictionTactics = hasRestriction(skillSystem, playerId, 'restriction_tactics');
            const restrictionMight = hasRestriction(skillSystem, playerId, 'restriction_might');
            const restrictionLife = hasRestriction(skillSystem, playerId, 'restriction_life');

            // Crazy Slots cannot be used while a weapon is active.
            if (skill.id === 'kaito_crazy_slots') {
                const hasWeapon = Boolean(passiveState && passiveState.kaitoWeaponKey);
                return !canUse || hasWeapon;
            }

            // Price of Power cannot be used if all restrictions are active.
            if (skill.id === 'kaito_price_of_power') {
                const r = getRestrictionCount(skillSystem, playerId);
                return !canUse || r >= 5;
            }

            if (restrictionPower || restrictionTactics || restrictionMight || restrictionLife) {
                // New rules do not disable skills; they modify effects only.
            }

            return !canUse;
        } catch (e) {}
    }, { id: 'ui:skills:kaito_disabled', order: 0 });

    window.BattleHooks.register('ui:ultimate:disabled', (ctx) => {
        try {
            const characterId = ctx && ctx.characterId;
            const gameState = ctx && ctx.gameState;
            const skillSystem = ctx && ctx.skillSystem;
            const character = ctx && ctx.character;
            const canUse = Boolean(ctx && ctx.canUse);
            if (characterId !== 'kaito') return;

            const playerId = gameState?.playerId;
            const maxHp = Math.max(1, Math.floor(Number(character?.stats?.maxHealth) || 1));
            const hp = Math.max(0, Math.floor(Number(character?.stats?.health) || 0));
            const hpPct = maxHp > 0 ? (hp / maxHp) : 0;

            const restrictionPower = hasRestriction(skillSystem, playerId, 'restriction_power');
            if (restrictionPower && hpPct < 0.5) {
                return true;
            }

            // Seal Ultimate debuff
            for (const [, eff] of skillSystem.activeEffects.entries()) {
                if (!eff) continue;
                if (eff.target !== playerId) continue;
                if (eff.type !== 'debuff') continue;
                if (eff.key !== 'seal_ultimate') continue;
                if ((Number(eff.turnsLeft) || 0) > 0) {
                    return true;
                }
            }

            return !canUse;
        } catch (e) {}
    }, { id: 'ui:ultimate:kaito_disabled', order: 0 });

    window.BattleHooks.register('ui:ultimate:description', (ctx) => {
        try {
            const characterId = ctx && ctx.characterId;
            const ultimate = ctx && ctx.ultimate;
            const gameState = ctx && ctx.gameState;
            const skillSystem = ctx && ctx.skillSystem;
            if (characterId !== 'kaito') return;
            if (!ultimate || ultimate.id !== 'kaito_ultimate') return;

            const playerId = gameState?.playerId;
            const r = getRestrictionCount(skillSystem, playerId);
            const pctBase = 1.25;
            const pctPer = 0.4;
            const pctTotal = Math.max(0, pctBase + (pctPer * (Number(r) || 0)));
            const pctText = `${Math.round(pctTotal * 100)}%`;
            return `Deal ${pctText} of attack as damage and use your current Skill 1 as a bonus effect (ignores restrictions).`;
        } catch (e) {}
    }, { id: 'ui:ultimate:kaito_description', order: 0 });

    window.BattleHooks.register('skill_system:can_use_ultimate', (ctx) => {
        try {
            const playerId = ctx && ctx.playerId;
            const gameState = ctx && ctx.gameState;
            const skillSystem = ctx && ctx.skillSystem;
            const character = ctx && ctx.character;

            if (!character || character.id !== 'kaito') return;
            if (playerId !== 'player1' && playerId !== 'player2') return;

            const maxHp = Math.max(1, Math.floor(Number(character?.stats?.maxHealth) || 1));
            const hp = Math.max(0, Math.floor(Number(character?.stats?.health) || 0));
            const hpPct = maxHp > 0 ? (hp / maxHp) : 0;

            if (hasRestriction(skillSystem, playerId, 'restriction_power') && hpPct < 0.5) {
                return false;
            }

            for (const [, eff] of skillSystem.activeEffects.entries()) {
                if (!eff) continue;
                if (eff.target !== playerId) continue;
                if (eff.type !== 'debuff') continue;
                if (eff.key !== 'seal_ultimate') continue;
                if ((Number(eff.turnsLeft) || 0) > 0) {
                    return false;
                }
            }
        } catch (e) {}
    }, { id: 'kaito:can_use_ultimate', order: 0 });
})();

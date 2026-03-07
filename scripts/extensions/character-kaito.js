(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    const RESTRICTIONS = [
        {
            key: 'restriction_power',
            name: 'Restriction of Power',
            description: 'Cannot use Ultimate while health is over 20%.'
        },
        {
            key: 'restriction_tactics',
            name: 'Restriction of Tactics',
            description: 'Debuffs inflicted to your opponent last 1 turn and your opponent cannot have more than 1 debuff.'
        },
        {
            key: 'restriction_might',
            name: 'Restriction of Might',
            description: 'Attack skills lose 50% multiplier.'
        },
        {
            key: 'restriction_life',
            name: 'Restriction of Life',
            description: 'Recover 50% less health.'
        },
        {
            key: 'restriction_emotions',
            name: 'Restriction of Emotions',
            description: 'Skills have +1 cooldown.'
        }
    ];

    const WEAPONS = [
        { key: 'healing_staff', name: 'Healing Staff' },
        { key: 'scythe', name: 'Scythe' },
        { key: 'baton', name: 'Baton' },
        { key: 'carbine_rifle', name: 'Carbine Rifle' },
        { key: 'shield', name: 'Shield' },
        { key: 'light_trident', name: 'Light Trident' },
        { key: 'rapier', name: 'Rapier' },
        { key: 'heavy_axe', name: 'Heavy Axe' },
        { key: 'tome_of_paragons', name: 'Tome of Paragons', secret: true }
    ];

    function isKaitoCharacter(character) {
        return Boolean(character && character.id === 'kaito');
    }

    function getWeaponByKey(key) {
        return WEAPONS.find(w => w && w.key === key) || null;
    }

    function ensureKaitoState(passiveSystem, character) {
        const state = passiveSystem.ensureState(character);
        if (!state.counters) state.counters = {};

        if (state.kaitoInitialized !== true) {
            state.kaitoInitialized = true;
            state.kaitoWeaponKey = null;
            state.kaitoWeaponUses = 0;
            state.kaitoPendingRevertOnOpponentTurnEnd = false;
            state.kaitoPendingRevertMarkedAtTurnCount = null;
            state.kaitoWeaponHistory = [];
            state.kaitoRestrictionsInitialized = false;
            state.kaitoTomeRollLastTurnCount = null;
            state.kaitoTomeSkillA = null;
            state.kaitoTomeSkillB = null;

            state.lastSkillType = state.lastSkillType || null;
            state.lastActionTurnCount = state.lastActionTurnCount || null;
        }

        if (!Number.isFinite(state.counters.kaitoRestrictions)) {
            state.counters.kaitoRestrictions = 0;
        }

        if (!Number.isFinite(state.kaitoWeaponUses)) {
            state.kaitoWeaponUses = 0;
        }

        if (!Array.isArray(state.kaitoWeaponHistory)) {
            state.kaitoWeaponHistory = [];
        }

        return state;
    }

    function getPlayerIdForCharacter(gameState, character) {
        if (!gameState || !character) return null;
        for (const pid of ['player1', 'player2']) {
            const c = gameState?.players?.get(pid)?.character;
            if (c === character) return pid;
            if (c && character && c.id && character.id && c.id === character.id && c.stats === character.stats) {
                return pid;
            }
        }
        return null;
    }

    function getActiveKaitoRestrictions(skillSystem, playerId) {
        const keys = new Set();
        try {
            const restrictionKeys = new Set((RESTRICTIONS || []).map(r => r && r.key).filter(Boolean));
            for (const [, eff] of skillSystem.activeEffects.entries()) {
                if (!eff) continue;
                if (eff.type !== 'restriction') continue;
                if (eff.target !== playerId) continue;
                // Do not rely on _kaitoRestriction: the very first restriction (or older saves)
                // might not have been tagged, which would allow duplicates.
                if (typeof eff.key !== 'string' || !eff.key) continue;
                if (!restrictionKeys.has(eff.key)) continue;
                if ((Number(eff.turnsLeft) || 0) <= 0) continue;
                keys.add(eff.key);
            }
        } catch (e) {}
        return keys;
    }

    async function applyKaitoRestriction(skillSystem, playerId, character, restrictionKey) {
        if (!skillSystem || !playerId || !character || !restrictionKey) return;
        const def = RESTRICTIONS.find(r => r && r.key === restrictionKey);
        if (!def) return;

        const already = getActiveKaitoRestrictions(skillSystem, playerId);
        if (already.has(def.key)) return;

        await skillSystem.applyRestriction(character, {
            key: def.key,
            name: def.name,
            description: def.description,
            duration: 99999
        }, playerId);

        try {
            const effects = skillSystem.activeEffects;
            for (const [id, eff] of effects.entries()) {
                if (!eff) continue;
                if (eff.type !== 'restriction') continue;
                if (eff.target !== playerId) continue;
                if (eff.key !== def.key) continue;
                if (!eff._kaitoRestriction) {
                    eff._kaitoRestriction = true;
                }
            }
        } catch (e) {}

        // Track last applied restriction to prevent immediate repeats (including after removals).
        try {
            const state = character?.passiveState;
            if (state) {
                state.kaitoLastRestrictionKey = def.key;
            }
        } catch (e) {}
    }

    function upsertWeaponIndicator(skillSystem, playerId, weaponKey) {
        if (!skillSystem || !skillSystem.activeEffects) return;
        const effects = skillSystem.activeEffects;

        const toRemove = [];
        for (const [id, eff] of effects.entries()) {
            if (!eff) continue;
            if (eff.target !== playerId) continue;
            if (!eff._kaitoWeaponIndicator) continue;
            toRemove.push(id);
        }
        for (const id of toRemove) effects.delete(id);

        if (!weaponKey) return;
        const w = getWeaponByKey(weaponKey);
        const label = w ? w.name : String(weaponKey);

        effects.set(`kaito_weapon_${playerId}_${Date.now()}`, {
            type: 'stack-counter',
            target: playerId,
            characterId: 'kaito',
            ownerId: playerId,
            duration: 1,
            turnsLeft: 1,
            name: 'Current Weapon',
            description: `Current weapon: ${label}`,
            _kaitoWeaponIndicator: true
        });
    }

    function updateRestrictionCounter(passiveSystem, skillSystem, playerId, character) {
        try {
            const state = ensureKaitoState(passiveSystem, character);
            const keys = getActiveKaitoRestrictions(skillSystem, playerId);
            state.counters.kaitoRestrictions = keys.size;
        } catch (e) {}
    }

    function rollInitialRestrictionKey(skillSystem, gameState, playerId, character) {
        const state = character?.passiveState;
        const last = state && typeof state.kaitoLastRestrictionKey === 'string' ? state.kaitoLastRestrictionKey : null;

        const pool = RESTRICTIONS
            .map(r => r && r.key)
            .filter(Boolean)
            .filter(k => k !== last);

        if (pool.length === 0) return null;

        const gid = gameState && typeof gameState.gameId === 'string' && gameState.gameId ? gameState.gameId : null;
        const seed = gid
            ? `${gid}:init:${playerId}:kaito:restriction:${pool.join(',')}`
            : null;

        const rand = seed && skillSystem && typeof skillSystem.deterministicRandom === 'function'
            ? skillSystem.deterministicRandom(seed)
            : Math.random();

        const idx = Math.min(pool.length - 1, Math.max(0, Math.floor(rand * pool.length)));
        return pool[idx];
    }

    function getEligibleWeaponPool(state, character, includeSecret) {
        const history = Array.isArray(state?.kaitoWeaponHistory) ? state.kaitoWeaponHistory : [];
        const last = history.length > 0 ? history[history.length - 1] : null;
        const prev = history.length > 1 ? history[history.length - 2] : null;

        const pool = WEAPONS
            .filter(w => w && (!w.secret || includeSecret))
            .map(w => w.key)
            .filter(Boolean)
            .filter(k => k !== last && k !== prev);

        // Safety fallback if pool collapses.
        if (pool.length === 0) {
            return WEAPONS
                .filter(w => w && (!w.secret || includeSecret))
                .map(w => w.key)
                .filter(Boolean)
                .filter(k => k !== last) 
                .filter(Boolean);
        }
        return pool;
    }

    function rollWeaponKey(skillSystem, gameState, playerId, character) {
        const state = character?.passiveState;
        const maxHp = Number(character?.stats?.maxHealth) || 0;
        const hp = Number(character?.stats?.health) || 0;
        const includeSecret = maxHp > 0 && (hp / maxHp) <= 0.2;

        const pool = getEligibleWeaponPool(state, character, includeSecret);
        if (pool.length === 0) return null;

        const seed = `${gameState?.gameId || 'game'}:${gameState?.turnCount || 0}:${playerId}:kaito:weapon_roll:${state?.kaitoWeaponHistory?.join(',') || ''}`;
        const rand = skillSystem && typeof skillSystem.deterministicRandom === 'function'
            ? skillSystem.deterministicRandom(seed)
            : Math.random();
        const idx = Math.min(pool.length - 1, Math.max(0, Math.floor(rand * pool.length)));
        return pool[idx];
    }

    function getBaseSkillIds() {
        return ['kaito_crazy_slots', 'kaito_price_of_power'];
    }

    function getWeaponSkillIds(weaponKey) {
        if (weaponKey === 'healing_staff') return ['kaito_staff_first_aid', 'kaito_staff_recovery_zone'];
        if (weaponKey === 'scythe') return ['kaito_scythe_minor_curse', 'kaito_scythe_purge'];
        if (weaponKey === 'baton') return ['kaito_baton_snap_strike', 'kaito_baton_reversal_stance'];
        if (weaponKey === 'carbine_rifle') return ['kaito_rifle_headshot', 'kaito_rifle_multistrike'];
        if (weaponKey === 'shield') return ['kaito_shield_bulwark_strike', 'kaito_shield_fortify'];
        if (weaponKey === 'light_trident') return ['kaito_trident_ult_seal', 'kaito_trident_triple_thrust'];
        if (weaponKey === 'rapier') return ['kaito_rapier_time_cut', 'kaito_rapier_evasive_lunge'];
        if (weaponKey === 'heavy_axe') return ['kaito_axe_gash_bleed', 'kaito_axe_double_cleave'];
        if (weaponKey === 'tome_of_paragons') return ['kaito_tome_paragon_cast', 'kaito_tome_random_spell'];
        return null;
    }

    function clearSkipNextDecrementFlag(skillSystem, playerId, skillId) {
        try {
            const key = (typeof skillSystem.getSkillCooldownKey === 'function')
                ? skillSystem.getSkillCooldownKey(skillId, playerId)
                : `${playerId}:${skillId}`;
            if (skillSystem._cooldownsSkipNextDecrement && typeof skillSystem._cooldownsSkipNextDecrement.delete === 'function') {
                skillSystem._cooldownsSkipNextDecrement.delete(key);
            }
        } catch (e) {}
    }

    function swapSkillPalette(skillSystem, playerId, character, nextSkillIds) {
        if (!skillSystem || !playerId || !character) return;
        const cs = skillSystem.characterSystem || (skillSystem.gameState ? skillSystem.gameState.characterSystem : null);
        if (!cs || typeof cs.getSkill !== 'function') return;

        const ids = Array.isArray(nextSkillIds) ? nextSkillIds : [];
        if (ids.length < 2) return;

        const cur = Array.isArray(character.skills) ? character.skills : [];
        const cur0 = cur[0] && cur[0].id;
        const cur1 = cur[1] && cur[1].id;

        return Promise.all([cs.getSkill(ids[0]), cs.getSkill(ids[1])]).then(([s0, s1]) => {
            if (!s0 || !s1) return;

            character.skills = [s0, s1];

            // Transfer cooldowns per slot.
            if (cur0 && s0.id && cur0 !== s0.id) {
                const cd = skillSystem.getSkillCooldown({ id: cur0 }, playerId);
                skillSystem.setSkillCooldown(s0.id, playerId, cd);
                skillSystem.setSkillCooldown(cur0, playerId, 0);
                clearSkipNextDecrementFlag(skillSystem, playerId, cur0);
                clearSkipNextDecrementFlag(skillSystem, playerId, s0.id);
            }
            if (cur1 && s1.id && cur1 !== s1.id) {
                const cd = skillSystem.getSkillCooldown({ id: cur1 }, playerId);
                skillSystem.setSkillCooldown(s1.id, playerId, cd);
                skillSystem.setSkillCooldown(cur1, playerId, 0);
                clearSkipNextDecrementFlag(skillSystem, playerId, cur1);
                clearSkipNextDecrementFlag(skillSystem, playerId, s1.id);
            }
        }).catch(() => {});
    }

    function isInTomeForm(state) {
        return Boolean(state && state.kaitoWeaponKey === 'tome_of_paragons');
    }

    window.BattleHooks.register('passive_system:event', async (ctx) => {
        try {
            const passiveSystem = ctx && ctx.passiveSystem;
            const skillSystem = ctx && ctx.skillSystem;
            const gameState = ctx && ctx.gameState;
            const playerId = ctx && ctx.playerId;
            const eventType = ctx && ctx.eventType;
            const payload = ctx && ctx.payload;
            if (!passiveSystem || !skillSystem || !gameState) return;

            // Track last skill type for all characters (needed for Restriction of Might).
            if (eventType === 'skill_used') {
                const character = ctx && ctx.character;
                if (character && character.passiveState) {
                    const state = passiveSystem.ensureState(character);
                    state.lastSkillType = payload && typeof payload.skillType === 'string' ? payload.skillType : null;
                    state.lastActionTurnCount = Number.isFinite(Number(gameState?.turnCount)) ? Number(gameState.turnCount) : null;
                }
            }

            if (eventType === 'opponent_turn_end') {
                const character = gameState?.players?.get(playerId)?.character;
                if (!isKaitoCharacter(character)) return;

                const state = ensureKaitoState(passiveSystem, character);
                if (state.kaitoPendingRevertOnOpponentTurnEnd) {
                    state.kaitoPendingRevertOnOpponentTurnEnd = false;
                    state.kaitoPendingRevertMarkedAtTurnCount = null;
                    state.kaitoWeaponKey = null;
                    state.kaitoWeaponUses = 0;
                    await Promise.resolve(swapSkillPalette(skillSystem, playerId, character, getBaseSkillIds()));
                    upsertWeaponIndicator(skillSystem, playerId, null);
                }
            }

            // Tome form: refresh the random spell each turn (but not to the one that just appeared).
            if (eventType === 'turn_end') {
                const character = gameState?.players?.get(playerId)?.character;
                if (!isKaitoCharacter(character)) return;
                const state = ensureKaitoState(passiveSystem, character);

                if (isInTomeForm(state)) {
                    const turnCount = Number(gameState?.turnCount);
                    if (Number.isFinite(turnCount) && state.kaitoTomeRollLastTurnCount === turnCount) {
                        return;
                    }
                    state.kaitoTomeRollLastTurnCount = Number.isFinite(turnCount) ? turnCount : null;

                    const pool = WEAPONS
                        .filter(w => w && !w.secret && w.key !== 'tome_of_paragons')
                        .map(w => getWeaponSkillIds(w.key))
                        .flat()
                        .filter(Boolean)
                        .filter(id => id !== 'kaito_tome_paragon_cast' && id !== 'kaito_tome_random_spell');

                    const prevCopied = state.kaitoTomeSkillB && typeof state.kaitoTomeSkillB.id === 'string' ? state.kaitoTomeSkillB.id : null;
                    const seed = `${gameState?.gameId || 'game'}:${turnCount || 0}:${playerId}:kaito:tome_roll:${prevCopied || 'none'}`;
                    const rand = skillSystem && typeof skillSystem.deterministicRandom === 'function'
                        ? skillSystem.deterministicRandom(seed)
                        : Math.random();

                    const idx = pool.length > 0 ? Math.floor(rand * pool.length) : 0;
                    let pickedId = pool[Math.min(pool.length - 1, Math.max(0, idx))] || null;
                    if (pool.length > 1 && prevCopied && pickedId === prevCopied) {
                        pickedId = pool[(idx + 1) % pool.length] || pickedId;
                    }

                    const cs = gameState?.characterSystem || skillSystem?.characterSystem;
                    if (pickedId && cs && typeof cs.getSkill === 'function') {
                        try {
                            const s = await cs.getSkill(pickedId);
                            if (s) {
                                state.kaitoTomeSkillB = JSON.parse(JSON.stringify(s));
                                const skill = character.skills && character.skills[1] ? character.skills[1] : null;
                                if (skill && skill.id === 'kaito_tome_random_spell') {
                                    skill._copiedSkillId = pickedId;
                                    skill._copiedName = s.name;
                                    skill._copiedDescription = s.description;
                                }
                            }
                        } catch (e) {}
                    }
                }
            }

            const character = ctx && ctx.character;
            if (!isKaitoCharacter(character)) return;

            const state = ensureKaitoState(passiveSystem, character);

            if (eventType === 'turn_start') {
                if (!state.kaitoRestrictionsInitialized) {
                    state.kaitoRestrictionsInitialized = true;

                    // Start with 1 restriction.
                    const picked = rollInitialRestrictionKey(skillSystem, gameState, playerId, character) || 'restriction_power';
                    await applyKaitoRestriction(skillSystem, playerId, character, picked);
                }

                updateRestrictionCounter(passiveSystem, skillSystem, playerId, character);

                // Always show current weapon line if active.
                upsertWeaponIndicator(skillSystem, playerId, state.kaitoWeaponKey);
            }

            if (eventType === 'skill_used') {
                updateRestrictionCounter(passiveSystem, skillSystem, playerId, character);

                // Weapon usage tracking.
                if (state.kaitoWeaponKey) {
                    state.kaitoWeaponUses = Math.max(0, Math.floor(Number(state.kaitoWeaponUses) || 0)) + 1;

                    if (state.kaitoWeaponUses >= 2) {
                        state.kaitoPendingRevertOnOpponentTurnEnd = true;
                        state.kaitoPendingRevertMarkedAtTurnCount = Number.isFinite(Number(gameState?.turnCount)) ? Number(gameState.turnCount) : null;
                    }
                }
            }
        } catch (e) {}
    }, { id: 'character:kaito', order: 0 });

    window.BattleHooks.register('skill_system:handle_character_death', async (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const passiveSystem = ctx && ctx.passiveSystem;
            const gameState = ctx && ctx.gameState;
            const character = ctx && ctx.character;
            const playerId = ctx && ctx.playerId;

            if (!skillSystem || !passiveSystem || !gameState) return;
            if (!isKaitoCharacter(character)) return;

            const state = ensureKaitoState(passiveSystem, character);
            if (!isInTomeForm(state)) return;

            const keys = Array.from(getActiveKaitoRestrictions(skillSystem, playerId));
            if (keys.length <= 0) return;

            const seed = `${gameState?.gameId || 'game'}:${gameState?.turnCount || 0}:${playerId}:kaito:tome_immortality`;
            const rand = skillSystem && typeof skillSystem.deterministicRandom === 'function'
                ? skillSystem.deterministicRandom(seed)
                : Math.random();
            const idx = Math.min(keys.length - 1, Math.max(0, Math.floor(rand * keys.length)));
            const pickedKey = keys[idx];

            // Remove one random restriction effect instance.
            for (const [id, eff] of skillSystem.activeEffects.entries()) {
                if (!eff) continue;
                if (eff.type !== 'restriction') continue;
                if (eff.target !== playerId) continue;
                if (eff.key !== pickedKey) continue;
                if (!eff._kaitoRestriction) continue;
                skillSystem.activeEffects.delete(id);
                break;
            }

            // Survive.
            character.stats.health = 1;

            updateRestrictionCounter(passiveSystem, skillSystem, playerId, character);
            return { handled: true, revived: true };
        } catch (e) {}
    }, { id: 'character:kaito:tome_immortality', order: -10 });

    window.BattleHooks.register('skill_system:can_use_skill', (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const skill = ctx && ctx.skill;
            const caster = ctx && ctx.caster;
            const playerId = ctx && ctx.playerId;
            const override = ctx && ctx.override;
            if (!skillSystem || !skill || !caster || !playerId) return;
            if (!isKaitoCharacter(caster)) return;

            if (override && override.ignoreKaitoRestrictions) return true;

            // New rules do not block skill usage; they modify effects.
            return true;
        } catch (e) {}
    }, { id: 'kaito:can_use_skill', order: 0 });

    window.KaitoCharacter = {
        isKaitoCharacter,
        getActiveKaitoRestrictions,
        applyKaitoRestriction,
        rollWeaponKey,
        getEligibleWeaponPool,
        getWeaponByKey,
        getWeaponSkillIds,
        getBaseSkillIds,
        swapSkillPalette,
        upsertWeaponIndicator,
        RESTRICTIONS,
        WEAPONS
    };
})();

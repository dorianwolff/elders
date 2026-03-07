(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function isYatoCharacter(character) {
        return Boolean(character && character.id === 'yato');
    }

    function ensureYatoState(passiveSystem, character) {
        const state = passiveSystem.ensureState(character);
        if (!state.counters) state.counters = {};

        if (!Number.isFinite(state.counters.immortalityStacks)) {
            state.counters.immortalityStacks = 9;
        }
        if (!Number.isFinite(state.counters.yatoUltCharge)) {
            state.counters.yatoUltCharge = 0;
        }
        if (!Number.isFinite(state.yatoImmortalityLost)) {
            state.yatoImmortalityLost = 0;
        }
        if (!Number.isFinite(state.yatoAttackExtraTriggers)) {
            state.yatoAttackExtraTriggers = 0;
        }
        if (!Number.isFinite(state.yatoTwinStrikeHits)) {
            state.yatoTwinStrikeHits = 2;
        }
        return state;
    }

    function formatTimesWord(n) {
        const x = Math.max(1, Math.floor(Number(n) || 1));
        if (x === 1) return 'once';
        if (x === 2) return 'twice';
        if (x === 3) return 'thrice';
        return `${x} times`;
    }

    async function maybeTransformDivinePossession(skillSystem, gameState, playerId, character) {
        if (!skillSystem || !gameState || !playerId || !character) return;
        const state = character.passiveState;
        const stacks = Math.max(0, Math.floor(Number(state?.counters?.immortalityStacks) || 0));

        const cs = gameState?.characterSystem || skillSystem?.characterSystem;
        if (!cs || typeof cs.getSkill !== 'function') return;

        const skills = Array.isArray(character.skills) ? character.skills : [];
        const idx = skills.findIndex(s => s && s.id === 'yato_divine_possession');
        const hasLastStrike = skills.some(s => s && s.id === 'yato_last_strike');

        if (stacks <= 0) {
            if (idx !== -1) {
                const lastStrike = await cs.getSkill('yato_last_strike');
                if (lastStrike) {
                    character.skills[idx] = lastStrike;
                    skillSystem.setSkillCooldown('yato_last_strike', playerId, skillSystem.getSkillCooldown('yato_divine_possession', playerId));
                    skillSystem.setSkillCooldown('yato_divine_possession', playerId, 0);
                }
            }
        } else {
            if (hasLastStrike) {
                const lsIdx = skills.findIndex(s => s && s.id === 'yato_last_strike');
                if (lsIdx !== -1) {
                    const divine = await cs.getSkill('yato_divine_possession');
                    if (divine) {
                        character.skills[lsIdx] = divine;
                        skillSystem.setSkillCooldown('yato_divine_possession', playerId, skillSystem.getSkillCooldown('yato_last_strike', playerId));
                        skillSystem.setSkillCooldown('yato_last_strike', playerId, 0);
                    }
                }
            }
        }
    }

    function loseImmortalityStack(passiveSystem, playerId, character, amount) {
        const state = ensureYatoState(passiveSystem, character);
        const lose = Math.max(1, Math.floor(Number(amount) || 1));

        const before = Math.max(0, Math.floor(Number(state.counters.immortalityStacks) || 0));
        const next = Math.max(0, before - lose);
        state.counters.immortalityStacks = next;

        state.yatoImmortalityLost = Math.max(0, Math.floor(Number(state.yatoImmortalityLost) || 0)) + (before - next);

        // Charge ultimate mission progress: 0/3 immortality stacks lost.
        // PassiveSystem.updateUltimateReady handles setting ultimateReady and resetting this counter
        // when the mission is satisfied (resetOnReady: true).
        try {
            const gained = Math.max(0, before - next);
            state.counters.yatoUltCharge = (Number(state.counters.yatoUltCharge) || 0) + gained;
            if (passiveSystem && typeof passiveSystem.updateUltimateReady === 'function') {
                passiveSystem.updateUltimateReady(playerId);
            }
        } catch (e) {}

        return { before, next };
    }

    window.BattleHooks.register('passive_system:event', async (ctx) => {
        try {
            const passiveSystem = ctx && ctx.passiveSystem;
            const skillSystem = ctx && ctx.skillSystem;
            const gameState = ctx && ctx.gameState;
            const playerId = ctx && ctx.playerId;
            const character = ctx && ctx.character;
            const eventType = ctx && ctx.eventType;

            if (!passiveSystem || !skillSystem || !gameState) return;
            if (!isYatoCharacter(character)) return;

            const state = ensureYatoState(passiveSystem, character);

            if (eventType === 'turn_start') {
                // Ensure skill 2 transform is correct.
                await maybeTransformDivinePossession(skillSystem, gameState, playerId, character);

                // Keep ultimate description in sync.
                const hits = Math.max(2, Math.floor(Number(state.yatoTwinStrikeHits) || 2));
                if (character.ultimate && character.ultimate.id === 'yato_twin_strike') {
                    const word = formatTimesWord(hits);
                    character.ultimate.description = `Deal 125% of attack as damage, ${word}. For the rest of the game, all of Yato's attack skills trigger an additional time.`;
                }
            }
        } catch (e) {}
    }, { id: 'character:yato', order: 0 });

    window.BattleHooks.register('skill_system:handle_character_death', async (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const passiveSystem = ctx && ctx.passiveSystem;
            const gameState = ctx && ctx.gameState;
            const character = ctx && ctx.character;
            const playerId = ctx && ctx.playerId;

            if (!skillSystem || !passiveSystem || !gameState) return;
            if (!isYatoCharacter(character)) return;

            const state = ensureYatoState(passiveSystem, character);
            const stacks = Math.max(0, Math.floor(Number(state?.counters?.immortalityStacks) || 0));
            if (stacks <= 0) return;

            const { next } = loseImmortalityStack(passiveSystem, playerId, character, 1);

            // Survive the fatal hit.
            character.stats.health = 1;

            // Once the last stack is removed, recover 8% max health.
            if (next <= 0) {
                const heal = Math.max(1, Math.ceil((Number(character.stats.maxHealth) || 0) * 0.08));
                character.stats.health = Math.min(Number(character.stats.maxHealth) || 0, character.stats.health + heal);
            }

            // Update Divine Possession -> Last Strike transform.
            await maybeTransformDivinePossession(skillSystem, gameState, playerId, character);

            // Visual indicator (grey stack-counter, unremovable).
            try {
                skillSystem.activeEffects.set(`yato_immortality_${playerId}_${Date.now()}`, {
                    type: 'stack-counter',
                    target: playerId,
                    characterId: 'yato',
                    turnsLeft: 1,
                    name: 'Immortality',
                    description: `${Math.max(0, next)} stacks remaining`
                });
            } catch (e) {}

            return { handled: true, revived: true };
        } catch (e) {}
    }, { id: 'character:yato:death', order: -10 });

    // Expose a small helper for other scripts.
    window.YatoCharacter = {
        ensureYatoState,
        loseImmortalityStack,
        formatTimesWord
    };
})();

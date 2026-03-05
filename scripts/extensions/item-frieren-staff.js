(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function ensureStaffApplied(character) {
        if (!character || !character.passiveState) return false;
        if (character.passiveState._frierenStaffApplied) return false;
        character.passiveState._frierenStaffApplied = true;
        return true;
    }

    function trySetMaxPages(character, maxPages) {
        try {
            if (character && character.passive && typeof character.passive.description === 'string') {
                character.passive.description = character.passive.description
                    .replace(/max\s*5/gi, `max ${maxPages}`)
                    .replace(/At\s*5\s*Pages/gi, `At ${maxPages} Pages`);
            }

            const effs = Array.isArray(character?.passive?.effects) ? character.passive.effects : [];
            for (const e of effs) {
                if (e && e.type === 'spell_archive_pages') {
                    e.maxPages = maxPages;
                }
            }

            if (character && character.passive && character.passive.mission && character.passive.mission.type === 'stack_threshold') {
                if (character.passive.mission.counter === 'archivePages') {
                    character.passive.mission.value = maxPages;
                }
            }

            const skills = Array.isArray(character?.skills) ? character.skills : [];
            for (const s of skills) {
                if (!s || !s.id || !s.effect) continue;
                if (s.id === 'frieren_rotating_page' && s.effect && typeof s.effect === 'object') {
                    s.effect.max_pages = maxPages;
                }
            }

            if (character && character.ultimate && character.ultimate.effect && typeof character.ultimate.effect === 'object') {
                if (character.ultimate.effect.type === 'frieren_minor_utility_barrage') {
                    character.ultimate.effect.casts = maxPages;
                }
            }

            if (typeof character?.ultimate?.description === 'string') {
                character.ultimate.description = `Cast Minor Utility Spell ${maxPages} times at full power. Cannot be doubled.`;
            }
        } catch (e) {}
    }

    window.BattleHooks.register('passive_system:event', async (ctx) => {
        try {
            const passiveSystem = ctx && ctx.passiveSystem;
            const playerId = ctx && ctx.playerId;
            const character = ctx && ctx.character;
            const eventType = ctx && ctx.eventType;

            if (!passiveSystem) return;
            if (!character || character.id !== 'frieren') return;
            if (character.itemId !== 'frieren_staff') return;

            // Apply once when combat starts flowing.
            if (eventType !== 'turn_start' && eventType !== 'opponent_skill_used') return;
            if (!ensureStaffApplied(character)) return;

            trySetMaxPages(character, 6);

            if (typeof passiveSystem.updateUltimateReady === 'function') {
                passiveSystem.updateUltimateReady(playerId);
            }
        } catch (e) {}
    }, { id: 'item:frieren_staff', order: -10 });
})();

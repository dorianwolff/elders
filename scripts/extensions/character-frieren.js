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
            if (!character || character.id !== 'frieren') return;

            if (eventType === 'turn_start') {
                const state = passiveSystem.ensureState(character);
                const turnCount = Number(gameState?.turnCount);
                if (Number.isFinite(turnCount) && state.frierenRotatingSkillLastTurnCount === turnCount) {
                    return;
                }

                const allTypes = ['attack', 'buff', 'debuff', 'utility', 'stance', 'ultimate', 'domain'];

                const refillBag = () => {
                    const seedPrefix = `${gameState?.gameId || 'game'}:${gameState?.turnCount || 0}:${playerId}:frieren:rotate`;
                    const bag = allTypes.slice();
                    for (let i = bag.length - 1; i > 0; i--) {
                        const rand = typeof skillSystem.deterministicRandom === 'function'
                            ? skillSystem.deterministicRandom(`${seedPrefix}:${i}`)
                            : Math.random();
                        const j = Math.floor(rand * (i + 1));
                        const tmp = bag[i];
                        bag[i] = bag[j];
                        bag[j] = tmp;
                    }
                    state.frierenRotatingSkillBag = bag;
                };

                if (!Array.isArray(state.frierenRotatingSkillBag) || state.frierenRotatingSkillBag.length === 0) {
                    refillBag();
                }

                if (Array.isArray(state.frierenRotatingSkillBag) && state.frierenRotatingSkillBag.length > 0) {
                    state.frierenRotatingSkillCurrentType = state.frierenRotatingSkillBag.shift();
                } else {
                    state.frierenRotatingSkillCurrentType = 'attack';
                }

                if (Number.isFinite(turnCount)) {
                    state.frierenRotatingSkillLastTurnCount = turnCount;
                }
            }

            if (eventType === 'opponent_skill_used') {
                const type = payload && typeof payload.skillType === 'string' ? payload.skillType : null;
                if (!type) return;

                const effects = character && character.passive && Array.isArray(character.passive.effects)
                    ? character.passive.effects
                    : [];

                const cfg = effects.find(e => e && e.type === 'spell_archive_pages' && e.timing === 'opponent_skill_used');
                if (!cfg) return;

                const maxPages = typeof cfg.maxPages === 'number' ? cfg.maxPages : 5;
                const counterKey = cfg.counter || 'archivePages';

                character.passiveState.archiveLastPageType = type;

                const pages = Array.isArray(character?.passiveState?.archivePages)
                    ? character.passiveState.archivePages
                    : (character.passiveState.archivePages = []);

                pages.push(type);
                while (pages.length > maxPages) pages.shift();

                const state = passiveSystem.ensureState(character);
                state.counters[counterKey] = pages.length;

                if (typeof passiveSystem.updateUltimateReady === 'function') {
                    passiveSystem.updateUltimateReady(playerId);
                }
            }
        } catch (e) {}
    }, { id: 'character:frieren', order: 0 });
})();

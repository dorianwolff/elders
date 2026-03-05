(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    window.BattleHooks.register('ui:skills:description', (ctx) => {
        try {
            const characterId = ctx && ctx.characterId;
            const skill = ctx && ctx.skill;
            const passiveState = ctx && ctx.passiveState;
            if (characterId !== 'frieren' || !skill || !skill.id) return;

            const archiveLastType = typeof passiveState?.archiveLastPageType === 'string' ? passiveState.archiveLastPageType : null;
            const frierenRotatingType = typeof passiveState?.frierenRotatingSkillCurrentType === 'string'
                ? passiveState.frierenRotatingSkillCurrentType
                : null;

            if (skill.id === 'frieren_minor_utility') {
                if (!archiveLastType) {
                    return "Deal 75% of attack as damage. Gains a bonus effect based on your opponent's last skill type used.";
                }

                let tail = '';
                if (archiveLastType === 'attack') {
                    tail = 'gain a Barrier (+7 Shield).';
                } else if (archiveLastType === 'buff') {
                    tail = 'dispel 1 buff from the enemy and deal additional 95% of attack as damage.';
                } else if (archiveLastType === 'debuff') {
                    tail = 'cleanse yourself and heal 5 Health.';
                } else if (archiveLastType === 'ultimate') {
                    tail = 'deal True Damage instead and recover 50% of damage dealt.';
                } else if (archiveLastType === 'stance') {
                    tail = "ignore the enemy's Stance.";
                } else if (archiveLastType === 'domain') {
                    tail = 'deploy a Domain (+3 attack to you and -3 attack to the enemy for 2 turns).';
                } else {
                    tail = 'apply Heal Block.';
                }

                return `Deal 75% of attack as damage and ${tail}`;
            }

            if (skill.id === 'frieren_rotating_page') {
                const t = frierenRotatingType || 'attack';
                if (t === 'attack') {
                    return 'Add 1 attack Page and gain a Barrier (+7 Shield).';
                }
                if (t === 'buff') {
                    return 'Add 1 buff Page, dispel 1 buff from the enemy, and deal 95% of attack as damage.';
                }
                if (t === 'debuff') {
                    return 'Add 1 debuff Page, cleanse yourself, and heal 5 Health.';
                }
                if (t === 'ultimate') {
                    return 'Add 1 ultimate Page and deal 75% of attack as True Damage, then recover 50% of damage dealt.';
                }
                if (t === 'stance') {
                    return "Add 1 stance Page and ignore the enemy's Stance on your next hit.";
                }
                if (t === 'domain') {
                    return 'Add 1 domain Page and deploy a Domain (+3 attack to you and -3 attack to the enemy for 2 turns).';
                }
                return 'Add 1 utility Page and apply Heal Block.';
            }
        } catch (e) {}
    }, { id: 'ui:skills:frieren_descriptions', order: 0 });

    window.BattleHooks.register('ui:skills:disabled', (ctx) => {
        try {
            const characterId = ctx && ctx.characterId;
            const skill = ctx && ctx.skill;
            const canUse = Boolean(ctx && ctx.canUse);

            if (characterId !== 'frieren' || !skill || !skill.id) return;

            if (skill.id === 'frieren_copycat_glyph') {
                return !canUse;
            }
        } catch (e) {}
    }, { id: 'ui:skills:frieren_disabled', order: 0 });

    window.BattleHooks.register('ui:effect_indicators:badge_title', (ctx) => {
        try {
            const character = ctx && ctx.character;
            const counterKey = ctx && ctx.counterKey;
            if (!character || character.id !== 'frieren') return;
            if (counterKey !== 'archivePages') return;

            const pages = Array.isArray(character?.passiveState?.archivePages)
                ? character.passiveState.archivePages
                : [];

            const counts = {
                stance: 0,
                utility: 0,
                attack: 0,
                debuff: 0,
                buff: 0,
                recovery: 0,
                ultimate: 0,
                domain: 0
            };

            for (const p of pages) {
                const t = typeof p === 'string' ? p : null;
                if (t && counts[t] !== undefined) counts[t] += 1;
            }

            const order = ['debuff', 'buff', 'attack', 'stance', 'utility', 'recovery', 'domain', 'ultimate'];
            const parts = [];
            for (const t of order) {
                const n = counts[t] || 0;
                if (n <= 0) continue;
                parts.push(`${n} ${t}`);
            }

            const total = pages.length;
            if (parts.length === 0) {
                return '0 pages';
            }
            if (parts.length === 1) {
                return `${parts[0]} ${total === 1 ? 'page' : 'pages'}`;
            }

            const head = parts.slice(0, -1).join(', ');
            const tail = parts[parts.length - 1];
            return `${head} and ${tail} ${total === 1 ? 'page' : 'pages'}`;
        } catch (e) {}
    }, { id: 'ui:effect_indicators:frieren_pages_title', order: 0 });
})();

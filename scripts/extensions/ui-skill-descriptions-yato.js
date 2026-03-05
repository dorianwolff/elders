(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function formatTimesWord(n) {
        const x = Math.max(1, Math.floor(Number(n) || 1));
        if (x === 1) return 'once';
        if (x === 2) return 'twice';
        if (x === 3) return 'thrice';
        return `${x} times`;
    }

    window.BattleHooks.register('ui:skills:description', (ctx) => {
        try {
            const characterId = ctx && ctx.characterId;
            const skill = ctx && ctx.skill;
            const passiveState = ctx && ctx.passiveState;
            if (characterId !== 'yato' || !skill || !skill.id) return;

            const extra = Math.max(0, Math.floor(Number(passiveState?.yatoAttackExtraTriggers) || 0));
            const totalHits = 1 + extra;
            const word = formatTimesWord(totalHits);

            if (skill.id === 'yato_normal_strike') {
                return totalHits > 1
                    ? `Deal 100% of attack as damage, ${word}.`
                    : 'Deal 100% of attack as damage.';
            }

            if (skill.id === 'yato_last_strike') {
                return totalHits > 1
                    ? `Deal 80% of attack as true damage, ${word}.`
                    : 'Deal 80% of attack as true damage.';
            }

            if (skill.id === 'yato_divine_possession') {
                return 'Remove 1 stack of Immortality. Once your last stack of Immortality is removed, this skill becomes Last Strike.';
            }

            if (skill.id === 'yato_teleportation') {
                return 'Reduce the next attack skill damage to 0. Gain a buff which prevents true damage for 3 turns.';
            }
        } catch (e) {}
    }, { id: 'ui:skills:yato_descriptions', order: 0 });
})();

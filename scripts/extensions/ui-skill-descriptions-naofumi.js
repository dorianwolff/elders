(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    window.BattleHooks.register('ui:skills:description', (ctx) => {
        try {
            const characterId = ctx && ctx.characterId;
            const skill = ctx && ctx.skill;
            const passiveState = ctx && ctx.passiveState;
            if (characterId !== 'naofumi_iwatani' || !skill || !skill.id) return;

            if (skill.id === 'naofumi_shield_bash') {
                const isTransform = Boolean(passiveState && passiveState.naofumiTransformActive);
                return isTransform
                    ? 'Deal 140% of defense as damage.'
                    : 'Deal 125% of defense as damage.';
            }

            if (skill.id === 'naofumi_defensive_stance') {
                const isTransform = Boolean(passiveState && passiveState.naofumiTransformActive);
                return isTransform
                    ? 'Reduces damage taken by 30% and deals 50% of defense as damage if enemy deals damage to Naofumi with a skill'
                    : 'Reduces damage taken by 30%';
            }
        } catch (e) {}
    }, { id: 'ui:skills:naofumi_descriptions', order: 0 });
})();

(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function getCdrStacks(passiveState, skillId) {
        try {
            return passiveState && passiveState.counters
                ? (Number(passiveState.counters[`cdr_${skillId}`]) || 0)
                : 0;
        } catch (e) {
            return 0;
        }
    }

    window.BattleHooks.register('ui:skills:stack_tag', (ctx) => {
        try {
            const characterId = ctx && ctx.characterId;
            const skill = ctx && ctx.skill;
            const passiveState = ctx && ctx.passiveState;
            if (characterId !== 'chen' || !skill || !skill.id) return;
            if (!skill.cooldownReductionBuff) return;
            return { text: String(getCdrStacks(passiveState, skill.id)), display: 'flex' };
        } catch (e) {}
    }, { id: 'ui:chen:skill_stack_tags', order: 0 });

    window.BattleHooks.register('ui:skills:description', (ctx) => {
        try {
            const characterId = ctx && ctx.characterId;
            const skill = ctx && ctx.skill;
            const passiveState = ctx && ctx.passiveState;
            if (characterId !== 'chen' || !skill || !skill.id) return;

            if (skill.id === 'chen_dragon_strike') {
                const stacks = getCdrStacks(passiveState, skill.id);
                const base = Number(skill?.effect?.base_percent) || 0;
                const per = Number(skill?.effect?.per_stack_percent) || 0;
                const basePct = Math.round(base * 100);
                const perPct = Math.round(per * 100);

                const permDefAt = Math.max(0, Math.floor(Number(skill?.effect?.permanent_defense_if_stacks_at_least) || 0));
                const permDef = Math.floor(Number(skill?.effect?.permanent_defense_amount) || 0);
                const defTail = (permDefAt > 0 && permDef !== 0)
                    ? ` If it was applied ${permDefAt} or more times also gain +${permDef} defense permanently.`
                    : '';

                return `Deal ${basePct}% of attack as damage. Cooldown reduction applied to this skill grants it +${perPct}% of attack.${defTail}`;
            }
        } catch (e) {}
    }, { id: 'ui:chen:skill_descriptions', order: 0 });

    window.BattleHooks.register('ui:ultimate:stack_tag', (ctx) => {
        try {
            const characterId = ctx && ctx.characterId;
            const ultimate = ctx && ctx.ultimate;
            const passiveState = ctx && ctx.passiveState;
            if (characterId !== 'chen' || !ultimate || !ultimate.id) return;
            if (!ultimate.cooldownReductionBuff) return;
            return { text: String(getCdrStacks(passiveState, ultimate.id)), display: 'flex' };
        } catch (e) {}
    }, { id: 'ui:chen:ultimate_stack_tag', order: 0 });

    window.BattleHooks.register('ui:ultimate:description', (ctx) => {
        try {
            const characterId = ctx && ctx.characterId;
            const ultimate = ctx && ctx.ultimate;
            const passiveState = ctx && ctx.passiveState;
            if (characterId !== 'chen' || !ultimate || !ultimate.id) return;

            if (ultimate.id === 'chen_crimson_ult') {
                const stacks = getCdrStacks(passiveState, ultimate.id);
                const basePct = Math.round((Number(ultimate?.effect?.base_percent) || 0) * 100);
                const cdrAt = Math.max(0, Math.floor(Number(ultimate?.effect?.reduce_other_skill_cooldowns_if_stacks_at_least) || 0));
                const cdrAmt = Math.max(0, Math.floor(Number(ultimate?.effect?.reduce_other_skill_cooldowns_amount) || 0));
                const cdrTail = (cdrAt > 0 && cdrAmt > 0)
                    ? ` If it was applied ${cdrAt} or more times also reduce cooldown of all your other skills by ${cdrAmt}.`
                    : '';

                return `Deal ${basePct}% of attack as damage. Repeat this skill for each cooldown reduction applied to it.${cdrTail}`;
            }
        } catch (e) {}
    }, { id: 'ui:chen:ultimate_description', order: 0 });
})();

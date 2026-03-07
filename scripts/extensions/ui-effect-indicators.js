(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    window.BattleHooks.register('ui:effect_indicators:filter_effect', (ctx) => {
        try {
            const effect = ctx && ctx.effect;
            if (!effect || effect.type !== 'buff') return;
            if (effect._itemPassiveId !== 'chen_sword_cd_mastery') return;
            const stacks = Math.max(0, Math.floor(Number(effect._stackCount ?? effect.value) || 0));
            if (stacks <= 0) return false;
        } catch (e) {}
    }, { id: 'ui:chen_sword:hide_at_zero', order: 0 });

    window.BattleHooks.register('ui:effect_indicators:display_text', (ctx) => {
        try {
            const group = ctx && ctx.group;
            const effect = group && group.effect;
            const explicitStacks = ctx && ctx.explicitStacks;
            if (!effect || effect.type !== 'buff') return;
            if (effect._itemPassiveId !== 'chen_sword_cd_mastery') return;
            const stacks = Math.max(0, Math.floor(Number(explicitStacks) || 0));
            if (stacks <= 1) return '';
            return String(stacks);
        } catch (e) {}
    }, { id: 'ui:chen_sword:no_one', order: 0 });

    window.BattleHooks.register('ui:effect_indicators:display_text', (ctx) => {
        try {
            const group = ctx && ctx.group;
            const effect = group && group.effect;
            if (!effect) return;
            if (effect.type !== 'restriction') return;
            if (effect.key !== 'frozen_queen') return;
            const n = Math.max(0, Math.floor(Number(group?.count) || 0));
            if (n <= 0) return '';
            return String(n);
        } catch (e) {}
    }, { id: 'ui:emilia:frozen_queen:always_show', order: 0 });
})();

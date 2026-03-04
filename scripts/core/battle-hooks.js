(function () {
    if (window.BattleHooks) return;

    const phases = new Map();

    function register(phase, fn, options = {}) {
        if (!phase || typeof fn !== 'function') return;
        const list = phases.get(phase) || [];
        list.push({ fn, order: Number(options.order) || 0, id: options.id || null });
        list.sort((a, b) => (a.order || 0) - (b.order || 0));
        phases.set(phase, list);
    }

    function emit(phase, ctx) {
        const list = phases.get(phase);
        if (!list || list.length === 0) return [];
        const results = [];
        for (const h of list) {
            try {
                results.push(h.fn(ctx));
            } catch (e) {
                try {
                    console.warn('BattleHooks handler failed:', phase, h && h.id ? h.id : '', e);
                } catch (_) {}
            }
        }
        return results;
    }

    window.BattleHooks = {
        register,
        emit
    };
})();

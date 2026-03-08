(function () {
    const PRIMARY = ['aggro', 'control', 'scaler'];
    const SECONDARY = [
        'bruiser',
        'tank',
        'buffer',
        'counter',
        'sustain',
        'punisher',
        'broker',
        'parasite',
        'berserker',
        'burst',
        'masochist',
        'gambler'
    ];

    function normalizeTagKey(tag) {
        return String(tag || '').trim().toLowerCase();
    }

    function addWeights(totals, weights) {
        if (!weights || typeof weights !== 'object') return;
        for (const [k, v] of Object.entries(weights)) {
            const key = normalizeTagKey(k);
            if (!key) continue;
            const n = Number(v);
            if (!Number.isFinite(n) || n === 0) continue;
            totals[key] = (Number(totals[key]) || 0) + n;
        }
    }

    function pickTop(totals, allowed) {
        let bestKey = null;
        let bestVal = -Infinity;

        for (const k of allowed) {
            const key = normalizeTagKey(k);
            const val = Number(totals[key]) || 0;
            if (val > bestVal) {
                bestVal = val;
                bestKey = key;
                continue;
            }
            if (val === bestVal && bestKey && key.localeCompare(bestKey) < 0) {
                bestKey = key;
            }
        }

        return { key: bestKey, value: Number(totals[bestKey]) || 0 };
    }

    function computePrecombatTags({ passive, selectedSkills }) {
        const totals = Object.create(null);

        addWeights(totals, passive && passive.tagWeights);

        const list = Array.isArray(selectedSkills) ? selectedSkills : [];
        for (const s of list) {
            addWeights(totals, s && s.tagWeights);
        }

        const primaryPick = pickTop(totals, PRIMARY);
        const primaryTag = primaryPick && primaryPick.key ? primaryPick.key : 'aggro';

        const secondaryPick = pickTop(totals, SECONDARY);
        const secondaryTag = secondaryPick && secondaryPick.key && (Number(secondaryPick.value) || 0) > 0
            ? secondaryPick.key
            : null;

        return [primaryTag, secondaryTag].filter(Boolean);
    }

    window.PrecombatTags = {
        PRIMARY,
        SECONDARY,
        computePrecombatTags
    };
})();

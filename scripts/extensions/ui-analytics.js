(function () {
    async function track(eventName, payload = null) {
        try {
            if (!eventName) return;
            if (!window.EldersAuth || typeof window.EldersAuth.ensureSupabaseClient !== 'function') return;
            const client = window.EldersAuth.ensureSupabaseClient();
            if (!client) return;

            const sessionRes = await client.auth.getSession();
            const session = sessionRes && sessionRes.data ? sessionRes.data.session : null;
            const userId = session && session.user ? session.user.id : null;

            const evt = {
                event_name: String(eventName),
                user_id: userId,
                payload: payload ? payload : null,
                page: (() => {
                    try {
                        return window.location ? (window.location.pathname + window.location.search + window.location.hash) : null;
                    } catch (e) {
                        return null;
                    }
                })(),
                created_at: new Date().toISOString()
            };

            await client.from('analytics_events').insert(evt);
        } catch (e) {
            // analytics should never break the game
        }
    }

    window.EldersAnalytics = { track };
})();

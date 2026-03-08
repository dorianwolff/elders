(function () {
    const STORAGE_KEY = 'elders_supabase_config';
    const AVATAR_KEY_PREFIX = 'elders_avatar_';

    const DEFAULT_SUPABASE_URL = 'https://hsbqnpzrauguuejsbqhn.supabase.co';
    const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_GgEMsZN2q0MWgW7j7NPT9g_Ssh1NEeq';

    const DEFAULT_AVATARS = [
        'chen.png',
        'edward_elric.jpg',
        'emilia.png',
        'frieren.jpg',
        'gojo_satoru.jpeg',
        'kaito.webp',
        'lloyd_frontera.jpg',
        'naofumi_iwatani.jpg',
        'naruto_uzumaki.jpg',
        'rimuru_tempest.webp',
        'saitama_base.jpg',
        'trafalgar_law.webp',
        'yato.jpg',
        'zero_two.png'
    ];

    function getSavedConfig() {
        try {
            if (!window.localStorage) return null;
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const cfg = JSON.parse(raw);
            if (!cfg || typeof cfg !== 'object') return null;
            if (!cfg.url || !cfg.anonKey) return null;
            return cfg;
        } catch (e) {
            return null;
        }
    }

    function setSavedConfig({ url, anonKey }) {
        try {
            if (!window.localStorage) return;
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, anonKey }));
        } catch (e) {}
    }

    function getConfig() {
        const fromWindow = {
            url: (typeof window.SUPABASE_URL === 'string' && window.SUPABASE_URL) ? window.SUPABASE_URL : null,
            anonKey: (typeof window.SUPABASE_ANON_KEY === 'string' && window.SUPABASE_ANON_KEY) ? window.SUPABASE_ANON_KEY : null
        };

        if (fromWindow.url && fromWindow.anonKey) return fromWindow;

        const saved = getSavedConfig();
        if (saved) return saved;

        return { url: DEFAULT_SUPABASE_URL, anonKey: DEFAULT_SUPABASE_ANON_KEY };
    }

    function ensureSupabaseClient() {
        if (window.supabaseClient) return window.supabaseClient;
        if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;

        const cfg = getConfig();
        if (!cfg.url || !cfg.anonKey) return null;

        window.supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                flowType: 'pkce'
            }
        });
        return window.supabaseClient;
    }

    function getOrAssignDefaultAvatar(userId) {
        if (!userId) return null;
        const key = AVATAR_KEY_PREFIX + String(userId);

        try {
            if (window.localStorage) {
                const existing = window.localStorage.getItem(key);
                if (existing) return existing;
            }
        } catch (e) {}

        const idx = Math.floor(Math.random() * DEFAULT_AVATARS.length);
        const chosen = DEFAULT_AVATARS[Math.max(0, Math.min(DEFAULT_AVATARS.length - 1, idx))];

        try {
            if (window.localStorage) window.localStorage.setItem(key, chosen);
        } catch (e) {}

        return chosen;
    }

    async function getUserDisplay() {
        const client = ensureSupabaseClient();
        if (!client) return { signedIn: false, user: null, profile: null };

        const sessionRes = await client.auth.getSession();
        const session = sessionRes && sessionRes.data ? sessionRes.data.session : null;
        const user = session ? session.user : null;
        if (!user) return { signedIn: false, user: null, profile: null };

        const meta = user.user_metadata || {};
        const name = meta.full_name || meta.name || meta.user_name || meta.preferred_username || user.email || 'Player';
        const remoteAvatar = meta.avatar_url || meta.picture || null;

        const localAvatarFile = getOrAssignDefaultAvatar(user.id);

        const isProbablyBlockedRemoteAvatar = (() => {
            try {
                if (window.crossOriginIsolated) return true;
            } catch (e) {}
            try {
                const host = window.location && window.location.hostname ? window.location.hostname : '';
                if (host === 'localhost' || host === '127.0.0.1') return true;
            } catch (e) {}
            return false;
        })();

        const avatarUrl = (!isProbablyBlockedRemoteAvatar && remoteAvatar)
            ? remoteAvatar
            : (localAvatarFile ? `assets/final/${localAvatarFile}` : null);

        return {
            signedIn: true,
            user,
            profile: {
                name,
                avatarUrl
            }
        };
    }

    async function signInWithGoogle() {
        const client = ensureSupabaseClient();
        if (!client) return;

        const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}#menu`;
        await window.supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo }
        });
    }

    async function signOut() {
        const client = ensureSupabaseClient();
        if (!client) return;
        await client.auth.signOut();
    }

    function onAuthStateChange(handler) {
        const client = ensureSupabaseClient();
        if (!client) return () => {};
        const { data } = client.auth.onAuthStateChange(() => {
            handler();
        });

        return () => {
            try {
                if (data && data.subscription && typeof data.subscription.unsubscribe === 'function') {
                    data.subscription.unsubscribe();
                }
            } catch (e) {}
        };
    }

    window.EldersAuth = {
        ensureSupabaseClient,
        getUserDisplay,
        signInWithGoogle,
        signOut,
        onAuthStateChange
    };

    // Create eagerly so OAuth redirects are handled ASAP on page load.
    try {
        ensureSupabaseClient();
    } catch (e) {}
})();

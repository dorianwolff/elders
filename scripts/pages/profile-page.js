class ProfilePage extends BasePage {
    constructor() {
        super();
        this._profileTableMissing = false;
    }

    getHTML() {
        return `
            <div class="menu-page profile-page">
                <div class="precombat-view" style="display:flex;">
                    <div class="precombat-topbar profile-topbar">
                        <button class="precombat-back" id="profile-back" aria-label="Back">Back</button>
                        <div class="profile-title">Profile</div>
                        <div style="width: 86px;"></div>
                    </div>

                    <div class="profile-card">
                        <div class="profile-identity">
                            <div class="profile-avatar">
                                <img id="profile-avatar" alt="Avatar" />
                            </div>
                            <div class="profile-name" id="profile-name"></div>
                        </div>

                        <div class="profile-stat">
                            <div class="profile-stat-label">ELO</div>
                            <div class="profile-stat-value" id="profile-elo">1000</div>
                        </div>

                        <button class="profile-disconnect" id="profile-disconnect" type="button">Disconnect</button>
                    </div>
                </div>
            </div>
        `;
    }

    async setupEventListeners() {
        this.addEventListener('#profile-back', 'click', () => {
            window.app.router.navigateTo('menu');
        });

        this.addEventListener('#profile-disconnect', 'click', async () => {
            try {
                if (window.EldersAuth && typeof window.EldersAuth.signOut === 'function') {
                    await window.EldersAuth.signOut();
                }
            } catch (e) {}

            window.app.router.navigateTo('menu');
        });
    }

    async getSignedInState() {
        try {
            if (!window.EldersAuth || typeof window.EldersAuth.getUserDisplay !== 'function') return null;
            const state = await window.EldersAuth.getUserDisplay();
            if (!state || !state.signedIn || !state.user || !state.user.id) return null;
            return state;
        } catch (e) {
            return null;
        }
    }

    getClient() {
        try {
            if (!window.EldersAuth || typeof window.EldersAuth.ensureSupabaseClient !== 'function') return null;
            return window.EldersAuth.ensureSupabaseClient();
        } catch (e) {
            return null;
        }
    }

    clampElo(val) {
        const n = Math.floor(Number(val) || 0);
        return Math.max(0, n);
    }

    async loadOrCreateElo(userId) {
        try {
            if (this._profileTableMissing) return 1000;
            const client = this.getClient();
            if (!client) return 1000;

            const res = await client
                .from('user_profiles')
                .select('elo')
                .eq('user_id', userId)
                .maybeSingle();

            if (res && res.error && res.status === 404) {
                this._profileTableMissing = true;
                return 1000;
            }

            if (res && res.data && typeof res.data.elo !== 'undefined') {
                return this.clampElo(res.data.elo);
            }

            const up = await client
                .from('user_profiles')
                .upsert({
                    user_id: userId,
                    elo: 1000,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id' });

            if (up && up.error && up.status === 404) {
                this._profileTableMissing = true;
            }

            return 1000;
        } catch (e) {
            return 1000;
        }
    }

    async onPageLoad() {
        const state = await this.getSignedInState();
        if (!state) {
            window.app.router.navigateTo('menu');
            return;
        }

        const nameEl = this.querySelector('#profile-name');
        const avatarEl = this.querySelector('#profile-avatar');
        const eloEl = this.querySelector('#profile-elo');

        if (nameEl) nameEl.textContent = (state.profile && state.profile.name) ? state.profile.name : 'Player';
        if (avatarEl) {
            avatarEl.src = (state.profile && state.profile.avatarUrl) ? state.profile.avatarUrl : '';
            avatarEl.onerror = () => {
                avatarEl.onerror = null;
                avatarEl.src = 'assets/final/chen.png';
            };
        }

        const elo = await this.loadOrCreateElo(state.user.id);
        if (eloEl) eloEl.textContent = String(this.clampElo(elo));
    }
}

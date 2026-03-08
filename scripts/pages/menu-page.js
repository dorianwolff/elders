class MenuPage extends BasePage {
    constructor() {
        super();
        this.characterSystem = new CharacterSystem();
        this.selectedCharacter = null;
        this.characters = [];
        this.allCharacters = [];
        this.currentCharacterIndex = -1;
        this.selectedSkillIds = [];
        this.viewMode = 'menu';
        this.dataManager = null;

        this.selectedItemId = null;

        this.transformLinks = {};
        this.precombatBaseCharacterId = null;
        this.skillPreviewToken = 0;

        this.idleAnimationIntervalId = null;
        this.idleAnimationFrameIndex = 0;
        this.spriteBackgroundUrl = null;
        this.precombatBackgroundAssignments = null;

        this.kaitoFormPreviewIndex = 0;
        this.kaitoFormPreviewWeaponKey = null;
        this.kaitoFormPreviewWeaponName = null;
        this.kaitoFormPreviewSkills = null;
        this.kaitoFormPreviewLoadToken = 0;

        this.naofumiShieldPreviewIndex = 0;
        this.naofumiShieldPreviewKey = null;
        this.naofumiShieldPreviewName = null;
        this.naofumiShieldPreviewSkills = null;
        this.naofumiShieldPreviewLoadToken = 0;
        this.naofumiShieldPreviewSequence = null;
        this.naofumiShieldPreviewPrevSelectedSkillIds = null;

        this._authUnsubscribe = null;

        this._loadoutFetchToken = 0;
        this._loadoutSaveTimer = null;
        this._loadoutTableMissing = false;
    }

    async getSignedInUserId() {
        try {
            if (!window.EldersAuth || typeof window.EldersAuth.getUserDisplay !== 'function') return null;
            const state = await window.EldersAuth.getUserDisplay();
            if (!state || !state.signedIn || !state.user || !state.user.id) return null;
            return state.user.id;
        } catch (e) {
            return null;
        }
    }

    getSupabaseClientForAccount() {
        try {
            if (!window.EldersAuth || typeof window.EldersAuth.ensureSupabaseClient !== 'function') return null;
            return window.EldersAuth.ensureSupabaseClient();
        } catch (e) {
            return null;
        }
    }

    async fetchSavedSkillLoadout(characterId) {
        try {
            if (this._loadoutTableMissing) return null;
            const userId = await this.getSignedInUserId();
            if (!userId) return null;
            if (!characterId) return null;
            const client = this.getSupabaseClientForAccount();
            if (!client) return null;

            const res = await client
                .from('character_skill_loadouts')
                .select('skill_ids')
                .eq('user_id', userId)
                .eq('character_id', characterId)
                .maybeSingle();

            if (res && res.error && (res.error.code === 'PGRST116' || res.status === 404)) {
                this._loadoutTableMissing = true;
                return null;
            }

            const data = res && res.data ? res.data : null;
            const ids = data && Array.isArray(data.skill_ids) ? data.skill_ids.filter(Boolean) : null;
            if (!ids || ids.length === 0) return null;
            return ids.slice(0, 2);
        } catch (e) {
            try {
                if (e && (e.status === 404 || e.code === 'PGRST116')) {
                    this._loadoutTableMissing = true;
                }
            } catch (err) {}
            return null;
        }
    }

    async saveSkillLoadout(characterId, skillIds) {
        try {
            if (this._loadoutTableMissing) return;
            const userId = await this.getSignedInUserId();
            if (!userId) return;
            if (!characterId) return;
            const client = this.getSupabaseClientForAccount();
            if (!client) return;

            const ids = Array.isArray(skillIds) ? skillIds.filter(Boolean).slice(0, 2) : [];
            const res = await client
                .from('character_skill_loadouts')
                .upsert({
                    user_id: userId,
                    character_id: characterId,
                    skill_ids: ids,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id,character_id' });

            if (res && res.error && (res.error.code === 'PGRST116' || res.status === 404)) {
                this._loadoutTableMissing = true;
            }
        } catch (e) {}
    }

    scheduleSaveSkillLoadout() {
        try {
            if (this._loadoutSaveTimer) clearTimeout(this._loadoutSaveTimer);
        } catch (e) {}

        this._loadoutSaveTimer = setTimeout(() => {
            try {
                if (!this.selectedCharacter || !this.selectedCharacter.id) return;
                this.saveSkillLoadout(this.selectedCharacter.id, this.selectedSkillIds).catch(() => {});
            } catch (e) {}
        }, 550);
    }

    async applySavedSkillLoadoutIfAny(character) {
        if (!character || !character.id) return;

        const token = ++this._loadoutFetchToken;
        const saved = await this.fetchSavedSkillLoadout(character.id);
        if (token !== this._loadoutFetchToken) return;
        if (!saved || saved.length === 0) return;

        const skills = Array.isArray(character.skills) ? character.skills.filter(Boolean) : [];
        const allIds = skills.map(s => s && s.id).filter(Boolean);
        const filtered = saved.filter(id => allIds.includes(id));
        if (filtered.length === 0) return;

        const next = filtered.slice(0, 2);
        const same = Array.isArray(this.selectedSkillIds)
            && this.selectedSkillIds.length === next.length
            && this.selectedSkillIds.every((id, i) => id === next[i]);
        if (same) return;

        this.selectedSkillIds = next;
        this.renderPrecombatUI(character);
        this.startIdleSpriteAnimation(character);
    }

    getHTML() {
        return `
            <div class="menu-page">
                <div class="menu-view" id="menu-view">
                    <div class="menu-header">
                        <div class="menu-account" id="menu-account">
                            <button class="menu-signin-btn" id="menu-signin-btn" type="button">Sign in</button>
                            <button class="menu-profile" id="menu-profile" type="button" style="display:none">
                                <span class="menu-profile-avatar">
                                    <img id="menu-profile-avatar-img" alt="Avatar" />
                                </span>
                                <span class="menu-profile-name" id="menu-profile-name"></span>
                            </button>
                        </div>
                        <h1 class="game-title">ELDERS</h1>
                        <p class="game-subtitle">Battle Arena</p>
                    </div>

                    <div class="character-selection">
                        <h2 class="section-title">Choose Your Character</h2>
                        <div class="characters-grid" id="characters-grid">
                            <!-- Characters will be populated here -->
                        </div>
                    </div>
                </div>

                <div class="precombat-view" id="precombat-view" style="display: none;">
                    <div class="precombat-topbar">
                        <button class="precombat-back" id="precombat-back" aria-label="Back">
                            Back
                        </button>

                        <div class="precombat-profile">
                            <div class="precombat-profile-image">
                                <img id="precombat-profile-image" src="" alt="Character">
                            </div>
                            <div class="precombat-profile-stats">
                                <div class="precombat-name-row">
                                    <div class="precombat-name-wrap">
                                        <div class="precombat-name" id="precombat-name"></div>
                                        <div class="precombat-tags" id="precombat-tags"></div>
                                    </div>
                                    <div class="precombat-meta">Meta: <span id="precombat-meta"></span></div>
                                </div>
                                <div class="precombat-stats-grid">
                                    <div class="precombat-stat">
                                        <span class="precombat-stat-label">Health</span>
                                        <span class="precombat-stat-value" id="precombat-stat-health"></span>
                                    </div>
                                    <div class="precombat-stat">
                                        <span class="precombat-stat-label">Attack</span>
                                        <span class="precombat-stat-value" id="precombat-stat-attack"></span>
                                    </div>
                                    <div class="precombat-stat">
                                        <span class="precombat-stat-label">Defense</span>
                                        <span class="precombat-stat-value" id="precombat-stat-defense"></span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="precombat-main">
                        <div class="precombat-stage" id="precombat-stage">
                            <button class="precombat-transform-toggle" id="precombat-transform-toggle" type="button" aria-label="Transform" style="display:none">
                                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                    <path d="M7 7h7a4 4 0 1 1 0 8H8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M7 7l2-2M7 7l2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M17 17H10a4 4 0 1 1 0-8h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M17 17l-2-2M17 17l-2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                            <button class="stage-arrow stage-arrow-left" id="stage-arrow-left" aria-label="Previous character">
                                &laquo;
                            </button>
                            <div class="stage-sprite">
                                <img id="precombat-sprite" src="" alt="Idle Sprite">
                            </div>
                            <button class="stage-arrow stage-arrow-right" id="stage-arrow-right" aria-label="Next character">
                                &raquo;
                            </button>
                        </div>

                        <div class="precombat-kit">
                            <div class="kit-card kit-kaito-forms" id="precombat-kaito-forms" style="display:none">
                                <div class="kit-card-title">Weapons</div>
                                <div class="kaito-form-row" id="kaito-form-row"></div>
                                <div class="kaito-form-preview" id="kaito-form-preview" style="display:none"></div>
                            </div>

                            <div class="kit-card kit-naofumi-shields" id="precombat-naofumi-shields" style="display:none">
                                <div class="kit-card-title">Shields</div>
                                <div class="kaito-form-row" id="naofumi-shield-row"></div>
                                <div class="kaito-form-preview" id="naofumi-shield-preview" style="display:none"></div>
                            </div>

                            <div class="kit-card kit-passive">
                                <div class="kit-card-title">Passive</div>
                                <div class="kit-name" id="precombat-passive-name"></div>
                                <div class="kit-desc" id="precombat-passive-desc"></div>
                            </div>

                            <div class="kit-card kit-skills">
                                <div class="kit-card-title-row">
                                    <div class="kit-card-title">Skills</div>
                                    <div class="skill-slots" id="skill-slots"></div>
                                </div>
                                <div class="kit-hint" id="skills-hint"></div>
                                <div class="skills-picker" id="skills-picker"></div>
                            </div>

                            <div class="kit-card kit-ultimate">
                                <div class="kit-card-title-row">
                                    <div class="kit-card-title">Ultimate</div>
                                    <div class="skill-pick-tags">
                                        <span class="skill-tag skill-tag-cd" id="precombat-ultimate-cd" style="display:none"></span>
                                    </div>
                                </div>
                                <div class="kit-name" id="precombat-ultimate-name"></div>
                                <div class="kit-desc" id="precombat-ultimate-desc"></div>
                            </div>

                            <div class="kit-actions">
                                <div class="precombat-action-row">
                                    <button class="precombat-item-slot" id="precombat-item-slot" type="button" aria-label="Select item" title="Select item">
                                        <img id="precombat-item-image" alt="Item" />
                                    </button>
                                    <button class="btn btn-primary btn-large" id="casual-match-button" disabled>
                                        Casual Match
                                    </button>
                                    <button class="btn btn-secondary btn-large" id="ranked-match-button" style="display:none" disabled>
                                        Ranked Match
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async setupEventListeners() {
        this.addEventListener('#precombat-back', 'click', this.handleBackToMenu.bind(this));
        this.addEventListener('#stage-arrow-left', 'click', () => this.cycleCharacter(-1));
        this.addEventListener('#stage-arrow-right', 'click', () => this.cycleCharacter(1));
        this.addEventListener('#casual-match-button', 'click', () => this.handleFindMatch('casual'));
        this.addEventListener('#ranked-match-button', 'click', () => this.handleFindMatch('ranked'));
        this.addEventListener('#precombat-transform-toggle', 'click', this.toggleTransformPreview.bind(this));
        this.addEventListener('#precombat-item-slot', 'click', this.openItemPicker.bind(this));

        this.addEventListener('#menu-signin-btn', 'click', async () => {
            try {
                if (!window.EldersAnalytics || typeof window.EldersAnalytics.track !== 'function') {
                    // no-op
                } else {
                    window.EldersAnalytics.track('click_sign_in', { source: 'menu' });
                }
            } catch (e) {}

            try {
                if (window.EldersAuth && typeof window.EldersAuth.signInWithGoogle === 'function') {
                    await window.EldersAuth.signInWithGoogle();
                }
            } catch (e) {
                console.error('Sign in failed:', e);
            }
        });

        this.addEventListener('#menu-profile', 'click', async () => {
            // Account page later. For now, allow sign-out via confirm.
            try {
                const ok = confirm('Sign out?');
                if (!ok) return;

                if (window.EldersAnalytics && typeof window.EldersAnalytics.track === 'function') {
                    window.EldersAnalytics.track('click_sign_out', { source: 'menu' });
                }

                if (window.EldersAuth && typeof window.EldersAuth.signOut === 'function') {
                    await window.EldersAuth.signOut();
                }
            } catch (e) {
                console.error('Sign out failed:', e);
            }
        });
    }

    async onPageLoad() {
        // Wait for data manager to be available
        while (!window.app || !window.app.dataManager) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        this.dataManager = window.app.dataManager;

        await this.renderAccountUI();
        setTimeout(() => {
            this.renderAccountUI().catch(() => {});
        }, 350);
        if (this._authUnsubscribe) {
            try { this._authUnsubscribe(); } catch (e) {}
            this._authUnsubscribe = null;
        }
        if (window.EldersAuth && typeof window.EldersAuth.onAuthStateChange === 'function') {
            this._authUnsubscribe = window.EldersAuth.onAuthStateChange(async () => {
                await this.renderAccountUI();
            });
        }

        try {
            if (window.EldersAnalytics && typeof window.EldersAnalytics.track === 'function') {
                window.EldersAnalytics.track('page_view', { page: 'menu' });
            }
        } catch (e) {}

        await this.loadCharacters();
        await this.loadSelectedCharacter();
    }

    async updateRankedMatchVisibility() {
        const rankedBtn = this.querySelector('#ranked-match-button');
        if (!rankedBtn) return;

        try {
            if (!window.EldersAuth || typeof window.EldersAuth.getUserDisplay !== 'function') {
                rankedBtn.style.display = 'none';
                return;
            }
            const state = await window.EldersAuth.getUserDisplay();
            rankedBtn.style.display = state && state.signedIn ? '' : 'none';
        } catch (e) {
            rankedBtn.style.display = 'none';
        }
    }

    async renderAccountUI() {
        const btn = this.querySelector('#menu-signin-btn');
        const profileBtn = this.querySelector('#menu-profile');
        const nameEl = this.querySelector('#menu-profile-name');
        const avatarImg = this.querySelector('#menu-profile-avatar-img');

        if (!btn || !profileBtn || !nameEl || !avatarImg) return;

        try {
            if (!window.EldersAuth || typeof window.EldersAuth.getUserDisplay !== 'function') {
                btn.style.display = '';
                profileBtn.style.display = 'none';
                return;
            }

            const state = await window.EldersAuth.getUserDisplay();
            if (!state || !state.signedIn) {
                btn.style.display = '';
                profileBtn.style.display = 'none';
                return;
            }

            btn.style.display = 'none';
            profileBtn.style.display = '';

            nameEl.textContent = (state.profile && state.profile.name) ? state.profile.name : 'Player';
            const avatarUrl = state.profile && state.profile.avatarUrl ? state.profile.avatarUrl : '';
            avatarImg.src = avatarUrl;
            avatarImg.onerror = () => {
                try {
                    avatarImg.onerror = null;
                    avatarImg.src = 'assets/final/lloyd_frontera.jpg';
                } catch (e) {}
            };
        } catch (e) {
            btn.style.display = '';
            profileBtn.style.display = 'none';
        }
    }

    async cleanup() {
        if (this._authUnsubscribe) {
            try { this._authUnsubscribe(); } catch (e) {}
            this._authUnsubscribe = null;
        }
        await super.cleanup();
    }

    async loadCharacters() {
        const characters = await this.characterSystem.getAllCharacters();
        this.allCharacters = Array.isArray(characters) ? characters.filter(Boolean) : [];
        this.characters = Array.isArray(characters)
            ? characters.filter(c => c && c.selectable !== false)
            : [];
        this.buildTransformLinksFromCharacters(this.allCharacters);
        const grid = this.querySelector('#characters-grid');
        
        grid.innerHTML = '';
        
        this.characters.forEach(character => {
            const characterCard = this.createCharacterCard(character);
            grid.appendChild(characterCard);
        });
    }

    buildTransformLinksFromCharacters(characters) {
        const links = {};
        const list = Array.isArray(characters) ? characters : [];
        for (const c of list) {
            const eff = c && c.ultimate && c.ultimate.effect ? c.ultimate.effect : null;
            if (!eff || eff.type !== 'transform_self') continue;
            const to = typeof eff.transform_to === 'string' ? eff.transform_to : null;
            if (!to) continue;
            if (c && c.id) {
                links[c.id] = to;
                if (!links[to]) links[to] = c.id;
            }
        }
        this.transformLinks = links;
    }

    getTransformTargetId(characterId) {
        if (!characterId) return null;
        return this.transformLinks && this.transformLinks[characterId] ? this.transformLinks[characterId] : null;
    }

    createCharacterCard(character) {
        const card = document.createElement('div');
        card.className = 'character-card';
        card.dataset.characterId = character.id;
        
        card.innerHTML = `
            <div class="character-card-image">
                <img src="assets/final/${character.images[0]}" alt="${character.name}" 
                     onerror="this.src='assets/images/characters/placeholder.png'">
            </div>
            <div class="character-card-info">
                <h3 class="character-card-name">${character.name}</h3>
                <div class="character-card-meta">Meta Points: ${character.metaPoints}</div>
            </div>
        `;
        
        card.addEventListener('click', () => this.selectCharacter(character));
        
        return card;
    }

    async selectCharacter(character) {
        this.selectedCharacter = character;
        
        // Update visual selection
        this.querySelectorAll('.character-card').forEach(card => {
            card.classList.remove('selected');
        });
        
        const selectedCard = this.querySelector(`[data-character-id="${character.id}"]`);
        if (selectedCard) {
            selectedCard.classList.add('selected');
        }
        
        if (this.viewMode === 'menu') {
            this.precombatBackgroundAssignments = {};
            const choices = this.getStageBackgroundChoices();
            this.characters.forEach(c => {
                if (!c || !c.id) return;
                const idx = Math.floor(Math.random() * choices.length);
                this.precombatBackgroundAssignments[c.id] = choices[Math.max(0, Math.min(choices.length - 1, idx))];
            });
        }

        const idx = this.characters.findIndex(c => c && c.id === character.id);
        this.currentCharacterIndex = idx >= 0 ? idx : 0;
        await this.openPrecombatByIndex(this.currentCharacterIndex);
    }

    async loadSelectedCharacter() {
        const savedCharacter = await this.dataManager.loadSelectedCharacter();
        if (savedCharacter) {
            const character = await this.characterSystem.getCharacter(savedCharacter.id);
            if (character) {
                this.selectedCharacter = character;
                this.querySelectorAll('.character-card').forEach(card => {
                    card.classList.remove('selected');
                });
                const selectedCard = this.querySelector(`[data-character-id="${character.id}"]`);
                if (selectedCard) {
                    selectedCard.classList.add('selected');
                }
            }
        }
    }

    renderPrecombatTags(character) {
        const root = this.querySelector('#precombat-tags');
        if (!root) return;
        root.innerHTML = '';

        if (!character || !window.PrecombatTags || typeof window.PrecombatTags.computePrecombatTags !== 'function') {
            return;
        }

        const isKaitoWeaponPreview = character.id === 'kaito' && this.kaitoFormPreviewWeaponKey;
        const kaitoPreviewSkills = isKaitoWeaponPreview && Array.isArray(this.kaitoFormPreviewSkills)
            ? this.kaitoFormPreviewSkills.filter(Boolean)
            : [];

        const isNaofumiSoulPreview = character.id === 'naofumi_iwatani'
            && this.naofumiShieldPreviewKey === 'soul_eater'
            && Array.isArray(this.naofumiShieldPreviewSkills);
        const naofumiPreviewSkills = isNaofumiSoulPreview
            ? this.naofumiShieldPreviewSkills.filter(Boolean)
            : [];

        const baseSkills = Array.isArray(character.skills) ? character.skills.filter(Boolean) : [];
        const skillPool = isKaitoWeaponPreview
            ? kaitoPreviewSkills
            : (isNaofumiSoulPreview ? naofumiPreviewSkills : baseSkills);

        const selected = Array.isArray(this.selectedSkillIds) ? this.selectedSkillIds : [];
        const selectedSkills = skillPool.filter(s => s && selected.includes(s.id));

        const tags = window.PrecombatTags.computePrecombatTags({
            passive: character.passive,
            selectedSkills
        });

        if (!Array.isArray(tags) || tags.length === 0) return;

        for (const tag of tags.slice(0, 2)) {
            const key = String(tag || '').toLowerCase();
            if (!key) continue;
            const pill = document.createElement('span');
            pill.className = `tag-pill tag-pill-${key}`;
            pill.textContent = key.replace(/_/g, ' ');
            root.appendChild(pill);
        }
    }

    setViewMode(mode) {
        this.viewMode = mode;
        const menuView = this.querySelector('#menu-view');
        const precombatView = this.querySelector('#precombat-view');
        if (menuView) menuView.style.display = mode === 'menu' ? '' : 'none';
        if (precombatView) precombatView.style.display = mode === 'precombat' ? '' : 'none';
    }

    hashToUnitInterval(input) {
        let h = 2166136261;
        const s = String(input);
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0) / 4294967296;
    }

    getStageBackgroundChoices() {
        return [
            '/assets/backgrounds/desert.png',
            '/assets/backgrounds/forest.png',
            '/assets/backgrounds/ice.png',
            '/assets/backgrounds/beach.png',
            '/assets/backgrounds/radioactive.png',
            '/assets/backgrounds/space.png',
            '/assets/backgrounds/wasteland_sun.png',
            '/assets/backgrounds/wasteland.png'
        ];
    }

    getSpriteBackgroundUrlForKey(key) {
        const choices = this.getStageBackgroundChoices();
        if (!choices.length) return null;
        const r = this.hashToUnitInterval(key);
        const idx = Math.floor(r * choices.length);
        return choices[Math.max(0, Math.min(choices.length - 1, idx))];
    }

    getIdleFramesForCharacter(character) {
        const id = character && character.id;
        if (id === 'trafalgar_law') {
            return [
                'assets/animations/trafalgar_law/trafalgar_law_idle_1.png',
                'assets/animations/trafalgar_law/trafalgar_law_idle_2.png'
            ];
        } else if (id === 'kaito') {
            const weaponKey = typeof this.kaitoFormPreviewWeaponKey === 'string' ? this.kaitoFormPreviewWeaponKey : null;
            if (weaponKey === 'healing_staff') {
                return [
                    'assets/animations/kaito/kaito_idle_healing_staff_1.png',
                    'assets/animations/kaito/kaito_idle_healing_staff_2.png'
                ];
            }
            else if (weaponKey === 'carbine_rifle') {
                return [
                    'assets/animations/kaito/kaito_idle_rifle_1.png',
                    'assets/animations/kaito/kaito_idle_rifle_2.png'
                ];
            }
            else if (weaponKey === 'heavy_axe') {
                return [
                    'assets/animations/kaito/kaito_idle_axe_1.png',
                    'assets/animations/kaito/kaito_idle_axe_2.png'
                ];
            }
            else if (weaponKey === 'scythe') {
                return [
                    'assets/animations/kaito/kaito_idle_scythe_1.png',
                    'assets/animations/kaito/kaito_idle_scythe_2.png'
                ];
            }
            else if (weaponKey === 'baton') {
                return [
                    'assets/animations/kaito/kaito_idle_baton_1.png',
                    'assets/animations/kaito/kaito_idle_baton_2.png'
                ];
            }
            else if (weaponKey === 'shield') {
                return [
                    'assets/animations/kaito/kaito_idle_shield_1.png',
                    'assets/animations/kaito/kaito_idle_shield_2.png'
                ];
            }
            else if (weaponKey === 'light_trident') {
                return [
                    'assets/animations/kaito/kaito_idle_trident_1.png',
                    'assets/animations/kaito/kaito_idle_trident_2.png'
                ];
            }
            else if (weaponKey === 'rapier') {
                return [
                    'assets/animations/kaito/kaito_idle_rapier_1.png',
                    'assets/animations/kaito/kaito_idle_rapier_2.png'
                ];
            }
            else if (weaponKey === 'tome_of_paragons') {
                return [
                    'assets/animations/kaito/kaito_idle_book_1.png',
                    'assets/animations/kaito/kaito_idle_book_2.png'
                ];
            }
            return [
                'assets/animations/kaito/kaito_idle_1.png',
                'assets/animations/kaito/kaito_idle_2.png'
            ];
        } else if (id === 'chen') {
            return [
                'assets/animations/chen/chen_idle_1.png',
                'assets/animations/chen/chen_idle_2.png'
            ];
        } else if (id === 'yato') {
            return [
                'assets/animations/yato/yato_idle_1.png',
                'assets/animations/yato/yato_idle_2.png'
            ];
        } else if (id === 'frieren') {
            return [
                'assets/animations/frieren/frieren_idle_1.png',
                'assets/animations/frieren/frieren_idle_2.png'
            ];
        } else if (id === 'naofumi_iwatani') {
            const key = typeof this.naofumiShieldPreviewKey === 'string' ? this.naofumiShieldPreviewKey : null;

            if (key === 'leaf') {
                return [
                    'assets/animations/naofumi_isawani/naofumi_iwatani_idle_leaf_1.png',
                    'assets/animations/naofumi_isawani/naofumi_iwatani_idle_leaf_2.png'
                ];
            }
            if (key === 'chimera') {
                return [
                    'assets/animations/naofumi_isawani/naofumi_iwatani_idle_chimera_1.png',
                    'assets/animations/naofumi_isawani/naofumi_iwatani_idle_chimera_2.png'
                ];
            }
            if (key === 'transformation') {
                return [
                    'assets/animations/naofumi_isawani/naofumi_iwatani_idle_transformation_1.png',
                    'assets/animations/naofumi_isawani/naofumi_iwatani_idle_transformation_2.png'
                ];
            }
            if (key === 'slime') {
                return [
                    'assets/animations/naofumi_isawani/naofumi_iwatani_idle_slime_1.png',
                    'assets/animations/naofumi_isawani/naofumi_iwatani_idle_slime_2.png'
                ];
            }
            if (key === 'prison') {
                return [
                    'assets/animations/naofumi_isawani/naofumi_iwatani_idle_prison_1.png',
                    'assets/animations/naofumi_isawani/naofumi_iwatani_idle_prison_2.png'
                ];
            }
            if (key === 'void' || key === 'soul_eater') {
                return [
                    'assets/animations/naofumi_isawani/naofumi_iwatani_idle_void_1.png',
                    'assets/animations/naofumi_isawani/naofumi_iwatani_idle_void_2.png'
                ];
            }
            return [
                'assets/animations/naofumi_isawani/naofumi_iwatani_idle_1.png',
                'assets/animations/naofumi_isawani/naofumi_iwatani_idle_2.png'
            ];
        } else if (id === 'lloyd_frontera') {
            return [
                'assets/animations/lloyd_frontera/lloyd_frontera_idle_1.png',
                'assets/animations/lloyd_frontera/lloyd_frontera_idle_2.png.png'
            ];
        } else if (id === 'rimuru_tempest') {
            return [
                'assets/animations/rimuru_tempest/rimuru_tempest_idle_1.png',
                'assets/animations/rimuru_tempest/rimuru_tempest_idle_2.png'
            ];
        } else if (id === 'saitama') {
            return [
                'assets/animations/saitama/saitama_idle_1.png',
                'assets/animations/saitama/saitama_idle_2.png'
            ];
        } else if (id === 'saitama_serious') {
            return [
                'assets/animations/saitama/saitama_serious_idle_1.png',
                'assets/animations/saitama/saitama_serious_idle_2.png'
            ];
        } else if (id === 'gojo_satoru') {
            return [
                'assets/animations/gojo_satoru/gojo_satoru_idle_1.png',
                'assets/animations/gojo_satoru/gojo_satoru_idle_2.png'
            ];
        } else if (id === 'naruto') {
            return [
                'assets/animations/naruto_uzumaki/naruto_uzumaki_idle_1.png',
                'assets/animations/naruto_uzumaki/naruto_uzumaki_idle_2.png'
            ];
        } else if (id === 'naruto_sage') {
            return [
                'assets/animations/naruto_uzumaki/naruto_uzumaki_sage_idle_1.png',
                'assets/animations/naruto_uzumaki/naruto_uzumaki_sage_idle_2.png',
                'assets/animations/naruto_uzumaki/naruto_uzumaki_sage_idle_3.png',
                'assets/animations/naruto_uzumaki/naruto_uzumaki_sage_idle_4.png'
            ];
        } else if (id === 'edward_elric') {
            return [
                'assets/animations/edward_elric/edward_elric_idle_1.png',
                'assets/animations/edward_elric/edward_elric_idle_2.png',
                'assets/animations/edward_elric/edward_elric_idle_3.png',
                'assets/animations/edward_elric/edward_elric_idle_4.png'
            ];
        } else if (id === 'emilia') {
            return [
                'assets/animations/emilia/emilia_idle_1.png',
                'assets/animations/emilia/emilia_idle_2.png'
            ];
        }
        return [
            'assets/animations/zero_two/zero_two_idle_1.png',
            'assets/animations/zero_two/zero_two_idle_2.png'
        ];
    }

    hasSelectedStanceSkill(character) {
        if (!character) return false;
        const isKaitoWeaponPreview = character.id === 'kaito' && this.kaitoFormPreviewWeaponKey;
        const previewSkills = isKaitoWeaponPreview && Array.isArray(this.kaitoFormPreviewSkills)
            ? this.kaitoFormPreviewSkills.filter(Boolean)
            : [];
        const skills = isKaitoWeaponPreview ? previewSkills : (Array.isArray(character.skills) ? character.skills.filter(Boolean) : []);
        for (const id of this.selectedSkillIds) {
            const s = skills.find(x => x && x.id === id);
            if (s && s.type === 'stance') return true;
        }
        return false;
    }

    getStanceFramesForCharacter(character) {
        if (window.BattleAssets && typeof window.BattleAssets.getStanceFramesForCharacter === 'function') {
            return window.BattleAssets.getStanceFramesForCharacter(character, { stanceKey: 'stance', key: 'stance' });
        }
        return null;
    }

    getIdleOrStanceFramesForCharacter(character) {
        if (this.hasSelectedStanceSkill(character)) {
            const stanceFrames = this.getStanceFramesForCharacter(character);
            if (Array.isArray(stanceFrames) && stanceFrames.length > 0) return stanceFrames;
        }
        return this.getIdleFramesForCharacter(character);
    }

    startIdleSpriteAnimation(character) {
        if (this.idleAnimationIntervalId) {
            clearInterval(this.idleAnimationIntervalId);
            this.idleAnimationIntervalId = null;
        }

        const frames = this.getIdleOrStanceFramesForCharacter(character);
        const sprite = this.querySelector('#precombat-sprite');
        if (!sprite || !frames || frames.length <= 0) return;

        this.idleAnimationFrameIndex = 0;
        sprite.src = frames[0];
        sprite.onerror = () => {
            sprite.onerror = null;
            sprite.src = 'assets/animations/zero_two/zero_two_idle_1.png';
        };

        const cycleLength = Math.max(frames.length, 1);
        this.idleAnimationIntervalId = setInterval(() => {
            this.idleAnimationFrameIndex = (this.idleAnimationFrameIndex + 1) % cycleLength;
            sprite.src = frames[this.idleAnimationFrameIndex % frames.length];
        }, 450);
    }

    async openPrecombatByIndex(index) {
        if (!Array.isArray(this.characters) || this.characters.length === 0) return;
        const next = ((index % this.characters.length) + this.characters.length) % this.characters.length;
        const characterStub = this.characters[next];
        if (!characterStub) return;

        const full = await this.characterSystem.getCharacter(characterStub.id);
        if (!full) return;

        this.selectedCharacter = full;
        this.precombatBaseCharacterId = full.id;
        this.currentCharacterIndex = next;

        await this.loadSelectedItemForCharacter(full);

        this.querySelectorAll('.character-card').forEach(card => {
            card.classList.remove('selected');
        });
        const selectedCard = this.querySelector(`[data-character-id="${full.id}"]`);
        if (selectedCard) {
            selectedCard.classList.add('selected');
        }

        const skillIds = Array.isArray(full.skills) ? full.skills.map(s => s && s.id).filter(Boolean) : [];
        this.selectedSkillIds = skillIds.slice(0, 2);

        // If signed in, apply saved skill loadout BEFORE first render to avoid UI flashing.
        try {
            const token = ++this._loadoutFetchToken;
            const saved = await this.fetchSavedSkillLoadout(full.id);
            if (token === this._loadoutFetchToken && Array.isArray(saved) && saved.length > 0) {
                const allIds = skillIds;
                const filtered = saved.filter(id => allIds.includes(id)).slice(0, 2);
                if (filtered.length > 0) {
                    this.selectedSkillIds = filtered;
                }
            }
        } catch (e) {}

        this.spriteBackgroundUrl = (this.precombatBackgroundAssignments && this.precombatBackgroundAssignments[full.id])
            ? this.precombatBackgroundAssignments[full.id]
            : this.getSpriteBackgroundUrlForKey(full.id);
        const stage = this.querySelector('#precombat-stage');
        if (stage) {
            stage.style.setProperty(
                '--stage-bg-url',
                this.spriteBackgroundUrl ? `url('${this.spriteBackgroundUrl}')` : 'none'
            );
        }

        this.setViewMode('precombat');
        this.renderPrecombatUI(full);
        this.startIdleSpriteAnimation(full);
    }

    async loadSelectedItemForCharacter(character) {
        if (!character || !character.id) {
            this.selectedItemId = null;
            return;
        }

        let desired = null;
        if (this.dataManager && typeof this.dataManager.loadSelectedItemForCharacter === 'function') {
            desired = await this.dataManager.loadSelectedItemForCharacter(character.id);
        }
        if (!desired) {
            const rec = Array.isArray(character.recommended_items) ? character.recommended_items : [];
            desired = rec.length > 0 ? rec[0] : null;
        }

        const eligible = await this.isItemEligibleForCharacter(desired, character);
        if (eligible) {
            this.selectedItemId = desired;
            return;
        }

        const rec = Array.isArray(character.recommended_items) ? character.recommended_items : [];
        if (rec.length > 0 && await this.isItemEligibleForCharacter(rec[0], character)) {
            this.selectedItemId = rec[0];
            return;
        }

        if (await this.isItemEligibleForCharacter('mace', character)) {
            this.selectedItemId = 'mace';
            return;
        }

        this.selectedItemId = null;
    }

    async isItemEligibleForCharacter(itemId, character) {
        if (!itemId || !character || !character.id) return false;
        const item = await this.characterSystem.getItem(itemId);
        if (!item) return false;
        if (item.type === 'regular') return true;

        const allowed = Array.isArray(item.allowedCharacters) ? item.allowedCharacters : [];
        return allowed.includes(character.id);
    }

    async openItemPicker() {
        if (!this.selectedCharacter) return;

        const characterId = this.selectedCharacter.id;
        const recommended = Array.isArray(this.selectedCharacter.recommended_items)
            ? this.selectedCharacter.recommended_items
            : [];

        const allItems = await this.characterSystem.getAllItems();
        const items = Array.isArray(allItems) ? allItems.filter(Boolean) : [];

        const eligible = [];
        for (const item of items) {
            if (!item || !item.id) continue;
            if (await this.isItemEligibleForCharacter(item.id, this.selectedCharacter)) {
                eligible.push(item);
            }
        }

        try {
            const recSet = new Set((recommended || []).filter(Boolean));
            eligible.sort((a, b) => {
                const aRec = recSet.has(a?.id);
                const bRec = recSet.has(b?.id);
                if (aRec !== bRec) return aRec ? -1 : 1;
                const aName = String(a?.name || '').toLowerCase();
                const bName = String(b?.name || '').toLowerCase();
                const nameCmp = aName.localeCompare(bName);
                if (nameCmp !== 0) return nameCmp;
                return String(a?.id || '').localeCompare(String(b?.id || ''));
            });
        } catch (e) {}

        const existing = document.querySelector('.item-picker-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'item-picker-overlay';

        const modal = document.createElement('div');
        modal.className = 'item-picker-modal';

        const title = document.createElement('div');
        title.className = 'item-picker-title';
        title.textContent = 'Select Item';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'item-picker-close';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => overlay.remove());

        const header = document.createElement('div');
        header.className = 'item-picker-header';
        header.appendChild(title);
        header.appendChild(closeBtn);

        const grid = document.createElement('div');
        grid.className = 'item-picker-grid';

        for (const item of eligible) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `item-picker-card${item.id === this.selectedItemId ? ' is-selected' : ''}`;

            const img = document.createElement('img');
            img.className = 'item-picker-image';
            img.src = item.image;
            img.alt = item.name || item.id;

            const name = document.createElement('div');
            name.className = 'item-picker-name';
            name.textContent = item.name || item.id;

            const itemStats = document.createElement('div');
            itemStats.className = 'item-picker-stats';
            itemStats.textContent = this.formatItemStats(item);

            const nameRow = document.createElement('div');
            nameRow.className = 'item-picker-name-row';
            nameRow.appendChild(name);
            nameRow.appendChild(itemStats);

            const passive = item.passiveId ? await this.characterSystem.getItemPassive(item.passiveId) : null;
            const desc = document.createElement('div');
            desc.className = 'item-picker-desc';
            desc.textContent = passive && passive.description ? passive.description : '';

            const tagRow = document.createElement('div');
            tagRow.className = 'item-picker-tags';

            if (recommended.includes(item.id)) {
                const tag = document.createElement('span');
                tag.className = 'item-tag item-tag-recommended';
                tag.textContent = 'Recommended';
                tagRow.appendChild(tag);
            }

            btn.appendChild(img);
            btn.appendChild(nameRow);
            btn.appendChild(tagRow);
            btn.appendChild(desc);

            btn.addEventListener('click', async () => {
                this.selectedItemId = item.id;
                if (this.dataManager && typeof this.dataManager.saveSelectedItemForCharacter === 'function') {
                    await this.dataManager.saveSelectedItemForCharacter(characterId, item.id);
                }
                overlay.remove();
                this.renderPrecombatUI(this.selectedCharacter);
            });

            grid.appendChild(btn);
        }

        modal.appendChild(header);
        modal.appendChild(grid);
        overlay.appendChild(modal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.body.appendChild(overlay);
    }

    formatItemStats(item) {
        const stats = item && item.stats && typeof item.stats === 'object' ? item.stats : {};
        const parts = [];

        const atk = Math.floor(Number(stats.attack) || 0);
        const def = Math.floor(Number(stats.defense) || 0);
        const hp = Math.floor(Number(stats.maxHealth) || 0);

        if (atk !== 0) parts.push(`${atk > 0 ? '+' : ''}${atk} ATK`);
        if (def !== 0) parts.push(`${def > 0 ? '+' : ''}${def} DEF`);
        if (hp !== 0) parts.push(`${hp > 0 ? '+' : ''}${hp} HP`);

        return parts.length > 0 ? parts.join(' ') : '—';
    }

    getItemStatDelta(statKey) {
        if (!this.selectedItemId || !this.characterSystem || typeof this.characterSystem.getItem !== 'function') {
            return 0;
        }
        const item = this.characterSystem.items && typeof this.characterSystem.items.get === 'function'
            ? this.characterSystem.items.get(this.selectedItemId)
            : null;
        const stats = item && item.stats && typeof item.stats === 'object' ? item.stats : {};

        if (statKey === 'health') {
            return Math.floor(Number(stats.maxHealth) || 0);
        }
        if (statKey === 'attack') {
            return Math.floor(Number(stats.attack) || 0);
        }
        if (statKey === 'defense') {
            return Math.floor(Number(stats.defense) || 0);
        }
        return 0;
    }

    renderPrecombatUI(character) {
        if (!character) return;

        this.updateRankedMatchVisibility().catch(() => {});

        this.renderNaofumiShieldPreview(character);
        this.renderKaitoFormPreview(character);

        const transformBtn = this.querySelector('#precombat-transform-toggle');
        if (transformBtn) {
            const curId = character && character.id;
            const target = this.getTransformTargetId(curId);
            transformBtn.style.display = target ? '' : 'none';
        }

        const profileImg = this.querySelector('#precombat-profile-image');
        if (profileImg) {
            profileImg.src = `assets/final/${character.images[0]}`;
            profileImg.onerror = () => (profileImg.src = 'assets/images/characters/placeholder.png');
        }

        this.updateElement('#precombat-name', character.name);
        this.updateElement('#precombat-meta', character.metaPoints);

        this.renderPrecombatTags(character);
        {
            const hpDelta = this.getItemStatDelta('health');
            const atkDelta = this.getItemStatDelta('attack');
            const defDelta = this.getItemStatDelta('defense');
            const hpSuffix = hpDelta !== 0 ? ` <span class="precombat-stat-delta ${hpDelta > 0 ? 'is-positive' : 'is-negative'}">(${hpDelta > 0 ? '+' : ''}${hpDelta})</span>` : '';
            const atkSuffix = atkDelta !== 0 ? ` <span class="precombat-stat-delta ${atkDelta > 0 ? 'is-positive' : 'is-negative'}">(${atkDelta > 0 ? '+' : ''}${atkDelta})</span>` : '';
            const defSuffix = defDelta !== 0 ? ` <span class="precombat-stat-delta ${defDelta > 0 ? 'is-positive' : 'is-negative'}">(${defDelta > 0 ? '+' : ''}${defDelta})</span>` : '';

            const hpEl = this.querySelector('#precombat-stat-health');
            const atkEl = this.querySelector('#precombat-stat-attack');
            const defEl = this.querySelector('#precombat-stat-defense');
            if (hpEl) hpEl.innerHTML = `${character.stats.health}${hpSuffix}`;
            if (atkEl) atkEl.innerHTML = `${character.stats.attack}${atkSuffix}`;
            if (defEl) defEl.innerHTML = `${character.stats.defense}${defSuffix}`;
        }

        {
            let passiveName = character.passive?.name || '';
            let passiveDesc = character.passive?.description || '';

            const showWeapon = character.id === 'kaito' && this.kaitoFormPreviewWeaponName;
            const weaponExtra = showWeapon
                ? ` <span class="kaito-current-weapon-inline">Current weapon : ${this.kaitoFormPreviewWeaponName}</span>`
                : '';

            if (character && character.id === 'naofumi_iwatani') {
                const key = typeof this.naofumiShieldPreviewKey === 'string' ? this.naofumiShieldPreviewKey : null;
                if (key === 'legendary') {
                    passiveName = 'Legendary Shield';
                    passiveDesc = 'At the start of battle, gain +7 defense permanently.';
                } else if (key === 'leaf') {
                    passiveName = 'Leaf Shield';
                    passiveDesc = 'At the start of your turn, heal 10 health and cleanse yourself.';
                } else if (key === 'chimera') {
                    passiveName = 'Chimera Shield';
                    passiveDesc = "When taking damage from an enemy skill, deal damage to opponent's attack as true damage.";
                } else if (key === 'prison') {
                    passiveName = 'Shield Prison';
                    passiveDesc = 'At the start of your turn, stun the opponent for 1 turn and deal 10 damage which bypasses defense.';
                } else if (key === 'slime') {
                    passiveName = 'Slime Shield';
                    passiveDesc = 'This turn, your attack skills are triggered twice.';
                } else if (key === 'soul_eater') {
                    passiveName = 'Soul Eater Shield';
                    passiveDesc = 'Your skills become Undead Control and Soul Eat for this turn. When using a skill recover 3% of max health.';
                } else if (key === 'transformation') {
                    passiveName = 'Transformation Shield';
                    passiveDesc = 'Gain access to your ultimate and your skills ignore defense. At the end of your turn, take escalating true damage.';
                }
            }

            this.updateElement('#precombat-passive-name', `${passiveName}${weaponExtra}`);
            this.updateElement('#precombat-passive-desc', passiveDesc);
        }

        {
            const img = this.querySelector('#precombat-item-image');
            if (img) {
                if (this.selectedItemId) {
                    const item = this.characterSystem && typeof this.characterSystem.getItem === 'function'
                        ? this.characterSystem.items.get(this.selectedItemId)
                        : null;
                    img.src = item && item.image ? item.image : 'assets/items/mace.png';
                } else {
                    img.src = 'assets/items/mace.png';
                }
                img.onerror = () => {
                    img.onerror = null;
                    img.src = 'assets/items/mace.png';
                };
            }
        }

        this.updateElement('#precombat-ultimate-name', character.ultimate?.name || '');
        this.updateElement('#precombat-ultimate-desc', character.ultimate?.description || '');
        try {
            const ult = character.ultimate || {};
            const cd = Math.max(0, Math.floor(Number(ult.cooldown) || 0));
            const cdEl = this.querySelector('#precombat-ultimate-cd');
            if (cdEl) {
                if (cd > 0) {
                    cdEl.textContent = `CD ${cd}`;
                    cdEl.style.display = '';
                } else {
                    cdEl.textContent = '';
                    cdEl.style.display = 'none';
                }
            }

            const isKaitoWeaponPreview = character.id === 'kaito' && this.kaitoFormPreviewWeaponKey;
            const kaitoPreviewSkills = isKaitoWeaponPreview && Array.isArray(this.kaitoFormPreviewSkills)
                ? this.kaitoFormPreviewSkills.filter(Boolean)
                : [];

            const isNaofumiSoulPreview = character.id === 'naofumi_iwatani' && this.naofumiShieldPreviewKey === 'soul_eater' && Array.isArray(this.naofumiShieldPreviewSkills);
            const naofumiPreviewSkills = isNaofumiSoulPreview
                ? this.naofumiShieldPreviewSkills.filter(Boolean)
                : [];

            const baseSkills = Array.isArray(character.skills) ? character.skills.filter(Boolean) : [];
            const skills = isKaitoWeaponPreview ? kaitoPreviewSkills : (isNaofumiSoulPreview ? naofumiPreviewSkills : baseSkills);
            const slots = this.querySelector('#skill-slots');
            if (slots) {
                slots.innerHTML = '';
                for (let i = 0; i < 2; i++) {
                    const id = this.selectedSkillIds[i];
                    const skill = skills.find(s => s && s.id === id);
                    const el = document.createElement('div');
                    el.className = 'skill-slot';
                    el.textContent = skill ? skill.name : 'Empty';
                    slots.appendChild(el);
                }
            }

            const hint = this.querySelector('#skills-hint');
            const casualBtn = this.querySelector('#casual-match-button');
            const rankedBtn = this.querySelector('#ranked-match-button');
            const needsTwo = skills.length >= 2;
            const valid = !needsTwo || this.selectedSkillIds.length === 2;
            if (hint) {
                hint.textContent = valid ? '' : 'Pick exactly 2 skills to start a match.';
            }

            if (casualBtn) {
                casualBtn.disabled = !valid;
            }
            if (rankedBtn && rankedBtn.style.display !== 'none') {
                rankedBtn.disabled = !valid;
            }
            const picker = this.querySelector('#skills-picker');
            if (picker) {
                picker.innerHTML = '';
                skills.forEach(skill => {
                    const selected = this.selectedSkillIds.includes(skill.id);
                    const card = document.createElement('button');
                    card.type = 'button';
                    const locked = Boolean(isKaitoWeaponPreview || isNaofumiSoulPreview);
                    card.className = `skill-pick ${selected || locked ? 'is-selected' : ''}`;
                    if (locked) {
                        card.disabled = true;
                    } else {
                        card.addEventListener('click', () => this.toggleSkillSelection(skill.id));
                    }

                    const cd = Math.max(0, Math.floor(Number(skill.cooldown) || 0));
                    const type = typeof skill.type === 'string' ? skill.type : 'utility';

                    card.innerHTML = `
                        <div class="skill-pick-top">
                            <div class="skill-pick-name">${skill.name}</div>
                            <div class="skill-pick-tags">
                                <span class="skill-tag">${type}</span>
                                <span class="skill-tag skill-tag-cd">CD ${cd}</span>
                            </div>
                        </div>
                        <div class="skill-pick-desc">${skill.description}</div>
                    `;
                    picker.appendChild(card);
                });
            }
        } catch (e) {
        }
    }

    buildNaofumiShieldPreviewSequence() {
        // Deterministic preview order (matches intended in-battle rotation):
        // 1 Legendary -> 2 Leaf -> 3 Chimera -> 4 Prison -> 5 Slime -> 6 Soul Eater -> 7 Transformation
        return ['legendary', 'leaf', 'chimera', 'prison', 'slime', 'soul_eater', 'transformation'];
    }

    renderNaofumiShieldPreview(character) {
        const root = this.querySelector('#precombat-naofumi-shields');
        if (!root) return;

        if (!character || character.id !== 'naofumi_iwatani') {
            root.style.display = 'none';
            this.naofumiShieldPreviewKey = null;
            this.naofumiShieldPreviewName = null;
            this.naofumiShieldPreviewSkills = null;
            this.naofumiShieldPreviewSequence = null;
            return;
        }

        root.style.display = '';

        if (!Array.isArray(this.naofumiShieldPreviewSequence) || this.naofumiShieldPreviewSequence.length !== 7) {
            this.naofumiShieldPreviewSequence = this.buildNaofumiShieldPreviewSequence();
        }

        if (!Number.isFinite(Number(this.naofumiShieldPreviewIndex))) {
            this.naofumiShieldPreviewIndex = 0;
        }
        this.naofumiShieldPreviewIndex = Math.max(
            0,
            Math.min(this.naofumiShieldPreviewSequence.length - 1, Math.floor(this.naofumiShieldPreviewIndex))
        );

        const labelMap = {
            legendary: '1',
            leaf: '2',
            chimera: '3',
            prison: '4',
            slime: '5',
            soul_eater: '6',
            transformation: '7'
        };
        const nameMap = {
            legendary: 'Legendary Shield',
            leaf: 'Leaf Shield',
            chimera: 'Chimera Shield',
            prison: 'Prison Shield',
            slime: 'Slime Shield',
            soul_eater: 'Soul Eater Shield',
            transformation: 'Transformation Shield'
        };

        const row = this.querySelector('#naofumi-shield-row');
        if (row) {
            row.innerHTML = '';
            for (let i = 0; i < this.naofumiShieldPreviewSequence.length; i++) {
                const key = this.naofumiShieldPreviewSequence[i];
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `kaito-form-btn ${i === this.naofumiShieldPreviewIndex ? 'is-selected' : ''}`;
                btn.textContent = labelMap[key] || String(i + 1);
                btn.title = nameMap[key] || key;
                btn.addEventListener('click', () => {
                    this.naofumiShieldPreviewIndex = i;
                    this.renderPrecombatUI(this.selectedCharacter);
                    this.startIdleSpriteAnimation(this.selectedCharacter);
                });
                row.appendChild(btn);
            }
        }

        const key = this.naofumiShieldPreviewSequence[this.naofumiShieldPreviewIndex];
        const prevKey = this.naofumiShieldPreviewKey;
        this.naofumiShieldPreviewKey = key;
        this.naofumiShieldPreviewName = nameMap[key] || 'Shield';

        const previewWrap = this.querySelector('#naofumi-shield-preview');
        if (previewWrap) {
            previewWrap.style.display = 'none';
        }

        // If we are leaving Soul Eater preview, restore the player's previous base skill selections.
        if (prevKey === 'soul_eater' && key !== 'soul_eater') {
            if (Array.isArray(this.naofumiShieldPreviewPrevSelectedSkillIds) && this.naofumiShieldPreviewPrevSelectedSkillIds.length > 0) {
                this.selectedSkillIds = this.naofumiShieldPreviewPrevSelectedSkillIds.slice(0, 2);
            }
            this.naofumiShieldPreviewPrevSelectedSkillIds = null;
        }

        if (key !== 'soul_eater') {
            this.naofumiShieldPreviewSkills = null;
            return;
        }

        // Load the special Soul Eater kit skills for preview.
        if (prevKey === key && Array.isArray(this.naofumiShieldPreviewSkills) && this.naofumiShieldPreviewSkills.length > 0) {
            return;
        }

        this.naofumiShieldPreviewSkills = null;

        // Entering Soul Eater preview: remember the player's current base selections so we can restore
        // them when they click a different shield.
        if (prevKey !== 'soul_eater') {
            this.naofumiShieldPreviewPrevSelectedSkillIds = Array.isArray(this.selectedSkillIds)
                ? this.selectedSkillIds.slice(0, 2)
                : [];
        }
        const loadToken = ++this.naofumiShieldPreviewLoadToken;
        Promise.all([
            this.characterSystem.getSkill('naofumi_soul_eat'),
            this.characterSystem.getSkill('naofumi_undead_control')
        ]).then((skills) => {
            if (loadToken !== this.naofumiShieldPreviewLoadToken) return;
            if (this.naofumiShieldPreviewKey !== 'soul_eater') return;
            const ok = Array.isArray(skills) ? skills.filter(Boolean) : [];
            this.naofumiShieldPreviewSkills = ok;

            // Force-show the Soul shield kit (locked) in the precombat skill slots.
            if (ok.length > 0) {
                this.selectedSkillIds = ok.map(s => s && s.id).filter(Boolean).slice(0, 2);
            }

            this.renderPrecombatUI(this.selectedCharacter);
        }).catch(() => {});
    }

    renderKaitoFormPreview(character) {
        const root = this.querySelector('#precombat-kaito-forms');
        if (!root) return;

        if (!character || character.id !== 'kaito') {
            root.style.display = 'none';
            this.kaitoFormPreviewWeaponKey = null;
            this.kaitoFormPreviewWeaponName = null;
            this.kaitoFormPreviewSkills = null;
            return;
        }

        root.style.display = '';

        const weaponKeys = [
            null,
            'healing_staff',
            'scythe',
            'baton',
            'carbine_rifle',
            'shield',
            'light_trident',
            'rapier',
            'heavy_axe',
            'tome_of_paragons'
        ];

        const weaponLabels = ['none', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
        if (!Number.isFinite(Number(this.kaitoFormPreviewIndex))) {
            this.kaitoFormPreviewIndex = 0;
        }
        this.kaitoFormPreviewIndex = Math.max(0, Math.min(weaponKeys.length - 1, Math.floor(this.kaitoFormPreviewIndex)));

        const row = this.querySelector('#kaito-form-row');
        if (row) {
            row.innerHTML = '';
            for (let i = 0; i < weaponKeys.length; i++) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `kaito-form-btn ${i === this.kaitoFormPreviewIndex ? 'is-selected' : ''}`;
                btn.textContent = weaponLabels[i];
                btn.addEventListener('click', () => {
                    this.kaitoFormPreviewIndex = i;
                    this.renderPrecombatUI(this.selectedCharacter);
                    this.startIdleSpriteAnimation(this.selectedCharacter);
                });
                row.appendChild(btn);
            }
        }

        const key = weaponKeys[this.kaitoFormPreviewIndex];
        const prevKey = this.kaitoFormPreviewWeaponKey;
        this.kaitoFormPreviewWeaponKey = key;

        const previewWrap = this.querySelector('#kaito-form-preview');
        if (!previewWrap) return;

        if (!key) {
            previewWrap.style.display = 'none';
            this.kaitoFormPreviewWeaponKey = null;
            this.kaitoFormPreviewWeaponName = null;
            this.kaitoFormPreviewSkills = null;
            return;
        }

        // Weapons card should contain only buttons, so keep the preview area hidden.
        previewWrap.style.display = 'none';

        let weaponName = key;
        try {
            const w = window.KaitoCharacter && typeof window.KaitoCharacter.getWeaponByKey === 'function'
                ? window.KaitoCharacter.getWeaponByKey(key)
                : null;
            if (w && typeof w.name === 'string') weaponName = w.name;
        } catch (e) {}
        this.kaitoFormPreviewWeaponName = weaponName;

        const ids = (window.KaitoCharacter && typeof window.KaitoCharacter.getWeaponSkillIds === 'function')
            ? window.KaitoCharacter.getWeaponSkillIds(key)
            : null;

        const list = Array.isArray(ids) ? ids.filter(Boolean).slice(0, 2) : [];
        if (list.length === 0) {
            this.kaitoFormPreviewSkills = [];
            return;
        }

        // If we're re-rendering with the same weapon key and already have the resolved skills,
        // just repaint the Skills panel and exit.
        if (prevKey === key && Array.isArray(this.kaitoFormPreviewSkills) && this.kaitoFormPreviewSkills.length > 0) {
            this.paintKaitoWeaponSkillsPanel(character);
            return;
        }

        // Weapon changed (or cache missing): load once.
        this.kaitoFormPreviewSkills = null;
        const loadToken = ++this.kaitoFormPreviewLoadToken;
        const expectedKey = key;
        Promise.all(list.map(id => this.characterSystem.getSkill(id))).then((skills) => {
            if (loadToken !== this.kaitoFormPreviewLoadToken) return;
            if (this.kaitoFormPreviewWeaponKey !== expectedKey) return;

            const ok = Array.isArray(skills) ? skills.filter(Boolean) : [];
            this.kaitoFormPreviewSkills = ok;

            try {
                const passiveName = character?.passive?.name || '';
                const baseDesc = character?.passive?.description || '';
                const showWeapon = character.id === 'kaito' && this.kaitoFormPreviewWeaponName;
                const extra = showWeapon
                    ? ` <span class="kaito-current-weapon-inline">Current weapon : ${this.kaitoFormPreviewWeaponName}</span>`
                    : '';
                this.updateElement('#precombat-passive-name', `${passiveName}${extra}`);
                this.updateElement('#precombat-passive-desc', baseDesc);
                this.paintKaitoWeaponSkillsPanel(character);
            } catch (e) {}
        }).catch(() => {});
    }

    paintKaitoWeaponSkillsPanel(character) {
        if (!character || character.id !== 'kaito') return;
        if (!this.kaitoFormPreviewWeaponKey) return;
        if (!Array.isArray(this.kaitoFormPreviewSkills)) return;

        const skills = this.kaitoFormPreviewSkills.filter(Boolean);

        const slots = this.querySelector('#skill-slots');
        if (slots) {
            slots.innerHTML = '';
            for (let i = 0; i < 2; i++) {
                const skill = skills[i];
                const el = document.createElement('div');
                el.className = 'skill-slot';
                el.textContent = skill ? skill.name : 'Empty';
                slots.appendChild(el);
            }
        }

        const hint = this.querySelector('#skills-hint');
        if (hint) {
            hint.textContent = 'Select 2 skills for battle.';
        }

        const picker = this.querySelector('#skills-picker');
        if (picker) {
            picker.innerHTML = '';
            skills.forEach(skill => {
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'skill-pick is-selected';
                card.disabled = true;

                const cd = Math.max(0, Math.floor(Number(skill.cooldown) || 0));
                const type = typeof skill.type === 'string' ? skill.type : 'utility';
                card.innerHTML = `
                    <div class="skill-pick-top">
                        <div class="skill-pick-name">${skill.name}</div>
                        <div class="skill-pick-tags">
                            <span class="skill-tag">${type}</span>
                            <span class="skill-tag skill-tag-cd">CD ${cd}</span>
                        </div>
                    </div>
                    <div class="skill-pick-desc">${skill.description}</div>
                `;
                picker.appendChild(card);
            });
        }
    }

    toggleSkillSelection(skillId) {
        if (!this.selectedCharacter) return;
        const skills = Array.isArray(this.selectedCharacter.skills) ? this.selectedCharacter.skills.filter(Boolean) : [];
        const allIds = skills.map(s => s && s.id).filter(Boolean);
        if (!allIds.includes(skillId)) return;

        const idx = this.selectedSkillIds.indexOf(skillId);
        let playedPreview = false;
        if (idx >= 0) {
            this.selectedSkillIds.splice(idx, 1);
        } else {
            if (this.selectedSkillIds.length >= 2) {
                return;
            }
            this.selectedSkillIds.push(skillId);

            const skill = skills.find(s => s && s.id === skillId);
            if (skill) {
                this.playSkillPreviewAnimationOnce(skill);
                playedPreview = true;
            }
        }

        this.renderPrecombatUI(this.selectedCharacter);

        // If we didn't trigger a one-shot preview (or we're removing), restart the idle loop so
        // stance selection immediately reflects in the displayed animation.
        if (!playedPreview) {
            this.startIdleSpriteAnimation(this.selectedCharacter);
        }

        this.scheduleSaveSkillLoadout();
    }

    async playSkillPreviewAnimationOnce(skill) {
        if (!this.selectedCharacter || !skill) return;
        const sprite = this.querySelector('#precombat-sprite');
        if (!sprite) return;

        const frames = (window.BattleAssets && typeof window.BattleAssets.getSkillPreviewAnimationFramesForCharacterSkill === 'function')
            ? window.BattleAssets.getSkillPreviewAnimationFramesForCharacterSkill(this.selectedCharacter, skill.id, skill.type)
            : null;
        if (!Array.isArray(frames) || frames.length === 0) return;

        const token = ++this.skillPreviewToken;

        if (this.idleAnimationIntervalId) {
            clearInterval(this.idleAnimationIntervalId);
            this.idleAnimationIntervalId = null;
        }

        const msPerFrame = 160;
        for (let i = 0; i < frames.length; i++) {
            if (token !== this.skillPreviewToken) return;
            sprite.src = frames[i];
            await new Promise(r => setTimeout(r, msPerFrame));
        }

        if (token !== this.skillPreviewToken) return;
        await new Promise(r => setTimeout(r, 160));
        if (token !== this.skillPreviewToken) return;
        this.startIdleSpriteAnimation(this.selectedCharacter);
    }

    async toggleTransformPreview() {
        if (!this.selectedCharacter) return;
        const currentId = this.selectedCharacter.id;
        const targetId = this.getTransformTargetId(currentId);
        if (!targetId) return;

        const next = await this.characterSystem.getCharacter(targetId);
        if (!next) return;

        this.skillPreviewToken += 1;
        this.selectedCharacter = next;

        const skillIds = Array.isArray(next.skills) ? next.skills.map(s => s && s.id).filter(Boolean) : [];
        this.selectedSkillIds = skillIds.slice(0, 2);

        this.renderPrecombatUI(next);
        this.startIdleSpriteAnimation(next);
    }

    cycleCharacter(delta) {
        if (!Array.isArray(this.characters) || this.characters.length === 0) return;
        const next = this.currentCharacterIndex >= 0 ? this.currentCharacterIndex + delta : 0;
        this.openPrecombatByIndex(next);
    }

    handleBackToMenu() {
        this.setViewMode('menu');
        this.precombatBackgroundAssignments = null;
        if (this.idleAnimationIntervalId) {
            clearInterval(this.idleAnimationIntervalId);
            this.idleAnimationIntervalId = null;
        }
    }

    async handleFindMatch(mode = 'casual') {
        if (!this.selectedCharacter) return;

        const skills = Array.isArray(this.selectedCharacter.skills) ? this.selectedCharacter.skills.filter(Boolean) : [];
        const needsTwo = skills.length >= 2;
        if (needsTwo && this.selectedSkillIds.length !== 2) {
            return;
        }

        const selected = skills.filter(s => this.selectedSkillIds.includes(s.id));
        if (needsTwo && selected.length !== 2) {
            return;
        }

        const characterForMatch = JSON.parse(JSON.stringify(this.selectedCharacter));
        if (needsTwo) {
            characterForMatch.skills = selected;
        }

        characterForMatch.itemId = this.selectedItemId;

        // Store selected matchmaking mode for the pairing page / future ranked logic.
        try {
            if (this.dataManager && typeof this.dataManager.saveData === 'function') {
                await this.dataManager.saveData('match_mode', { mode: String(mode || 'casual') });
            }
        } catch (e) {}

        try {
            const casualBtn = this.querySelector('#casual-match-button');
            const rankedBtn = this.querySelector('#ranked-match-button');
            if (casualBtn) {
                casualBtn.disabled = true;
                casualBtn.textContent = 'Connecting...';
            }
            if (rankedBtn) {
                rankedBtn.disabled = true;
                rankedBtn.textContent = 'Connecting...';
            }

            await this.dataManager.saveSelectedCharacter(characterForMatch);
            window.app.router.navigateTo('pairing');
        } catch (error) {
            console.error('Failed to start matchmaking:', error);
            const casualBtn = this.querySelector('#casual-match-button');
            const rankedBtn = this.querySelector('#ranked-match-button');
            if (casualBtn) {
                casualBtn.disabled = false;
                casualBtn.textContent = 'Casual Match';
            }
            if (rankedBtn) {
                rankedBtn.disabled = false;
                rankedBtn.textContent = 'Ranked Match';
            }
        }
    }

    getSelectedCharacter() {
        return this.selectedCharacter;
    }

    async cleanup() {
        this.selectedCharacter = null;
        if (this.idleAnimationIntervalId) {
            clearInterval(this.idleAnimationIntervalId);
            this.idleAnimationIntervalId = null;
        }
        await super.cleanup();
    }
}

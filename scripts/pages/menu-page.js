class MenuPage extends BasePage {
    constructor() {
        super();
        this.characterSystem = new CharacterSystem();
        this.selectedCharacter = null;
        this.characters = [];
        this.currentCharacterIndex = -1;
        this.selectedSkillIds = [];
        this.viewMode = 'menu';
        this.dataManager = null;

        this.idleAnimationIntervalId = null;
        this.idleAnimationFrameIndex = 0;
        this.spriteBackgroundUrl = null;
        this.precombatBackgroundAssignments = null;
    }

    getHTML() {
        return `
            <div class="menu-page">
                <div class="menu-view" id="menu-view">
                    <div class="menu-header">
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
                                    <div class="precombat-name" id="precombat-name"></div>
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
                                <button class="btn btn-primary btn-large" id="find-match-button" disabled>
                                    Find Match
                                </button>
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
        this.addEventListener('#find-match-button', 'click', this.handleFindMatch.bind(this));
    }

    async onPageLoad() {
        // Wait for data manager to be available
        while (!window.app || !window.app.dataManager) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        this.dataManager = window.app.dataManager;
        await this.loadCharacters();
        await this.loadSelectedCharacter();
    }

    async loadCharacters() {
        const characters = await this.characterSystem.getAllCharacters();
        this.characters = Array.isArray(characters)
            ? characters.filter(c => c && c.selectable !== false)
            : [];
        const grid = this.querySelector('#characters-grid');
        
        grid.innerHTML = '';
        
        this.characters.forEach(character => {
            const characterCard = this.createCharacterCard(character);
            grid.appendChild(characterCard);
        });
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
        } else if (id === 'frieren') {
            return [
                'assets/animations/frieren/frieren_idle_1.png',
                'assets/animations/frieren/frieren_idle_2.png'
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
        }
        return [
            'assets/animations/zero_two/zero_two_idle_1.png',
            'assets/animations/zero_two/zero_two_idle_2.png'
        ];
    }

    startIdleSpriteAnimation(character) {
        if (this.idleAnimationIntervalId) {
            clearInterval(this.idleAnimationIntervalId);
            this.idleAnimationIntervalId = null;
        }

        const frames = this.getIdleFramesForCharacter(character);
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
        this.currentCharacterIndex = next;

        this.querySelectorAll('.character-card').forEach(card => {
            card.classList.remove('selected');
        });
        const selectedCard = this.querySelector(`[data-character-id="${full.id}"]`);
        if (selectedCard) {
            selectedCard.classList.add('selected');
        }

        const skillIds = Array.isArray(full.skills) ? full.skills.map(s => s && s.id).filter(Boolean) : [];
        this.selectedSkillIds = skillIds.slice(0, 2);

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

    renderPrecombatUI(character) {
        if (!character) return;

        const profileImg = this.querySelector('#precombat-profile-image');
        if (profileImg) {
            profileImg.src = `assets/final/${character.images[0]}`;
            profileImg.onerror = () => (profileImg.src = 'assets/images/characters/placeholder.png');
        }

        this.updateElement('#precombat-name', character.name);
        this.updateElement('#precombat-meta', character.metaPoints);
        this.updateElement('#precombat-stat-health', character.stats.health);
        this.updateElement('#precombat-stat-attack', character.stats.attack);
        this.updateElement('#precombat-stat-defense', character.stats.defense);

        this.updateElement('#precombat-passive-name', character.passive?.name || '');
        this.updateElement('#precombat-passive-desc', character.passive?.description || '');

        this.updateElement('#precombat-ultimate-name', character.ultimate?.name || '');
        this.updateElement('#precombat-ultimate-desc', character.ultimate?.description || '');
        {
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
        }

        const skills = Array.isArray(character.skills) ? character.skills.filter(Boolean) : [];
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
        const findMatchBtn = this.querySelector('#find-match-button');
        const needsTwo = skills.length >= 2;
        const valid = !needsTwo || this.selectedSkillIds.length === 2;
        if (hint) {
            hint.textContent = needsTwo
                ? (valid ? 'Select 2 skills for battle.' : 'Select exactly 2 skills to continue.')
                : '';
        }
        if (findMatchBtn) {
            findMatchBtn.disabled = !valid;
        }

        const picker = this.querySelector('#skills-picker');
        if (picker) {
            picker.innerHTML = '';
            skills.forEach(skill => {
                const selected = this.selectedSkillIds.includes(skill.id);
                const card = document.createElement('button');
                card.type = 'button';
                card.className = `skill-pick ${selected ? 'is-selected' : ''}`;
                card.addEventListener('click', () => this.toggleSkillSelection(skill.id));

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
        if (idx >= 0) {
            this.selectedSkillIds.splice(idx, 1);
        } else {
            if (this.selectedSkillIds.length >= 2) {
                return;
            }
            this.selectedSkillIds.push(skillId);
        }

        this.renderPrecombatUI(this.selectedCharacter);
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

    async handleFindMatch() {
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

        try {
            const btn = this.querySelector('#find-match-button');
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Connecting...';
            }

            await this.dataManager.saveSelectedCharacter(characterForMatch);
            window.app.router.navigateTo('pairing');
        } catch (error) {
            console.error('Failed to start matchmaking:', error);
            const btn = this.querySelector('#find-match-button');
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Find Match';
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

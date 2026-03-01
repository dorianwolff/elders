window.BattleAssets = {
    getArenaBackgroundUrlForGameId(gameId) {
        const choices = [
            '/assets/backgrounds/desert.png',
            '/assets/backgrounds/forest.png',
            '/assets/backgrounds/ice.png',
            '/assets/backgrounds/beach.png',
            '/assets/backgrounds/radioactive.png',
            '/assets/backgrounds/space.png',
            '/assets/backgrounds/wasteland_sun.png',
            '/assets/backgrounds/wasteland.png'
        ];

        if (!gameId || !choices.length) return choices[0];

        let hash = 0;
        const str = String(gameId);
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        const idx = Math.abs(hash) % choices.length;
        return choices[idx];
    },

    getUltimateVideoForCharacter(character) {
        const id = character && character.id;
        if (id === 'gojo_satoru') {
            return 'assets/animations/gojo_satoru/gojo_satoru_ultimate.mp4';
        }
        else if (id === 'naruto') {
            return 'assets/animations/naruto_uzumaki/naruto_uzumaki_ultimate.mp4';
        }
        else if (id === 'naruto_sage') {
            return 'assets/animations/naruto_uzumaki/naruto_uzumaki_sage_ultimate.mp4';
        }
        else if (id === 'saitama') {
            return 'assets/animations/saitama/saitama_ultimate.mp4';
        }
        else if (id === 'saitama_serious') {
            return 'assets/animations/saitama/saitama_serious_ultimate.mp4';
        }
        else if (id === 'edward_elric') {
            return 'assets/animations/edward_elric/edward_elric_ultimate.mp4';
        }
        else if (id === 'trafalgar_law') {
            return 'assets/animations/trafalgar_law/trafalgar_law_ultimate.mp4';
        }
        else if (id === 'rimuru_tempest') {
            return 'assets/animations/rimuru_tempest/rimuru_tempest_ultimate.mp4';
        }
        else if (id === 'lloyd_frontera') {
            return 'assets/animations/lloyd_frontera/lloyd_frontera_ultimate.mp4';
        }
        else if (id === 'zero_two') {
            return 'assets/animations/zero_two/zero_two_ultimate.mp4';
        }
        else if (id === 'frieren') {
            return 'assets/animations/frieren/frieren_ultimate.mp4';
        }
        return null;
    },

    getIdleFramesForCharacter(character) {
        const id = character && character.id;
        if (id === 'trafalgar_law') {
            return [
                'assets/animations/trafalgar_law/trafalgar_law_idle_1.png',
                'assets/animations/trafalgar_law/trafalgar_law_idle_2.png'
            ];
        }

        else if (id === 'frieren') {
            return [
                'assets/animations/frieren/frieren_idle_1.png',
                'assets/animations/frieren/frieren_idle_2.png'
            ];
        }

        else if (id === 'lloyd_frontera') {
            return [
                'assets/animations/lloyd_frontera/lloyd_frontera_idle_1.png',
                'assets/animations/lloyd_frontera/lloyd_frontera_idle_2.png.png'
            ];
        }

        else if (id === 'rimuru_tempest') {
            return [
                'assets/animations/rimuru_tempest/rimuru_tempest_idle_1.png',
                'assets/animations/rimuru_tempest/rimuru_tempest_idle_2.png'
            ];
        }

        else if (id === 'saitama') {
            return [
                'assets/animations/saitama/saitama_idle_1.png',
                'assets/animations/saitama/saitama_idle_2.png'
            ];
        }

        else if (id === 'saitama_serious') {
            return [
                'assets/animations/saitama/saitama_serious_idle_1.png',
                'assets/animations/saitama/saitama_serious_idle_2.png'
            ];
        }

        else if (id === 'gojo_satoru') {
            return [
                'assets/animations/gojo_satoru/gojo_satoru_idle_1.png',
                'assets/animations/gojo_satoru/gojo_satoru_idle_2.png'
            ];
        }

        else if (id === 'naruto') {
            return [
                'assets/animations/naruto_uzumaki/naruto_uzumaki_idle_1.png',
                'assets/animations/naruto_uzumaki/naruto_uzumaki_idle_2.png'
            ];
        }

        else if (id === 'naruto_sage') {
            return [
                'assets/animations/naruto_uzumaki/naruto_uzumaki_sage_idle_1.png',
                'assets/animations/naruto_uzumaki/naruto_uzumaki_sage_idle_2.png',
                'assets/animations/naruto_uzumaki/naruto_uzumaki_sage_idle_3.png',
                'assets/animations/naruto_uzumaki/naruto_uzumaki_sage_idle_4.png'
            ];
        }

        else if (id === 'edward_elric') {
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
    },

    getStanceFramesForCharacter(character, stanceEffect) {
        const id = character && character.id;
        if (id === 'rimuru_tempest') {
            return [
                'assets/animations/rimuru_tempest/rimuru_tempest_stance_1.png',
                'assets/animations/rimuru_tempest/rimuru_tempest_stance_2.png',
                'assets/animations/rimuru_tempest/rimuru_tempest_stance_3.png'
            ];
        }
        else if (id === 'edward_elric') {
            return [
                'assets/animations/edward_elric/edward_elric_stance_1.png',
                'assets/animations/edward_elric/edward_elric_stance_2.png'
            ];
        }
        else if (id === 'saitama') {
            return [
                'assets/animations/saitama/saitama_stance_1.png',
                'assets/animations/saitama/saitama_stance_2.png',
                'assets/animations/saitama/saitama_stance_3.png'
            ];
        }
        return null;
    },

    getCloseAttackAnimationForCharacter(character) {
        const id = character && character.id;
        if (id === 'rimuru_tempest') {
            return {
                start: 'assets/animations/rimuru_tempest/rimuru_tempest_attack_close_start.png',
                hits: [
                    'assets/animations/rimuru_tempest/rimuru_tempest_attack_close_1.png'
                ],
                end: 'assets/animations/rimuru_tempest/rimuru_tempest_attack_close_end.png'
            };
        }
        if (id === 'trafalgar_law') {
            return {
                start: 'assets/animations/trafalgar_law/trafalgar_law_attack_close_start.png',
                hits: [
                    'assets/animations/trafalgar_law/trafalgar_law_attack_close_1.png'
                ],
                end: 'assets/animations/trafalgar_law/trafalgar_law_attack_close_end.png'
            };
        }
        return null;
    },

    getCloseAttackHitStartDelayMsForCharacter(character) {
        const anim = this.getCloseAttackAnimationForCharacter(character);
        if (!anim) return 0;
        const id = character && character.id;
        if (id === 'trafalgar_law') return 200;
        return 120;
    },

    getCloseAttackTeleportMultiplierForCharacter(character) {
        const id = character && character.id;
        if (id === 'trafalgar_law') return 1.6;
        if (id === 'rimuru_tempest') return 1.8;
        return 1.8;
    },

    getDomainAnimationForCharacterSkill(character, skillId) {
        const id = character && character.id;
        if (id === 'trafalgar_law' && skillId === 'room_domain') {
            return [
                'assets/animations/trafalgar_law/trafalgar_law_domain_1.png',
                'assets/animations/trafalgar_law/trafalgar_law_domain_2.png',
                'assets/animations/trafalgar_law/trafalgar_law_domain_3.png'
            ];
        }
        return null;
    },

    getCharacterPortraitSrc(character) {
        const img = character && Array.isArray(character.images) ? character.images[0] : null;
        if (!img) return null;
        return `assets/final/${img}`;
    },

    getCharacterPortraitFallbackSrc() {
        return 'assets/images/characters/placeholder.png';
    },

    getDefaultIdleFallbackFrame() {
        return 'assets/animations/zero_two/zero_two_idle_1.png';
    }
};

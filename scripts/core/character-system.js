class CharacterSystem {
    constructor() {
        this.characters = new Map();
        this.skills = new Map();
        this.passives = new Map();
        this.items = new Map();
        this.itemPassives = new Map();
        this.dataLoaded = false;
        this.loadingPromise = this.initializeData();
    }

    async initializeData() {
        try {
            // Load skills data
            const skillsResponse = await fetch('./data/skills.json');
            if (!skillsResponse.ok) {
                throw new Error(`Failed to load skills.json: ${skillsResponse.status}`);
            }
            const skillsData = await skillsResponse.json();

            Object.values(skillsData).forEach(skill => {
                this.skills.set(skill.id, skill);
            });

            // Load passives data
            const passivesResponse = await fetch('./data/passives.json');
            if (!passivesResponse.ok) {
                throw new Error(`Failed to load passives.json: ${passivesResponse.status}`);
            }
            const passivesData = await passivesResponse.json();

            Object.values(passivesData).forEach(passive => {
                this.passives.set(passive.id, passive);
            });

            // Load item passives data
            const itemPassivesResponse = await fetch('./data/item_passives.json');
            if (!itemPassivesResponse.ok) {
                throw new Error(`Failed to load item_passives.json: ${itemPassivesResponse.status}`);
            }
            const itemPassivesData = await itemPassivesResponse.json();
            Object.values(itemPassivesData).forEach(passive => {
                this.itemPassives.set(passive.id, passive);
            });

            // Load items data
            const itemsResponse = await fetch('./data/items.json');
            if (!itemsResponse.ok) {
                throw new Error(`Failed to load items.json: ${itemsResponse.status}`);
            }
            const itemsData = await itemsResponse.json();
            Object.values(itemsData).forEach(item => {
                this.items.set(item.id, item);
            });

            // Load characters data
            const charactersResponse = await fetch('./data/characters.json');
            if (!charactersResponse.ok) {
                throw new Error(`Failed to load characters.json: ${charactersResponse.status}`);
            }
            const charactersData = await charactersResponse.json();

            Object.values(charactersData).forEach(char => {
                char.skills = (char.skillIds || []).map(skillId => {
                    const skill = this.skills.get(skillId);
                    if (!skill) {
                        throw new Error(`Skill ${skillId} not found for character ${char.name}`);
                    }
                    return skill;
                });

                if (char.passiveId) {
                    const passive = this.passives.get(char.passiveId);
                    if (!passive) {
                        throw new Error(`Passive ${char.passiveId} not found for character ${char.name}`);
                    }
                    char.passive = passive;
                }

                delete char.skillIds;
                delete char.passiveId;

                this.characters.set(char.id, char);
            });

            console.log(`✅ Successfully loaded ${this.skills.size} skills, ${this.passives.size} passives, and ${this.characters.size} characters from JSON`);
            this.dataLoaded = true;
        } catch (error) {
            console.error('❌ Failed to load character/skill data from JSON:', error);
        }
    }

    async waitForData() {
        if (!this.dataLoaded) {
            await this.loadingPromise;
        }
    }

    async getCharacter(id) {
        await this.waitForData();
        const character = this.characters.get(id);
        if (!character) return null;
        
        // Create a deep copy and preserve base stats
        const characterCopy = JSON.parse(JSON.stringify(character));
        
        // Store original stats snapshots for UI + combat systems
        characterCopy.initialStats = { ...characterCopy.stats };
        characterCopy.baseStats = { ...characterCopy.stats };

        characterCopy.recommended_items = Array.isArray(characterCopy.recommended_items)
            ? characterCopy.recommended_items
            : [];

        return characterCopy;
    }

    async getAllCharacters() {
        await this.waitForData();
        return Array.from(this.characters.values());
    }

    async getCharactersByMetaPoints() {
        const characters = await this.getAllCharacters();
        return characters.sort((a, b) => a.metaPoints - b.metaPoints);
    }

    async getSkill(id) {
        await this.waitForData();
        return this.skills.get(id);
    }

    async getAllSkills() {
        await this.waitForData();
        return Array.from(this.skills.values());
    }

    async getItem(id) {
        await this.waitForData();
        return this.items.get(id) || null;
    }

    async getAllItems() {
        await this.waitForData();
        return Array.from(this.items.values());
    }

    async getItemPassive(id) {
        await this.waitForData();
        return this.itemPassives.get(id) || null;
    }
}

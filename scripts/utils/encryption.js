class EncryptionManager {
    constructor() {
        this.algorithm = 'AES-GCM';
        this.keyLength = 256;
    }

    async generateKey() {
        return await crypto.subtle.generateKey(
            {
                name: this.algorithm,
                length: this.keyLength
            },
            true,
            ['encrypt', 'decrypt']
        );
    }

    async exportKey(key) {
        const exported = await crypto.subtle.exportKey('raw', key);
        return Array.from(new Uint8Array(exported));
    }

    async importKey(keyData) {
        const keyArray = new Uint8Array(keyData);
        return await crypto.subtle.importKey(
            'raw',
            keyArray,
            { name: this.algorithm },
            true,
            ['encrypt', 'decrypt']
        );
    }

    async encrypt(data, key) {
        const encoder = new TextEncoder();
        const encodedData = encoder.encode(JSON.stringify(data));
        
        const iv = crypto.getRandomValues(new Uint8Array(12));
        
        const encrypted = await crypto.subtle.encrypt(
            {
                name: this.algorithm,
                iv: iv
            },
            key,
            encodedData
        );

        return {
            data: Array.from(new Uint8Array(encrypted)),
            iv: Array.from(iv)
        };
    }

    async decrypt(encryptedData, key) {
        const { data, iv } = encryptedData;
        const dataArray = new Uint8Array(data);
        const ivArray = new Uint8Array(iv);

        const decrypted = await crypto.subtle.decrypt(
            {
                name: this.algorithm,
                iv: ivArray
            },
            key,
            dataArray
        );

        const decoder = new TextDecoder();
        const decryptedString = decoder.decode(decrypted);
        return JSON.parse(decryptedString);
    }

    async getOrCreateKey() {
        const storedKey = localStorage.getItem('elders_encryption_key');
        
        if (storedKey) {
            try {
                const keyData = JSON.parse(storedKey);
                return await this.importKey(keyData);
            } catch (error) {
                console.warn('Failed to import stored key, generating new one');
            }
        }

        const newKey = await this.generateKey();
        const exportedKey = await this.exportKey(newKey);
        localStorage.setItem('elders_encryption_key', JSON.stringify(exportedKey));
        
        return newKey;
    }
}

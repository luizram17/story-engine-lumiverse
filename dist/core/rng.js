export function hash32(input) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export class TurnRng {
    next;
    constructor(seed) { this.next = mulberry32(hash32(seed)); }
    float() { return this.next(); }
    int(min, max) { return Math.floor(this.float() * (max - min + 1)) + min; }
    d20() { return this.int(1, 20); }
    d100() { return this.int(1, 100); }
    chance(p) { return this.float() < Math.max(0, Math.min(1, p)); }
    pick(items) { return items[this.int(0, Math.max(0, items.length - 1))]; }
}
export function fingerprintText(text) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    return hash32(clean).toString(36).padStart(7, '0');
}

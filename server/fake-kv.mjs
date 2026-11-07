// 테스트·로컬 모의 서버용 메모리 KV (Cloudflare KV의 get/put/delete 일부를 흉내 낸다)
export class FakeKV {
  constructor() { this.m = new Map(); }
  async get(key, type) {
    const v = this.m.get(key);
    if (v === undefined) return null;
    return type === 'json' || (type && type.type === 'json') ? JSON.parse(v) : v;
  }
  async put(key, value) { this.m.set(key, String(value)); }
  async delete(key) { this.m.delete(key); }
  dump() { return [...this.m.entries()]; }
}

// 给 Node 环境注入最小 localStorage，供业务文件模块加载时使用
const memory = new Map<string, string>();

export const localStorage = {
  getItem(key: string): string | null {
    return memory.has(key) ? memory.get(key)! : null;
  },
  setItem(key: string, value: string): void {
    memory.set(key, String(value));
  },
  removeItem(key: string): void {
    memory.delete(key);
  },
  clear(): void {
    memory.clear();
  }
};

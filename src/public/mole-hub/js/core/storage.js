export function createHubStorage(namespace = 'winlew.hub') {
  const makeKey = (key) => `${namespace}.${key}`;

  return {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(makeKey(key));
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(makeKey(key), JSON.stringify(value));
      } catch {}
      return value;
    },
    rememberLane(lane) {
      return this.set('lastLane', lane);
    },
    getLane() {
      return this.get('lastLane', 'web');
    },
  };
}

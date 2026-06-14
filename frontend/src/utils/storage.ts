/**
 * Safe localStorage helpers with type safety
 */

export function loadFromLocalStorage<T>(
  key: string,
  defaultValue: T,
  parser?: (raw: string) => T
): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return defaultValue

    if (parser) {
      return parser(raw)
    }

    // Auto-detect type
    if (typeof defaultValue === 'boolean') {
      return (raw !== 'false') as T
    }

    if (typeof defaultValue === 'number') {
      const num = Number(raw)
      return (Number.isFinite(num) ? num : defaultValue) as T
    }

    if (typeof defaultValue === 'object') {
      return JSON.parse(raw) as T
    }

    return raw as T
  } catch (err) {
    console.warn(`Failed to load "${key}" from localStorage:`, err)
    return defaultValue
  }
}

export function saveToLocalStorage<T>(
  key: string,
  value: T,
  serializer?: (value: T) => string
): void {
  try {
    let raw: string

    if (serializer) {
      raw = serializer(value)
    } else if (typeof value === 'object') {
      raw = JSON.stringify(value)
    } else {
      raw = String(value)
    }

    localStorage.setItem(key, raw)
  } catch (err) {
    console.warn(`Failed to save "${key}" to localStorage:`, err)
  }
}

export function removeFromLocalStorage(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch (err) {
    console.warn(`Failed to remove "${key}" from localStorage:`, err)
  }
}

export function clearLocalStorage(): void {
  try {
    localStorage.clear()
  } catch (err) {
    console.warn('Failed to clear localStorage:', err)
  }
}

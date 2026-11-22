export type Lang = 'es' | 'en'

export type Detail = 'summary' | 'full'

export type Row = { name: string; tokens: number }

export type Category = Row & { kind: 'used' | 'free' | 'buffer' | 'deferred' }

/** One model's tokens this session, and what they cost in USD at the table's prices. */
export type ModelSpend = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number
  /** False once a step of a model missing from the price table was added. */
  isPriced: boolean
}

/** Per-model spend, tied to the session it counts (`$.session.usage().startedAt`). */
export type Spend = { startedAt: number | null; models: Record<string, ModelSpend> }

/** A memory file: `name` is its short path, `origin` where it loaded from (`Project`, `User`…). */
export type MemoryRow = Row & { origin: string }

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** One reading of the context window, as the pane draws it. */
export type Snapshot = {
  at: number
  detail: Detail
  window: number
  tokens?: number
  percent?: number
  categories: Category[]
  memory: MemoryRow[]
  skills: Row[]
  /** The skill listing's tokens in all, overhead included. */
  skillsTokens?: number
  agents: Row[]
  mcp: Row[]
  limits: Limit[]
  costUsd?: number
  autoCompactAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'context-meter': {
      snapshot: Shaped<Snapshot | null>
      isWarned: boolean
      isPlaced: boolean
      isBusy: boolean
      isOpen: boolean
      sections: Record<string, boolean>
      spend: Shaped<Spend>
    }
  }
}

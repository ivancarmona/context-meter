import type { Category, Lang, MemoryRow, ModelSpend, Row } from '../types'

const STRINGS = {
  en: {
    title: 'Context',
    noData: 'No data yet: it appears after the first answer.',
    window: 'window',
    free: 'Free',
    buffer: 'Autocompact reserve',
    autoCompactAt: 'Autocompact at',
    limits: 'Plan limits',
    five_hour: '5 h',
    seven_day: 'Weekly',
    resets: 'resets',
    cost: 'Cost (API equivalent)',
    recount: 'Exact recount',
    refresh: 'Refresh',
    counting: 'Counting…',
    estimated: 'estimated',
    exact: 'exact',
    updated: 'updated',
    warn: (p: number) => `Context at ${p}%: consider /compact or a new session.`,
    opened: 'Context pane opened.',
    failed: 'Could not read the context usage.',
    band: 'Context',
    details: 'Detail',
    hide: 'Hide',
    noDataShort: 'no data yet',
    guidelines: 'Guidelines',
    skills: 'Skills',
    agents: 'Agents',
    more: (n: number) => `+${n} more`,
    spendLimit: 'Spend limit',
    session: 'Session',
    byModel: 'Usage by model',
    totalTokens: 'Total tokens',
    input: 'Input',
    output: 'Output',
    cacheRead: 'Cache read',
    cacheWrite: 'Cache write',
    approx: (exact: string) => `≈ table prices; exact session total ${exact}`,
  },
  es: {
    title: 'Contexto',
    noData: 'Sin datos aún: aparecen tras la primera respuesta.',
    window: 'ventana',
    free: 'Libre',
    buffer: 'Reserva autocompactación',
    autoCompactAt: 'Autocompacta a',
    limits: 'Límites del plan',
    five_hour: '5 h',
    seven_day: 'Semanal',
    resets: 'reinicia',
    cost: 'Coste (equivalente API)',
    recount: 'Recontar exacto',
    refresh: 'Actualizar',
    counting: 'Contando…',
    estimated: 'estimado',
    exact: 'exacto',
    updated: 'actualizado',
    warn: (p: number) => `Contexto al ${p} %: valora /compact o una sesión nueva.`,
    opened: 'Panel de contexto abierto.',
    failed: 'No se pudo leer el uso de contexto.',
    band: 'Contexto',
    details: 'Detalle',
    hide: 'Ocultar',
    noDataShort: 'sin datos aún',
    guidelines: 'Directrices',
    skills: 'Skills',
    agents: 'Agentes',
    more: (n: number) => `+${n} más`,
    spendLimit: 'Límite de gasto',
    session: 'Sesión',
    byModel: 'Uso por modelo',
    totalTokens: 'Tokens totales',
    input: 'Entrada',
    output: 'Salida',
    cacheRead: 'Lectura de caché',
    cacheWrite: 'Escritura en caché',
    approx: (exact: string) => `≈ precios de tabla; total exacto de la sesión ${exact}`,
  },
} as const

export type Strings = (typeof STRINGS)[Lang]

export const strings = (lang: Lang): Strings => STRINGS[lang]

/** Engine category labels, translated where known; unknown ones pass through. */
const CATEGORY_ES: Record<string, string> = {
  'System prompt': 'Prompt de sistema',
  'System tools': 'Herramientas del sistema',
  'MCP tools': 'Herramientas MCP',
  'MCP server instructions': 'Instrucciones MCP',
  'Custom agents': 'Agentes',
  'Memory files': 'Memoria',
  Skills: 'Skills',
  Messages: 'Mensajes',
  'Free space': 'Libre',
  'Autocompact buffer': 'Reserva autocompactación',
}

export const categoryName = (name: string, lang: Lang): string =>
  lang === 'es' ? (CATEGORY_ES[name] ?? name) : name

/** Picks es/en from an explicit option, the settings' language, or a locale. */
export const pickLang = (
  option: unknown,
  settingsLanguage: unknown,
  locale: string | undefined,
): Lang => {
  if (option === 'es' || option === 'en') return option
  const hint = `${typeof settingsLanguage === 'string' ? settingsLanguage : ''} ${locale ?? ''}`
  return /\b(es|spa|span|españ|castell)/i.test(hint.trim()) ? 'es' : 'en'
}

/** 116000 → "116k", 1200000 → "1.2M", 950 → "950". */
export const kTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return `${Math.round(n)}`
}

/** A text bar of `width` cells, `percent` 0-100 (clamped). */
export const bar = (percent: number, width: number): string => {
  const w = Math.max(4, Math.floor(width))
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * w)
  return '█'.repeat(filled) + '░'.repeat(w - filled)
}

/** Theme key for a usage level against the warning threshold. */
export const levelColor = (percent: number, warn: number): 'success' | 'warning' | 'error' =>
  percent >= Math.max(warn, 90) ? 'error' : percent >= warn ? 'warning' : 'success'

/** Used categories, biggest first, empty ones dropped. */
export const usedCategories = (cats: Category[]): Category[] =>
  cats.filter(c => c.kind === 'used' && c.tokens > 0).sort((a, b) => b.tokens - a.tokens)

/** The file name of a path, either separator. */
export const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/** Sums rows by name and keeps the `top` biggest. */
export const topRows = (rows: Row[], top: number): Row[] => {
  const sums = new Map<string, number>()
  for (const r of rows) sums.set(r.name, (sums.get(r.name) ?? 0) + r.tokens)
  return [...sums]
    .map(([name, tokens]) => ({ name, tokens }))
    .filter(r => r.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, top)
}

/**
 * A memory file's path, short enough to tell files of the same name apart:
 * relative to the project, `~/.claude/…` for the user's own, else as given.
 * Separators become `/`; the comparison ignores case (Windows drive letters).
 */
export const shortPath = (path: string, cwd: string | undefined): string => {
  const p = path.replace(/\\/g, '/')
  const lower = p.toLowerCase()
  const c = (cwd ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (c && lower.startsWith(`${c.toLowerCase()}/`)) return p.slice(c.length + 1)
  const i = lower.indexOf('/.claude/')
  return i > 0 ? `~${p.slice(i)}` : p
}

const ORIGINS = ['Managed', 'User', 'Project', 'Local', 'AutoMem']

const ORIGIN_NAME: Record<Lang, Record<string, string>> = {
  en: { Managed: 'Managed', User: 'User', Project: 'Project', Local: 'Local', AutoMem: 'Auto memory' },
  es: { Managed: 'Gestionado', User: 'Usuario', Project: 'Proyecto', Local: 'Local', AutoMem: 'Memoria auto' },
}

/** The label of a memory file's origin; unknown ones pass through. */
export const originName = (origin: string, lang: Lang): string => ORIGIN_NAME[lang][origin] ?? origin

/** Memory files grouped by origin (managed, user, project, local, auto, then others), biggest first within each. */
export const byOrigin = (rows: MemoryRow[]): { origin: string; tokens: number; rows: Row[] }[] => {
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    if (r.tokens <= 0) continue
    groups.set(r.origin, [...(groups.get(r.origin) ?? []), { name: r.name, tokens: r.tokens }])
  }
  const rank = (o: string) => (ORIGINS.includes(o) ? ORIGINS.indexOf(o) : ORIGINS.length)
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([origin, rs]) => ({
      origin,
      tokens: rs.reduce((n, r) => n + r.tokens, 0),
      rows: rs.sort((a, b) => b.tokens - a.tokens),
    }))
}

/** The `top` biggest rows, and how many rows and tokens are left beyond them. */
export const topWithRest = (rows: Row[], top: number): { shown: Row[]; restCount: number; restTokens: number } => {
  const sorted = rows.filter(r => r.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const rest = sorted.slice(top)
  return { shown: sorted.slice(0, top), restCount: rest.length, restTokens: rest.reduce((n, r) => n + r.tokens, 0) }
}

/** USD per million tokens. `cacheWrite` is the 5-minute write; `long` applies past `longFrom` prompt tokens. */
type Price = { input: number; output: number; cacheWrite: number; cacheRead: number }
type PriceRow = Price & { longFrom?: number; long?: Price }

const p = (input: number, output: number, cacheWrite: number, cacheRead: number): Price => ({
  input,
  output,
  cacheWrite,
  cacheRead,
})

/**
 * First-party API prices (claude-api skill, cached 2026-11-03). Bedrock and
 * Vertex bill their own rates; a model missing here leaves its cost unpriced.
 */
const PRICES: Record<string, PriceRow> = {
  'fable-5-2': p(8, 40, 10, 0.2),
  'mythos-5-2': p(8, 40, 10, 0.2),
  'fable-5-1': p(10, 50, 12.5, 0.25),
  'mythos-5-1': p(10, 50, 12.5, 0.25),
  'fable-5': p(10, 50, 12.5, 1),
  'mythos-5': p(10, 50, 12.5, 1),
  'opus-5-5': p(4, 20, 5, 0.2),
  'opus-5': p(5, 25, 6.25, 0.5),
  'opus-4-8': p(5, 25, 6.25, 0.5),
  'opus-4-7': p(5, 25, 6.25, 0.5),
  'opus-4-6': p(5, 25, 6.25, 0.5),
  'sonnet-5-5': p(2, 10, 2.5, 0.1),
  'sonnet-5': p(2, 10, 2.5, 0.2),
  'sonnet-4-6': p(3, 15, 3.75, 0.3),
  'haiku-5-5': { ...p(0.1, 0.5, 0.125, 0.01), longFrom: 100_000, long: p(0.5, 2.5, 0.625, 0.05) },
  'haiku-4-5': p(1, 5, 1.25, 0.1),
}

/**
 * The price row for a model id as the API reports it (`claude-opus-5-5`,
 * `anthropic.claude-opus-4-6`, a dated `claude-haiku-4-5-20251001`).
 * `opus-5` must not take `opus-5-5`: a short version tail after the key rules
 * it out, an 8-digit date does not.
 */
const priceOf = (model: string): PriceRow | undefined => {
  const id = model.toLowerCase()
  const key = Object.keys(PRICES).find(k => new RegExp(`claude-${k}(?!\\d)(?!-\\d{1,2}(?!\\d))`).test(id))
  return key === undefined ? undefined : PRICES[key]
}

/** One model request's token counts, as `turn.step` reports them. */
export type StepUsage = {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** What one request cost in USD at the table's prices; undefined for a model the table lacks. */
export const stepUsd = (u: StepUsage): number | undefined => {
  const row = priceOf(u.model)
  if (!row) return undefined
  const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const r = row.long && row.longFrom !== undefined && prompt > row.longFrom ? row.long : row
  return (
    (u.input_tokens * r.input +
      u.output_tokens * r.output +
      u.cache_creation_input_tokens * r.cacheWrite +
      u.cache_read_input_tokens * r.cacheRead) /
    1_000_000
  )
}

/** A step added to the session's per-model totals; a model's cost stays priced only while every step was. */
export const addStep = (models: Record<string, ModelSpend>, u: StepUsage): Record<string, ModelSpend> => {
  const prev = models[u.model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, isPriced: true }
  const usd = stepUsd(u)
  return {
    ...models,
    [u.model]: {
      input: prev.input + u.input_tokens,
      output: prev.output + u.output_tokens,
      cacheRead: prev.cacheRead + u.cache_read_input_tokens,
      cacheWrite: prev.cacheWrite + u.cache_creation_input_tokens,
      usd: prev.usd + (usd ?? 0),
      isPriced: prev.isPriced && usd !== undefined,
    },
  }
}

/** A model id without its vendor prefixes: `anthropic.claude-opus-5-5` → `opus-5-5`. */
export const modelShort = (model: string): string => model.replace(/^.*?claude-/i, '')

export type Currency = { code: 'eur' | 'usd'; usdToEur: number }

/** An amount in USD shown in the chosen currency: "3,42 €" in Spanish, "€3.42" in English; three decimals under 0.10. */
export const money = (usd: number, c: Currency, lang: Lang): string => {
  const n = c.code === 'eur' ? usd * c.usdToEur : usd
  const text = n.toFixed(Math.abs(n) < 0.1 ? 3 : 2)
  const sign = c.code === 'eur' ? '€' : '$'
  return lang === 'es' ? `${text.replace('.', ',')} ${sign}` : `${sign}${text}`
}

export type Billing = 'plan' | 'api' | 'unknown'

/**
 * How the session is paid for: a subscription reports the 5-hour and weekly
 * windows with every response, an API key none; until a response, unknown.
 */
export const billingOf = (option: unknown, limits: { kind: string }[], hasResponse: boolean): Billing => {
  if (option === 'plan' || option === 'api') return option
  if (limits.some(l => l.kind === 'five_hour' || l.kind === 'seven_day')) return 'plan'
  return hasResponse ? 'api' : 'unknown'
}

/** Whether a reading should raise the warning, and the armed flag after it. */
export const warnStep = (
  percent: number | undefined,
  warn: number,
  isWarned: boolean,
): { toast: boolean; isWarned: boolean } => {
  if (percent === undefined) return { toast: false, isWarned }
  if (percent >= warn) return { toast: !isWarned, isWarned: true }
  return { toast: false, isWarned: false }
}

/** Label for a rate-limit window kind (`five_hour`, `seven_day`, others as given). */
export const limitName = (kind: string, lang: Lang): string => {
  const t = strings(lang)
  if (kind === 'five_hour') return t.five_hour
  if (kind === 'seven_day') return t.seven_day
  if (kind === 'spend_limit') return t.spendLimit
  return kind
}

/** "14:05" from an ISO timestamp, or '' when it does not parse. */
export const clock = (iso: string | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const WEEKDAYS: Record<Lang, readonly string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
}

/**
 * When a window resets, seen from `now` (ms): the hour alone within the next
 * 24 h, where it cannot be mistaken; the weekday and hour further out.
 */
export const resetTime = (iso: string | undefined, now: number, lang: Lang): string => {
  const hm = clock(iso)
  if (!hm) return ''
  const d = new Date(iso as string)
  if (d.getTime() - now < 24 * 60 * 60 * 1000) return hm
  return `${WEEKDAYS[lang][d.getDay()]} ${hm}`
}

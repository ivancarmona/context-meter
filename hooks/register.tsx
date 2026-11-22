import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { Detail, Lang, Snapshot, Spend } from '../types'
import type { Billing, Currency } from './format'
import {
  addStep,
  bar,
  billingOf,
  modelShort,
  money,
  byOrigin,
  categoryName,
  clock,
  kTokens,
  levelColor,
  limitName,
  originName,
  pickLang,
  resetTime,
  shortPath,
  strings,
  topRows,
  topWithRest,
  usedCategories,
  warnStep,
} from './format'

const PANE = 'context-meter'
const COMMAND = 'context-meter'

// Bump the shape tag whenever Snapshot's fields change: a value an earlier
// version stored outlives a reload and is then declined, not misread.
const snapshot = atom({ plugin: 'context-meter', key: 'snapshot' } as const, null, { shape: 'snapshot-2' })
const isWarned = atom({ plugin: 'context-meter', key: 'isWarned' } as const, false)
const isPlaced = atom({ plugin: 'context-meter', key: 'isPlaced' } as const, true)
const isBusy = atom({ plugin: 'context-meter', key: 'isBusy' } as const, false)
const isOpen = atom({ plugin: 'context-meter', key: 'isOpen' } as const, false)
// Sections the person unfolded or folded, by key; unset ones follow DEFAULT_OPEN.
const sections = atom({ plugin: 'context-meter', key: 'sections' } as const, {} as Record<string, boolean>)

// Tokens and table-priced cost per model, summed from every model request
// (`turn.step`, subagents' included) of the session `startedAt` names.
const spend = atom({ plugin: 'context-meter', key: 'spend' } as const, { startedAt: null, models: {} } as Spend, {
  shape: 'spend-1',
})

// Sections open until folded; every other section starts folded.
const DEFAULT_OPEN: Record<string, boolean> = { guide: true, spend: true }

const isUnfolded = (m: Record<string, boolean>, key: string): boolean => m[key] ?? DEFAULT_OPEN[key] ?? false

async function toggleSection($: EngineInterface, key: string): Promise<void> {
  await update($, sections, m => ({ ...m, [key]: !isUnfolded(m, key) }))
}

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

type Shown = {
  showCost: boolean
  showRateLimits: boolean
  busy: boolean
  width: number
  sections: Record<string, boolean>
  spend: Spend
  onRefresh: () => void
  onRecount: () => void
  onToggle: (key: string) => void
}

const systemLocale = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}

const hasData = (s: Snapshot | null): s is Snapshot & { percent: number; tokens: number } =>
  s !== null && s.percent !== undefined && s.tokens !== undefined

// Module-level settings: register() runs again on every reload and resets them.
let warnPercent = 80
let lang: Lang = 'en'
// The session's folder, for memory-file paths relative to the project.
let cwd: string | undefined
let currency: Currency = { code: 'eur', usdToEur: 0.86 }
// The `billing` option: auto, plan or api.
let billingOption: unknown = 'auto'

const billing = (s: Snapshot | null): Billing => billingOf(billingOption, s?.limits ?? [], hasData(s))

// Windows a subscription reports; on API billing they are left out.
const isPlanLimit = (kind: string) => kind === 'five_hour' || kind === 'seven_day'

// Reads the window and stores a snapshot; the write redraws the pane and band.
async function refresh($: EngineInterface, detail: Detail): Promise<void> {
  const usage = await $.session.usage({ breakdown: detail })
  const ctx = usage.context
  const b = ctx.breakdown
  const next: Snapshot = {
    at: await $.clock.now(),
    detail,
    window: ctx.window,
    tokens: ctx.tokens ?? b?.totalTokens,
    percent: ctx.percent ?? b?.percentage,
    categories: (b?.categories ?? []).map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
    memory: (b?.memoryFiles ?? []).map(m => ({ name: shortPath(m.path, cwd), origin: m.type, tokens: m.tokens })),
    skills: (b?.skills?.skillFrontmatter ?? []).map(k => ({ name: k.name, tokens: k.tokens })),
    skillsTokens: b?.skills?.tokens,
    agents: (b?.agents ?? []).map(a => ({ name: a.agentType, tokens: a.tokens })),
    mcp: (b?.mcpTools ?? []).filter(t => t.isLoaded).map(t => ({ name: t.serverName, tokens: t.tokens })),
    limits: usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    costUsd: usage.cost?.usd,
    autoCompactAt: b?.autoCompactThreshold,
  }
  await update($, snapshot, () => next)

  const was = await read($, isWarned)
  const step = warnStep(ctx.percent, warnPercent, was)
  if (step.isWarned !== was) await update($, isWarned, () => step.isWarned)
  if (step.toast && ctx.percent !== undefined) $.ui.toast(strings(lang).warn(Math.round(ctx.percent)))
}

// Refreshes with the busy flag up, so the recount button says it is counting.
async function refreshBusy($: EngineInterface, detail: Detail): Promise<void> {
  await update($, isBusy, () => true)
  try {
    await refresh($, detail)
  } finally {
    await update($, isBusy, () => false)
  }
}

async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: PANE, title: strings(lang).title })
  await update($, isPlaced, () => opened.isPlaced)
  await update($, isOpen, () => true)
}

async function togglePane($: EngineInterface): Promise<void> {
  if (await read($, isOpen)) {
    await $.ui.close({ id: PANE })
    await update($, isOpen, () => false)
  } else {
    await openPane($)
  }
}

/** A row's right-hand figure: a token count, or text already formatted (an amount). */
type Figure = number | string

type Rows = {
  line: (name: string, value: Figure, indent?: string, isPath?: boolean) => JSX.Element
  /** A foldable row: ▸ folded, ▾ unfolded; pressing it flips the section `key`. */
  head: (key: string, name: string, value: Figure) => JSX.Element
  isUnfolded: (key: string) => boolean
}

// API billing: tokens and money per model this session, each model folding
// into its four token kinds. The heading carries the exact session total from
// the engine's ledger; the rows are table prices, marked ≈ when they drift.
function byModel(els: Els, s: Snapshot, sp: Spend, { line, head, isUnfolded: unfolded }: Rows) {
  const { Box, Text } = els
  const t = strings(lang)
  const models = Object.entries(sp.models).sort(([, a], [, b]) => b.usd - a.usd)
  if (models.length === 0 && s.costUsd === undefined) return null
  const tableUsd = models.reduce((n, [, m]) => n + m.usd, 0)
  const isPriced = models.every(([, m]) => m.isPriced)
  const exact = s.costUsd ?? tableUsd
  const drifts = !isPriced || (exact > 0 && Math.abs(tableUsd - exact) / exact > 0.05)
  const tokens = models.reduce((n, [, m]) => n + m.input + m.output + m.cacheRead + m.cacheWrite, 0)
  const cash = (usd: number) => money(usd, currency, lang)

  return (
    <Box flexDirection="column">
      {head('spend', t.byModel, cash(exact))}
      {unfolded('spend') && (
        <Box flexDirection="column" paddingLeft={1}>
          {line(t.totalTokens, tokens)}
          {models.flatMap(([id, m]) => {
            const key = `model:${id}`
            return [
              head(key, `${drifts ? '≈ ' : ''}${modelShort(id)}`, m.isPriced ? cash(m.usd) : '—'),
              ...(unfolded(key)
                ? [
                    line(t.input, m.input, '  '),
                    line(t.output, m.output, '  '),
                    line(t.cacheRead, m.cacheRead, '  '),
                    line(t.cacheWrite, m.cacheWrite, '  '),
                  ]
                : []),
            ]
          })}
          {drifts && models.length > 0 && <Text dimColor>{t.approx(cash(exact))}</Text>}
        </Box>
      )}
    </Box>
  )
}

// What the standing instructions cost: every memory file by origin, then the
// skill and agent listings, five of each and a line for the rest. Each part folds.
function guidelines(els: Els, s: Snapshot, { line, head, isUnfolded: unfolded }: Rows) {
  const { Box } = els
  const t = strings(lang)
  const groups = byOrigin(s.memory)
  const skills = topWithRest(s.skills, 5)
  const agents = topWithRest(s.agents, 5)
  const sum = (rows: { tokens: number }[]) => rows.reduce((n, r) => n + r.tokens, 0)
  const skillsTokens = s.skillsTokens ?? sum(s.skills)
  const agentsTokens = sum(s.agents)
  const total = sum(groups) + skillsTokens + agentsTokens
  if (total <= 0) return null

  const listing = (key: string, label: string, tokens: number, part: ReturnType<typeof topWithRest>) =>
    part.shown.length === 0
      ? []
      : [
          head(key, label, tokens),
          ...(unfolded(key)
            ? [
                ...part.shown.map(r => line(r.name, r.tokens, '  ')),
                ...(part.restCount > 0 ? [line(t.more(part.restCount), part.restTokens, '  ')] : []),
              ]
            : []),
        ]

  return (
    <Box flexDirection="column">
      {head('guide', t.guidelines, total)}
      {unfolded('guide') && (
        <Box flexDirection="column" paddingLeft={1}>
          {groups.flatMap(g => {
            const key = `origin:${g.origin}`
            return [
              head(key, originName(g.origin, lang), g.tokens),
              ...(unfolded(key) ? g.rows.map(r => line(r.name, r.tokens, '  ', true)) : []),
            ]
          })}
          {listing('skills', t.skills, skillsTokens, skills)}
          {listing('agents', t.agents, agentsTokens, agents)}
        </Box>
      )}
    </Box>
  )
}

// The full breakdown: drawn in the pane, or under the band where no pane is seated.
function detailView(els: Els, s: Snapshot | null, o: Shown) {
  const { Box, Text, Button } = els
  const t = strings(lang)
  const buttons = (
    <Box flexDirection="row" gap={1}>
      <Button key="refresh" variant="secondary" label={t.refresh} onPress={o.onRefresh} />
      <Button key="recount" variant="secondary" label={o.busy ? t.counting : t.recount} onPress={o.onRecount} />
    </Box>
  )

  if (!hasData(s)) {
    return (
      <Box flexDirection="column">
        <Text dimColor>{t.noData}</Text>
        {buttons}
      </Box>
    )
  }

  const pct = Math.round(s.percent)
  const label = ` ${pct} %  ${kTokens(s.tokens)}/${kTokens(s.window)}`
  const used = usedCategories(s.categories)
  const free = s.categories.find(c => c.kind === 'free')
  const buffer = s.categories.find(c => c.kind === 'buffer')
  const mcp = topRows(s.mcp, 5)
  // Names are cut by the surface, which knows the real width (VS Code's pane is
  // wider than its columns say). `isPath` cuts a long name from the start, so the file name stays visible.
  const figure = (value: Figure) => (typeof value === 'number' ? kTokens(value) : value)
  const line = (name: string, value: Figure, indent = '', isPath = false) => (
    <Box flexDirection="row" justifyContent="space-between" gap={1}>
      <Box paddingLeft={indent === '' ? 0 : 2} flexShrink={1}>
        <Text dimColor={indent !== ''} wrap={isPath ? 'truncate-start' : 'truncate-end'}>
          {name}
        </Text>
      </Box>
      <Text tabular dimColor={indent !== ''}>
        {figure(value)}
      </Text>
    </Box>
  )
  const unfolded = (key: string) => isUnfolded(o.sections, key)
  // Only the glyph is a control, small and quiet, right after the name: a
  // desktop surface draws every Button as a native one, border and all, so a
  // whole-row button, or one leading the name, would shout in the list; and
  // after the tokens it would push their column out of line.
  const head = (key: string, name: string, value: Figure) => (
    <Box flexDirection="row" justifyContent="space-between" gap={1}>
      <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1}>
        <Text wrap="truncate-end">{name}</Text>
        <Button
          key={`section:${key}`}
          plain
          dimColor
          variant="secondary"
          label={unfolded(key) ? '▾' : '▸'}
          onPress={() => o.onToggle(key)}
        />
      </Box>
      <Text tabular>{figure(value)}</Text>
    </Box>
  )
  const rows: Rows = { line, head, isUnfolded: unfolded }
  const isApi = billing(s) === 'api'
  // On API billing the plan windows mean nothing; a gateway's spend limit still does.
  const limits = s.limits.filter(l => !(isApi && isPlanLimit(l.kind)))

  return (
    <Box flexDirection="column">
      <Text mono color={levelColor(pct, warnPercent)}>
        {bar(pct, o.width - label.length)}
        {label}
      </Text>
      <Text dimColor>
        {s.detail === 'full' ? t.exact : t.estimated} · {t.updated} {clock(new Date(s.at).toISOString())}
      </Text>
      {buttons}
      <Box flexDirection="column">
        {used.flatMap(c =>
          c.name === 'MCP tools' && mcp.length > 0
            ? [
                head('mcp', categoryName(c.name, lang), c.tokens),
                ...(unfolded('mcp') ? mcp.map(m => line(m.name, m.tokens, '  ')) : []),
              ]
            : [line(categoryName(c.name, lang), c.tokens)],
        )}
        {free && line(t.free, free.tokens)}
        {buffer && buffer.tokens > 0 && line(t.buffer, buffer.tokens)}
      </Box>
      {s.autoCompactAt !== undefined && (
        <Text dimColor>
          {t.autoCompactAt} {kTokens(s.autoCompactAt)}
        </Text>
      )}
      {guidelines(els, s, rows)}
      {isApi && byModel(els, s, o.spend, rows)}
      {o.showRateLimits && limits.length > 0 && (
        <Box flexDirection="column">
          <Text bold>{t.limits}</Text>
          {limits.map(l => (
            <Text color={levelColor(l.percentUsed, warnPercent)}>
              {limitName(l.kind, lang)}: {l.percentUsed} %
              {l.resetsAt ? ` (${t.resets} ${resetTime(l.resetsAt, s.at, lang)})` : ''}
            </Text>
          ))}
        </Box>
      )}
      {o.showCost && !isApi && s.costUsd !== undefined && (
        <Text dimColor>
          {t.cost}: {money(s.costUsd, currency, lang)}
        </Text>
      )}
    </Box>
  )
}

export const register: Register = (on, options) => {
  warnPercent = typeof options.warnPercent === 'number' ? options.warnPercent : 80
  lang = pickLang(options.language, undefined, systemLocale())
  const showCost = options.showCost === true
  const showRateLimits = options.showRateLimits !== false
  const openPaneOnStart = options.openPaneOnStart === true
  const placement = options.placement === 'footer' || options.placement === 'above' ? options.placement : 'auto'
  billingOption = options.billing
  currency = {
    code: options.currency === 'usd' ? 'usd' : 'eur',
    usdToEur: typeof options.usdToEur === 'number' && options.usdToEur > 0 ? options.usdToEur : 0.86,
  }
  // On API billing the summary carries the session's exact cost in place of the plan windows.
  const sessionCost = (s: Snapshot | null): string =>
    billing(s) === 'api' && s?.costUsd !== undefined
      ? ` · ${strings(lang).session} ${money(s.costUsd, currency, lang)}`
      : ''
  // One home for the summary per surface: the prompt footer where it is drawn
  // (terminal, desktop) under 'auto', the band above the prompt elsewhere.
  const inFooter = placement !== 'above'
  const footerOn = (surface: string) =>
    placement === 'footer' || (placement === 'auto' && (surface === 'terminal' || surface === 'desktop'))
  // Each percentage alone in its level's colour; the rest of the line stays dim.
  const pctText = (Text: Els['Text'], value: number) => (
    <Text color={levelColor(value, warnPercent)}>{value} %</Text>
  )

  // Compact summary in the prompt footer, beside the engine's own mode labels.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!inFooter) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = strings(lang)
    const s = await read($, snapshot)
    const open = await read($, isOpen)
    const engine = e.props.modes.length > 0 ? await next(e) : null
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        {engine}
        {hasData(s) ? (
          <Text dimColor>
            {pctText(Text, Math.round(s.percent))} · {kTokens(s.tokens)}/{kTokens(s.window)}
            {sessionCost(s)}
          </Text>
        ) : (
          <Text dimColor>{t.noDataShort}</Text>
        )}
        <Button key="toggle" plain dimColor label={open ? t.hide : t.details} onPress={() => void togglePane($)} />
      </Box>
    )
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    cwd = e.cwd
    let configured: unknown
    try {
      configured = await $.settings.read({ key: 'language' })
    } catch {
      configured = undefined
    }
    lang = pickLang(options.language, configured, systemLocale())
    await $.command.register({ name: COMMAND, description: 'Open or close the context-meter detail pane' })
    // Clears the status line an earlier version left pinned.
    $.ui.status(undefined)
    if (openPaneOnStart) {
      void openPane($)
    } else {
      // After a reload the engine may still hold the pane open: follow it.
      const up = (await $.ui.panes()).some(p => p.id === PANE)
      await update($, isOpen, () => up)
    }
    void refresh($, 'summary')
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      await refresh($, 'summary')
    } catch {
      // A failed reading leaves the last snapshot on screen; the turn is unaffected.
    }
    return result
  })

  // Every model request, the main loop's and subagents', adds its tokens and
  // table-priced cost to its model. A new session (another `startedAt`, as after
  // /clear) starts the totals over; a reload keeps them.
  // A streaming event: the chunks pass through untouched, the totals move once the response is in.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    try {
      const u = result.usage
      if (u) {
        const { startedAt } = await $.session.usage()
        await update($, spend, sp => ({
          startedAt,
          models: addStep(sp.startedAt === startedAt ? sp.models : {}, u),
        }))
      }
    } catch {
      // A step the totals miss shows as drift against the ledger, never as a failed turn.
    }
    return result
  })

  on('command.run', { command: COMMAND }, async $ => {
    await openPane($)
    await refresh($, 'summary')
    return { text: strings(lang).opened }
  }).catch(() => ({ text: strings(lang).failed }))

  // The person closing the pane from its own mark or key.
  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) await update($, isOpen, () => false)
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    return detailView(els, await read($, snapshot), {
      showCost,
      showRateLimits,
      busy: await read($, isBusy),
      width: Math.max(20, e.props.bodyColumns),
      sections: await read($, sections),
      spend: await read($, spend),
      onRefresh: () => void refreshBusy($, 'summary'),
      onRecount: () => void refreshBusy($, 'full'),
      onToggle: key => void toggleSection($, key),
    })
  })

  // Always-on summary above the prompt, with a button for the detail.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // With the summary in the footer, the band only carries the unfolded detail.
    const footer = footerOn(e.surface)
    if (footer && !((await read($, isOpen)) && !(await read($, isPlaced)))) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const t = strings(lang)
    const s = await read($, snapshot)
    const open = await read($, isOpen)
    const placed = await read($, isPlaced)

    const summary = hasData(s) ? (
      <Text dimColor wrap="truncate-end">
        {t.band} {pctText(Text, Math.round(s.percent))} · {kTokens(s.tokens)}/{kTokens(s.window)}
        {sessionCost(s)}
        {showRateLimits &&
          s.limits
            .filter(l => !(billing(s) === 'api' && isPlanLimit(l.kind)))
            .flatMap(l => [` · ${limitName(l.kind, lang)} `, pctText(Text, l.percentUsed)])}
      </Text>
    ) : (
      <Text dimColor>
        {t.band}: {t.noDataShort}
      </Text>
    )

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {summary}
          <Button key="toggle" variant="secondary" label={open ? t.hide : t.details} onPress={() => void togglePane($)} />
        </Box>
        {open &&
          !placed &&
          detailView(els, s, {
            showCost,
            showRateLimits,
            busy: await read($, isBusy),
            width: Math.max(20, Math.min(60, e.props.bodyColumns)),
            sections: await read($, sections),
            spend: await read($, spend),
            onRefresh: () => void refreshBusy($, 'summary'),
            onRecount: () => void refreshBusy($, 'full'),
            onToggle: key => void toggleSection($, key),
          })}
      </Box>
    )
  })
}

import { expect, test } from 'claude-code/testing'

import { stepUsd } from '../hooks/format'

const PANE = {
  plugin: 'context-meter',
  component: 'Pane',
  requestId: 'context-meter',
  props: {
    title: 'Context',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'context-meter',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const EN = { options: { language: 'en' } } as const
const ABOVE = { options: { language: 'en', placement: 'above' } } as const

const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

type Limits = { kind: string; percentUsed: number; resetsAt?: string }[]

// A usage reading at `percent` of a 200k window, with a small breakdown.
const usage = (
  percent: number,
  rateLimits: Limits = [{ kind: 'five_hour', percentUsed: 34 }],
  extra: object = {},
  costUsd?: number,
) => ({
  ...(costUsd === undefined ? {} : { cost: { usd: costUsd } }),
  startedAt: 0,
  context: {
    tokens: percent * 2000,
    window: 200_000,
    percent,
    breakdown: {
      categories: [
        { name: 'Messages', tokens: percent * 1500, color: 'x', isDeferred: false, kind: 'used' },
        { name: 'Memory files', tokens: percent * 500, color: 'x', isDeferred: false, kind: 'used' },
        { name: 'Free space', tokens: 200_000 - percent * 2000, color: 'x', isDeferred: false, kind: 'free' },
      ],
      totalTokens: percent * 2000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autocompactSource: 'auto',
      percentage: percent,
      gridRows: [],
      model: 'test',
      memoryFiles: [{ path: '/home/someone/project/CLAUDE.md', type: 'Project', tokens: percent * 500 }],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: true,
      apiUsage: null,
      ...extra,
    },
  },
  rateLimits,
})

// Stands for the engine beneath the plugin; `readings` are served in order.
const engine = (
  on: any,
  readings: number[],
  placed = true,
  at: { now?: number; limits?: Limits; breakdown?: object; costUsd?: number; steps?: object[] } = {},
) => {
  const steps = [...(at.steps ?? [])]
  on('turn.step', async function* (_: unknown, e: { turnId: string; index: number }) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: steps.shift() ?? null,
    }
  })
  const calls: { breakdown?: string }[] = []
  const toasts: string[] = []
  let i = 0
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('settings.read', () => ({ value: {} }))
  on('command.register', () => ({ value: { command: 'context-meter' } }))
  const opened: string[] = []
  on('ui.open', (_: unknown, e: { id: string }) => {
    opened.push(e.id)
    return { value: { isPlaced: placed } }
  })
  on('ui.panes', () => ({ value: [] }))
  const statuses: (string | undefined)[] = []
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.close', () => undefined)
  on('clock.now', () => ({ value: at.now ?? 0 }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.usage', (_: unknown, e: { breakdown?: string }) => {
    calls.push({ breakdown: e?.breakdown })
    const p = readings[Math.min(i, readings.length - 1)] ?? 0
    i += 1
    return { value: usage(p, at.limits, at.breakdown, at.costUsd) }
  })
  return { calls, toasts, opened, statuses }
}

test('before any answer the pane says there is no data yet, on every surface', EN, async ($, on) => {
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /No data yet/ }))?.text).toContain('No data yet')
    await ui.unmount()
  }
})

test('after a turn the pane shows the percentage and the categories', EN, async ($, on) => {
  engine(on, [58])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /58 %/ }))?.text).toContain('116k/200k')
    expect(await ui.find({ type: 'Text', text: /Messages/ })).toBeDefined()
    if (surface === 'terminal') await ui.press({ key: 'section:origin:Project' })
    expect(await ui.find({ type: 'Text', text: /CLAUDE\.md/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5 h: 34 %/ })).toBeDefined()
    await ui.unmount()
  }
})

test('Spanish labels when the language option is es', { options: { language: 'es' } }, async ($, on) => {
  engine(on, [58])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /Mensajes/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Libre/ })).toBeDefined()
  await ui.unmount()
})

test('a reset more than a day away carries its weekday; a nearer one, the hour alone', { options: { language: 'es' } }, async ($, on) => {
  // Saturday 21 Nov 2026, 23:05 local; resets on Sunday 04:00 and Thursday 15:00.
  const now = new Date(2026, 10, 21, 23, 5).getTime()
  engine(on, [58], true, {
    now,
    limits: [
      { kind: 'five_hour', percentUsed: 6, resetsAt: new Date(2026, 10, 22, 4, 0).toISOString() },
      { kind: 'seven_day', percentUsed: 49, resetsAt: new Date(2026, 10, 26, 15, 0).toISOString() },
    ],
  })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.complete(TURN)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /^5 h:/ }))?.text).toContain('(reinicia 04:00)')
  expect((await ui.find({ type: 'Text', text: /^Semanal:/ }))?.text).toContain('(reinicia jue 15:00)')
  await ui.unmount()
})

test('guidelines list every memory file by origin with a telling path, then skills and agents', { options: { language: 'es' } }, async ($, on) => {
  engine(on, [58], true, {
    breakdown: {
      memoryFiles: [
        { path: 'C:\\Users\\someone\\.claude\\CLAUDE.md', type: 'User', tokens: 1200 },
        { path: 'c:\\work\\app\\CLAUDE.md', type: 'Project', tokens: 3100 },
        { path: 'C:\\work\\app\\docs\\estilo.md', type: 'Project', tokens: 2600 },
      ],
      skills: {
        totalSkills: 7,
        includedSkills: 7,
        tokens: 7000,
        skillFrontmatter: [1, 2, 3, 4, 5, 6, 7].map(n => ({ name: `skill-${n}`, source: 'userSettings', tokens: n * 100 })),
      },
      agents: [{ agentType: 'revisor', source: 'projectSettings', tokens: 300 }],
    },
  })
  await $.session.start({ cwd: 'C:\\work\\app', surface: 'vscode', isInteractive: true })
  await $.turn.complete(TURN)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^Directrices$/ })).toBeDefined()
  for (const key of ['origin:User', 'origin:Project', 'skills', 'agents']) await ui.press({ key: `section:${key}` })
  expect(await ui.find({ type: 'Text', text: /^Usuario$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /~\/\.claude\/CLAUDE\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Proyecto$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\s*CLAUDE\.md$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /docs\/estilo\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /skill-7/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /skill-1$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\+2 más/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /revisor/ })).toBeDefined()
  await ui.unmount()
})

test('each part with detail folds: folded at first, the guidelines heading open', EN, async ($, on) => {
  engine(on, [58], true, {
    breakdown: {
      skills: {
        totalSkills: 1,
        includedSkills: 1,
        tokens: 500,
        skillFrontmatter: [{ name: 'dataviz', source: 'userSettings', tokens: 482 }],
      },
    },
  })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.complete(TURN)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  // Only the glyph is a Button; the name beside it is text.
  expect(await ui.find({ type: 'Button', text: /^▸$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Skills/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Skills$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /dataviz/ })).toBeUndefined()
  await ui.press({ key: 'section:skills' })
  expect(await ui.find({ type: 'Text', text: /dataviz/ })).toBeDefined()
  await ui.press({ key: 'section:skills' })
  expect(await ui.find({ type: 'Text', text: /dataviz/ })).toBeUndefined()

  await ui.press({ key: 'section:guide' })
  expect(await ui.find({ type: 'Text', text: /^Guidelines$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Skills$/ })).toBeUndefined()
  await ui.unmount()
})

// Two requests: Opus 5.5 with a large cache read, a small Haiku 5.5 one.
const STEPS = [
  {
    model: 'claude-opus-5-5',
    input_tokens: 1000,
    output_tokens: 2000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 10_000,
  },
  { model: 'claude-haiku-5-5', input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
]
// Opus: (1000·4 + 2000·20 + 10000·5 + 1e6·0.2) / 1e6 = 0.294 USD; Haiku: 0.0001 USD.
const STEPS_USD = 0.2941

const runSteps = async ($: any) => {
  for (const index of [0, 1]) {
    const stream = $.turn.step({ turnId: 't', index, model: 'x', messageCount: 1 })
    for await (const _ of stream);
    await stream.result
  }
}

test('without plan windows the session is API-billed: cost in the band, usage by model in the pane', { options: { language: 'es' } }, async ($, on) => {
  engine(on, [5], true, { limits: [], costUsd: STEPS_USD, steps: STEPS })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await runSteps($)
  await $.turn.complete(TURN)

  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await band.find({ type: 'Text', text: /Contexto 5 %/ }))?.text).toContain('Sesión 0,25 €')
  await band.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^Uso por modelo$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^opus-5-5$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^haiku-5-5$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /≈/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Límites del plan/ })).toBeUndefined()
  await ui.press({ key: 'section:model:claude-opus-5-5' })
  expect(await ui.find({ type: 'Text', text: /^Lectura de caché$/ })).toBeDefined()
  await ui.unmount()
})

test('per-model rows are marked ≈ when table prices drift from the exact total', { options: { language: 'es' } }, async ($, on) => {
  engine(on, [5], true, { limits: [], costUsd: STEPS_USD * 2, steps: STEPS })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await runSteps($)
  await $.turn.complete(TURN)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^≈ opus-5-5$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /total exacto de la sesión 0,51 €/ })).toBeDefined()
  await ui.unmount()
})

test('on a subscription the pane keeps the plan limits and shows no usage by model', EN, async ($, on) => {
  engine(on, [5], true, { costUsd: STEPS_USD, steps: STEPS })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await runSteps($)
  await $.turn.complete(TURN)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /Usage by model/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /5 h: 34 %/ })).toBeDefined()
  await ui.unmount()
})

test('prices: each model id finds its own row, dated or prefixed; Haiku 5.5 bills long prompts higher', EN, async () => {
  const one = (model: string, input: number) =>
    stepUsd({ model, input_tokens: input, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  expect(one('claude-opus-5-5', 1_000_000)).toBe(4)
  expect(one('claude-opus-5', 1_000_000)).toBe(5)
  expect(one('anthropic.claude-opus-4-6', 1_000_000)).toBe(5)
  expect(one('claude-haiku-4-5-20251001', 1_000_000)).toBe(1)
  expect(Math.round((one('claude-haiku-5-5', 100_000) ?? 0) * 1e6)).toBe(10_000)
  expect(Math.round((one('claude-haiku-5-5', 200_000) ?? 0) * 1e6)).toBe(100_000)
  expect(one('some-other-model', 1_000_000)).toBeUndefined()
})

test('the warning toasts once per crossing and re-arms below the threshold', EN, async ($, on) => {
  const { toasts } = engine(on, [10, 85, 90, 50, 82])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (let n = 0; n < 4; n += 1) await $.turn.complete(TURN)

  expect(toasts.length).toBe(2)
  expect(toasts[0]).toContain('85%')
})

test('the exact recount asks for the full breakdown', EN, async ($, on) => {
  const { calls } = engine(on, [40])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'recount' })
  expect(calls.some(c => c.breakdown === 'full')).toBe(true)
  await ui.unmount()
})

test('the band above the prompt always shows the summary and a Detail button', ABOVE, async ($, on) => {
  engine(on, [58])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /Context 58 %/ }))?.text).toContain('116k/200k')
    expect(await ui.find({ type: 'Text', text: /5 h 34 %/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /Detail/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the pane does not open by itself; the Detail button opens it', ABOVE, async ($, on) => {
  const { opened } = engine(on, [58])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)
  expect(opened.length).toBe(0)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'toggle' })
  expect(opened).toEqual(['context-meter'])
  expect(await ui.find({ type: 'Button', text: /Hide/ })).toBeDefined()
  await ui.unmount()
})

test('openPaneOnStart opens the pane when the session starts', { options: { language: 'en', openPaneOnStart: true } }, async ($, on) => {
  const { opened } = engine(on, [58])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)
  expect(opened).toEqual(['context-meter'])
})

test('where no surface seats the pane, the detail unfolds under the band', ABOVE, async ($, on) => {
  engine(on, [58], false)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Messages/ })).toBeUndefined()
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /Messages/ })).toBeDefined()
  await ui.unmount()
})

const FOOTER = {
  plugin: 'context-meter',
  component: 'SessionMode',
  props: { modes: [] },
} as const

test('auto: the footer carries the summary on desktop, the band on vscode, never the status line', EN, async ($, on) => {
  const { opened, statuses } = engine(on, [58])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)
  expect(statuses.filter(s => s !== undefined)).toEqual([])

  const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect(await footer.find({ type: 'Text', text: /58 %/ })).toBeDefined()
  await footer.press({ key: 'toggle' })
  expect(opened).toEqual(['context-meter'])
  await footer.unmount()

  const desktopBand = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desktopBand.find({ type: 'Text', text: /Context 58 %/ })).toBeUndefined()
  await desktopBand.unmount()
  const vscodeBand = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await vscodeBand.find({ type: 'Text', text: /Context 58 %/ })).toBeDefined()
  // The footer's toggle opened the pane above, so the band offers to hide it.
  expect(await vscodeBand.find({ type: 'Button', text: /Hide/ })).toBeDefined()
  await vscodeBand.unmount()
})

test('only the percentages carry a colour; the rest of the band is dim', ABOVE, async ($, on) => {
  engine(on, [58])
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.complete(TURN)
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await band.find({ type: 'Text', text: /^58 %$/ }))?.props.color).toBe('success')
  expect((await band.find({ type: 'Text', text: /^34 %$/ }))?.props.color).toBe('success')
  expect((await band.find({ type: 'Text', text: /Context 58 %/ }))?.props.dimColor).toBe(true)
  await band.unmount()
})

test('placement footer: the footer carries the summary and a toggle', { options: { language: 'en', placement: 'footer' } }, async ($, on) => {
  const { opened, statuses } = engine(on, [58])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)
  expect(statuses.filter(s => s !== undefined)).toEqual([])

  const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect((await footer.find({ type: 'Text', text: /58 %/ }))?.text).toContain('116k/200k')
  await footer.press({ key: 'toggle' })
  expect(opened).toEqual(['context-meter'])
  await footer.unmount()
})

test('placement footer drops the band on every surface', { options: { language: 'en', placement: 'footer' } }, async ($, on) => {
  engine(on, [58])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: /Context 58 %/ })).toBeUndefined()
    await band.unmount()
  }
})

test('placement above keeps the band and leaves the footer alone', { options: { language: 'en', placement: 'above' } }, async ($, on) => {
  engine(on, [58])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)

  const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect(await footer.find({ type: 'Text', text: /58 %/ })).toBeUndefined()
  await footer.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /Context 58 %/ })).toBeDefined()
  await band.unmount()
})

test('placement above shows the band and leaves the status line alone, so nothing shows twice', ABOVE, async ($, on) => {
  const { statuses } = engine(on, [58])
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.turn.complete(TURN)
  expect(statuses.filter(s => s !== undefined)).toEqual([])
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await band.find({ type: 'Text', text: /Context 58 %/ })).toBeDefined()
  await band.unmount()
})

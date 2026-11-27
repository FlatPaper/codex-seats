import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'codex-seats',
  component: 'Pane',
  requestId: 'codex-seats',
  props: {
    title: 'Codex seats',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const COMMAND =
  '"/p/skills/codex-seat/scripts/codex-run.sh" /repo gpt-6.1-terra high /s/codex-review.md read-only --agent "/agents/review prompts/reviewer.md"'

test('an agent named read-only appears as a writing seat', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' },
  }))

  await $.tool.call({
    tool: 'Bash',
    command: '"/p/skills/codex-seat/scripts/codex-run.sh" /repo gpt-6.1-terra high /s/brief.md --agent read-only',
    run_in_background: true,
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /gpt-6.1-terra/ }))?.text).toBe(
    '  gpt-6.1-terra · high · write · read-only',
  )
  await ui.unmount()
})

test('a codex-run.sh call becomes a seat, and its notification ends it', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  let callId = ''
  on('tool.call', (_, e) => {
    callId = e.tool_use_id
    return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }
  })

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({
    tool: 'Bash',
    command: COMMAND,
    description: 'Codex: review PR 56',
    run_in_background: true,
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /review PR 56/ }))?.text).toContain('review PR 56')
    expect((await ui.find({ type: 'Text', text: /gpt-6.1-terra/ }))?.text).toBe(
      '  gpt-6.1-terra · high · read-only · reviewer',
    )
    expect((await ui.find({ type: 'Text', text: /running ·/ }))?.text).toBe('1 running · 0 finished')
    await ui.unmount()
  }

  await $.prompt.submit({
    text: `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${callId}</tool-use-id>\n<status>killed</status>\n</task-notification>`,
    wait: false,
    origin: { kind: 'task-notification' },
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /running ·/ }))?.text).toBe('0 running · 1 finished')
  expect((await ui.find({ type: 'Text', text: /^  stopped$/ }))?.text).toBe('  stopped')
  await ui.unmount()
})

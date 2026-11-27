import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Seat, SeatStatus } from '../types'

const PANE = 'codex-seats'
const TITLE = 'Codex seats'
const KEEP = 20
const TAIL_BYTES = 4096

const seats = atom({ plugin: 'codex-seats', key: 'seats' } as const, [], {
  shape: 'seats-1',
})
const now = atom({ plugin: 'codex-seats', key: 'now' } as const, 0)

function words(command: string): string[] {
  const out: string[] = []
  let word = ''
  let quote: '"' | "'" | undefined
  let isWord = false
  for (const ch of command) {
    if (quote !== undefined) {
      if (ch === quote) quote = undefined
      else word += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      isWord = true
    } else if (/\s/.test(ch) || ch === ';' || ch === '&' || ch === '|') {
      if (isWord) out.push(word)
      word = ''
      isWord = false
    } else {
      word += ch
      isWord = true
    }
  }
  if (isWord) out.push(word)

  return out
}

function logPath(prompt: string): string {
  const slash = prompt.lastIndexOf('/')
  const dot = prompt.lastIndexOf('.')

  return (dot > slash ? prompt.slice(0, dot) : prompt) + '.codex.log'
}

export function parseSeat(command: string): Omit<Seat, 'id' | 'task' | 'startedAt' | 'status' | 'last'> | undefined {
  const argv = words(command)
  const at = argv.findIndex(word => word.endsWith('codex-run.sh'))
  if (at < 0) return undefined
  const [, model, effort, prompt, ...rest] = argv.slice(at + 1)
  if (model === undefined || effort === undefined || prompt === undefined) return undefined
  const agentAt = rest.indexOf('--agent')

  return {
    model: model === 'default' ? 'codex default' : model,
    effort,
    isReadOnly: rest.includes('read-only'),
    agent: agentAt >= 0 ? rest[agentAt + 1]?.split('/').pop()?.replace(/\.md$/, '') : undefined,
    log: logPath(prompt),
  }
}

const TURN_END = /^\[codex\] Turn (completed|failed|interrupted)\.$/m

function lastLine(text: string): string {
  const lines = text.split('\n').filter(line => line.trim() !== '')
  const line = lines[lines.length - 1] ?? ''

  return line.replace(/^\[codex\] /, '')
}

function notified(text: string): { id: string; status: string } | undefined {
  if (!text.includes('<task-notification>')) return undefined
  const id = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(text)?.[1]
  const status = /<status>([^<]+)<\/status>/.exec(text)?.[1]

  return id && status ? { id, status } : undefined
}

function ended(status: string): SeatStatus {
  if (status === 'completed' || status === 'failed' || status === 'interrupted') return status

  return status === 'killed' ? 'stopped' : 'failed'
}

function endSeat(note: { id: string; status: string }): (all: Seat[]) => Seat[] {
  return all =>
    all.map(seat =>
      seat.id === note.id && seat.status === 'running'
        ? { ...seat, status: ended(note.status), endedAt: Date.now() }
        : seat,
    )
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))

  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

const GLYPH: Record<SeatStatus, string> = {
  running: '●',
  completed: '✓',
  failed: '✗',
  interrupted: '■',
  stopped: '■',
}

const COLOR: Record<SeatStatus, string> = {
  running: 'warning',
  completed: 'success',
  failed: 'error',
  interrupted: 'error',
  stopped: 'inactive',
}

function clip(text: string, width: number): string {
  return text.length > width ? text.slice(0, Math.max(1, width - 1)) + '…' : text
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'codex-seats',
      description: 'Show Codex seats in a pane; "clear" drops finished ones',
    })
    $.clock.every(1500, async () => {
      const list = await read($, seats)
      const live = list.filter(seat => seat.status === 'running')
      if (live.length === 0) return
      const changes = new Map<string, Partial<Seat>>()
      for (const seat of live) {
        try {
          const { size } = await $.fs.stat(seat.log)
          const offset = Math.max(0, size - TAIL_BYTES)
          const text = await $.fs.read(seat.log, { offset, length: TAIL_BYTES })
          const last = lastLine(text)
          const turn = TURN_END.exec(text)?.[1] as SeatStatus | undefined
          if (last !== seat.last || turn !== undefined) {
            changes.set(seat.id, { last, ...(turn ? { status: turn, endedAt: Date.now() } : {}) })
          }
        } catch {
          // The log appears once codex-run.sh starts writing it.
        }
      }
      if (changes.size > 0) {
        await update($, seats, all =>
          all.map(seat => (changes.has(seat.id) ? { ...seat, ...changes.get(seat.id) } : seat)),
        )
      }
      await update($, now, () => Date.now())
    })

    return next(e)
  })

  on('command.run', { command: 'codex-seats' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await update($, seats, all => all.filter(seat => seat.status === 'running'))

      return { text: 'Cleared finished Codex seats.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Codex seats pane opened.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const parsed = parseSeat(e.command)
    if (parsed === undefined) return next(e)
    const id = e.tool_use_id
    const seat: Seat = {
      ...parsed,
      id,
      task: (e.description ?? 'Codex seat').replace(/^Codex:\s*/, ''),
      startedAt: Date.now(),
      status: 'running',
      last: 'starting…',
    }
    await update($, seats, all => [...all.filter(one => one.id !== id), seat].slice(-KEEP))
    await update($, now, () => Date.now())
    void $.ui.open({ id: PANE, title: TITLE })

    const ran = await next(e)
    const isBackground = Boolean((ran.result as { backgroundTaskId?: string } | null | undefined)?.backgroundTaskId)
    if (ran.deny !== undefined || ran.isError === true || !isBackground) {
      const status: SeatStatus = ran.deny !== undefined || ran.isError === true ? 'failed' : 'completed'
      await update($, seats, all =>
        all.map(one =>
          one.id === id && one.status === 'running' ? { ...one, status, endedAt: Date.now() } : one,
        ),
      )
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    const text = e.message.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('\n')
    const note = notified(text)
    if (note !== undefined) await update($, seats, endSeat(note))

    return stored
  }).catch(($, e, next) => next(e))

  // A plugin above can pass session.append on past this mod, so notices are read here too.
  on('prompt.submit', async ($, e, next) => {
    const note = notified(e.text)
    if (note !== undefined) await update($, seats, endSeat(note))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, seats)
    const at = (await read($, now)) || Date.now()
    const width = Math.max(10, e.props.bodyColumns)
    const room = Math.max(1, Math.floor(((e.viewport?.rows ?? 24) - 2) / 3))
    const running = list.filter(seat => seat.status === 'running').length

    return (
      <Box flexDirection="column">
        <Text dimColor>
          {running} running · {list.length - running} finished
        </Text>
        {list.length === 0 && <Text dimColor>No Codex seats yet.</Text>}
        {list
          .slice(-room)
          .reverse()
          .map(seat => {
            const isLive = seat.status === 'running'
            const took = elapsed((seat.endedAt ?? at) - seat.startedAt)
            const tags = [seat.model, seat.effort, seat.isReadOnly ? 'read-only' : 'write', seat.agent]
              .filter(Boolean)
              .join(' · ')

            return (
              <Box flexDirection="column" marginTop={1}>
                <Text>
                  <Text color={COLOR[seat.status]}>{GLYPH[seat.status]}</Text>{' '}
                  <Text bold={isLive} dimColor={!isLive}>
                    {clip(seat.task, width - took.length - 3)}
                  </Text>{' '}
                  <Text dimColor>{took}</Text>
                </Text>
                <Text dimColor>{clip(`  ${tags}`, width)}</Text>
                <Text dimColor>{clip(`  ${isLive ? seat.last : seat.status}`, width)}</Text>
              </Box>
            )
          })}
      </Box>
    )
  })
}

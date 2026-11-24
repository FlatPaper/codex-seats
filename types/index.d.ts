export type SeatStatus = 'running' | 'completed' | 'failed' | 'interrupted' | 'stopped'

export type Seat = {
  id: string
  task: string
  model: string
  effort: string
  isReadOnly: boolean
  agent?: string
  log: string
  startedAt: number
  endedAt?: number
  status: SeatStatus
  last: string
}

declare module 'claude-code' {
  interface PluginState {
    'codex-seats': { seats: Shaped<Seat[]>; now: number }
  }
}

import { expect, test } from 'claude-code/testing'

async function start($: any, on: any, port?: string) {
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'local_me' }))
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? '/Users/me' : e.name === 'AGENT_OFFICE_PORT' ? port : undefined }))
  on('session.cwd', () => ({ value: '/Users/me/code/app' }))
  on('fs.exists', () => ({ value: false }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'office' } }))
  await $.session.start({ cwd: '/Users/me/code/app', surface: 'desktop', isInteractive: false })
}

test('/office gives the default address', async ($, on) => {
  await start($, on)
  expect((await $.command.run({ command: 'office' })).text).toBe('Agent Office is at http://localhost:8794')
})

test('/office follows AGENT_OFFICE_PORT', async ($, on) => {
  await start($, on, '9100')
  expect((await $.command.run({ command: 'office' })).text).toBe('Agent Office is at http://localhost:9100')
})

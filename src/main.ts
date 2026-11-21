import { fileURLToPath } from 'node:url'
import { selectInstance } from '@acryldev/instance'
import { createApp } from './app.ts'

// The composition root: the one place that reads the environment and chooses where the app lives.
const chosen = selectInstance({
  projectRoot: fileURLToPath(new URL('..', import.meta.url)),
  env: process.env,
})
const app = await createApp(chosen)
console.log(`listening on ${app.url} (data in ${chosen.home})`)

// Stop taking requests, let the ones in flight finish, then unload every row in reverse and exit.
const stop = async () => {
  const timer = setTimeout(() => process.exit(1), 10_000)
  timer.unref()
  await app.stop()
  process.exit(0)
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)

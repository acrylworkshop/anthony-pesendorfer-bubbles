import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { pinnedInstance, withPort } from '@acryldev/instance'
import { normalize } from '../plugins/bubbles/store.ts'
import { createApp as boot } from '../src/app.ts'

/** Throwaway homes live inside the project (`.acrylblends/` is ignored by git), because a sandboxed agent may not write to the system temp folder. */
const scratch = join(fileURLToPath(new URL('..', import.meta.url)), '.acrylblends', 'test')
mkdirSync(scratch, { recursive: true })

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

const stops: (() => Promise<void>)[] = []
after(() => Promise.all(stops.map((stop) => stop())))

interface Booted {
  app: Awaited<ReturnType<typeof boot>>
  home: string
}

async function booted(home?: string): Promise<Booted> {
  const folder = home ?? (await mkdtemp(join(scratch, 'bubbles-test-')))
  const app = await boot(withPort(pinnedInstance(folder, { root: projectRoot }), 0), {
    listen: false,
  })
  stops.push(async () => {
    await app.stop()
    if (home === undefined) await rm(folder, { recursive: true, force: true })
  })
  return { app, home: folder }
}

type App = Booted['app']

function call(app: App, method: string, path: string, body?: unknown): Promise<Response> {
  return app.root.router.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body === undefined ? {} : body),
  })
}

async function created(app: App, body: Record<string, unknown>): Promise<string> {
  const response = await call(app, 'POST', '/bubbles/items', body)
  assert.equal(response.status, 200)
  const answer = (await response.json()) as { created: string }
  assert.equal(typeof answer.created, 'string')
  return answer.created
}

async function configure(app: App, id: string, code: string): Promise<void> {
  const response = await call(app, 'PATCH', `/bubbles/items/${id}`, { code, executable: true })
  assert.equal(response.status, 200)
}

const command = (label: string): string => `node -e "console.log('${label}')"`

test('the bubbles page carries the wavy core, the initial mind and the module that reads the gestures', async () => {
  const { app } = await booted()
  const response = await app.root.router.request('/bubbles', { headers: { accept: 'text/html' } })
  assert.equal(response.status, 200)
  const page = await response.text()
  assert.match(page, /<canvas id="bubbles-orb"/)
  assert.match(page, /id="bubbles-initial"/)
  assert.match(page, /id="bubbles-layer"/)
  assert.match(page, /export function clockwiseSweep/)
  assert.match(page, /\+ Bubble/)
  assert.match(page, /runs as code/)
})

test('Connect, Run, + Bubble, Undo and Delete share one dock at the bottom right, one size and one style', async () => {
  const { app } = await booted()
  const response = await app.root.router.request('/bubbles', { headers: { accept: 'text/html' } })
  const page = await response.text()
  const dock = /\<div id="bubbles-dock"[^>]*\>([\s\S]*?)\<\/div\>/.exec(page)
  assert.ok(dock !== null, 'the page carries a dock of stage actions')
  assert.match(dock[1], /id="bubbles-connect"/)
  assert.match(dock[1], /id="bubbles-run"/)
  assert.match(dock[1], /id="bubbles-add"/)
  assert.match(dock[1], /id="bubbles-undo"/)
  assert.match(dock[1], /id="bubbles-remove"/)
  // Undo starts switched off: there is nothing to put back yet.
  assert.match(dock[1], /id="bubbles-undo" type="button" disabled/)
  // The header no longer holds them.
  const header = /\<header\>([\s\S]*?)\<\/header\>/.exec(page)
  assert.ok(header !== null)
  assert.doesNotMatch(header[1], /id="bubbles-connect"/)
  assert.doesNotMatch(header[1], /id="bubbles-run"/)
  // One rule sizes and paints all five, so they cannot drift apart.
  assert.match(page, /#bubbles-dock button\{[^}]*min-height:36px/)
})

test('the top bar is one row, and the hint fills the width the title and the crumbs leave', async () => {
  const { app } = await booted()
  const page = await (await app.root.router.request('/', { headers: { accept: 'text/html' } })).text()
  const header = /\<header\>([\s\S]*?)\<\/header\>/.exec(page)
  assert.ok(header !== null)
  assert.match(header[1], /id="bubbles-hint"/)
  assert.doesNotMatch(header[1], /class="grow"/)
  // The bar never wraps: the hint grows into the space left over and shortens with an ellipsis instead of folding.
  assert.match(page, /header\{[^}]*flex-wrap:nowrap/)
  // Where you are is one row as well, so a deep path cannot push the bar to a second line.
  assert.match(page, /\.crumbs\{[^}]*flex-wrap:nowrap/)
  assert.match(page, /header \.hint\{[^}]*flex:1 1 auto/)
  assert.match(page, /header \.hint\{[^}]*white-space:nowrap/)
  assert.match(page, /header \.hint\{[^}]*text-overflow:ellipsis/)
  assert.doesNotMatch(page, /header \.hint\{[^}]*max-width:560px/)
  // It stays on the bar on a narrow window too.
  assert.doesNotMatch(page, /header \.hint\{display:none\}/)
})

test('Delete is a mode: the page script removes the bubble a click lands on, with no dialog', async () => {
  const { app } = await booted()
  const response = await app.root.router.request('/', { headers: { accept: 'text/html' } })
  const page = await response.text()
  // The button turns on like Connect, in the destructive colour, and the click path skips the confirm dialog.
  assert.match(page, /#bubbles-remove\.on\{[^}]*background:#ffb3c1/)
  assert.match(page, /deleteMode: false/)
  assert.match(page, /if \(ui\.deleteMode\) \{/)
  assert.match(page, /void removeBubbleNow\(id\)/)
  const removal = /async function removeBubbleNow\(id\) \{([\s\S]*?)\n  \}/.exec(page)
  assert.ok(removal !== null, 'the page script carries a quick removal')
  assert.doesNotMatch(removal[1], /window\.confirm/)
  assert.match(removal[1], /request\('DELETE'/)
})

test('a removal goes back with Undo, exactly, and a bubble made after it stays', async () => {
  const { app } = await booted()
  const keep = await created(app, { name: 'keep' })
  const doomed = await created(app, { name: 'doomed' })
  const inside = await created(app, { parentId: doomed, name: 'inside' })
  const link = await call(app, 'POST', '/bubbles/links', { from: keep, to: doomed })
  assert.equal(link.status, 200)

  const removed = await call(app, 'DELETE', `/bubbles/items/${doomed}`, {})
  assert.equal(removed.status, 200)
  assert.equal(((await removed.json()) as { canUndo: boolean }).canUndo, true)

  // A bubble made after the removal is not part of what undo puts back, and is not taken away either.
  const after = await created(app, { name: 'after' })

  const undone = await call(app, 'POST', '/bubbles/undo', {})
  assert.equal(undone.status, 200)
  const back = (await undone.json()) as {
    bubbles: { id: string; name: string; parentId: string | null }[]
    links: { from: string; to: string }[]
    restored: string[]
    canUndo: boolean
  }
  assert.deepEqual([...back.restored].sort(), ['doomed', 'inside'])
  assert.equal(back.canUndo, false)
  const ids = back.bubbles.map((bubble) => bubble.id)
  // The ids are the ones they had, so everything that pointed at them points at them again.
  assert.ok(ids.includes(doomed))
  assert.ok(ids.includes(inside))
  assert.ok(ids.includes(after))
  assert.equal(back.bubbles.find((bubble) => bubble.id === inside)?.parentId, doomed)
  assert.equal(back.links.some((entry) => entry.from === keep && entry.to === doomed), true)

  // Nothing left to undo.
  const again = await call(app, 'POST', '/bubbles/undo', {})
  assert.equal(again.status, 409)
  assert.match(((await again.json()) as { error: string }).error, /nothing to undo/)
})

test('a deleted line comes back with Undo', async () => {
  const { app } = await booted()
  const first = await created(app, { name: 'first' })
  const second = await created(app, { name: 'second' })
  const linked = (await (await call(app, 'POST', '/bubbles/links', { from: first, to: second })).json()) as {
    links: { id: string; from: string; to: string }[]
  }
  const line = linked.links[0]
  assert.equal((await call(app, 'DELETE', `/bubbles/links/${line.id}`, {})).status, 200)
  const undone = (await (await call(app, 'POST', '/bubbles/undo', {})).json()) as {
    links: { id: string }[]
  }
  assert.equal(undone.links.some((entry) => entry.id === line.id), true)
})

test('bubbles is the whole app: the page answers at / and at /bubbles', async () => {
  const { app } = await booted()
  const root = await app.root.router.request('/', { headers: { accept: 'text/html' } })
  assert.equal(root.status, 200)
  const atBubbles = await app.root.router.request('/bubbles', { headers: { accept: 'text/html' } })
  assert.equal(atBubbles.status, 200)
  const page = await root.text()
  assert.match(page, /<title>Bubbles<\/title>/)
  assert.equal(await atBubbles.text(), page)
  // The pages this app used to carry are gone.
  assert.equal((await app.root.router.request('/mindmap', { headers: { accept: 'text/html' } })).status, 404)
  assert.equal((await app.root.router.request('/notes', { headers: { accept: 'text/html' } })).status, 404)
  assert.equal((await app.root.router.request('/login', { headers: { accept: 'text/html' } })).status, 404)
})

test('the page is a space theme: a black sky, star-light tokens and galaxy blues and pinks, no infrared', async () => {
  const { app } = await booted()
  const response = await app.root.router.request('/', { headers: { accept: 'text/html' } })
  const page = await response.text()
  assert.match(page, /body\{background:#04050b/)
  // The stage stays see-through so the app-wide white orbital sky is the background; the page draws no starfield of its own.
  assert.doesNotMatch(page, /#bubbles-app\{[^}]*background:/)
  assert.doesNotMatch(page, /drawStarfield/)
  // The page must not quote the app-wide background's marker, or that plugin skips its injection and the page breaks.
  assert.match(page, /<canvas data-orbital-background/)
  assert.match(page, /--star:#eaf2ff/)
  assert.match(page, /--pink:#f2a6e0/)
  assert.match(page, /#bubbles-orb\{position:absolute/)
  assert.doesNotMatch(page, /#ffb020/)
  assert.doesNotMatch(page, /#ffd789/)
  assert.match(page, /stop-color="#2f4d9e"/)
})

test('a run follows the lines and descends into a bubble: 2, then 1a, 1c and 1b', async () => {
  const { app } = await booted()
  const one = await created(app, { name: '1' })
  const two = await created(app, { name: '2' })
  const a = await created(app, { name: 'a', parentId: one })
  const c = await created(app, { name: 'c', parentId: one })
  const b = await created(app, { name: 'b', parentId: one })

  await configure(app, two, command('two'))
  await configure(app, a, command('a'))
  await configure(app, c, command('c'))
  await configure(app, b, command('b'))

  // The lines, not the creation order, decide: a -> c -> b inside 1, and 2 -> 1 at the top.
  for (const [from, to] of [
    [a, c],
    [c, b],
    [two, one],
  ] as const) {
    const response = await call(app, 'POST', '/bubbles/links', { from, to })
    assert.equal(response.status, 200)
  }

  const response = await call(app, 'POST', '/bubbles/run', {})
  assert.equal(response.status, 200)
  const run = (await response.json()) as {
    steps: { path: string[]; status: string; stdout: string; stderr: string }[]
  }
  assert.deepEqual(
    run.steps.filter((step) => step.status === 'ok').map((step) => step.path.join('/')),
    ['2', '1/a', '1/c', '1/b'],
  )
  assert.deepEqual(
    run.steps.filter((step) => step.status === 'ok').map((step) => step.stdout.trim()),
    ['two', 'a', 'c', 'b'],
  )
  const container = run.steps.find((step) => step.path.join('/') === '1')
  assert.equal(container?.status, 'container')

  // A line across levels, a second line in the same direction, and a line that would loop are refused.
  const across = await call(app, 'POST', '/bubbles/links', { from: one, to: a })
  assert.equal(across.status, 400)
  const again = await call(app, 'POST', '/bubbles/links', { from: a, to: c })
  assert.equal(again.status, 400)
  const loop = await call(app, 'POST', '/bubbles/links', { from: b, to: a })
  assert.equal(loop.status, 400)
  assert.match(((await loop.json()) as { error: string }).error, /loop/)
})

test('a bubble is renamed, nested bubbles go with it, and a new app on the same home starts with it', async () => {
  const first = await booted()
  const top = await created(first.app, { name: 'first name' })
  const inner = await created(first.app, { name: 'inner', parentId: top })
  const renamed = await call(first.app, 'PATCH', `/bubbles/items/${top}`, { name: 'renamed' })
  assert.equal(renamed.status, 200)
  const state = (await renamed.json()) as { bubbles: { id: string; name: string; parentId: string | null }[] }
  assert.equal(state.bubbles.find((bubble) => bubble.id === top)?.name, 'renamed')
  assert.equal(state.bubbles.find((bubble) => bubble.id === inner)?.parentId, top)

  const second = await booted(first.home)
  const fresh = (await (await call(second.app, 'GET', '/bubbles/state')).json()) as {
    bubbles: { id: string; name: string; parentId: string | null }[]
  }
  assert.equal(fresh.bubbles.length, 2)
  assert.equal(fresh.bubbles.find((bubble) => bubble.id === top)?.name, 'renamed')
  assert.equal(fresh.bubbles.find((bubble) => bubble.id === inner)?.parentId, top)

  // Removing a bubble removes everything inside it.
  const removed = await call(second.app, 'DELETE', `/bubbles/items/${top}`)
  assert.equal(removed.status, 200)
  const empty = (await removed.json()) as { bubbles: unknown[] }
  assert.equal(empty.bubbles.length, 0)

  // Only a JSON body may change the mind.
  const form = await second.app.root.router.request('/bubbles/items', {
    method: 'POST',
    headers: { origin: 'http://localhost', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=from a form',
  })
  assert.equal(form.status, 415)
})

test('the file is reduced to what the app can use: broken bubbles and lines are dropped, never trusted', () => {
  const data = normalize({
    bubbles: [
      { id: 'a', name: 'A', parentId: null, x: 0.5, y: 0.5, radius: 46, code: '', executable: false, createdAt: 1 },
      { id: 'a', name: 'again', parentId: null, x: 0.5, y: 0.5, radius: 46, code: '', executable: false, createdAt: 2 },
      { id: '', name: 'nameless', parentId: null, x: 0.5, y: 0.5, radius: 46, code: '', executable: false, createdAt: 3 },
      {
        id: 'b',
        name: ' ',
        parentId: 'a',
        x: 99,
        y: -4,
        radius: 9999,
        code: 4,
        executable: 'yes',
        createdAt: 4,
      },
      { id: 'c', name: 'C', parentId: 'a', x: 0.5, y: 0.5, radius: 46, code: 'echo c', executable: true, createdAt: 5 },
      { id: 'd', name: 'D', parentId: 'd', x: 0.5, y: 0.5, radius: 46, code: '', executable: false, createdAt: 6 },
      { id: 'e', name: 'E', parentId: 'missing', x: 0.5, y: 0.5, radius: 46, code: '', executable: false, createdAt: 7 },
    ],
    links: [
      { id: 'l1', from: 'a', to: 'd' },
      { id: 'l2', from: 'b', to: 'c' },
      { id: 'l3', from: 'b', to: 'c' },
      { id: 'l4', from: 'b', to: 'b' },
      { id: 'l5', from: 'c', to: 'b' },
      { id: 'l6', from: 'd', to: 'b' },
      { id: 'l7', from: 'a', to: 'missing' },
    ],
  })
  assert.deepEqual(
    data.bubbles.map((bubble) => bubble.id),
    ['a', 'b', 'c', 'd', 'e'],
  )
  const b = data.bubbles.find((bubble) => bubble.id === 'b')
  assert.equal(b?.name, 'bubble')
  assert.equal(b?.parentId, 'a')
  assert.equal(b?.x, 0.95)
  assert.equal(b?.y, 0.05)
  assert.equal(b?.radius, 104)
  assert.equal(b?.code, '')
  assert.equal(b?.executable, false)
  assert.equal(data.bubbles.find((bubble) => bubble.id === 'd')?.parentId, null)
  assert.equal(data.bubbles.find((bubble) => bubble.id === 'e')?.parentId, null)
  assert.deepEqual(
    data.links.map((link) => [link.from, link.to]),
    [
      ['a', 'd'],
      ['b', 'c'],
    ],
  )
})

const client = (await import(new URL('../plugins/bubbles/client.js', import.meta.url).href)) as {
  PALETTE: string[]
  EXIT_TURN: number
  accentFor: (key: string) => string
  deepen: (hex: string, keep?: number) => string
  clamp: (value: number, low: number, high: number) => number
  curveFor: (
    from: { x: number; y: number },
    to: { x: number; y: number },
    bend?: number,
  ) => { d: string; mid: { x: number; y: number } }
  clockwiseSweep: (
    points: { t: number; x: number; y: number }[],
    now: number,
    center: { x: number; y: number },
    windowMs?: number,
  ) => number
  clockwiseGesture: (
    points: { t: number; x: number; y: number }[],
    now: number,
    windowMs?: number,
  ) => { turn: number; progress: number; circling: boolean; consistency: number; radiusRatio: number }
}

test('a clockwise circle is a positive turn and a counterclockwise one cancels it', () => {
  const now = 5000
  const center = { x: 0, y: 0 }
  const ring = (direction: number): { t: number; x: number; y: number }[] => {
    const points = []
    for (let index = 0; index <= 80; index += 1) {
      const angle = direction * (index / 80) * Math.PI * 2
      points.push({ t: now - 800 + (index / 80) * 800, x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 })
    }
    return points
  }
  assert.ok(Math.abs(client.clockwiseSweep(ring(1), now, center, 800) - Math.PI * 2) < 0.2)
  assert.ok(Math.abs(client.clockwiseSweep(ring(-1), now, center, 800) + Math.PI * 2) < 0.2)
  assert.ok(client.EXIT_TURN > Math.PI)
  assert.equal(client.clamp(9, 0, 1), 1)
  assert.ok(client.PALETTE.includes(client.accentFor('a bubble')))
  assert.equal(client.deepen('#ffffff', 0), '#04050b')
  assert.match(client.deepen(client.accentFor('a bubble')), /^#[0-9a-f]{6}$/u)
  const curve = client.curveFor({ x: 0, y: 0 }, { x: 100, y: 0 })
  assert.match(curve.d, /^M 0 0 Q /)
  assert.deepEqual(curve.mid, { x: 50, y: 8 })
})

test('the exit gesture is a consistent clockwise circle, not a straight sweep', () => {
  const now = 5000
  const ring = (direction: number): { t: number; x: number; y: number }[] => {
    const points = []
    for (let index = 0; index <= 80; index += 1) {
      const angle = direction * (index / 80) * Math.PI * 2
      points.push({
        t: now - 800 + (index / 80) * 800,
        x: 240 + Math.cos(angle) * 120,
        y: 160 + Math.sin(angle) * 120,
      })
    }
    return points
  }
  const clockwise = client.clockwiseGesture(ring(1), now, 800)
  assert.equal(clockwise.circling, true)
  assert.ok(clockwise.progress >= 1)
  assert.ok(clockwise.consistency > 0.9)
  assert.equal(client.clockwiseGesture(ring(-1), now, 800).progress, 0)

  const straight = []
  for (let index = 0; index <= 80; index += 1) {
    straight.push({ t: now - 800 + (index / 80) * 800, x: 100 + index * 3, y: 120 + index * 1.5 })
  }
  assert.equal(client.clockwiseGesture(straight, now, 800).circling, false)
})

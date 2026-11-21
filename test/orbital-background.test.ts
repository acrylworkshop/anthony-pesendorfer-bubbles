import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { pinnedInstance, withPort } from '@acryldev/instance'
import { createApp as boot } from '../src/app.ts'

/** Throwaway homes live inside the project (`.acrylblends/` is ignored by git), because a sandboxed agent may not write to the system temp folder. */
const scratch = join(fileURLToPath(new URL('..', import.meta.url)), '.acrylblends', 'test')
mkdirSync(scratch, { recursive: true })

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

const stops: (() => Promise<void>)[] = []
after(() => Promise.all(stops.map((stop) => stop())))
async function booted() {
  const home = await mkdtemp(join(scratch, 'orbital-test-'))
  const app = await boot(withPort(pinnedInstance(home, { root: projectRoot }), 0), {
    listen: false,
  })
  stops.push(async () => {
    await app.stop()
    await rm(home, { recursive: true, force: true })
  })
  return app
}

test('every HTML page carries the orbital background exactly once', async () => {
  const app = await booted()
  const res = await app.root.router.request('/', { headers: { accept: 'text/html' } })
  assert.equal(res.status, 200)
  const page = await res.text()
  assert.equal(page.split('<canvas data-orbital-background').length - 1, 1)
  assert.match(page, /z-index:-1/)
  // The drawing module rides inside the page, so a page loaded under the frame's prefix needs no extra URL.
  assert.match(page, /export function sampleOrbital/)
  assert.match(page, /<script type="module">/)
})

test('a JSON answer is left untouched', async () => {
  const app = await booted()
  const res = await app.root.router.request('/bubbles/state', { headers: { accept: 'application/json' } })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type')?.includes('application/json'), true)
  assert.equal((await res.text()).includes('data-orbital-background'), false)
})

const orbital = (await import(
  new URL('../plugins/orbital-background/client.js', import.meta.url).href
)) as {
  LEVELS: { n: number; l: number; m: number; label: string }[]
  RADIANS_PER_LEVEL: number
  levelFor: (turn: number) => number
  CLOUDS: {
    id: string
    x: number
    y: number
    radius: number
    share: number
    dot: number
    alpha: number
    depth: number
    offset: number
  }[]
  POINT_COLORS: number[][]
  SKY: string
  spinForWheel: (deltaY: number) => number
  radial: (n: number, l: number, r: number) => number
  realY: (l: number, m: number, z: number, phi: number) => number
  sampleOrbital: (
    n: number,
    l: number,
    m: number,
    count: number,
    seed?: number,
  ) => {
    positions: Float32Array
    phase: Float32Array
    meanRadius: number
    rmsRadius: number
  }
}

test('the points are white light on a black sky, not blue and pink dots on a lavender wash', () => {
  assert.equal(orbital.POINT_COLORS.length, 2)
  for (const color of orbital.POINT_COLORS) {
    assert.equal(color.length, 3)
    // A point is white or a shade of white: every channel is bright, and the channels stay close together.
    assert.ok(
      color.every((channel) => channel >= 220 && channel <= 255),
      `a point is not white: ${color.join(',')}`,
    )
    assert.ok(Math.max(...color) - Math.min(...color) <= 24, `a point is too colourful: ${color.join(',')}`)
  }
  const sky = orbital.SKY
  assert.match(sky, /^#[0-9a-f]{6}$/u)
  const channels = [1, 3, 5].map((start) => Number.parseInt(sky.slice(start, start + 2), 16))
  assert.ok(channels.every((channel) => channel < 16), `the sky is not near black: ${sky}`)
})

test('the sampled clouds follow the hydrogen mean radius <r> = (3n^2 - l(l+1)) / 2', async () => {
  for (const orbitalDefinition of orbital.LEVELS) {
    const { n, l } = orbitalDefinition
    const cloud = orbital.sampleOrbital(n, l, orbitalDefinition.m, 6000, 11)
    const expected = (3 * n * n - l * (l + 1)) / 2
    assert.ok(
      Math.abs(cloud.meanRadius - expected) / expected < 0.1,
      `${orbitalDefinition.label}: mean radius ${cloud.meanRadius.toFixed(2)} a0, expected about ${expected}`,
    )
  }
})

test('a sampled cloud is finite and framed to the same size as every other', async () => {
  const cloud = orbital.sampleOrbital(3, 2, 0, 4000, 5)
  const points = cloud.positions.length / 3
  let squareSum = 0
  for (let i = 0; i < cloud.positions.length; i += 3) {
    const x = cloud.positions[i]
    const y = cloud.positions[i + 1]
    const z = cloud.positions[i + 2]
    for (const value of [x, y, z]) assert.equal(Number.isFinite(value), true)
    squareSum += x * x + y * y + z * z
  }
  const rms = Math.sqrt(squareSum / points)
  assert.ok(Math.abs(rms - 1) < 0.02, `normalized rms is ${rms}`)
  for (let i = 0; i < cloud.phase.length; i++) assert.ok(cloud.phase[i] === 0 || cloud.phase[i] === 1)
})

test('a clockwise turn climbs the orbital loop and a counterclockwise turn runs it back', () => {
  const levels = orbital.LEVELS.length
  assert.equal(orbital.levelFor(0), 0)
  assert.equal(orbital.levelFor(orbital.RADIANS_PER_LEVEL), 1)
  assert.ok(Math.abs(orbital.levelFor(orbital.RADIANS_PER_LEVEL * 2.5) - 2.5) < 1e-9)
  // Two full clockwise circles walk the whole set and land back on 1s: the ladder is a loop, not a dead end.
  assert.ok(Math.abs(orbital.levelFor(4 * Math.PI) - 0) < 1e-9)
  assert.ok(Math.abs(orbital.levelFor(2 * Math.PI) - levels / 2) < 1e-9)
  // Turning back from 1s lands on the last orbital, then keeps descending.
  assert.ok(Math.abs(orbital.levelFor(-orbital.RADIANS_PER_LEVEL) - (levels - 1)) < 1e-9)
  assert.ok(Math.abs(orbital.levelFor(-orbital.RADIANS_PER_LEVEL * 2) - (levels - 2)) < 1e-9)
  for (const turn of [0.3, 1.1, 7.7, -3.2, 100]) {
    const level = orbital.levelFor(turn)
    assert.ok(level >= 0 && level < levels, `level ${level} for ${turn}`)
  }
})

test('five clouds fill the page: the centre, a far pair on the top-left and bottom-right, and a near pair', () => {
  const clouds = orbital.CLOUDS
  assert.equal(clouds.length, 5)
  const centre = clouds.filter((cloud) => cloud.depth === 0)
  assert.equal(centre.length, 1)
  assert.equal(centre[0].share, 1)
  const far = clouds.filter((cloud) => cloud.depth < 0)
  const near = clouds.filter((cloud) => cloud.depth > 0)
  assert.equal(far.length, 2)
  assert.equal(near.length, 2)
  // The far pair is the top-left and bottom-right one; the near pair the other diagonal.
  assert.deepEqual(far.map((cloud) => cloud.x < 0.5).sort(), [false, true])
  assert.deepEqual(far.map((cloud) => cloud.y < 0.5).sort(), [false, true])
  assert.deepEqual(near.map((cloud) => cloud.x < 0.5).sort(), [false, true])
  assert.deepEqual(near.map((cloud) => cloud.y < 0.5).sort(), [false, true])
  // Far reads as smaller and dimmer than near, and the corners are smaller than the centre.
  const above = (cloud: { y: number }) => cloud.y < 0.5
  for (const cloud of far) {
    const opposite = near.find(
      (other) => other.x < 0.5 !== cloud.x < 0.5 && above(other) === above(cloud),
    )
    assert.ok(opposite, 'a near cloud on the other side of the same edge')
    assert.ok(cloud.radius < opposite.radius, `${cloud.id} is smaller than ${opposite.id}`)
    assert.ok(cloud.alpha < opposite.alpha, `${cloud.id} is dimmer than ${opposite.id}`)
    assert.ok(cloud.radius < centre[0].radius, `${cloud.id} is smaller than the centre`)
    assert.ok(cloud.share < centre[0].share)
  }
  // They sit on the corners, the far pair a little more inward than the near pair, and every one walks the ladder.
  for (const cloud of clouds) {
    assert.ok(cloud.x < 0.25 || cloud.x > 0.75 || cloud.x === 0.5)
    assert.ok(cloud.y < 0.3 || cloud.y > 0.7 || Math.abs(cloud.y - 0.52) < 0.03)
    assert.ok(cloud.offset >= 0 && cloud.offset < orbital.LEVELS.length)
  }
  for (const cloud of far) {
    const nearOpposite = near.find(
      (other) => other.x < 0.5 !== cloud.x < 0.5 && above(other) === above(cloud),
    ) as { x: number }
    assert.ok(Math.abs(cloud.x - 0.5) < Math.abs(nearOpposite.x - 0.5), 'the far cloud sits inward of the near one')
  }
  assert.equal(new Set(clouds.map((cloud) => cloud.offset)).size, 5)
})

test('scrolling down is a clockwise turn and scrolling up runs it back', () => {
  // Screen y points down, so a positive turn is clockwise.
  assert.ok(orbital.spinForWheel(120) > 0)
  assert.ok(orbital.spinForWheel(-120) < 0)
  assert.equal(orbital.spinForWheel(0), 0)
  // Half an orbital per wheel notch, in both directions.
  assert.ok(Math.abs(orbital.levelFor(orbital.spinForWheel(100)) - 0.5) < 1e-9)
  assert.ok(Math.abs(orbital.levelFor(orbital.spinForWheel(-100)) - (orbital.LEVELS.length - 0.5)) < 1e-9)
  // Two notches climb one orbital: a scroll down lifts the ladder, a scroll up from 1s goes to the top of the loop.
  assert.ok(Math.abs(orbital.levelFor(orbital.spinForWheel(200)) - 1) < 1e-9)
})

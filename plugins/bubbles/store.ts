/**
 * The bubbles' data and the changes to it: bubbles that nest, the energized lines between siblings, and the order a run walks them in.
 *
 * Every change returns a new value, so a route writes it to the file in one step and a test checks it without a server. Only `readData` and
 * `writeData` touch the disk; the write goes through a temporary file and a rename, so a stop in the middle never leaves half a file.
 * A bad change throws `StoreError`, which carries the status the route answers with.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** One bubble: a document that can also run as code, and a place inside its parent where it swims. */
export interface Bubble {
  id: string
  name: string
  /** The bubble this one lives inside; null for a bubble at the top level. */
  parentId: string | null
  /** Where it swims, as a fraction of the stage (0..1), so the page fits any window. */
  x: number
  y: number
  /** Its speed in the same fraction per second; kept so a reload starts with the same gentle drift. */
  vx: number
  vy: number
  /** Its size in pixels at the page's reference size. */
  radius: number
  /** The document body, and the shell command when `executable` is on. */
  code: string
  executable: boolean
  /** Creation order, so bubbles without lines keep a stable order. */
  createdAt: number
}

/** One energized line between two bubbles that live inside the same parent. */
export interface Link {
  id: string
  from: string
  to: string
  /** The parent the line belongs to: null at the top level. */
  parentId: string | null
}

export interface BubblesData {
  bubbles: Bubble[]
  links: Link[]
}

export interface BubbleInput {
  parentId?: string | null
  name?: string
  x?: number
  y?: number
  radius?: number
  code?: string
  executable?: boolean
}

export interface BubblePatch {
  name?: string
  code?: string
  executable?: boolean
  x?: number
  y?: number
  vx?: number
  vy?: number
  radius?: number
}

export const MAX_BUBBLES = 400
export const MAX_LINKS = 600
export const MAX_NAME = 80
export const MAX_CODE = 20_000
export const MAX_DEPTH = 8
export const MIN_RADIUS = 28
export const MAX_RADIUS = 104
export const DEFAULT_RADIUS = 46
export const MAX_VELOCITY = 4
export const MIN_COORD = 0.05
export const MAX_COORD = 0.95
const TAU = Math.PI * 2

/** A refused change: the route answers `{ error }` with this status, as the app answers every bad input. */
export class StoreError extends Error {
  readonly status: 400 | 404 | 409 | 415

  constructor(status: 400 | 404 | 409 | 415, message: string) {
    super(message)
    this.status = status
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value))

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : ''

const cleanName = (value: unknown): string =>
  text(value, MAX_NAME * 2).replace(/\s+/gu, ' ').trim().slice(0, MAX_NAME)

/** The place the next bubble gets when a request does not place it: a golden-angle ring around the core, clear of the middle. */
export function nextPosition(index: number): { x: number; y: number } {
  const ring = 0.28 + 0.075 * (index % 3)
  const angle = index * 2.399963229728653
  return {
    x: clamp(0.5 + Math.cos(angle) * ring, MIN_COORD, MAX_COORD),
    y: clamp(0.5 + Math.sin(angle) * ring * 0.82, MIN_COORD, MAX_COORD),
  }
}

export function emptyData(): BubblesData {
  return { bubbles: [], links: [] }
}

/** How many ancestors a bubble has. It also guards against a parent chain that loops. */
function depthOf(bubbles: readonly Bubble[], id: string): number {
  const byId = new Map(bubbles.map((bubble) => [bubble.id, bubble]))
  let depth = 0
  let cursor = byId.get(id)
  const seen = new Set<string>()
  while (cursor !== undefined && cursor.parentId !== null) {
    if (seen.has(cursor.id)) break
    seen.add(cursor.id)
    depth += 1
    cursor = byId.get(cursor.parentId)
  }
  return depth
}

function reaches(links: readonly Link[], start: string, target: string): boolean {
  const stack = [start]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined) break
    if (id === target) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const link of links) {
      if (link.from === id) stack.push(link.to)
    }
  }
  return false
}

/**
 * The file as the app can use it: broken entries are dropped, a parent that is missing or loops becomes the top level, coordinates and sizes are
 * clamped, and a line that is crossed, duplicated or loops is dropped. Never throws on a malformed file.
 */
export function normalize(raw: unknown): BubblesData {
  const source = isRecord(raw) ? raw : {}
  const rawBubbles = Array.isArray(source.bubbles) ? source.bubbles : []
  const seen = new Set<string>()
  const bubbles: Bubble[] = []
  for (const entry of rawBubbles) {
    if (!isRecord(entry)) continue
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    const parentRaw = typeof entry.parentId === 'string' ? entry.parentId.trim() : ''
    bubbles.push({
      id,
      name: cleanName(entry.name) || 'bubble',
      parentId: parentRaw === '' ? null : parentRaw,
      x: clamp(finite(entry.x, 0.5), MIN_COORD, MAX_COORD),
      y: clamp(finite(entry.y, 0.5), MIN_COORD, MAX_COORD),
      vx: clamp(finite(entry.vx, 0), -MAX_VELOCITY, MAX_VELOCITY),
      vy: clamp(finite(entry.vy, 0), -MAX_VELOCITY, MAX_VELOCITY),
      radius: clamp(finite(entry.radius, DEFAULT_RADIUS), MIN_RADIUS, MAX_RADIUS),
      code: text(entry.code, MAX_CODE),
      executable: entry.executable === true,
      createdAt: finite(entry.createdAt, bubbles.length),
    })
    if (bubbles.length >= MAX_BUBBLES) break
  }

  const byId = new Map(bubbles.map((bubble) => [bubble.id, bubble]))
  for (const bubble of bubbles) {
    let parent = bubble.parentId === null ? null : (byId.get(bubble.parentId) ?? null)
    if (parent !== null && parent.id === bubble.id) parent = null
    let cursor = parent
    let depth = 0
    const visited = new Set<string>([bubble.id])
    while (cursor !== null) {
      if (visited.has(cursor.id)) {
        parent = null
        break
      }
      visited.add(cursor.id)
      depth += 1
      if (depth > MAX_DEPTH) {
        parent = null
        break
      }
      cursor = cursor.parentId === null ? null : (byId.get(cursor.parentId) ?? null)
    }
    bubble.parentId = parent === null ? null : parent.id
  }

  const rawLinks = Array.isArray(source.links) ? source.links : []
  const links: Link[] = []
  const linkIds = new Set<string>()
  const pairs = new Set<string>()
  for (const entry of rawLinks) {
    if (!isRecord(entry) || links.length >= MAX_LINKS) continue
    const from = typeof entry.from === 'string' ? entry.from.trim() : ''
    const to = typeof entry.to === 'string' ? entry.to.trim() : ''
    const a = byId.get(from)
    const b = byId.get(to)
    if (a === undefined || b === undefined || a.id === b.id) continue
    if (a.parentId !== b.parentId) continue
    const pair = `${a.parentId ?? 'root'}:${a.id}->${b.id}`
    if (pairs.has(pair)) continue
    if (reaches(links, b.id, a.id)) continue
    pairs.add(pair)
    let id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (id === '' || linkIds.has(id)) id = randomUUID()
    linkIds.add(id)
    links.push({ id, from: a.id, to: b.id, parentId: a.parentId })
  }

  return { bubbles, links }
}

export function readData(file: string): BubblesData {
  if (!existsSync(file)) return emptyData()
  try {
    return normalize(JSON.parse(readFileSync(file, 'utf8')) as unknown)
  } catch {
    return emptyData()
  }
}

export function writeData(file: string, data: BubblesData): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, `${JSON.stringify(data, null, 2)}\n`)
  renameSync(`${file}.tmp`, file)
}

/** A bubble's siblings, oldest first: the order a run uses before any line is drawn. */
export function siblings(data: BubblesData, parentId: string | null): Bubble[] {
  return data.bubbles
    .filter((bubble) => bubble.parentId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export function addBubble(data: BubblesData, input: BubbleInput = {}): { data: BubblesData; bubble: Bubble } {
  if (data.bubbles.length >= MAX_BUBBLES) {
    throw new StoreError(400, `there are already ${String(MAX_BUBBLES)} bubbles`)
  }
  const parentId = input.parentId ?? null
  if (parentId !== null) {
    const parent = data.bubbles.find((bubble) => bubble.id === parentId)
    if (parent === undefined) throw new StoreError(400, 'no such parent bubble')
    if (depthOf(data.bubbles, parentId) + 1 > MAX_DEPTH) {
      throw new StoreError(400, `bubbles nest at most ${String(MAX_DEPTH)} deep`)
    }
    if (siblings(data, parentId).length >= MAX_BUBBLES) {
      throw new StoreError(400, 'this bubble is full')
    }
  }
  const here = siblings(data, parentId)
  const name = cleanName(input.name) || `bubble ${String(here.length + 1)}`
  const fallback = nextPosition(here.length)
  const x = input.x === undefined ? fallback.x : clamp(finite(input.x, fallback.x), MIN_COORD, MAX_COORD)
  const y = input.y === undefined ? fallback.y : clamp(finite(input.y, fallback.y), MIN_COORD, MAX_COORD)
  const radius =
    input.radius === undefined
      ? DEFAULT_RADIUS + (here.length % 3) * 4
      : clamp(finite(input.radius, DEFAULT_RADIUS), MIN_RADIUS, MAX_RADIUS)
  const lastCreated = data.bubbles.reduce((highest, bubble) => Math.max(highest, bubble.createdAt), 0)
  const bubble: Bubble = {
    id: randomUUID(),
    name,
    parentId,
    x,
    y,
    vx: 0,
    vy: 0,
    radius,
    code: text(input.code, MAX_CODE),
    executable: input.executable === true,
    createdAt: Math.max(Date.now(), lastCreated) + 1,
  }
  return { data: { bubbles: [...data.bubbles, bubble], links: data.links }, bubble }
}

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new StoreError(400, `${label} must be a number`)
  return value
}

export function patchBubble(data: BubblesData, id: string, patch: BubblePatch): BubblesData {
  const existing = data.bubbles.find((bubble) => bubble.id === id)
  if (existing === undefined) throw new StoreError(404, 'no such bubble')
  const next: Bubble = { ...existing }
  if (patch.name !== undefined) {
    const name = cleanName(patch.name)
    if (name === '') throw new StoreError(400, 'a bubble needs a name')
    next.name = name
  }
  if (patch.code !== undefined) {
    if (typeof patch.code !== 'string') throw new StoreError(400, 'code must be text')
    next.code = patch.code.slice(0, MAX_CODE)
  }
  if (patch.executable !== undefined) {
    if (typeof patch.executable !== 'boolean') throw new StoreError(400, 'executable must be true or false')
    next.executable = patch.executable
  }
  if (patch.x !== undefined) next.x = clamp(finiteNumber(patch.x, 'x'), MIN_COORD, MAX_COORD)
  if (patch.y !== undefined) next.y = clamp(finiteNumber(patch.y, 'y'), MIN_COORD, MAX_COORD)
  if (patch.vx !== undefined) next.vx = clamp(finiteNumber(patch.vx, 'vx'), -MAX_VELOCITY, MAX_VELOCITY)
  if (patch.vy !== undefined) next.vy = clamp(finiteNumber(patch.vy, 'vy'), -MAX_VELOCITY, MAX_VELOCITY)
  if (patch.radius !== undefined) {
    next.radius = clamp(finiteNumber(patch.radius, 'radius'), MIN_RADIUS, MAX_RADIUS)
  }
  return {
    bubbles: data.bubbles.map((bubble) => (bubble.id === id ? next : bubble)),
    links: data.links,
  }
}

/** Removes a bubble and everything inside it, with every line that touched one of them. */
export function removeBubble(data: BubblesData, id: string): BubblesData {
  if (!data.bubbles.some((bubble) => bubble.id === id)) throw new StoreError(404, 'no such bubble')
  const doomed = new Set<string>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const bubble of data.bubbles) {
      if (bubble.parentId !== null && doomed.has(bubble.parentId) && !doomed.has(bubble.id)) {
        doomed.add(bubble.id)
        changed = true
      }
    }
  }
  return {
    bubbles: data.bubbles.filter((bubble) => !doomed.has(bubble.id)),
    links: data.links.filter((link) => !doomed.has(link.from) && !doomed.has(link.to)),
  }
}

/**
 * Puts back what a snapshot has and the data no longer does: the bubbles and lines the last removal took, and nothing else, so a bubble made
 * after that removal stays. A bubble comes back only when its parent is there (or it lived at the top level), parents first, and a line only when
 * both of its bubbles are. A restored bubble keeps its id, its place, its code and its `createdAt`, so the run order is the one it had.
 */
export function restore(
  data: BubblesData,
  snapshot: BubblesData,
): { data: BubblesData; restored: string[] } {
  const present = new Set(data.bubbles.map((bubble) => bubble.id))
  const missing = snapshot.bubbles.filter((bubble) => !present.has(bubble.id))
  const back: Bubble[] = []
  let changed = true
  while (changed) {
    changed = false
    for (const bubble of missing) {
      if (present.has(bubble.id)) continue
      if (bubble.parentId !== null && !present.has(bubble.parentId)) continue
      back.push(bubble)
      present.add(bubble.id)
      changed = true
    }
  }
  const haveLinks = new Set(data.links.map((link) => link.id))
  const linesBack = snapshot.links.filter(
    (link) => !haveLinks.has(link.id) && present.has(link.from) && present.has(link.to),
  )
  return {
    data: {
      bubbles: back.length === 0 ? data.bubbles : [...data.bubbles, ...back],
      links: linesBack.length === 0 ? data.links : [...data.links, ...linesBack],
    },
    restored: back.map((bubble) => bubble.name),
  }
}

export function addLink(data: BubblesData, from: string, to: string): BubblesData {
  if (data.links.length >= MAX_LINKS) {
    throw new StoreError(400, `there are already ${String(MAX_LINKS)} lines`)
  }
  const a = data.bubbles.find((bubble) => bubble.id === from)
  const b = data.bubbles.find((bubble) => bubble.id === to)
  if (a === undefined || b === undefined) throw new StoreError(404, 'no such bubble')
  if (a.id === b.id) throw new StoreError(400, 'a line needs two bubbles')
  if (a.parentId !== b.parentId) throw new StoreError(400, 'a line joins bubbles at the same level')
  const pair = data.links.find((link) => link.from === a.id && link.to === b.id)
  if (pair !== undefined) throw new StoreError(400, 'these bubbles are already connected')
  if (reaches(data.links, b.id, a.id)) throw new StoreError(400, 'that line would make a loop')
  return {
    bubbles: data.bubbles,
    links: [...data.links, { id: randomUUID(), from: a.id, to: b.id, parentId: a.parentId }],
  }
}

export function removeLink(data: BubblesData, id: string): BubblesData {
  if (!data.links.some((link) => link.id === id)) throw new StoreError(404, 'no such line')
  return {
    bubbles: data.bubbles,
    links: data.links.filter((link) => link.id !== id),
  }
}

/**
 * The order the bubbles at one level run in: the lines are the order, read from the bubbles nothing points at, and bubbles without a line
 * follow in creation order. A line that loops is never kept, so the walk always ends.
 */
export function levelOrder(data: BubblesData, parentId: string | null): string[] {
  const here = siblings(data, parentId)
  const links = data.links.filter((link) => link.parentId === parentId)
  if (links.length === 0) return here.map((bubble) => bubble.id)
  const index = new Map(here.map((bubble, position) => [bubble.id, position]))
  const byCreation = (a: string, b: string): number => (index.get(a) ?? 0) - (index.get(b) ?? 0)
  const connected = new Set<string>()
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const bubble of here) incoming.set(bubble.id, 0)
  for (const link of links) {
    connected.add(link.from)
    connected.add(link.to)
    incoming.set(link.to, (incoming.get(link.to) ?? 0) + 1)
    const list = outgoing.get(link.from) ?? []
    list.push(link.to)
    outgoing.set(link.from, list)
  }
  const ready = here
    .filter((bubble) => connected.has(bubble.id) && (incoming.get(bubble.id) ?? 0) === 0)
    .map((bubble) => bubble.id)
    .sort(byCreation)
  const order: string[] = []
  while (ready.length > 0) {
    ready.sort(byCreation)
    const id = ready.shift()
    if (id === undefined) break
    order.push(id)
    for (const next of outgoing.get(id) ?? []) {
      const left = (incoming.get(next) ?? 0) - 1
      incoming.set(next, left)
      if (left === 0) ready.push(next)
    }
  }
  for (const bubble of here) {
    if (!order.includes(bubble.id)) order.push(bubble.id)
  }
  return order
}

export interface PlanStep {
  bubbleId: string
  /** The names from the top level down to this bubble: `['1', 'a']` is the bubble `a` inside `1`. */
  path: string[]
  depth: number
}

function ancestryNames(data: BubblesData, id: string): string[] {
  const byId = new Map(data.bubbles.map((bubble) => [bubble.id, bubble]))
  const names: string[] = []
  let cursor = byId.get(id)
  const seen = new Set<string>()
  while (cursor !== undefined && !seen.has(cursor.id) && names.length <= MAX_DEPTH) {
    seen.add(cursor.id)
    names.unshift(cursor.name)
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)
  }
  return names
}

/**
 * The bubbles a run visits, in order. Every bubble is visited, so a document or a container still shows its place; a bubble's own code runs
 * before the bubbles inside it. `startId` runs one bubble and its contents instead of the whole mind.
 */
export function executionPlan(data: BubblesData, startId: string | null = null): PlanStep[] {
  const byId = new Map(data.bubbles.map((bubble) => [bubble.id, bubble]))
  const steps: PlanStep[] = []
  const seen = new Set<string>()
  const visit = (id: string, parentPath: string[], depth: number): void => {
    if (seen.has(id)) return
    const bubble = byId.get(id)
    if (bubble === undefined) return
    seen.add(id)
    const path = [...parentPath, bubble.name]
    steps.push({ bubbleId: bubble.id, path, depth })
    for (const childId of levelOrder(data, bubble.id)) visit(childId, path, depth + 1)
  }
  if (startId !== null) {
    if (!byId.has(startId)) throw new StoreError(404, 'no such bubble')
    const names = ancestryNames(data, startId)
    const parentPath = names.slice(0, -1)
    visit(startId, parentPath, Math.max(0, names.length - 1))
  } else {
    for (const id of levelOrder(data, null)) visit(id, [], 0)
  }
  return steps
}

/** The angle of a point around a centre, for the page's clockwise exit gesture; kept here so a test can check it without a browser. */
export function angleAround(x: number, y: number, cx: number, cy: number): number {
  return Math.atan2(y - cy, x - cx)
}

export { TAU }

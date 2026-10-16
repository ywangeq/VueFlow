import { gsap } from 'gsap'

// Selected original graph-motion dependency closure; see THIRD_PARTY_NOTICES.md.
const reducedQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

export function prefersReducedMotion() {
  return Boolean(reducedQuery?.matches)
}

/** 页面在后台时 rAF 被节流，补间会停在中途：此时直接给终态 */
function skipMotion() {
  return prefersReducedMotion() || (typeof document !== 'undefined' && document.hidden)
}


/** 弹簧状态：x 当前值，v 速度 */
export interface SpringState { x: number; v: number }
export const springOf = (x: number): SpringState => ({ x, v: 0 })

/** 临界阻尼弹簧：每帧把 state 推向 target，返回新值。k 越大越硬（62 ≈ 0.5s 落定） */
export function spring(state: SpringState, target: number, dt: number, k = 62) {
  const c = 2 * Math.sqrt(k)
  state.v += (-k * (state.x - target) - c * state.v) * dt
  state.x += state.v * dt
  return state.x
}

/** 三次贝塞尔上 u 处的坐标分量 */
export function bezierAt(p0: number, p1: number, p2: number, p3: number, u: number) {
  const m = 1 - u
  return m * m * m * p0 + 3 * m * m * u * p1 + 3 * m * u * u * p2 + u * u * u * p3
}

/**
 * 常驻帧循环：挂在 gsap.ticker 上，页面隐藏或元素离开视口时停帧（导 Conduct）。
 * 回调拿到 dt（秒，限制在 1/30 内）与累计时间 t；单帧出错只报一次，不让循环停摆。
 */
export function createFrameLoop(step: (dt: number, t: number) => void) {
  let target: Element | null = null
  let offscreen = false
  let frames = 0
  let running = false
  let last = 0
  let time = 0
  let warned = false
  const run = (force: boolean) => {
    if (document.hidden && !force) { last = 0; return }
    // 每 20 帧量一次位置：离开视口就停帧（比 IntersectionObserver 更不受过渡与隐藏祖先影响）
    if (target && (offscreen || frames++ % 20 === 0)) {
      const r = target.getBoundingClientRect()
      offscreen = r.width === 0 || r.bottom < 0 || r.top > window.innerHeight
    }
    if (offscreen && !force) { last = 0; return }
    const now = performance.now()
    const dt = last ? Math.max(0, Math.min(1 / 30, (now - last) / 1000)) : 1 / 60
    last = now
    time += dt
    try { step(dt, time) } catch (error) {
      if (!warned) { warned = true; console.error(error) }
    }
  }
  const tick = () => run(false)
  return {
    start(el?: Element | null) {
      if (running) return
      running = true
      last = 0
      target = el ?? null
      gsap.ticker.add(tick)
    },
    stop() {
      running = false
      gsap.ticker.remove(tick)
      target = null
    },
    /** 立即执行一帧（减少动态效果时用来直接画到终态） */
    flush() { run(true) },
    get time() { return time },
  }
}


/** 是否应跳过过程动画（reduced motion 或页面在后台） */
export function motionSkipped() {
  return skipMotion()
}

export { gsap }

import { StrictMode, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useAuthBridge, useAuthSnapshot } from 'light-sdk-builder-react'
const listeners = new Map()
class Source {
  constructor(key) {
    this.context = { sessionKey: key, revision: 1 }
    this.listeners = new Set()
    listeners.set(key, this.listeners)
  }
  getRequestContext() {
    return this.context
  }
  subscribe(changed) {
    this.listeners.add(changed)
    return () => this.listeners.delete(changed)
  }
  change(key) {
    this.context = { sessionKey: key, revision: 1 }
    for (const fn of this.listeners) fn()
  }
}
const a = new Source('a'),
  b = new Source('b')
let release
const gate = new Promise((resolve) => {
  release = resolve
})
const fetch = async () => new Response(null, { status: 200 })
function Screen() {
  const [source, setSource] = useState(a),
    [asyncMode, setAsyncMode] = useState(false),
    [render, setRender] = useState(0)
  const bridge = useAuthBridge(
    asyncMode
      ? {
          getRequestContext: async () => {
            await gate
            return { sessionKey: 'async', revision: 1 }
          },
        }
      : source,
    { fetch },
  )
  const snapshot = useAuthSnapshot(bridge)
  window.reactAuth = {
    bridge,
    snapshot,
    asyncMode,
    render,
    switchSource: () => setSource(b),
    changeB: () => b.change('c'),
    async: () => setAsyncMode(true),
    rerender: () => setRender(render + 1),
    release,
    listenersA: a.listeners,
    listenersB: b.listeners,
  }
  return createElement('p', null, `${snapshot.sessionKey}:${render}`)
}
createRoot(document.getElementById('root')).render(
  createElement(StrictMode, null, createElement(Screen)),
)

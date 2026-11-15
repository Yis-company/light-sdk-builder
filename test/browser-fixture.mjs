import { createClient, endpoint } from 'light-sdk-builder'
const schema = {
  '~standard': { version: 1, vendor: 'browser-fixture', validate: (value) => ({ value }) },
}
window.sdkSmoke = (async () => {
  const requests = []
  const headers = { 'X-Workspace': '7' }
  const client = createClient({
    baseUrl: 'https://fixture.invalid/api',
    keyContext: [7],
    headers,
    fetch: async (url, init) => {
      requests.push({ url, workspace: init.headers.get('X-Workspace') })
      return Response.json({ name: 'Ada' })
    },
  })
  const read = endpoint({
    name: 'user',
    method: 'GET',
    path: '/users/:id',
    input: schema,
    responses: { 200: schema },
  }).bind(client)
  const value = await read.call({ params: { id: 'a/b' } })
  const prepared = await read.prepare({ params: { id: 'a/b' } })
  headers['X-Workspace'] = '9'
  await prepared.call()
  const controller = new AbortController()
  controller.abort()
  let cancelled = false
  try {
    await read.call({ params: { id: '1' } }, { signal: controller.signal })
  } catch (error) {
    cancelled = error.name === 'AbortError'
  }
  const nativeEndpoint = endpoint({
    name: 'native-fetch',
    method: 'GET',
    path: '/native',
    responses: { 200: schema },
  })
  const nativeDefault = await nativeEndpoint
    .bind(createClient({ baseUrl: 'https://fixture.invalid/api' }))
    .call()
  const nativeInjected = await nativeEndpoint
    .bind(createClient({ baseUrl: 'https://fixture.invalid/api', fetch: globalThis.fetch }))
    .call()
  const localeKey = (await read.prepare({ params: { id: 'a/b' }, query: { ch: 1, h: 2 } })).key
  return { value, requests, cancelled, key: prepared.key, nativeDefault, nativeInjected, localeKey }
})()

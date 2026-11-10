import http from 'node:http'
import { spawn } from 'node:child_process'

const required = ['TEST_GMAIL_EMAIL', 'TEST_GMAIL_PASSWORD', 'TEST_GMAIL_RECOVERY', 'TEST_GMAIL_2FA', 'TEST_CLIENT_ID', 'TEST_CLIENT_SECRET']
for (const name of required) {
  if (!process.env[name]) throw new Error(`missing ${name}`)
}

const requestId = 'test'
let report = null
let child

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/oidc') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ value: 'test-oidc' }))
    return
  }
  if (req.method !== 'POST' || !url.pathname.startsWith(`/worker/${requestId}/`)) {
    res.writeHead(404).end()
    return
  }
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const action = url.pathname.split('/').pop()
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (action === 'bootstrap-start') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        email: process.env.TEST_GMAIL_EMAIL,
        provider: 'gmail',
        auth: 'browser',
        clientId: process.env.TEST_CLIENT_ID,
        clientSecret: process.env.TEST_CLIENT_SECRET,
        password: process.env.TEST_GMAIL_PASSWORD,
        recoveryEmail: process.env.TEST_GMAIL_RECOVERY,
        twoFactor: process.env.TEST_GMAIL_2FA,
      }))
      return
    }
    if (action === 'bootstrap-report') report = body
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }))
  })
})

function finish(code) {
  if (child && child.exitCode === null) child.kill('SIGKILL')
  server.close(() => process.exit(code))
}

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('listener')
  const base = `http://127.0.0.1:${address.port}/worker`
  child = spawn(process.execPath, ['test-pickup.cjs'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      PICKUP_MODE: 'bootstrap',
      PICKUP_REQUEST: requestId,
      PICKUP_URL: base,
      ACTIONS_ID_TOKEN_REQUEST_URL: `http://127.0.0.1:${address.port}/oidc`,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'test',
    },
  })
  const timer = setTimeout(() => {
    console.error('bootstrap timeout')
    finish(1)
  }, 300_000)
  child.once('error', () => {
    clearTimeout(timer)
    console.error('bootstrap process failed')
    finish(1)
  })
  child.once('exit', () => {
    clearTimeout(timer)
    if (typeof report?.refreshToken === 'string' && report.refreshToken.length > 0) {
      console.log('bootstrap succeeded')
      finish(0)
      return
    }
    console.error(`bootstrap report: ${typeof report?.error === 'string' ? report.error : 'missing'}`)
    finish(1)
  })
})

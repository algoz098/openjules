// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html
import { feathers } from '@feathersjs/feathers'
import configuration from '@feathersjs/configuration'
import { koa, rest, bodyParser, errorHandler, parseAuthentication, cors, serveStatic } from '@feathersjs/koa'
import socketio from '@feathersjs/socketio'

import { configurationValidator } from './configuration'
import type { Application } from './declarations'
import { logError } from './hooks/log-error'
import { sqlite } from './sqlite'
import { authentication } from './authentication'
import { services } from './services/index'
import { channels } from './channels'

// const readRawRequestBody = async (request: any): Promise<Buffer> => {
//   return new Promise((resolve, reject) => {
//     const chunks: Buffer[] = []
//     request.on('data', (chunk: Buffer | string) => {
//       chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
//     })
//     request.on('end', () => {
//       resolve(Buffer.concat(chunks))
//     })
//     request.on('error', (error: Error) => {
//       reject(error)
//     })
//   })
// }

const app: Application = koa(feathers())

// Load our app configuration (see config/ folder)
app.configure(configuration(configurationValidator))

// Set up Koa middleware
app.use(cors())
app.use(serveStatic(app.get('public')))
app.use(errorHandler())
app.use(parseAuthentication())
// app.use(async (ctx, next) => {
//   if (ctx.path === '/github-webhooks' && (ctx.method === 'POST' || ctx.method === 'PUT')) {
//     const rawBuffer = await readRawRequestBody(ctx.req)
//     const rawBody = rawBuffer.toString('utf8')

//     let parsedBody: any = {}
//     if (rawBody.trim()) {
//       try {
//         parsedBody = JSON.parse(rawBody)
//       } catch {
//         parsedBody = {}
//       }
//     }

//     ctx.request.body = parsedBody
//     ctx.feathers = {
//       ...(ctx.feathers || {}),
//       rawBody
//     }
//   }

//   await next()
// })
app.use(bodyParser())

// Configure services and transports
app.configure(rest())
app.configure(
  socketio({
    cors: {
      origin: app.get('origins')
    }
  })
)
app.configure(sqlite)
app.configure(authentication)
app.configure(services)
app.configure(channels)

// Register hooks that run on all service methods
app.hooks({
  around: {
    // all: [logError]
  },
  before: {},
  after: {},
  error: {}
})

export { app }

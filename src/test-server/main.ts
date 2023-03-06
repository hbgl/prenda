import { fastify as Fastify } from 'fastify';
import { Edge } from 'edge.js';
import selfsigned from 'selfsigned';
import glob from 'glob';
import * as path from 'node:path';
import fastifyStatic from '@fastify/static';
import { sleepMs } from '../support/sleep.js';
import { $dirname } from '../support/meta.js';

const port = Number(process.env.PORT ?? 26478);
const httpsPort = Number(process.env.PORT_HTTPS ?? 26479);
const certificate = selfsigned.generate();
const dirname = $dirname(import.meta.url);

const httpsFastify = Fastify({
  logger: true,
  https: {
    allowHTTP1: true,
    key: certificate.private,
    cert: certificate.cert,
  } as any,
});

httpsFastify.get('*', (request, reply) => {
  reply.type('text/html').send('Ok');
});

const fastify = Fastify({
  logger: true,
});

fastify.register(fastifyStatic, {
  root: path.join(dirname, 'static'),
  prefix: '/assets/',
  maxAge: 30 * 1000,
});

const edge = new Edge({ cache: false });
edge.mount(path.join(dirname, 'views'));

declare module 'fastify' {
  interface FastifyReply {
    view(name: string, args?: Record<string, any>): FastifyReply;
  }
}

fastify.decorateReply('view', async function (name: string, args?: Record<string, any>) {
  const html = await edge.render(name, args);
  this.type('text/html').send(html);
});

fastify.get('/', async (request, reply) => {
  await reply.view('welcome');
  return reply;
});

fastify.get('/ok', (request, reply) => {
  reply.type('text/html').send('ok');
});

fastify.get('/404', (request, reply) => {
  reply.code(404).send();
});

fastify.get('/wait-5s', async (request, reply) => {
  await sleepMs(5000);
  reply.type('text/html').send('5s');
  return reply;
});

fastify.get('/errors/incomplete-chunked-encoding', (request, reply) => {
  reply.raw.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  reply.raw.write('Hel', () => {
    request.raw.destroy();
  });
});

const views = glob.sync('./**/*.edge', {
  cwd: path.join(dirname, 'views/tests'),
  nodir: true,
});
for (const name of views) {
  const viewPath = /^\.\/(.+)\.edge$/.exec(name)![1];
  fastify.get(`/tests/${viewPath}`, async (request, reply) => {
    await reply.view(`tests/${viewPath}`);
    return reply;
  });
}

try {
  await fastify.listen({ port: port, host: 'localhost' });
  await httpsFastify.listen({ port: httpsPort, host: 'localhost' });
  if (process.send) {
    process.send({ type: 'listening' });
  }
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

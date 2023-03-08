#!/usr/bin/env node
import { fastify as Fastify, FastifyInstance } from 'fastify';
import { setupErrorHandler } from './error.js';
import { setupRender } from './render.js';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { readConfig, setupConfig } from './config.js';
import { program } from 'commander';

let fastify = undefined as FastifyInstance | undefined;

async function main() {
  program
    .description('Start Prenda service.')
    .option('-c, --config <config>', 'config file to use', 'config.yaml')
    .option('--no-config', 'use application defaults')
    .parse();

  const opts = program.opts();
  const config = await readConfig(opts.config);

  fastify = Fastify({
    logger: { level: config.app.logLevel },
    ajv: {
      customOptions: {
        discriminator: true,
      },
    },
  });

  await setupConfig(fastify, config);
  await setupErrorHandler(fastify);
  await setupSwagger(fastify);
  await setupRender(fastify);

  await fastify.listen({ port: config.app.port });
}

async function setupSwagger(fastify: FastifyInstance) {
  if (!fastify.config.app.swaggerEnabled) {
    return;
  }
  await fastify.register(swagger, { openapi: {} });
  await fastify.register(swaggerUi);
}

try {
  await main();
} catch (err) {
  if (fastify) {
    fastify.log.error(err);
  } else {
    console.error(err);
  }
  process.exit(1);
}

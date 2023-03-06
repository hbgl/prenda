import { FastifyInstance } from 'fastify';
import { JSONSchemaType } from 'ajv';

export interface ServiceError {
  code: string;
  message?: string | null;
}

const apiErrorSchema: JSONSchemaType<ServiceError> = {
  $id: 'service-error',
  type: 'object',
  required: ['code'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string', nullable: true },
  },
};

export async function setupErrorHandler(fastify: FastifyInstance) {
  fastify.addSchema(apiErrorSchema);

  fastify.setErrorHandler(async (error, request, reply) => {
    fastify.log.error(`Unhandled error "${error.name}": ${error.message}`);
    const retObj: ServiceError = {
      code: 'unknown',
      message: 'An unknown error occurred.',
    };
    reply.status(500).send(retObj);
  });
}

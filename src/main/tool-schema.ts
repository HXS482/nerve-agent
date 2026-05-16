import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

export function zodToInputSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(schema, { target: 'openApi3' })
  // Strip $schema wrapper — Anthropic/OpenAI expect bare input_schema
  const { $schema, ...rest } = jsonSchema as any
  return rest
}

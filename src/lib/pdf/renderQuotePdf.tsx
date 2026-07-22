// ============================================================
// JSX lives here (not in the route handlers) so the API routes
// can stay plain .ts files — route.tsx isn't a recognized Next.js
// special-file convention in this version.
// ============================================================
import { pdf } from '@react-pdf/renderer'
import { QuoteDocument, type QuotePdfData } from './QuoteDocument'

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function renderQuotePdfBuffer(data: QuotePdfData): Promise<Buffer> {
  const stream = await pdf(<QuoteDocument data={data} />).toBuffer()
  return streamToBuffer(stream)
}

// Repro: tool_choice "required" is not enforced when openrouter:web_search runs.
// No dependencies. Node 18+ (global fetch).
//
//   OPENROUTER_API_KEY=sk-or-... node repro.mjs [maxRequests=10] [model=google/gemini-3.5-flash-lite]
//
// Sends requests one at a time and stops at the first response that breaks
// tool_choice "required" (no tool_calls, plain content instead), so it usually
// costs fewer than maxRequests requests. Every raw response goes to results/.

import fs from 'node:fs'
import path from 'node:path'

const key = process.env.OPENROUTER_API_KEY
if (!key) {
  console.error('Set OPENROUTER_API_KEY')
  process.exit(1)
}
const maxRequests = Number(process.argv[2] ?? 10)
const model = process.argv[3] ?? 'google/gemini-3.5-flash-lite'

const request = {
  model,
  max_tokens: 3000,
  provider: { data_collection: 'deny' },
  reasoning: { effort: 'high' },
  tool_choice: 'required',
  tools: [
    {
      type: 'function',
      function: {
        name: 'idle',
        description: 'Use this to not do any actions',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'text_reply',
        description: 'Sends a text message to the chat.',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
    { type: 'openrouter:web_search', parameters: { engine: 'exa', max_results: 3 } },
  ],
  messages: [
    { role: 'system', content: 'You are a chat bot. Always act via tools. Use web search when you need current info.' },
    { role: 'user', content: 'What was the closing price of NVDA stock yesterday? Reply to me with it.' },
  ],
}

const outDir = path.join('results', new Date().toISOString().replace(/[:.]/g, '-'))
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'request.json'), JSON.stringify(request, null, 2))

const summary = []
let violations = 0
for (let i = 1; i <= maxRequests; i++) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  const body = await res.json()
  fs.writeFileSync(path.join(outDir, `response-${String(i).padStart(2, '0')}.json`), JSON.stringify(body, null, 2))

  const choice = body.choices?.[0]
  const toolCalls = choice?.message?.tool_calls ?? []
  const row = {
    n: i,
    http: res.status,
    id: body.id,
    finish_reason: choice?.finish_reason,
    tool_calls: toolCalls.map((t) => t.function.name),
    has_content: typeof choice?.message?.content === 'string' && choice.message.content.length > 0,
    web_search_requests: body.usage?.server_tool_use_details?.web_search_requests,
    error: body.error,
  }
  const violated = res.ok && !body.error && toolCalls.length === 0
  row.violates_tool_choice_required = violated
  summary.push(row)
  console.log(
    `#${i} ${row.id} http=${row.http} finish=${row.finish_reason} tool_calls=[${row.tool_calls}]` +
      ` content=${row.has_content} searches=${row.web_search_requests}` +
      (row.error ? ` error=${JSON.stringify(row.error)}` : '') +
      (violated ? '  <-- NO TOOL CALL despite tool_choice "required"' : ''),
  )
  if (violated) {
    violations++
    break
  }
}

fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(
  violations
    ? `\nReproduced after ${summary.length} request(s). Raw responses in ${outDir}/`
    : `\nNot reproduced in ${summary.length} request(s) (observed rate is ~20%, try again). Raw responses in ${outDir}/`,
)

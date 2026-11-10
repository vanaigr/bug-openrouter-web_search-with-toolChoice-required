// Repro: tool_choice "required" is not enforced when openrouter:web_search runs.
// No dependencies. Node 18+ (global fetch).
//
//   OPENROUTER_API_KEY=sk-or-... node repro.mjs [rounds=10] [model=google/gemini-3.5-flash-lite]
//
// Each round sends two requests in parallel, identical apart from the tools:
//   search:  function tools + openrouter:web_search  (expected to break)
//   control: function tools only                    (negative test, expected to hold)
// The prompt asks for a plain-text answer, which pushes against tool_choice "required".
// Stops after the first round where the search request comes back without tool_calls.
// Every raw response goes to results/.

import fs from 'node:fs'
import path from 'node:path'

const key = process.env.OPENROUTER_API_KEY
if (!key) {
  console.error('Set OPENROUTER_API_KEY')
  process.exit(1)
}
const rounds = Number(process.argv[2] ?? 10)
const model = process.argv[3] ?? 'google/gemini-3.5-flash-lite'

const functionTools = [
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
]
const webSearch = { type: 'openrouter:web_search', parameters: { engine: 'exa', max_results: 1 } }

const makeRequest = (tools) => ({
  model,
  max_tokens: 3000,
  provider: { data_collection: 'deny' },
  reasoning: { effort: 'high' },
  tool_choice: 'required',
  tools,
  messages: [
    { role: 'system', content: 'Answer the user directly in plain text. Do not use function tools.' },
    { role: 'user', content: 'What was the closing price of NVDA stock yesterday? Look it up.' },
  ],
})
const arms = {
  search: makeRequest([...functionTools, webSearch]),
  control: makeRequest(functionTools),
}

const outDir = path.join('results', new Date().toISOString().replace(/[:.]/g, '-'))
fs.mkdirSync(outDir, { recursive: true })
for (const [arm, req] of Object.entries(arms)) {
  fs.writeFileSync(path.join(outDir, `request-${arm}.json`), JSON.stringify(req, null, 2))
}

async function send(arm, round) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(arms[arm]),
  })
  const body = await res.json()
  fs.writeFileSync(
    path.join(outDir, `${String(round).padStart(2, '0')}-${arm}.json`),
    JSON.stringify(body, null, 2),
  )
  const choice = body.choices?.[0]
  const toolCalls = choice?.message?.tool_calls ?? []
  return {
    round,
    arm,
    http: res.status,
    id: body.id,
    finish_reason: choice?.finish_reason,
    tool_calls: toolCalls.map((t) => t.function.name),
    has_content: typeof choice?.message?.content === 'string' && choice.message.content.length > 0,
    web_search_requests: body.usage?.server_tool_use_details?.web_search_requests ?? 0,
    error: body.error,
    violates_tool_choice_required: res.ok && !body.error && toolCalls.length === 0,
  }
}

const summary = []
const violations = { search: 0, control: 0 }
for (let round = 1; round <= rounds; round++) {
  const rows = await Promise.all(Object.keys(arms).map((arm) => send(arm, round)))
  for (const row of rows) {
    summary.push(row)
    if (row.violates_tool_choice_required) violations[row.arm]++
    console.log(
      `#${round} ${row.arm.padEnd(7)} ${row.id} http=${row.http} finish=${row.finish_reason}` +
        ` tool_calls=[${row.tool_calls}] content=${row.has_content} searches=${row.web_search_requests}` +
        (row.error ? ` error=${JSON.stringify(row.error)}` : '') +
        (row.violates_tool_choice_required ? '  <-- NO TOOL CALL despite tool_choice "required"' : ''),
    )
  }
  if (violations.search > 0) break
}

fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
const done = summary.length / 2
console.log(
  `\n${done} round(s). Responses without tool calls: search ${violations.search}/${done}, control ${violations.control}/${done}.` +
    `\n${violations.search ? 'Reproduced.' : 'Not reproduced, try again.'} Raw responses in ${outDir}/`,
)

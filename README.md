# `tool_choice: "required"` is ignored when `openrouter:web_search` runs

With function tools, `tool_choice: "required"` and the `openrouter:web_search`
server tool (engine `exa`) in one request, some responses come back with
`finish_reason: "stop"`, plain `message.content` and **no `tool_calls`**. That
breaks `tool_choice: "required"`.

## Run

```sh
OPENROUTER_API_KEY=sk-or-... node repro.mjs        # up to 10 requests
```

No dependencies (Node 18+). Requests go one at a time, and the script stops at
the first response with no tool call. Raw responses and `summary.json` go to
`results/<timestamp>/`.

## What we saw

Model `google/gemini-3.5-flash-lite` (provider Google), the request in `repro.mjs`:

| setup | responses without a tool call |
|---|---|
| `openrouter:web_search`, engine `exa` | 3 / 29 |
| `openrouter:web_search`, engine `parallel` | 0 / 10 |
| no server tools, our production traffic (mostly `gemini-3.6-flash`, 19 on `gemini-3.5-flash-lite`) | 0 / 1334 |

Every response that came back without a tool call had run 2–3 searches on
OpenRouter's side (`usage.server_tool_use_details.web_search_requests`).

Example failing generation: `gen-1794287986-BhlDx18UndbUQaeLDio8`

```json
"finish_reason": "stop",
"message": {
  "role": "assistant",
  "content": "The closing price of NVDA stock yesterday (Monday, November 9, 2026) was **$178.67**.",
  "annotations": [ /* 6 url_citation */ ]
},
"usage": { "server_tool_use_details": { "web_search_requests": 2, "tool_calls_requested": 2, "tool_calls_executed": 2 } }
```

## Expected

The final response has at least one function tool call, as `tool_choice: "required"` asks.

## Guess

`required` seems to apply only to the first step of the server-tool loop, where
a search counts as the required tool call. The steps after the search results come
back seem to run without it.

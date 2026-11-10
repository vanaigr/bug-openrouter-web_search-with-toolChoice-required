# `tool_choice: "required"` is ignored when `openrouter:web_search` runs

With function tools, `tool_choice: "required"` and the `openrouter:web_search`
server tool (engine `exa`) in one request, some responses come back with
`finish_reason: "stop"`, plain `message.content` and **no `tool_calls`**. That
breaks `tool_choice: "required"`. The same request without the server tool
always returns a tool call.

## Run

```sh
OPENROUTER_API_KEY=sk-or-... node repro.mjs                              # up to 10 rounds
OPENROUTER_API_KEY=sk-or-... node repro.mjs 10 google/gemini-3.6-flash   # other model
```

No dependencies (Node 18+). Each round sends two requests in parallel, identical
apart from `tools`:

- **search**: function tools + `{"type":"openrouter:web_search","parameters":{"engine":"exa","max_results":1}}`
- **control** (negative test): function tools only

The system prompt asks for a plain-text answer, which pushes against
`tool_choice: "required"`. The script stops after the first round where the
search request returns no tool call. Requests, raw responses and `summary.json`
go to `results/<timestamp>/`.

## What we saw

`google/gemini-3.5-flash-lite`, provider Google, current `repro.mjs`:

| round | search | control |
|---|---|---|
| 1 | `finish_reason: "stop"`, text, **no tool call**, 4 searches (`gen-1794290141-1lwLXugZfgvbXHDQU6ge`) | `text_reply` tool call (`gen-1794290141-mf0TYd1yHWwp5a7FFGLe`) |

Earlier runs, with a neutral prompt ("Always act via tools…") and `max_results: 3`:

| model | setup | responses without a tool call |
|---|---|---|
| `gemini-3.5-flash-lite` | `openrouter:web_search`, engine `exa` | 4 / 44 |
| `gemini-3.5-flash-lite` | `openrouter:web_search`, engine `parallel` | 0 / 10 |
| `gemini-3.6-flash` | `openrouter:web_search`, engine `exa` | 0 / 10 |
| mostly `gemini-3.6-flash`, 19 on `gemini-3.5-flash-lite` | no server tools (our production traffic) | 0 / 1334 |

Every response that came back without a tool call had run 2–4 searches on
OpenRouter's side (`usage.server_tool_use_details.web_search_requests`).
Earlier failures: `gen-1794289410-NVCCXDYj4eRQySnKeSZy`, `gen-1794287986-BhlDx18UndbUQaeLDio8`.

## Expected

The final response has at least one function tool call, as `tool_choice: "required"` asks.

## Guess

`required` seems to apply only to the first step of the server-tool loop, where
a search counts as the required tool call. The steps after the search results come
back seem to run without it.

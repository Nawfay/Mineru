# Mineru

Autonomous web navigation agent using Playwright and Groq Llama Vision.

## Setup

1. Install dependencies:
```bash
npm install

```


2. Copy `.env.example` to `.env` and add your Groq API key:
```
GROQ_API_KEY=your_api_key_here

```



## Usage

1. Open `src/main.ts` and update the `GOAL` variable with your prompt:
```typescript
const GOAL = "navigate to clutch.ca and find a 2021 BMW 3 Series"

```


2. Run the agent:
```bash
npm run dev

```



## Debugging

Session artifacts including screenshots, DOM element maps, and AI decision logs are saved to `debug-output/`.

## Project Structure

* `src/agent`: Main execution loop and action handlers.
* `src/ai`: Groq client configuration and prompt generation.
* `src/browser`: Playwright initialization and DOM tagging logic.
* `src/utils`: File logging and delay helpers.
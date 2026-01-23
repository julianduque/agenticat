# AgentiCat

A modern dashboard for interacting with AI agents using the [A2A (Agent-to-Agent) Protocol](https://google.github.io/A2A/).

![A2A Protocol](https://img.shields.io/badge/A2A-Protocol-blue)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Agent Registration** - Connect to A2A-compatible agents via URL or by pasting the agent card JSON
- **Real-time Chat** - Communicate with agents using JSON-RPC protocol with full streaming support (SSE)
- **Debug Panel** - Inspect raw JSON-RPC requests/responses with one-click cURL export
- **Task Tracking** - Monitor task lifecycle states (submitted, working, input-required, completed, failed)
- **Authentication** - Support for Bearer tokens, API keys, and custom headers
- **Conversation Export** - Save chat history as JSON or Markdown
- **Skills Discovery** - Explore agent capabilities with interactive skill examples
- **Dark/Light Theme** - Toggle between dark and light modes
- **Multi-endpoint Support** - Handle agents with multiple API endpoints

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) with App Router
- **Language**: TypeScript 5
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/) (Radix UI primitives)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
- **A2A SDK**: [@a2a-js/sdk](https://www.npmjs.com/package/@a2a-js/sdk)
- **Markdown**: react-markdown with syntax highlighting

## Getting Started

### Prerequisites

- Node.js 18+ 
- pnpm (recommended) or npm/yarn

### Installation

1. Clone the repository:

```bash
git clone https://github.com/julianduque/agenticat.git
cd agenticat
```

2. Install dependencies:

```bash
pnpm install
```

3. Start the development server:

```bash
pnpm dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Registering an Agent

1. Click the **Add** button in the Agents panel
2. Choose registration method:
   - **Card URL**: Enter the agent's base URL (automatically appends `/.well-known/agent-card.json`)
   - **Paste JSON**: Directly paste the agent card JSON configuration
3. Click **Register Agent**

### Chatting with Agents

1. Select a registered agent from the sidebar
2. Choose the endpoint and method (`message/send` or `message/stream`)
3. Type your message and press Enter or click Send
4. View streaming responses in real-time

### Configuring Authentication

1. Select an agent and click the **Auth** button
2. Choose authentication type:
   - **Bearer Token**: Standard OAuth/JWT bearer authentication
   - **API Key**: Custom header with API key value
   - **Custom Headers**: Define arbitrary HTTP headers as JSON

### Debugging Requests

1. Switch to the **Debug** tab to view all JSON-RPC communications
2. Click on any log entry to expand full request/response details
3. Use **Copy cURL** to export the request for external testing

### Task Management

1. Click the **Tasks** button to open the task panel
2. View tracked tasks with their current state
3. Fetch any task by ID using the `tasks/get` method
4. Refresh task status to see latest updates

## A2A Protocol Support

AgentiCat implements the following A2A protocol features:

| Feature | Status |
|---------|--------|
| Agent Card Discovery | ✅ |
| `message/send` | ✅ |
| `message/stream` | ✅ |
| `tasks/get` | ✅ |
| Streaming (SSE) | ✅ |
| Push Notifications | 🔜 |
| State Transition History | ✅ |
| Multi-turn Conversations | ✅ |
| Input-Required State | ✅ |
| Artifacts | ✅ |

## Scripts

```bash
pnpm dev      # Start development server
pnpm build    # Build for production
pnpm start    # Start production server
pnpm lint     # Run ESLint
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

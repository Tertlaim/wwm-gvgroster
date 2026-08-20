# wwm-gvgroster

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A roster management tool for Where Winds Meet Guild vs Guild wars.

## Features

- Assign and manage guild members to GvG rosters
- Simple, easy-to-use interface
- Track roster availability and scheduling

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

```bash
git clone https://github.com/Tertlaim/wwm-gvgroster.git
cd wwm-gvgroster
npm install
```

### Environment Setup

1. Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

2. Edit `.env` with your configuration:

```bash
# Storage backend: 'json' (default) or 'supabase'
STORAGE=json

# Supabase config (only needed when STORAGE=supabase)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key-here

# Server port
PORT=3000
```

3. If using Supabase, follow the [Supabase Setup Guide](SUPABASE_SETUP.md) to create tables.

### Run

```bash
npm start
```

Open http://localhost:3000 in your browser.

## Storage Options

| Backend | Use Case | Setup |
|---------|----------|-------|
| **JSON** (default) | Local development | No additional setup needed |
| **Supabase** | Cloud deployment (Render) | See [Supabase Setup Guide](SUPABASE_SETUP.md) |

## Deployment

See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for cloud deployment instructions.

## Usage

Open the tool in your browser after starting the server. From there you can create new rosters, add guild members, and assign them to GvG sessions.

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
